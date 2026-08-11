import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = process.env.LCU_DATA_DIR || join(homedir(), '.linux-computer-use');
const AUDIT_FILE = join(DATA_DIR, 'audit.log');

/**
 * Control lease. Only one party drives the browser at a time: the agent, or
 * the human who took over in the dashboard. Without this, both can act on the
 * same page and the agent ends up clicking refs that no longer mean anything.
 */
const state = {
  mode: 'normal',
  lease: 'agent',
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

export function getLease() { return state.lease; }

export function setLease(owner) {
  if (owner !== 'agent' && owner !== 'human') throw new Error(`unknown lease owner: ${owner}`);
  // Handing control back to the agent invalidates every ref it captured
  // before, because the human may have navigated or changed the page.
  if (state.lease === 'human' && owner === 'agent') state.staleSnapshot = true;
  state.lease = owner;
  return state.lease;
}

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

/**
 * Append one audit entry. Field values are never written: only their length,
 * so a password typed into a form can never end up in the log.
 */
export function audit(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  try {
    mkdirSync(dirname(AUDIT_FILE), { recursive: true });
    appendFileSync(AUDIT_FILE, line + '\n');
  } catch {
    // auditing must never break a run
  }
}

export const auditPath = AUDIT_FILE;
