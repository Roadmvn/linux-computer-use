#!/usr/bin/env node
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { displayProblem, evaluate, run } from './runner.js';
import { CURSOR_SOURCE } from './cursor.js';
import { check } from './policy.js';
import * as desktop from './desktop.js';
import {
  audit, auditPath, getLease, getMode, getSession, leasePath,
  markSnapshotStale, rememberSnapshot, safeUrl, setMode, setSession, takeOver,
} from './state.js';

const VERSION = '0.1.0';

const TOOLS = [
  {
    name: 'open',
    description: 'Open a browser session, or attach to a browser already running with a CDP endpoint. Call this first.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to load once the browser is up.' },
        session: { type: 'string', description: 'Session name. Sessions have separate cookies and tabs. Defaults to "default".' },
        profile: { type: 'string', description: 'Path to a persistent profile directory, to keep logins between runs. Ignored when cdp is set, since the running browser already has its own.' },
        browser: { type: 'string', description: 'chromium (default, the bundled build), chrome, firefox, webkit or msedge. Ignored when cdp is set.' },
        cdp: { type: 'string', description: 'Attach to a browser already running with --remote-debugging-port instead of launching one, e.g. http://127.0.0.1:9222' },
      },
    },
  },
  {
    name: 'goto',
    description: 'Navigate the current tab to a URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'snapshot',
    description: 'Accessibility tree of the page with a ref for each element. Use these refs with click and fill. Prefer this over screenshot for acting: it is exact and cheap.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'screenshot',
    description: 'Image of the page. Use it to read visual content, verify a result, or work out coordinates for the mouse tool.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'click',
    description: 'Click an element by its ref from snapshot. Blocked when the element looks irreversible unless confirm is true.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot, e.g. e42. A CSS or role selector also works.' },
        confirm: { type: 'boolean', description: 'Set true only after a human approved an action flagged as irreversible.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'type',
    description: 'Type text into the focused element. Refused when a password field has focus.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'fill',
    description: 'Fill a field identified by its ref. Refused on credential fields.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' }, text: { type: 'string' } },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'press',
    description: 'Press a key, for example Enter, Tab or ArrowDown.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
  },
  {
    name: 'mouse',
    description: 'Coordinate based mouse control for canvas, maps and custom widgets that have no accessible element. Take a screenshot first to read the coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['move', 'click', 'down', 'up', 'wheel'] },
        x: { type: 'number' },
        y: { type: 'number' },
        confirm: { type: 'boolean', description: 'Set true only after a human approved an action flagged as irreversible.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tabs',
    description: 'List, open, select or close tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
        index: { type: 'number', description: 'Tab index for select and close.' },
        url: { type: 'string', description: 'URL for new.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'history',
    description: 'Go back, go forward or reload.',
    inputSchema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['back', 'forward', 'reload'] } },
      required: ['direction'],
    },
  },
  {
    name: 'status',
    description: 'Report the session, the mode and who holds the control lease. Pass takeover: true to hand control to the human before they act in the dashboard. Control comes back only when the human releases it on their machine, never through this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        takeover: { type: 'boolean', description: 'true to hand control to the human. There is no value that takes it back.' },
      },
    },
  },
  {
    name: 'set_mode',
    description: 'normal asks before sensitive actions. auto runs a complete objective end to end, stopping only for an empty login, an account choice, or an irreversible action.',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['normal', 'auto'] } },
      required: ['mode'],
    },
  },

  // Desktop backend. The agent gets a nested X display of its own, so it can
  // drive native applications without taking the mouse away from the human.
  {
    name: 'desktop_start',
    description: 'Start the agent desktop, a nested X display in a resizable window. Required before any other desktop tool. Pass stop: true to shut it down.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Defaults to 1280.' },
        height: { type: 'number', description: 'Defaults to 800.' },
        stop: { type: 'boolean', description: 'Shut the desktop down instead of starting it.' },
      },
    },
  },
  {
    name: 'desktop_windows',
    description: 'List the visible windows on the agent desktop, with id, title, class and geometry.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop_focus',
    description: 'Bring a window of the agent desktop to the front. Keyboard input goes to the focused window.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Window id from desktop_windows.' } },
      required: ['id'],
    },
  },
  {
    name: 'desktop_screenshot',
    description: 'Capture the agent desktop, or a single window of it. Use it to find coordinates before clicking.',
    inputSchema: {
      type: 'object',
      properties: { window: { type: 'string', description: 'Window id. Omit for the whole desktop.' } },
    },
  },
  {
    name: 'desktop_click',
    description: 'Move the pointer of the agent desktop and click. Coordinates come from desktop_screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'number', description: '1 left, 2 middle, 3 right. Defaults to 1.' },
        move_only: { type: 'boolean', description: 'Move the pointer without clicking.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop_type',
    description: 'Type text into the focused window of the agent desktop. Typing into a terminal needs confirm, because a shell runs whatever it receives.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        confirm: { type: 'boolean', description: 'Required when a terminal has focus, after the human approved.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'desktop_key',
    description: 'Press a key or combination on the agent desktop, for example Return, ctrl+c or alt+Tab.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        confirm: { type: 'boolean', description: 'Required when a terminal has focus.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'desktop_launch',
    description: 'Start an application on the agent desktop, found by name in the desktop catalog. Applications outside the allowed list need confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Name or part of it, for example burp or wireshark.' },
        confirm: { type: 'boolean', description: 'Required for an application outside the allowed list.' },
      },
      required: ['app'],
    },
  },
];

const text = (value) => ({ content: [{ type: 'text', text: value }] });

/** Re-draw the agent cursor. Navigation wipes it, so this runs after every move. */
async function injectCursor(session) {
  await evaluate(session, CURSOR_SOURCE);
}

/**
 * Let the overlay follow the next few moments of input.
 *
 * Without this the cursor tracked the human's pointer too, so the two were
 * impossible to tell apart during a takeover.
 */
async function armCursor(session) {
  await evaluate(session, 'window.__lcuArm && window.__lcuArm(3000)');
}

async function handle(name, args) {
  const session = args.session || getSession();

  if (name.startsWith('desktop_')) {
    if (getLease() === 'human') {
      audit({ tool: name, blocked: 'human_has_control' });
      return text(`BLOCKED (human_has_control)\n\nThe human is driving. Control returns when they delete ${leasePath}.`);
    }
    if (name !== 'desktop_start' && !desktop.isRunning()) {
      return text('The agent desktop is not running. Call desktop_start first.');
    }
  }

  const verdict = await check(name, args, session);
  if (!verdict.allowed) {
    audit({ tool: name, session, blocked: verdict.reason });
    return text(`BLOCKED (${verdict.reason})\n\n${verdict.detail}`);
  }

  switch (name) {
    case 'open': {
      setSession(args.session || 'default');
      const target = getSession();
      let result;
      if (args.cdp) {
        result = await run(target, ['attach', `--cdp=${args.cdp}`], { timeout: 90000 });
      } else {
        const problem = displayProblem();
        if (problem) return text(`CANNOT OPEN A BROWSER\n\n${problem}`);
        const argv = ['open', '--headed'];
        if (args.url) argv.splice(1, 0, args.url);
        if (args.profile) { argv.push('--persistent', `--profile=${args.profile}`); }
        // Default to the bundled build. Upstream defaults to the chrome
        // channel, which is not what the installer downloads, so a machine
        // without Google Chrome failed on the very first call.
        argv.push(`--browser=${args.browser || 'chromium'}`);
        result = await run(target, argv, { timeout: 120000 });
      }
      if (args.cdp && args.url) await run(target, ['goto', args.url]);
      await injectCursor(target);
      audit({ tool: 'open', session: target, attached: Boolean(args.cdp) });
      return text(result.stdout || result.stderr || 'opened');
    }

    case 'goto': {
      const result = await run(session, ['goto', args.url]);
      await injectCursor(session);
      markSnapshotStale();
      // origin only: paths carry magic-link and password-reset tokens
      audit({ tool: 'goto', session, origin: safeUrl(args.url) });
      return text(result.stdout || result.stderr);
    }

    case 'snapshot': {
      const result = await run(session, ['snapshot']);
      rememberSnapshot(session, result.stdout);
      audit({ tool: 'snapshot', session });
      return text(result.stdout || result.stderr);
    }

    case 'screenshot': {
      const file = join(tmpdir(), `lcu-${Date.now()}.png`);
      const result = await run(session, ['screenshot', `--filename=${file}`], { timeout: 60000 });
      audit({ tool: 'screenshot', session });
      try {
        const data = readFileSync(file).toString('base64');
        unlinkSync(file);
        return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
      } catch {
        return text(result.stdout || result.stderr || 'screenshot failed');
      }
    }

    case 'click': {
      await armCursor(session);
      const result = await run(session, ['click', String(args.ref)]);
      // A click routinely navigates, which invalidates every other ref.
      markSnapshotStale();
      await injectCursor(session);
      audit({ tool: 'click', session, ref: args.ref, confirmed: Boolean(args.confirm) });
      return text(result.stdout || result.stderr);
    }

    case 'type': {
      const result = await run(session, ['type', String(args.text)]);
      // length only: the text itself never reaches the log
      audit({ tool: 'type', session, chars: String(args.text).length });
      return text(result.stdout || result.stderr);
    }

    case 'fill': {
      const result = await run(session, ['fill', String(args.ref), String(args.text)]);
      audit({ tool: 'fill', session, ref: args.ref, chars: String(args.text).length });
      return text(result.stdout || result.stderr);
    }

    case 'press': {
      const result = await run(session, ['press', String(args.key)]);
      markSnapshotStale();
      await injectCursor(session);
      // The key itself is never logged: a password typed one press at a time
      // would otherwise be reconstructible from this file.
      audit({ tool: 'press', session });
      return text(result.stdout || result.stderr);
    }

    case 'mouse': {
      const { action, x, y } = args;
      const moves = {
        move: [['mousemove', String(x), String(y)]],
        down: [['mousedown']],
        up: [['mouseup']],
        wheel: [['mousewheel', String(x ?? 0), String(y ?? 0)]],
        click: [['mousemove', String(x), String(y)], ['mousedown'], ['mouseup']],
      }[action];
      if (!moves) return text(`unknown mouse action: ${action}`);
      await armCursor(session);
      let out = '';
      for (const argv of moves) {
        const result = await run(session, argv);
        out = result.stdout || result.stderr;
      }
      if (action !== 'move') { markSnapshotStale(); await injectCursor(session); }
      audit({ tool: 'mouse', session, action, x, y, confirmed: Boolean(args.confirm) });
      return text(out || `mouse ${action} done`);
    }

    case 'tabs': {
      const argv = {
        list: ['tab-list'],
        new: ['tab-new', ...(args.url ? [args.url] : [])],
        select: ['tab-select', String(args.index)],
        close: ['tab-close', ...(args.index === undefined ? [] : [String(args.index)])],
      }[args.action];
      if (!argv) return text(`unknown tabs action: ${args.action}`);
      const result = await run(session, argv);
      if (args.action !== 'list') { markSnapshotStale(); await injectCursor(session); }
      audit({ tool: 'tabs', session, action: args.action, index: args.index });
      return text(result.stdout || result.stderr);
    }

    case 'history': {
      const argv = { back: ['go-back'], forward: ['go-forward'], reload: ['reload'] }[args.direction];
      if (!argv) return text(`unknown direction: ${args.direction}`);
      const result = await run(session, argv);
      markSnapshotStale();
      await injectCursor(session);
      audit({ tool: 'history', session, direction: args.direction });
      return text(result.stdout || result.stderr);
    }

    case 'status': {
      if (args.takeover === true) takeOver();
      audit({ tool: 'status', session, lease: getLease() });
      const human = getLease() === 'human';
      return text(JSON.stringify({
        version: VERSION,
        session,
        mode: getMode(),
        lease: getLease(),
        auditLog: auditPath,
        note: human
          ? `The human is driving. The agent cannot act. Control returns only when the human deletes ${leasePath} on their machine, which this tool cannot do.`
          : 'The agent is driving. Call snapshot after any human takeover before reusing refs.',
        releaseCommand: human ? `rm ${leasePath}` : undefined,
      }, null, 2));
    }

    case 'set_mode': {
      const mode = setMode(args.mode);
      audit({ tool: 'set_mode', mode });
      return text(`mode: ${mode}`);
    }

    case 'desktop_start': {
      if (args.stop) {
        const stopped = desktop.stop();
        audit({ tool: 'desktop_start', stopped: true });
        return text(JSON.stringify(stopped, null, 2));
      }
      const started = desktop.start({ width: args.width, height: args.height });
      audit({ tool: 'desktop_start', display: started.display, ok: started.ok });
      if (!started.ok) return text(`COULD NOT START THE DESKTOP\n\n${started.error}`);
      return text(JSON.stringify({
        ...started,
        allowedApps: desktop.allowedApps,
        note: started.note
          ? 'Reattached to the desktop that was already running, with everything still open in it.'
          : 'A window titled "agent desktop" opened on your screen. You can minimise it; the agent keeps working. Its pointer and focus are separate from yours.',
      }, null, 2));
    }

    case 'desktop_windows':
      return text(JSON.stringify(desktop.listWindows(), null, 2));

    case 'desktop_focus': {
      const r = desktop.focusWindow(args.id);
      audit({ tool: 'desktop_focus', id: args.id });
      return text(r.ok ? `focused ${args.id}` : `could not focus ${args.id}: ${r.error}`);
    }

    case 'desktop_screenshot': {
      const file = join(tmpdir(), `lcu-desk-${Date.now()}.png`);
      const r = desktop.capture(file, args.window);
      audit({ tool: 'desktop_screenshot', window: args.window });
      if (!r.ok) return text(`capture failed: ${r.error}`);
      try {
        const data = readFileSync(file).toString('base64');
        unlinkSync(file);
        return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
      } catch (error) {
        return text(`capture unreadable: ${error.message}`);
      }
    }

    case 'desktop_click': {
      const r = args.move_only
        ? desktop.move(args.x, args.y)
        : desktop.click(args.x, args.y, args.button || 1);
      audit({ tool: 'desktop_click', x: args.x, y: args.y, button: args.button || 1 });
      return text(r.ok ? `${args.move_only ? 'moved to' : 'clicked'} ${args.x},${args.y}` : r.error);
    }

    case 'desktop_type':
    case 'desktop_key': {
      // A shell runs whatever reaches it, so a terminal is a checkpoint even
      // though the agent already has the user's account on this path.
      if (desktop.isTerminalFocused() && !args.confirm) {
        return text(`BLOCKED (terminal_focused)\n\nA terminal window has focus (${desktop.focusedClass()}), and a shell acts on whatever it receives. Ask the human, then repeat the call with confirm: true.`);
      }
      const r = name === 'desktop_type' ? desktop.typeText(args.text) : desktop.key(args.key);
      // Neither the text nor the key is written to the log.
      audit({ tool: name, chars: name === 'desktop_type' ? String(args.text).length : undefined, confirmed: Boolean(args.confirm) });
      return text(r.ok ? 'done' : r.error);
    }

    case 'desktop_launch': {
      const matches = desktop.findApp(args.app);
      if (!matches.length) return text(`No application matching "${args.app}" in the desktop catalog.`);
      const app = matches.find((m) => desktop.isAllowed(m)) || matches[0];
      if (!desktop.isAllowed(app) && !args.confirm) {
        return text(`BLOCKED (app_not_allowed)\n\n"${app.name}" is outside the allowed list (${desktop.allowedApps.join(', ')}). Ask the human, then repeat with confirm: true, or set LCU_APPS.\n\nMatches: ${matches.slice(0, 5).map((m) => m.name).join(', ')}`);
      }
      const r = desktop.launch(app);
      audit({ tool: 'desktop_launch', app: app.id, confirmed: Boolean(args.confirm) });
      return text(`launched ${app.name}. Call desktop_windows in a moment: applications take a few seconds to map their window.`);
    }

    default:
      return text(`unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'linux-computer-use', version: VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    return await handle(name, args);
  } catch (error) {
    audit({ tool: name, error: error.message });
    return { ...text(`error in ${name}: ${error.message}`), isError: true };
  }
});

await server.connect(new StdioServerTransport());
