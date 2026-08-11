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

  return new Promise((resolve) => {
    const child = spawn(
      useNode ? process.execPath : bin,
      useNode ? [bin, ...argv] : argv,
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' } }
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

/** Extract a JSON payload that a page expression returned. */
export function parseJsonResult(stdout) {
  const fenced = stdout.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  try {
    return JSON.parse(fenced[0].replace(/\\"/g, '"'));
  } catch {
    return null;
  }
}
