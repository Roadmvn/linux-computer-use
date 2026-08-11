import { evaluate, parseJsonResult } from './runner.js';
import { describeRef, getLease, getMode, isSnapshotStale, leasePath } from './state.js';

/**
 * Words that mark an action as hard to undo, matched against the accessible
 * name of the element being acted on.
 *
 * Matched on word boundaries. Plain substring matching blocked "Dropbox"
 * because it contains "drop", and "Sendgrid" because it contains "send".
 *
 * Override with LCU_IRREVERSIBLE (comma separated).
 */
const DEFAULT_IRREVERSIBLE = [
  'delete', 'supprimer', 'remove', 'destroy', 'erase', 'drop', 'empty trash',
  'uninstall', 'revoke', 'deactivate', 'close account', 'cancel subscription',
  'push', 'force push', 'merge', 'deploy', 'publish', 'publier',
  'pay', 'payer', 'purchase', 'acheter', 'checkout', 'place order', 'commander',
  'transfer', 'virement', 'withdraw', 'unsubscribe',
  'send', 'envoyer', 'yes, i am sure', 'i understand',
];

const IRREVERSIBLE = (process.env.LCU_IRREVERSIBLE
  ? process.env.LCU_IRREVERSIBLE.split(',')
  : DEFAULT_IRREVERSIBLE
).map((w) => w.trim().toLowerCase()).filter(Boolean);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every name list is matched on word boundaries. Substring matching flagged
 * "Dropbox" for "drop" and "Sendgrid" for "send" - a guardrail that cries wolf
 * on ordinary product names gets switched off by its users.
 */
const wordRe = (words) => new RegExp(`(^|\\W)(${words.map(escape).join('|')})(\\W|$)`, 'i');

const IRREVERSIBLE_RE = wordRe(IRREVERSIBLE);

const PASSWORD_NAME = /password|mot de passe|passwd|mdp|passphrase/i;

/**
 * Names that submit a login form. The credential guard fires on these, not on
 * every click: plenty of pages carry a sign-in widget in a corner, and
 * blocking the whole page because of it would make the tool useless.
 */
const LOGIN_SUBMIT = wordRe([
  'sign in', 'signin', 'log in', 'login', 'se connecter', 'connexion',
  'continue', 'continuer', 'next', 'suivant', 'valider', 'submit',
]);
const SUBMIT_NAME = wordRe([
  'submit', 'save', 'send', 'post', 'create', 'confirm', 'apply',
  'valider', 'enregistrer', 'envoyer',
]);
const EMAIL_IN_NAME = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Keys that cannot commit anything on their own. Anything else is treated as input. */
const INERT_KEYS = /^(tab|escape|arrow(up|down|left|right)|page(up|down)|home|end|f\d{1,2})$/i;

/** Tools that change something, as opposed to just reading. */
const MUTATING = new Set(['click', 'type', 'fill', 'press', 'mouse', 'goto', 'tabs', 'history', 'open']);

/** Tools that act on whatever is under the pointer or has focus. */
const AIMED = new Set(['click', 'mouse', 'press', 'type', 'fill']);

const PROBE_BODY = `
  var visible = function (el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  var pw = Array.prototype.filter.call(
    document.querySelectorAll('input[type=password]'), visible);
  var mail = /[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}/i;
  var seen = {};
  Array.prototype.forEach.call(
    document.querySelectorAll('a,button,li,[role=button],[role=link],[role=listitem],[data-identifier],[data-authuser]'),
    function (el) {
      if (!visible(el)) return;
      var m = (el.textContent || '').match(mail);
      if (m) seen[m[0].toLowerCase()] = 1;
    });
  var active = document.activeElement;
  var out = {
    ok: true,
    hasPassword: pw.length > 0,
    passwordFilled: pw.some(function (i) { return (i.value || '').length > 0; }),
    passwordFocused: !!(active && active.type === 'password'),
    accountChoices: Object.keys(seen).length
  };`;

const LOGIN_PROBE = `(function () {${PROBE_BODY}
  return JSON.stringify(out);
})()`;

/** Same probe, plus the accessible name of whatever sits at a pixel position. */
const pointProbe = (x, y) => `(function () {${PROBE_BODY}
  var at = document.elementFromPoint(${x}, ${y});
  // Stop before BODY and HTML: they hold the whole page text, so walking into
  // them would make a click on empty space look like a named target.
  var generic = { BODY: 1, HTML: 1 };
  var named = at;
  while (named && !generic[named.tagName]
         && !(named.getAttribute && (named.getAttribute('aria-label') || (named.textContent || '').trim()))) {
    named = named.parentElement;
  }
  if (named && generic[named.tagName]) named = null;
  out.pointFound = !!(at && !generic[at.tagName]);
  out.pointName = named
    ? ((named.getAttribute && named.getAttribute('aria-label')) || (named.textContent || '')).trim().slice(0, 120)
    : '';
  out.pointIsPassword = !!(at && at.type === 'password');
  return JSON.stringify(out);
})()`;

async function probe(session, expression) {
  const result = await evaluate(session, expression);
  const parsed = parseJsonResult(result.stdout);
  return parsed && parsed.ok === true ? parsed : null;
}

export const probeLogin = (session) => probe(session, LOGIN_PROBE);

function blocked(reason, detail) {
  return { allowed: false, reason, detail };
}

/** Name-based rules, shared by ref clicks and coordinate clicks. */
function judgeName(name, args, page) {
  if (page.accountChoices > 1 && EMAIL_IN_NAME.test(name)) {
    return blocked(
      'account_choice',
      `The page offers ${page.accountChoices} accounts. Ask the human which one to use before continuing.`
    );
  }
  if ((LOGIN_SUBMIT.test(name) || EMAIL_IN_NAME.test(name))
      && page.hasPassword && !page.passwordFilled) {
    return blocked(
      'login_required',
      `"${name}" submits a login form whose password field is empty. Hand over to the human with status {takeover: true}.`
    );
  }
  if (!args.confirm && IRREVERSIBLE_RE.test(name)) {
    return blocked(
      'irreversible',
      `"${name}" looks hard to undo. Ask the human, then repeat the call with confirm: true.`
    );
  }
  // normal mode keeps a checkpoint before committing a form; auto mode does not.
  if (!args.confirm && getMode() === 'normal' && SUBMIT_NAME.test(name)) {
    return blocked(
      'confirm_submit',
      `"${name}" commits a form and the server is in normal mode. Ask the human, then repeat with confirm: true, or switch to auto with set_mode.`
    );
  }
  return { allowed: true };
}

/**
 * Decide whether a tool call may proceed.
 *
 * Everything here fails closed: when the page cannot be read, or an element
 * cannot be named, the action is refused. The earlier version allowed in both
 * cases, which meant a missing snapshot silently disabled every guardrail.
 */
export async function check(tool, args, session) {
  if (!MUTATING.has(tool)) return { allowed: true };

  if (getLease() === 'human') {
    return blocked(
      'human_has_control',
      `The human is driving. The agent cannot act until they release control by deleting ${leasePath}.`
    );
  }

  if (!AIMED.has(tool)) return { allowed: true };

  if (isSnapshotStale() && (tool === 'click' || tool === 'fill')) {
    return blocked(
      'stale_snapshot',
      'The page changed since the last snapshot, so element refs may point at the wrong thing. Call snapshot again.'
    );
  }

  if (tool === 'fill') {
    const name = describeRef(session, String(args.ref || ''));
    if (name === null) {
      return blocked(
        'unknown_target',
        `Cannot establish what "${args.ref}" is, so it cannot be checked. Call snapshot and use a ref from it.`
      );
    }
    if (PASSWORD_NAME.test(name)) {
      return blocked(
        'credential_entry',
        `"${name}" is a credential field. Hand over with status {takeover: true} and let the human type it.`
      );
    }
    return { allowed: true };
  }

  if (tool === 'type' || tool === 'press') {
    // Navigation keys commit nothing, so they need no page read.
    if (tool === 'press' && INERT_KEYS.test(String(args.key || ''))) return { allowed: true };

    const page = await probeLogin(session);
    if (!page) {
      return blocked(
        'page_unreadable',
        'The page state could not be read, so credential protection cannot be applied. Retry, or call snapshot first.'
      );
    }
    if (page.passwordFocused) {
      return blocked(
        'credential_entry',
        'A password field has focus. Hand over with status {takeover: true}; the agent never types credentials.'
      );
    }
    if (tool === 'press' && page.hasPassword && !page.passwordFilled) {
      return blocked(
        'login_required',
        'A login form with an empty password field is on screen, so this key could submit it. Hand over to the human.'
      );
    }
    return { allowed: true };
  }

  if (tool === 'click') {
    const name = describeRef(session, String(args.ref || ''));
    if (name === null) {
      return blocked(
        'unknown_target',
        `Cannot establish what "${args.ref}" is, so it cannot be checked. Call snapshot and click a ref from it.`
      );
    }
    const page = await probeLogin(session);
    if (!page) {
      return blocked('page_unreadable', 'The page state could not be read. Retry, or call snapshot first.');
    }
    return judgeName(name, args, page);
  }

  if (tool === 'mouse') {
    const { action, x, y } = args;
    if (action === 'move' || action === 'wheel') return { allowed: true };
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return blocked('unknown_target', 'A click by coordinates needs finite x and y so the target can be identified.');
    }
    const page = await probe(session, pointProbe(Number(x), Number(y)));
    if (!page) {
      return blocked('page_unreadable', 'The page state could not be read, so this coordinate click cannot be checked.');
    }
    if (page.pointIsPassword) {
      return blocked(
        'credential_entry',
        'That position is a password field. Hand over with status {takeover: true}.'
      );
    }
    if (!page.pointFound || !page.pointName) {
      return blocked(
        'unknown_target',
        `Nothing identifiable sits at (${x}, ${y}). Prefer snapshot and click a ref, which can be checked.`
      );
    }
    return judgeName(page.pointName, args, page);
  }

  return { allowed: true };
}
