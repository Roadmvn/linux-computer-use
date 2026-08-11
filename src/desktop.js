import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Nested desktop backend.
 *
 * The agent gets its own X display inside a window, rather than sharing the
 * one you are using. That is not a preference: on a shared display xdotool
 * drives the single core pointer, so the agent takes the mouse away from you,
 * and sending input to a background window does not work either - modern
 * toolkits ignore synthetic XSendEvent input on purpose. A nested display is
 * the only arrangement where the agent works while you keep using your machine.
 *
 * Applications keep their configuration: it lives on disk per user, not per
 * display, so Burp launched here has the same settings, extensions and CA as
 * the one you launch yourself.
 */

const APP_DIRS = [
  '/usr/share/applications',
  '/usr/local/share/applications',
  `${process.env.HOME}/.local/share/applications`,
];

/** Applications the agent may start without asking. Override with LCU_APPS. */
const DEFAULT_APPS = [
  'burpsuite', 'wireshark', 'firefox', 'firefox-esr', 'chromium',
  'zaproxy', 'ghidra', 'cutter', 'gedit', 'mousepad', 'thunar',
];

const ALLOWED = (process.env.LCU_APPS ? process.env.LCU_APPS.split(',') : DEFAULT_APPS)
  .map((a) => a.trim().toLowerCase()).filter(Boolean);

/** Window classes that mean a shell is on the other side of the keystrokes. */
const TERMINAL_CLASS = /terminal|xterm|konsole|alacritty|kitty|tilix|urxvt|st-256color|wezterm/i;

/**
 * The desktop outlives this process, so where it is has to be written down.
 *
 * Xephyr is detached: when the MCP client restarts the server, the desktop and
 * everything running in it are still there. Keeping the display number only in
 * memory meant a restart opened a second desktop and abandoned the first, with
 * the applications still inside it.
 */
const DATA_DIR = process.env.LCU_DATA_DIR || join(homedir(), '.linux-computer-use');
const DESKTOP_FILE = join(DATA_DIR, 'desktop.json');

const state = { display: null, xephyr: null, wm: null };

const displayAnswers = (display) =>
  spawnSync('xdpyinfo', ['-display', display], { stdio: 'ignore' }).status === 0;

function remember() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DESKTOP_FILE, JSON.stringify(state), { mode: 0o600 });
  } catch { /* not worth failing a run over */ }
}

function forget() {
  try { rmSync(DESKTOP_FILE, { force: true }); } catch { /* already gone */ }
}

/** Pick up a desktop an earlier run left behind, if it is still alive. */
function recover() {
  if (state.display) return true;
  if (!existsSync(DESKTOP_FILE)) return false;
  try {
    const saved = JSON.parse(readFileSync(DESKTOP_FILE, 'utf8'));
    if (saved.display && displayAnswers(saved.display)) {
      Object.assign(state, saved);
      return true;
    }
  } catch { /* unreadable, treat as none */ }
  forget();
  return false;
}

const sh = (cmd, args, display = state.display) => spawnSync(cmd, args, {
  encoding: 'utf8',
  env: display ? { ...process.env, DISPLAY: display } : process.env,
});

export const isRunning = () => recover();
export const getDisplay = () => (recover() ? state.display : null);

/** A display number nothing else answers on. */
function freeDisplay() {
  for (let n = 20; n < 40; n += 1) {
    if (!displayAnswers(`:${n}`)) return `:${n}`;
  }
  return null;
}

export function start({ width = 1280, height = 800 } = {}) {
  if (recover()) {
    return { ok: true, display: state.display, note: 'reattached to the desktop already running' };
  }

  if (!process.env.DISPLAY) {
    return { ok: false, error: 'No DISPLAY set, so there is no screen to put the nested desktop on.' };
  }
  const display = freeDisplay();
  if (!display) return { ok: false, error: 'No free display number between :20 and :39.' };

  const host = process.env.DISPLAY;
  // Whoever you were working in, so the new window does not take the keyboard
  // from you. The desktop appears, it does not interrupt.
  const hostFocus = (spawnSync('xdotool', ['getactivewindow'], {
    encoding: 'utf8', env: { ...process.env, DISPLAY: host },
  }).stdout || '').trim();

  const xephyr = spawn('Xephyr', [
    display, '-screen', `${width}x${height}`, '-resizeable',
    // without this Xephyr grabs the keyboard and pointer as soon as they enter
    // its window, which is startling when you only meant to pass over it
    '-no-host-grab',
    '-title', 'agent desktop (linux-computer-use)',
  ], { stdio: 'ignore', detached: true });
  xephyr.unref();

  // Give the server a moment, then confirm it actually answers.
  const deadline = Date.now() + 8000;
  let up = false;
  while (Date.now() < deadline) {
    if (spawnSync('xdpyinfo', ['-display', display], { stdio: 'ignore' }).status === 0) { up = true; break; }
    spawnSync('sleep', ['0.3']);
  }
  if (!up) {
    try { process.kill(-xephyr.pid); } catch { /* already gone */ }
    return {
      ok: false,
      error: `Xephyr did not come up on ${display}. On Debian based systems: sudo apt install xserver-xephyr xdotool imagemagick xfwm4`,
    };
  }

  // A window manager, so applications can be focused, moved and resized.
  const wm = spawn('xfwm4', [], {
    stdio: 'ignore', detached: true, env: { ...process.env, DISPLAY: display },
  });
  wm.unref();

  // Hand the keyboard back to the window you were in. Without this the agent
  // desktop jumps in front the moment it is created.
  if (hostFocus) {
    spawnSync('sleep', ['0.6']);
    spawnSync('xdotool', ['windowactivate', hostFocus], {
      stdio: 'ignore', env: { ...process.env, DISPLAY: host },
    });
  }

  state.display = display;
  state.xephyr = xephyr.pid;
  state.wm = wm.pid;
  remember();
  return { ok: true, display, size: `${width}x${height}` };
}

export function stop() {
  if (!recover()) return { ok: true, note: 'not running' };
  for (const pid of [state.wm, state.xephyr]) {
    try { if (pid) process.kill(pid); } catch { /* already gone */ }
  }
  const was = state.display;
  state.display = null; state.xephyr = null; state.wm = null;
  forget();
  return { ok: true, note: `stopped ${was}` };
}

/** Visible, named windows only: the raw search also returns invisible helpers. */
export function listWindows() {
  const found = sh('xdotool', ['search', '--onlyvisible', '--name', '.*']);
  const ids = (found.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const windows = [];
  for (const id of ids) {
    const name = (sh('xdotool', ['getwindowname', id]).stdout || '').trim();
    if (!name) continue;
    const geo = (sh('xdotool', ['getwindowgeometry', '--shell', id]).stdout || '');
    const num = (key) => Number((geo.match(new RegExp(`${key}=(\\d+)`)) || [])[1] || 0);
    const cls = (sh('xdotool', ['getwindowclassname', id]).stdout || '').trim();
    windows.push({ id, name, class: cls, x: num('X'), y: num('Y'), width: num('WIDTH'), height: num('HEIGHT') });
  }
  return windows;
}

export function focusWindow(id) {
  const r = sh('xdotool', ['windowactivate', '--sync', String(id)]);
  return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || '').trim() || 'could not focus' };
}

/** Class name of whatever currently has focus, used to spot a shell. */
export function focusedClass() {
  const id = (sh('xdotool', ['getactivewindow']).stdout || '').trim();
  if (!id) return '';
  return (sh('xdotool', ['getwindowclassname', id]).stdout || '').trim();
}

export const isTerminalFocused = () => TERMINAL_CLASS.test(focusedClass());

export function capture(file, windowId) {
  const target = windowId ? String(windowId) : 'root';
  const r = sh('import', ['-window', target, file]);
  return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || '').trim() || 'capture failed' };
}

export function move(x, y) {
  sh('xdotool', ['mousemove', String(x), String(y)]);
  return { ok: true };
}

export function click(x, y, button = 1) {
  if (Number.isFinite(x) && Number.isFinite(y)) sh('xdotool', ['mousemove', String(x), String(y)]);
  const r = sh('xdotool', ['click', String(button)]);
  return r.status === 0 ? { ok: true } : { ok: false, error: 'click failed' };
}

export function typeText(text) {
  const r = sh('xdotool', ['type', '--delay', '25', '--', String(text)]);
  return r.status === 0 ? { ok: true } : { ok: false, error: 'type failed' };
}

export function key(combo) {
  const r = sh('xdotool', ['key', '--', String(combo)]);
  return r.status === 0 ? { ok: true } : { ok: false, error: `unknown key: ${combo}` };
}

/** Read the desktop catalog once per call: it is small and rarely hot. */
export function findApp(query) {
  const wanted = String(query).toLowerCase();
  const matches = [];
  for (const dir of APP_DIRS) {
    let entries = [];
    try { entries = readdirSync(dir).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const file of entries) {
      let content = '';
      try { content = readFileSync(`${dir}/${file}`, 'utf8'); } catch { continue; }
      const name = (content.match(/^Name=(.*)$/m) || [])[1] || '';
      const exec = (content.match(/^Exec=(.*)$/m) || [])[1] || '';
      if (!exec) continue;
      const id = file.replace(/\.desktop$/, '');
      const haystack = `${id} ${name} ${exec}`.toLowerCase();
      if (haystack.includes(wanted)) {
        // Strip the field codes the spec allows in Exec (%f, %U and friends).
        matches.push({ id, name: name || id, command: exec.replace(/\s%[a-zA-Z]/g, '').trim() });
      }
    }
  }
  return matches;
}

export const isAllowed = (app) => {
  const hay = `${app.id} ${app.name} ${app.command}`.toLowerCase();
  return ALLOWED.some((a) => hay.includes(a));
};

export function launch(app) {
  const parts = app.command.split(/\s+/);
  const child = spawn(parts[0], parts.slice(1), {
    stdio: 'ignore', detached: true, env: { ...process.env, DISPLAY: state.display },
  });
  child.unref();
  return { ok: true, launched: app.name, pid: child.pid };
}

export const allowedApps = ALLOWED;
