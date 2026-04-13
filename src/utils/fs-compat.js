/**
 * fs-compat.js — Drop-in replacement for 'fs-extra' using only Node built-ins.
 *
 * Re-exports every native fs method (sync + async) and adds the extra
 * convenience methods that fs-extra provides:
 *   readJson, writeJson, ensureDir, pathExists, copy, remove,
 *   readJSONSync, writeJSONSync, ensureDirSync
 *
 * Usage:
 *   import fs from './utils/fs-compat.js'   // default export
 *   import { readJson } from './utils/fs-compat.js'  // named export
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

/**
 * Read a JSON file and parse its contents.
 * @param {string} path
 * @param {{ encoding?: string, throws?: boolean, reviver?: Function }} [opts]
 * @returns {Promise<any>}
 */
async function readJson(path, opts = {}) {
  const encoding = opts.encoding ?? 'utf-8';
  const content = await fsp.readFile(path, encoding);
  const reviver = opts.reviver;
  return JSON.parse(content, reviver);
}

/**
 * Serialize data as JSON and write to a file.
 * @param {string} path
 * @param {any} data
 * @param {{ spaces?: number|string, encoding?: string, replacer?: Function, EOL?: string }} [opts]
 * @returns {Promise<void>}
 */
async function writeJson(path, data, opts = {}) {
  const spaces = opts.spaces ?? 2;
  const replacer = opts.replacer ?? null;
  const EOL = opts.EOL ?? '\n';
  const str = JSON.stringify(data, replacer, spaces);
  const content = str.endsWith('\n') ? str : str + EOL;
  const encoding = opts.encoding ?? 'utf-8';
  await fsp.writeFile(path, content, encoding);
}

/**
 * Ensure a directory exists, creating it (and parents) if needed.
 * @param {string} path
 * @returns {Promise<string|undefined>}
 */
async function ensureDir(path) {
  return fsp.mkdir(path, { recursive: true });
}

/**
 * Check whether a path exists.
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a file or directory recursively.
 * @param {string} src
 * @param {string} dest
 * @param {object} [opts]
 * @returns {Promise<void>}
 */
async function copy(src, dest, opts = {}) {
  return fsp.cp(src, dest, { recursive: true, ...opts });
}

/**
 * Remove a file or directory recursively.
 * @param {string} path
 * @returns {Promise<void>}
 */
async function remove(path) {
  return fsp.rm(path, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

/**
 * Read a JSON file synchronously and parse its contents.
 * @param {string} path
 * @param {{ encoding?: string, throws?: boolean, reviver?: Function }} [opts]
 * @returns {any}
 */
function readJSONSync(path, opts = {}) {
  const encoding = opts.encoding ?? 'utf-8';
  const content = fs.readFileSync(path, encoding);
  const reviver = opts.reviver;
  return JSON.parse(content, reviver);
}

/**
 * Serialize data as JSON and write to a file synchronously.
 * @param {string} path
 * @param {any} data
 * @param {{ spaces?: number|string, encoding?: string, replacer?: Function, EOL?: string }} [opts]
 * @returns {void}
 */
function writeJSONSync(path, data, opts = {}) {
  const spaces = opts.spaces ?? 2;
  const replacer = opts.replacer ?? null;
  const EOL = opts.EOL ?? '\n';
  const str = JSON.stringify(data, replacer, spaces);
  const content = str.endsWith('\n') ? str : str + EOL;
  const encoding = opts.encoding ?? 'utf-8';
  fs.writeFileSync(path, content, encoding);
}

/**
 * Ensure a directory exists synchronously.
 * @param {string} path
 * @returns {string|undefined}
 */
function ensureDirSync(path) {
  return fs.mkdirSync(path, { recursive: true });
}

// ---------------------------------------------------------------------------
// Build the combined export object — all native methods + our extras
// ---------------------------------------------------------------------------

const compat = {
  // Spread every native sync & async method
  ...fs,

  // Override with promise-based versions from fs/promises for the key methods
  readFile: fsp.readFile,
  writeFile: fsp.writeFile,
  mkdir: fsp.mkdir,
  rename: fsp.rename,
  access: fsp.access,
  stat: fsp.stat,
  lstat: fsp.lstat,
  readdir: fsp.readdir,
  unlink: fsp.unlink,
  rmdir: fsp.rmdir,
  realpath: fsp.realpath,
  chmod: fsp.chmod,
  chown: fsp.chown,
  link: fsp.link,
  symlink: fsp.symlink,
  readlink: fsp.readlink,
  truncate: fsp.truncate,
  utimes: fsp.utimes,
  open: fsp.open,
  copyFile: fsp.copyFile,
  appendFile: fsp.appendFile,
  mkdtemp: fsp.mkdtemp,
  cp: fsp.cp,
  rm: fsp.rm,

  // fs-extra compat methods (async)
  readJson,
  readJSON: readJson,
  writeJson,
  writeJSON: writeJson,
  ensureDir,
  pathExists,
  copy,
  remove,
  rename: fsp.rename,

  // fs-extra compat methods (sync)
  readJSONSync,
  readJsonSync: readJSONSync,
  writeJSONSync,
  writeJsonSync: writeJSONSync,
  ensureDirSync,
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  renameSync: fs.renameSync,
  copyFileSync: fs.copyFileSync,
  appendFileSync: fs.appendFileSync,
  unlinkSync: fs.unlinkSync,
  readdirSync: fs.readdirSync,
  statSync: fs.statSync,
  lstatSync: fs.lstatSync,
  realpathSync: fs.realpathSync,
  chmodSync: fs.chmodSync,
  chownSync: fs.chownSync,
  linkSync: fs.linkSync,
  symlinkSync: fs.symlinkSync,
  readlinkSync: fs.readlinkSync,
  truncateSync: fs.truncateSync,
  utimesSync: fs.utimesSync,
  openSync: fs.openSync,
  mkdtempSync: fs.mkdtempSync,
  rmSync: fs.rmSync,
  rmdirSync: fs.rmdirSync,
  cpSync: fs.cpSync,
  createReadStream: fs.createReadStream,
  createWriteStream: fs.createWriteStream,
  watch: fs.watch,
  watchFile: fs.watchFile,
  unwatchFile: fs.unwatchFile,
  constants: fs.constants,
  Dir: fs.Dir,
  Dirent: fs.Dirent,
  Stats: fs.Stats,
  ReadStream: fs.ReadStream,
  WriteStream: fs.WriteStream,
  FSWatcher: fs.FSWatcher,
  promises: fsp,
};

export default compat;

// Also export named for flexibility
export {
  readJson,
  readJson as readJSON,
  writeJson,
  writeJson as writeJSON,
  ensureDir,
  pathExists,
  copy,
  remove,
  readJSONSync,
  readJSONSync as readJsonSync,
  writeJSONSync,
  writeJSONSync as writeJsonSync,
  ensureDirSync,
};
