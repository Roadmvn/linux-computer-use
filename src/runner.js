import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

let cachedBin = null;

/**
 * Locate the playwright-cli executable. Resolved from our own dependency tree
 * first so a global install of a different version cannot shadow it.
 */
export function resolveCli() {
  if (cachedBin) return cachedBin;

  if (process.env.LCU_PLAYWRIGHT_CLI && existsSync(process.env.LCU_PLAYWRIGHT_CLI)) {
    cachedBin = process.env.LCU_PLAYWRIGHT_CLI;
    return cachedBin;
  }
  try {
    cachedBin = require.resolve('@playwright/cli/playwright-cli.js');
    return cachedBin;
  } catch {
    // fall through to PATH lookup
  }
  cachedBin = 'playwright-cli';
  return cachedBin;
}

/**
 * Run a single playwright-cli command and return its stdout.
 * Commands are passed as an argv array, never as a shell string, so page
 * content and user text can never be interpreted by a shell.
 */
export function run(session, args, { timeout = 60000 } = {}) {
  const bin = resolveCli();
  const argv = [`-s=${session}`, ...args];
  const useNode = bin.endsWith('.js');

  // A value starting with "-" would be read as a flag by the CLI, so a crafted
  // url or ref could turn into an option. Only the flags this module builds
  // itself are allowed to look like flags.
  const OWN_FLAGS = /^--(headed|persistent|profile|browser|filename|cdp)(=|$)/;
  const sneaky = args.find((a) => typeof a === 'string' && a.startsWith('-') && !OWN_FLAGS.test(a));
  if (sneaky) {
    return Promise.resolve({
      ok: false, stdout: '', code: -1,
      stderr: `refused: argument "${sneaky}" starts with "-" and would be read as an option`,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(
      useNode ? process.execPath : bin,
      useNode ? [bin, ...argv] : argv,
      // DISPLAY is inherited, never invented: forcing :0 only ever worked on
      // the machine this was written on.
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env }
    );

    let stdout = '';
    let stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      resolve({ ok: false, stdout, stderr: `timed out after ${timeout}ms`, code: -1 });
    }, timeout);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message, code: -1 });
    });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code });
    });
  });
}

/**
 * Evaluate a JS expression in the page and return the raw CLI output.
 *
 * The eval() here runs inside the browser page, not in this Node process, and
 * only ever receives expressions defined in this repository - never page
 * content or model output. It is the mechanism playwright-cli exposes for
 * running script in the page. Base64 encoding keeps quoting from breaking the
 * argv; it is not a security measure.
 */
export async function evaluate(session, expression) {
  const encoded = Buffer.from(expression, 'utf8').toString('base64');
  return run(session, ['eval', `eval(atob(${JSON.stringify(encoded)}))`]);
}

/**
 * Extract a JSON payload a page expression returned.
 *
 * The CLI prints the value under a "### Result" heading as a JSON encoded
 * string, so it needs decoding twice. This is deliberately strict: callers
 * treat null as "I could not read the page" and refuse the action, so a
 * greedy regex that half-succeeds would silently disable a guardrail.
 */
export function parseJsonResult(stdout) {
  const lines = stdout.split('\n');
  const marker = lines.findIndex((l) => l.trim() === '### Result');
  if (marker === -1) return null;

  const payload = lines.slice(marker + 1).find((l) => l.trim().length > 0);
  if (!payload) return null;

  try {
    const decoded = JSON.parse(payload.trim());
    const value = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** A headed browser needs a display server. Say so plainly instead of leaking a stack trace. */
export function displayProblem() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return null;
  return 'No DISPLAY or WAYLAND_DISPLAY is set, so a browser window cannot open. '
    + 'Run inside a graphical session, or wrap the client in xvfb-run for a headless machine.';
}
