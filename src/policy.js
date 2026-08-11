import { evaluate, parseJsonResult } from './runner.js';
import { describeRef, getLease, getMode, isSnapshotStale } from './state.js';

/**
 * Words that mark an action as hard to undo. Matched against the accessible
 * name of the element being clicked, so "Delete repository" trips it and a
 * paragraph mentioning deletion does not.
 *
 * Override with LCU_IRREVERSIBLE (comma separated) to fit your own workflow.
 */
const DEFAULT_IRREVERSIBLE = [
  'delete', 'supprimer', 'remove', 'destroy', 'erase', 'drop',
  'uninstall', 'revoke', 'deactivate', 'desactiver', 'close account',
  'push', 'force push', 'merge', 'deploy', 'publish', 'publier',
  'pay', 'payer', 'purchase', 'acheter', 'checkout', 'place order', 'commander',
  'transfer', 'virement', 'withdraw', 'unsubscribe',
  'send', 'envoyer',
];

const IRREVERSIBLE = (process.env.LCU_IRREVERSIBLE
  ? process.env.LCU_IRREVERSIBLE.split(',')
  : DEFAULT_IRREVERSIBLE
).map((w) => w.trim().toLowerCase()).filter(Boolean);

const PASSWORD_NAME = /password|mot de passe|passwd|mdp|passphrase/i;

/**
 * Names that submit a login form. The credential guard only fires on these,
 * not on every click: plenty of pages carry a sign-in widget in a corner, and
 * blocking the whole page because of it would make the tool useless.
 */
const LOGIN_SUBMIT = /sign ?in|log ?in|se connecter|connexion|continue|continuer|next|suivant|valider|submit/i;

const EMAIL_IN_NAME = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Actions that change the page, as opposed to just reading it. */
const MUTATING = new Set(['click', 'type', 'fill', 'press', 'mouse', 'goto', 'tabs', 'history', 'open']);

/**
 * Ask the page what a login form currently looks like.
 *
 * Heuristic by nature: pages differ. It answers three things - is there a
 * password field, is it already filled by the browser password manager, and
 * does the page look like an account chooser.
 */
const LOGIN_PROBE = `(function () {
  var visible = function (el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  var pw = Array.prototype.filter.call(
    document.querySelectorAll('input[type=password]'), visible);
  var filled = pw.some(function (i) { return (i.value || '').length > 0; });
  var mail = /[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}/i;
  var pickers = Array.prototype.filter.call(
    document.querySelectorAll('a,button,li,[role=button],[role=link],[role=listitem],[data-identifier],[data-authuser]'),
    function (el) { return visible(el) && mail.test(el.textContent || ''); });
  var seen = {};
  pickers.forEach(function (el) {
    var m = (el.textContent || '').match(mail);
    if (m) seen[m[0].toLowerCase()] = 1;
  });
  var active = document.activeElement;
  return JSON.stringify({
    hasPassword: pw.length > 0,
    passwordFilled: filled,
    passwordFocused: !!(active && active.type === 'password'),
    accountChoices: Object.keys(seen).length
  });
})()`;

export async function probeLogin(session) {
  const result = await evaluate(session, LOGIN_PROBE);
  const parsed = parseJsonResult(result.stdout);
  return parsed || { hasPassword: false, passwordFilled: false, accountChoices: 0 };
}

function blocked(reason, detail) {
  return { allowed: false, reason, detail };
}

/**
 * Decide whether a tool call may proceed.
 *
 * Returns { allowed } or { allowed: false, reason, detail }. Guardrails that
 * protect credentials cannot be bypassed. The irreversible-action guard can,
 * but only when the caller passes confirm: true after asking the human - and
 * that stays true in auto mode.
 */
export async function check(tool, args, session) {
  if (!MUTATING.has(tool)) return { allowed: true };

  if (getLease() === 'human') {
    return blocked(
      'human_has_control',
      'The human took over in the dashboard. Wait for them to release control (Escape in the viewport), then call status.'
    );
  }

  if (isSnapshotStale() && (tool === 'click' || tool === 'fill')) {
    return blocked(
      'stale_snapshot',
      'The page changed while a human was driving. Call snapshot again before using element refs.'
    );
  }

  // Never let the agent put text into a password field. If credentials are
  // needed and the browser has not filled them in, a human types them.
  if (tool === 'fill') {
    const name = describeRef(session, String(args.ref || ''));
    if (name && PASSWORD_NAME.test(name)) {
      return blocked(
        'credential_entry',
        `"${name}" looks like a credential field. Ask the human to take over in the dashboard and type it themselves.`
      );
    }
  }

  if (tool === 'type') {
    const login = await probeLogin(session);
    if (login.passwordFocused) {
      return blocked(
        'credential_entry',
        'A password field has focus. Hand over to the human in the dashboard; the agent never types credentials.'
      );
    }
  }

  if (tool === 'click') {
    const name = describeRef(session, String(args.ref || '')) || String(args.ref || '');

    // Only probe when the target itself looks like a login step, so a sign-in
    // widget sitting in a corner does not freeze the rest of the page.
    if (LOGIN_SUBMIT.test(name) || EMAIL_IN_NAME.test(name)) {
      const login = await probeLogin(session);

      if (login.accountChoices > 1 && EMAIL_IN_NAME.test(name)) {
        return blocked(
          'account_choice',
          `The page offers ${login.accountChoices} accounts. Ask the human which one to use before continuing.`
        );
      }
      // A filled password field means the password manager already supplied
      // the credentials, so submitting is the human's own saved intent.
      if (login.hasPassword && !login.passwordFilled) {
        return blocked(
          'login_required',
          `"${name}" submits a login form whose password field is empty. Hand over to the human in the dashboard.`
        );
      }
    }
  }

  if (tool === 'click' && !args.confirm) {
    const name = describeRef(session, String(args.ref || '')) || String(args.ref || '');
    const hit = IRREVERSIBLE.find((word) => name.toLowerCase().includes(word));
    if (hit) {
      return blocked(
        'irreversible',
        `"${name}" matches "${hit}" and looks hard to undo. Ask the human, then call click again with confirm: true.`
      );
    }
  }

  return { allowed: true };
}

export const guardrails = {
  irreversible: IRREVERSIBLE,
  modes: ['normal', 'auto'],
  current: () => getMode(),
};
