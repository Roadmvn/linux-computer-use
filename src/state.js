import { appendFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = process.env.LCU_DATA_DIR || join(homedir(), '.linux-computer-use');
const AUDIT_FILE = join(DATA_DIR, 'audit.log');
const LEASE_FILE = join(DATA_DIR, 'lease');

const state = {
  mode: 'normal',
  session: 'default',
  snapshots: new Map(),
  staleSnapshot: false,
};

export function getMode() { return state.mode; }

export function setMode(mode) {
  if (mode !== 'normal' && mode !== 'auto') throw new Error(`unknown mode: ${mode}`);
  state.mode = mode;
  return state.mode;
}

/**
 * Control lease. Exactly one party drives at a time.
 *
 * It lives in a file rather than in memory on purpose. An agent that could
 * hand control back to itself would make the whole thing decorative, and the
 * agent reaches this process only through the browser tools - it has no shell.
 * So releasing means touching the filesystem, which only the human can do.
 */
export function getLease() {
  return existsSync(LEASE_FILE) ? 'human' : 'agent';
}

/** Hand control to the human. There is deliberately no way back through MCP. */
export function takeOver() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LEASE_FILE, `human since ${new Date().toISOString()}\n`, { mode: 0o600 });
  state.staleSnapshot = true;
  return 'human';
}

// Releasing is deliberately not implemented here: the human deletes the file
// themselves, which is precisely what keeps it out of the agent's reach.
export const leasePath = LEASE_FILE;

export function getSession() { return state.session; }
export function setSession(name) { state.session = name || 'default'; return state.session; }

export function rememberSnapshot(session, text) {
  state.snapshots.set(session, text);
  state.staleSnapshot = false;
}

export function recallSnapshot(session) {
  return state.snapshots.get(session) || '';
}

export function isSnapshotStale() { return state.staleSnapshot; }
export function markSnapshotStale() { state.staleSnapshot = true; }

/**
 * Look up the accessible name a snapshot recorded for a ref, so guardrails can
 * reason about what an element actually says before it gets clicked.
 *
 * Returns null when the name cannot be established. Callers must treat that as
 * a refusal, never as permission.
 */
export function describeRef(session, ref) {
  // Refs are e12 in the main frame and f3e12 inside a frame. Matching only the
  // first form silently disabled every name-based guardrail on framed pages.
  if (!/^(f\d+)?e\d+$/.test(ref)) return null;
  const snapshot = recallSnapshot(session);
  if (!snapshot) return null;
  const line = snapshot.split('\n').find((l) => l.includes(`[ref=${ref}]`));
  if (!line) return null;
  const quoted = line.match(/"([^"]*)"/);
  if (quoted) return quoted[1];
  return line.trim().replace(/^-\s*/, '').replace(/\s*\[ref=(f\d+)?e\d+\].*$/, '');
}

/** Keep only the origin of a URL: paths carry magic-link and reset tokens. */
export function safeUrl(url) {
  try { return new URL(String(url)).origin; } catch { return '(unparseable url)'; }
}

/**
 * Append one audit entry. Field values and keystrokes are never written, only
 * counts, so a typed password cannot be reconstructed from this file.
 */
let permsChecked = false;

export function audit(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(AUDIT_FILE, line + '\n');
    // Once per run, including for a log created by an earlier version that
    // left it world readable.
    if (!permsChecked) {
      chmodSync(AUDIT_FILE, 0o600);
      permsChecked = true;
    }
  } catch {
    // auditing must never break a run
  }
}

export const auditPath = AUDIT_FILE;
