/**
 * ⏪ TurnCheckpointer — automatic per-turn file checkpoints + rewind
 *
 * Parity target: Claude Code `/rewind` (code restore) and OpenCode `/undo`.
 *
 * Lifecycle (singleton module):
 *   1. The CLI calls `beginTurn(label)` before sending each user prompt to the agent.
 *   2. Every file-mutating tool calls `capture(filePath)` BEFORE it writes, deletes,
 *      or moves a path. The first capture of a path within a turn stores the
 *      original bytes (content-addressed blob) or a "did-not-exist" marker.
 *      Later captures of the same path in the same turn are no-ops.
 *   3. `rewind(turnId)` restores every file changed in that turn AND every later
 *      turn, processing turns newest → oldest so the oldest snapshot wins.
 *      Files that did not exist before are deleted.
 *
 * Storage layout (per session):
 *   <rootDir>/.openagent/checkpoints/<sessionId>/
 *     manifest.json     { version, sessionId, rootDir, nextTurnId, turns: [...] }
 *     blobs/<sha256>    raw original file bytes (deduplicated)
 *
 * Limits & safety:
 *   - capture() is a NO-OP until beginTurn() has been called (so SDK use, tests,
 *     and tools run outside the interactive CLI never write checkpoint data).
 *   - Files larger than `maxFileBytes` (default 5 MB) and binary files (NUL byte in
 *     the first 8 KB) are recorded as `skipped` and are NOT restorable.
 *   - Paths containing a `.git` segment and paths inside the checkpoint store are ignored.
 *   - Only the last `maxTurns` (default 50) turns are kept; unreferenced blobs are
 *     garbage-collected. Only the newest `maxSessions` (default 10) session dirs are kept.
 *   - Works without git.
 *
 * Known limitation: changes made by shell commands (exec, scripts, package managers,
 * git checkout, etc.) are NOT captured — only OpenAgent's file tools call capture().
 */

import crypto from 'crypto';
import fsp from 'fs/promises';
import path from 'path';

const DEFAULTS = Object.freeze({
  maxTurns: 50,
  maxSessions: 10,
  maxFileBytes: 5 * 1024 * 1024,
  maxDirEntries: 1000,
  binarySniffBytes: 8000,
});

const MANIFEST_VERSION = 1;

/** @type {{rootDir: string|null, sessionId: string|null, maxTurns: number, maxSessions: number, maxFileBytes: number, maxDirEntries: number, enabled: boolean}} */
const config = {
  rootDir: null,
  sessionId: null,
  maxTurns: DEFAULTS.maxTurns,
  maxSessions: DEFAULTS.maxSessions,
  maxFileBytes: DEFAULTS.maxFileBytes,
  maxDirEntries: DEFAULTS.maxDirEntries,
  enabled: process.env.OPENAGENT_CHECKPOINTS !== 'off' && process.env.OPENAGENT_CHECKPOINTS !== 'false',
};

/** In-memory manifest (lazy loaded). */
let manifest = null;
/** Id of the active turn, or null when no turn has begun. */
let currentTurnId = null;
/** Serializes manifest writes / captures to avoid races between parallel tools. */
let queue = Promise.resolve();

function enqueue(fn) {
  const run = queue.then(fn, fn);
  // Keep the chain alive even if fn rejects.
  queue = run.catch(() => {});
  return run;
}

function defaultSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `session-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${process.pid}`;
}

function sanitizeSessionId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || defaultSessionId();
}

function getRootDir() {
  return path.resolve(config.rootDir || process.cwd());
}

function getSessionId() {
  if (!config.sessionId) config.sessionId = defaultSessionId();
  return config.sessionId;
}

/** Directory holding all sessions' checkpoint stores. */
export function getCheckpointsRoot() {
  return path.join(getRootDir(), '.openagent', 'checkpoints');
}

/** Directory holding the current session's checkpoint store. */
export function getStoreDir() {
  return path.join(getCheckpointsRoot(), getSessionId());
}

function manifestPath() {
  return path.join(getStoreDir(), 'manifest.json');
}

function blobsDir() {
  return path.join(getStoreDir(), 'blobs');
}

function normKey(p) {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

function isInside(child, parent) {
  const rel = path.relative(normKey(parent), normKey(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isIgnoredPath(absPath) {
  const segments = path.resolve(absPath).split(/[\\/]+/);
  if (segments.some((s) => s.toLowerCase() === '.git')) return true;
  if (isInside(absPath, getCheckpointsRoot())) return true;
  return false;
}

async function exists(p) {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

function isBinaryBuffer(buf) {
  const len = Math.min(buf.length, DEFAULTS.binarySniffBytes);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function loadManifest() {
  if (manifest) return manifest;
  try {
    const raw = await fsp.readFile(manifestPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.turns)) {
      manifest = parsed;
      return manifest;
    }
  } catch {
    // No manifest yet (or unreadable) — start fresh.
  }
  manifest = {
    version: MANIFEST_VERSION,
    sessionId: getSessionId(),
    rootDir: getRootDir(),
    nextTurnId: 1,
    turns: [],
  };
  return manifest;
}

async function saveManifest() {
  if (!manifest) return;
  await fsp.mkdir(getStoreDir(), { recursive: true });
  const target = manifestPath();
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  await fsp.rename(tmp, target);
}

async function writeBlob(buf) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const blobPath = path.join(blobsDir(), hash);
  if (!await exists(blobPath)) {
    await fsp.mkdir(blobsDir(), { recursive: true });
    await fsp.writeFile(blobPath, buf);
  }
  return hash;
}

async function readBlob(hash) {
  return fsp.readFile(path.join(blobsDir(), hash));
}

function findTurn(turnId) {
  if (!manifest) return null;
  const id = Number(turnId);
  return manifest.turns.find((t) => t.id === id) || null;
}

function currentTurn() {
  return currentTurnId == null ? null : findTurn(currentTurnId);
}

async function pruneTurns() {
  if (!manifest) return;
  const max = Math.max(1, config.maxTurns);
  if (manifest.turns.length > max) {
    manifest.turns = manifest.turns.slice(manifest.turns.length - max);
  }
  await gcBlobs();
}

async function gcBlobs() {
  if (!manifest) return;
  const referenced = new Set();
  for (const turn of manifest.turns) {
    for (const entry of Object.values(turn.files || {})) {
      if (entry.blob) referenced.add(entry.blob);
    }
  }
  let names = [];
  try {
    names = await fsp.readdir(blobsDir());
  } catch {
    return;
  }
  await Promise.all(names.filter((n) => !referenced.has(n)).map((n) =>
    fsp.rm(path.join(blobsDir(), n), { force: true }).catch(() => {})
  ));
}

async function pruneSessions() {
  let entries = [];
  try {
    entries = await fsp.readdir(getCheckpointsRoot(), { withFileTypes: true });
  } catch {
    return;
  }
  const current = getSessionId();
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === current) continue;
    const full = path.join(getCheckpointsRoot(), e.name);
    try {
      const st = await fsp.stat(full);
      dirs.push({ full, mtime: st.mtimeMs });
    } catch {
      // ignore vanished dirs
    }
  }
  const keepOthers = Math.max(0, config.maxSessions - 1);
  dirs.sort((a, b) => b.mtime - a.mtime);
  for (const d of dirs.slice(keepOthers)) {
    await fsp.rm(d.full, { recursive: true, force: true }).catch(() => {});
  }
}

async function snapshotFile(absPath, st) {
  if (st.size > config.maxFileBytes) {
    return { existed: true, type: 'file', blob: null, skipped: 'too-large', size: st.size };
  }
  const buf = await fsp.readFile(absPath);
  if (isBinaryBuffer(buf)) {
    return { existed: true, type: 'file', blob: null, skipped: 'binary', size: st.size };
  }
  const blob = await writeBlob(buf);
  return { existed: true, type: 'file', blob, size: st.size, mode: st.mode };
}

async function listFilesRecursive(dir, limit) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (isIgnoredPath(full)) continue;
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function captureOne(turn, absPath) {
  const key = normKey(absPath);
  if (turn.files[key]) return turn.files[key];
  let st = null;
  try {
    st = await fsp.stat(absPath);
  } catch {
    st = null;
  }
  let entry;
  if (!st) {
    entry = { existed: false, type: 'absent' };
  } else if (st.isDirectory()) {
    // Directory: snapshot each file inside (bounded) so deletes/moves are restorable.
    entry = { existed: true, type: 'dir' };
    turn.files[key] = { ...entry, path: absPath };
    const files = await listFilesRecursive(absPath, config.maxDirEntries);
    for (const f of files) {
      await captureOne(turn, f);
    }
    return turn.files[key];
  } else if (st.isFile()) {
    entry = await snapshotFile(absPath, st);
  } else {
    entry = { existed: true, type: 'other', blob: null, skipped: 'unsupported-type' };
  }
  turn.files[key] = { ...entry, path: absPath };
  return turn.files[key];
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Configure the checkpointer. Changing rootDir or sessionId resets in-memory state.
 * @param {{rootDir?: string, sessionId?: string, maxTurns?: number, maxSessions?: number, maxFileBytes?: number, maxDirEntries?: number, enabled?: boolean}} options
 */
export function configure(options = {}) {
  const nextRoot = options.rootDir ? path.resolve(options.rootDir) : config.rootDir;
  const nextSession = options.sessionId ? sanitizeSessionId(options.sessionId) : config.sessionId;
  if (nextRoot !== config.rootDir || nextSession !== config.sessionId) {
    manifest = null;
    currentTurnId = null;
  }
  config.rootDir = nextRoot;
  config.sessionId = nextSession;
  for (const k of ['maxTurns', 'maxSessions', 'maxFileBytes', 'maxDirEntries']) {
    if (Number.isFinite(options[k]) && options[k] > 0) config[k] = options[k];
  }
  if (typeof options.enabled === 'boolean') config.enabled = options.enabled;
  return getConfig();
}

/** Current configuration snapshot. */
export function getConfig() {
  return {
    rootDir: getRootDir(),
    sessionId: getSessionId(),
    storeDir: getStoreDir(),
    maxTurns: config.maxTurns,
    maxSessions: config.maxSessions,
    maxFileBytes: config.maxFileBytes,
    enabled: config.enabled,
    currentTurnId,
  };
}

/** Reset all in-memory state and restore defaults (does not touch disk). Mainly for tests. */
export function reset() {
  manifest = null;
  currentTurnId = null;
  queue = Promise.resolve();
  config.rootDir = null;
  config.sessionId = null;
  config.maxTurns = DEFAULTS.maxTurns;
  config.maxSessions = DEFAULTS.maxSessions;
  config.maxFileBytes = DEFAULTS.maxFileBytes;
  config.maxDirEntries = DEFAULTS.maxDirEntries;
  config.enabled = process.env.OPENAGENT_CHECKPOINTS !== 'off' && process.env.OPENAGENT_CHECKPOINTS !== 'false';
}

/**
 * Start a new turn. Called by the CLI before each user prompt.
 * @param {string} [label] - Usually the (truncated) user prompt.
 * @returns {Promise<{id: number, label: string, createdAt: string}|null>}
 */
export function beginTurn(label = '') {
  if (!config.enabled) return Promise.resolve(null);
  return enqueue(async () => {
    await loadManifest();
    // Drop the previous turn if it changed nothing (keeps the list meaningful).
    const prev = currentTurn();
    if (prev && Object.keys(prev.files).length === 0) {
      manifest.turns = manifest.turns.filter((t) => t !== prev);
    }
    const turn = {
      id: manifest.nextTurnId++,
      label: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      createdAt: new Date().toISOString(),
      files: {},
    };
    manifest.turns.push(turn);
    currentTurnId = turn.id;
    await pruneTurns();
    // Turns without files are not persisted until something is captured.
    if (manifest.turns.some((t) => Object.keys(t.files).length > 0)) {
      await saveManifest();
    }
    if (manifest.nextTurnId === 2) {
      await pruneSessions();
    }
    return { id: turn.id, label: turn.label, createdAt: turn.createdAt };
  });
}

/**
 * Snapshot a path before it is mutated. Safe to call repeatedly; only the first
 * call per path per turn stores data. Never throws — returns null on failure or
 * when no turn is active.
 * @param {string} filePath
 * @returns {Promise<object|null>} the stored entry
 */
export function capture(filePath) {
  if (!config.enabled || currentTurnId == null || !filePath) return Promise.resolve(null);
  const absPath = path.resolve(String(filePath));
  if (isIgnoredPath(absPath)) return Promise.resolve(null);
  return enqueue(async () => {
    try {
      const turn = currentTurn();
      if (!turn) return null;
      const key = normKey(absPath);
      if (turn.files[key]) return turn.files[key];
      const entry = await captureOne(turn, absPath);
      await saveManifest();
      return entry;
    } catch {
      return null;
    }
  });
}

function summarizeEntry(entry) {
  let status;
  if (!entry.existed) status = 'created';
  else if (entry.type === 'dir') status = 'dir';
  else status = 'modified';
  return {
    path: entry.path,
    status,
    restorable: !entry.skipped,
    skipped: entry.skipped || undefined,
  };
}

/**
 * List turns that changed at least one file (oldest first). The active turn is
 * included even when empty so callers can show it.
 * @returns {Promise<Array<{id:number,label:string,createdAt:string,current:boolean,files:Array}>>}
 */
export function listTurns() {
  return enqueue(async () => {
    await loadManifest();
    return manifest.turns
      .filter((t) => Object.keys(t.files).length > 0 || t.id === currentTurnId)
      .map((t) => ({
        id: t.id,
        label: t.label,
        createdAt: t.createdAt,
        current: t.id === currentTurnId,
        files: Object.values(t.files).filter((e) => e.type !== 'dir').map(summarizeEntry),
      }));
  });
}

async function restoreEntry(entry, result) {
  const target = entry.path;
  if (entry.skipped) {
    result.skipped.push({ path: target, reason: entry.skipped });
    return;
  }
  if (!entry.existed) {
    if (await exists(target)) {
      await fsp.rm(target, { recursive: true, force: true });
      result.actions.push({ path: target, action: 'deleted' });
    }
    return;
  }
  if (entry.type === 'dir') {
    await fsp.mkdir(target, { recursive: true });
    return;
  }
  if (entry.type === 'file' && entry.blob) {
    const buf = await readBlob(entry.blob);
    // If something now occupies the path as a directory, remove it first.
    try {
      const st = await fsp.lstat(target);
      if (st.isDirectory()) await fsp.rm(target, { recursive: true, force: true });
    } catch {
      // path does not exist — fine
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buf);
    result.actions.push({ path: target, action: 'restored' });
  }
}

/**
 * Rewind code to the state before `turnId` began: restores files changed in that
 * turn and every later turn (newest first), deleting files that did not exist.
 * Rewound turns are removed from history.
 * @param {number|string} turnId
 * @param {{code?: boolean}} [options] - code:false performs a dry run (no file changes).
 * @returns {Promise<{success:boolean, turnsRewound:number[], restored:string[], deleted:string[], skipped:Array, errors:Array, error?:string}>}
 */
export function rewind(turnId, options = {}) {
  const applyCode = options.code !== false;
  return enqueue(async () => {
    await loadManifest();
    const id = Number(turnId);
    const idx = manifest.turns.findIndex((t) => t.id === id);
    if (idx === -1) {
      return { success: false, error: `Unknown checkpoint turn: ${turnId}`, turnsRewound: [], restored: [], deleted: [], skipped: [], errors: [] };
    }
    const affected = manifest.turns.slice(idx);
    const result = {
      success: true,
      turnsRewound: affected.map((t) => t.id),
      restored: [],
      deleted: [],
      skipped: [],
      errors: [],
      actions: [],
      dryRun: !applyCode,
    };
    if (!applyCode) {
      delete result.actions;
      for (const t of affected) {
        for (const e of Object.values(t.files)) {
          if (e.type === 'dir') continue;
          if (e.skipped) result.skipped.push({ path: e.path, reason: e.skipped });
          else if (!e.existed) result.deleted.push(e.path);
          else result.restored.push(e.path);
        }
      }
      return result;
    }
    for (let i = affected.length - 1; i >= 0; i--) {
      const entries = Object.values(affected[i].files);
      // Directories first so their files land inside them; deletions of
      // created paths are handled per-entry.
      entries.sort((a, b) => (a.type === 'dir' ? -1 : 0) - (b.type === 'dir' ? -1 : 0));
      for (const entry of entries) {
        try {
          await restoreEntry(entry, result);
        } catch (error) {
          result.errors.push({ path: entry.path, error: error.message });
        }
      }
    }
    // Dedupe: a path may be touched by several turns; the oldest turn (processed
    // last) determines its final state.
    const finalState = new Map();
    for (const p of result.actions) finalState.set(normKey(p.path), p);
    delete result.actions;
    result.restored = [];
    result.deleted = [];
    for (const { path: p, action } of finalState.values()) {
      if (action === 'deleted') result.deleted.push(p);
      else result.restored.push(p);
    }
    result.success = result.errors.length === 0;
    manifest.turns = manifest.turns.slice(0, idx);
    if (currentTurnId != null && !findTurn(currentTurnId)) currentTurnId = null;
    await gcBlobs();
    await saveManifest();
    return result;
  });
}

/** Rewind only the most recent turn that changed files. */
export async function rewindLast(options = {}) {
  const turns = (await listTurns()).filter((t) => t.files.length > 0);
  if (turns.length === 0) {
    return { success: false, error: 'No checkpoints with file changes to rewind.', turnsRewound: [], restored: [], deleted: [], skipped: [], errors: [] };
  }
  return rewind(turns[turns.length - 1].id, options);
}

function lineDelta(before, after) {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const counts = new Map();
  for (const l of a) counts.set(l, (counts.get(l) || 0) + 1);
  let added = 0;
  for (const l of b) {
    const c = counts.get(l) || 0;
    if (c > 0) counts.set(l, c - 1);
    else added++;
  }
  let removed = 0;
  for (const c of counts.values()) removed += c;
  return { added, removed };
}

/**
 * Summarize what changed for files touched in `turnId`, comparing the snapshot
 * taken at the start of that turn to the CURRENT file content (cumulative with
 * later turns).
 * @returns {Promise<{success:boolean, turnId:number, label?:string, files:Array, error?:string}>}
 */
export function diffSummary(turnId) {
  return enqueue(async () => {
    await loadManifest();
    const turn = findTurn(turnId);
    if (!turn) return { success: false, turnId: Number(turnId), files: [], error: `Unknown checkpoint turn: ${turnId}` };
    const files = [];
    for (const entry of Object.values(turn.files)) {
      if (entry.type === 'dir') continue;
      const nowExists = await exists(entry.path);
      const item = { path: entry.path, added: 0, removed: 0 };
      if (entry.skipped) {
        item.status = 'skipped';
        item.reason = entry.skipped;
      } else if (!entry.existed) {
        item.status = nowExists ? 'created' : 'unchanged';
        if (nowExists) {
          try {
            const cur = await fsp.readFile(entry.path, 'utf-8');
            item.added = cur.split(/\r?\n/).length;
          } catch {
            // unreadable (e.g. directory) — leave counts at zero
          }
        }
      } else if (!nowExists) {
        item.status = 'deleted';
        try {
          item.removed = (await readBlob(entry.blob)).toString('utf-8').split(/\r?\n/).length;
        } catch {
          // missing blob — counts stay zero
        }
      } else {
        try {
          const before = (await readBlob(entry.blob)).toString('utf-8');
          const after = await fsp.readFile(entry.path, 'utf-8');
          const delta = lineDelta(before, after);
          item.status = before === after ? 'unchanged' : 'modified';
          item.added = delta.added;
          item.removed = delta.removed;
        } catch (error) {
          item.status = 'error';
          item.reason = error.message;
        }
      }
      files.push(item);
    }
    return { success: true, turnId: turn.id, label: turn.label, files };
  });
}

/** Disk usage of the current session store, in bytes. */
export async function getStorageStats() {
  let bytes = 0;
  let blobs = 0;
  try {
    for (const name of await fsp.readdir(blobsDir())) {
      try {
        bytes += (await fsp.stat(path.join(blobsDir(), name))).size;
        blobs++;
      } catch {
        // vanished
      }
    }
  } catch {
    // no blobs yet
  }
  const turns = await listTurns();
  return { storeDir: getStoreDir(), bytes, blobs, turns: turns.filter((t) => t.files.length > 0).length };
}

export default {
  configure,
  getConfig,
  reset,
  beginTurn,
  capture,
  listTurns,
  rewind,
  rewindLast,
  diffSummary,
  getStorageStats,
  getStoreDir,
  getCheckpointsRoot,
};
