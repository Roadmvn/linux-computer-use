#!/usr/bin/env node
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { evaluate, run } from './runner.js';
import { CURSOR_SOURCE } from './cursor.js';
import { check } from './policy.js';
import {
  audit, auditPath, getLease, getMode, getSession,
  markSnapshotStale, rememberSnapshot, setLease, setMode, setSession,
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
        profile: { type: 'string', description: 'Path to a persistent profile directory, to keep logins between runs.' },
        browser: { type: 'string', description: 'chrome, firefox, webkit or msedge. Defaults to bundled Chromium.' },
        cdp: { type: 'string', description: 'Attach to an existing browser instead of launching one, e.g. http://127.0.0.1:9222' },
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
    description: 'Type text into the focused element. Refused while a login form has an empty password field.',
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
    description: 'Report the session, the mode and who holds the control lease. Pass takeover to hand control to the human, or release it back to the agent.',
    inputSchema: {
      type: 'object',
      properties: {
        takeover: { type: 'boolean', description: 'true when the human takes control in the dashboard, false when they give it back.' },
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
];

const text = (value) => ({ content: [{ type: 'text', text: value }] });

/** Re-draw the agent cursor. Navigation wipes it, so this runs after every move. */
async function injectCursor(session) {
  await evaluate(session, CURSOR_SOURCE);
}

async function handle(name, args) {
  const session = args.session || getSession();

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
        const argv = ['open', '--headed'];
        if (args.url) argv.splice(1, 0, args.url);
        if (args.profile) { argv.push('--persistent', `--profile=${args.profile}`); }
        if (args.browser) argv.push(`--browser=${args.browser}`);
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
      audit({ tool: 'goto', session, url: args.url });
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
      const result = await run(session, ['click', String(args.ref)]);
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
      audit({ tool: 'press', session, key: args.key });
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
      let out = '';
      for (const argv of moves) {
        const result = await run(session, argv);
        out = result.stdout || result.stderr;
      }
      audit({ tool: 'mouse', session, action, x, y });
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
      if (args.takeover === true) setLease('human');
      if (args.takeover === false) setLease('agent');
      audit({ tool: 'status', session, lease: getLease() });
      return text(JSON.stringify({
        version: VERSION,
        session,
        mode: getMode(),
        lease: getLease(),
        auditLog: auditPath,
        note: getLease() === 'human'
          ? 'The human is driving. The agent cannot act until control is released.'
          : 'The agent is driving. Call snapshot after any human takeover before reusing refs.',
      }, null, 2));
    }

    case 'set_mode': {
      const mode = setMode(args.mode);
      audit({ tool: 'set_mode', mode });
      return text(`mode: ${mode}`);
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
