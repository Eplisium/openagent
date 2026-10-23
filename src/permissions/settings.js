/**
 * OpenAgent settings.json loader (permissions + hooks).
 *
 * Sources (later ones are lower priority for scalar values; lists are merged):
 *   project: <workingDir>/.openagent/settings.json
 *   user:    ~/.openagent/settings.json
 *
 * Shape (Claude-Code compatible):
 * {
 *   "permissions": { "allow": [], "deny": [], "ask": [], "defaultMode": "ask" },
 *   "hooks": { "PreToolUse": [{ "matcher": "regex", "hooks": [{ "type": "command", "command": "...", "timeout": 30 }] }] }
 * }
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SETTINGS_DIR_NAME = '.openagent';
export const SETTINGS_FILE_NAME = 'settings.json';

/** Path of the project-level settings file. */
export function getProjectSettingsPath(workingDir) {
  return path.join(path.resolve(workingDir || process.cwd()), SETTINGS_DIR_NAME, SETTINGS_FILE_NAME);
}

/** Path of the user-level settings file. */
export function getUserSettingsPath(homeDir) {
  return path.join(homeDir || os.homedir(), SETTINGS_DIR_NAME, SETTINGS_FILE_NAME);
}

/**
 * Read a JSON settings file synchronously. Missing file → null.
 * Invalid JSON → { _error } so callers can surface it without crashing.
 * @param {string} filePath
 */
export function readSettingsFile(filePath) {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf-8');
    if (!text.trim()) return {};
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    return { _error: `Failed to read ${filePath}: ${err.message}` };
  }
}

/**
 * Resolve the settings file paths for a session.
 * @param {{workingDir?: string, projectSettingsPath?: string|null, userSettingsPath?: string|null, homeDir?: string}} opts
 *   Pass `null` for a path to disable that source.
 */
export function resolveSettingsPaths(opts = {}) {
  return {
    project: opts.projectSettingsPath === null
      ? null
      : (opts.projectSettingsPath || getProjectSettingsPath(opts.workingDir)),
    user: opts.userSettingsPath === null
      ? null
      : (opts.userSettingsPath || getUserSettingsPath(opts.homeDir)),
  };
}

/**
 * Load project + user settings.
 * @returns {{project: object|null, user: object|null, paths: {project: string|null, user: string|null}, errors: string[]}}
 */
export function loadSettings(opts = {}) {
  const paths = resolveSettingsPaths(opts);
  const project = readSettingsFile(paths.project);
  const user = readSettingsFile(paths.user);
  const errors = [project?._error, user?._error].filter(Boolean);
  return {
    project: project && !project._error ? project : null,
    user: user && !user._error ? user : null,
    paths,
    errors,
  };
}

function toStringList(value) {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()) : [];
}

/**
 * Merge permission sections from loaded settings.
 * @param {{project: object|null, user: object|null}} loaded
 * @returns {{allow: string[], deny: string[], ask: string[], defaultMode: string|null}}
 */
export function mergePermissionSettings(loaded) {
  const sources = [loaded?.project?.permissions, loaded?.user?.permissions].filter(Boolean);
  const out = { allow: [], deny: [], ask: [], defaultMode: null };
  for (const src of sources) {
    for (const key of ['allow', 'deny', 'ask']) {
      for (const rule of toStringList(src[key])) {
        if (!out[key].includes(rule)) out[key].push(rule);
      }
    }
    if (!out.defaultMode && typeof src.defaultMode === 'string') out.defaultMode = src.defaultMode;
  }
  return out;
}

/**
 * Append a rule to a list in a settings file (creating the file if needed).
 * @param {string} filePath
 * @param {'allow'|'deny'|'ask'} list
 * @param {string} rule
 * @returns {Promise<boolean>} true if the file changed
 */
export async function addPermissionRuleToFile(filePath, list, rule) {
  if (!filePath || !rule) return false;
  let data = {};
  try {
    const text = await fsp.readFile(filePath, 'utf-8');
    if (text.trim()) data = JSON.parse(text);
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Cannot update ${filePath}: ${err.message}`);
  }
  if (!data || typeof data !== 'object') data = {};
  if (!data.permissions || typeof data.permissions !== 'object') data.permissions = {};
  if (!Array.isArray(data.permissions[list])) data.permissions[list] = [];
  if (data.permissions[list].includes(rule)) return false;
  data.permissions[list].push(rule);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return true;
}
