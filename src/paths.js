import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const OPENAGENT_HOME_DIRNAME = '.openagent';
export const LEGACY_TASK_STATE_DIRNAME = '.openagent-tasks';
export const OPENAGENT_WORKSPACE_PREFIX = 'workspace:';
export const OPENAGENT_PROJECT_PREFIX = 'project:';
export const OPENAGENT_WORKDIR_PREFIX = 'workdir:';
export const OPENAGENT_HOME_PREFIX = 'openagent:';

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

export function getOpenAgentHome(workingDir, openAgentDir) {
  const root = workingDir || process.cwd();
  return path.resolve(openAgentDir || path.join(root, OPENAGENT_HOME_DIRNAME));
}

export function getLegacyTaskStateDir(workingDir) {
  return path.join(path.resolve(workingDir || process.cwd()), LEGACY_TASK_STATE_DIRNAME);
}

export function getDefaultTaskStateDir(workingDir, options = {}) {
  if (options.taskDir) {
    return path.resolve(options.taskDir);
  }

  const legacyTaskDir = getLegacyTaskStateDir(workingDir);
  if (!options.ignoreLegacyTaskDir && fs.existsSync(legacyTaskDir)) {
    return legacyTaskDir;
  }

  return path.join(getOpenAgentHome(workingDir, options.openAgentDir), 'task-state');
}

export function getDefaultSessionSaveDir(workingDir, openAgentDir) {
  return path.join(getOpenAgentHome(workingDir, openAgentDir), 'sessions');
}

export function getWorkspaceRoot(workingDir, openAgentDir) {
  return path.join(getOpenAgentHome(workingDir, openAgentDir), 'workspaces');
}

export function sanitizeTaskSlug(value, fallback = 'task') {
  if (!value) return fallback;

  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return slug || fallback;
}

export function formatWorkspaceTimestamp(date = new Date()) {
  const iso = date.toISOString();
  return iso
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '')
    .toLowerCase();
}

export function createWorkspaceName(task, timestamp = new Date()) {
  return `${formatWorkspaceTimestamp(timestamp)}-${sanitizeTaskSlug(task)}`;
}

function stripPrefix(value, prefix) {
  const remainder = value.slice(prefix.length).replace(/^[/\\]+/, '');
  return remainder || '.';
}

export function resolveAgentPath(inputPath = '.', options = {}) {
  const baseDir = path.resolve(options.baseDir || process.cwd());
  const workspaceDir = options.workspaceDir ? path.resolve(options.workspaceDir) : null;
  const openAgentDir = options.openAgentDir ? path.resolve(options.openAgentDir) : null;

  if (inputPath === null || inputPath === undefined) {
    return baseDir;
  }

  const rawPath = String(inputPath).trim();
  if (!rawPath || rawPath === '.') {
    return baseDir;
  }

  const lowerPath = rawPath.toLowerCase();

  if (lowerPath.startsWith(OPENAGENT_WORKSPACE_PREFIX)) {
    if (!workspaceDir) {
      throw new Error('No task workspace is active yet. Use a project path or initialize a workspace first.');
    }
    return path.resolve(workspaceDir, stripPrefix(rawPath, OPENAGENT_WORKSPACE_PREFIX));
  }

  if (lowerPath.startsWith(OPENAGENT_PROJECT_PREFIX)) {
    return path.resolve(baseDir, stripPrefix(rawPath, OPENAGENT_PROJECT_PREFIX));
  }

  if (lowerPath.startsWith(OPENAGENT_WORKDIR_PREFIX)) {
    return path.resolve(baseDir, stripPrefix(rawPath, OPENAGENT_WORKDIR_PREFIX));
  }

  if (lowerPath.startsWith(OPENAGENT_HOME_PREFIX)) {
    if (!openAgentDir) {
      throw new Error('No OpenAgent home directory is available. Use a project path or initialize OpenAgent first.');
    }
    return path.resolve(openAgentDir, stripPrefix(rawPath, OPENAGENT_HOME_PREFIX));
  }

  if (WINDOWS_ABSOLUTE_PATH.test(rawPath) || path.isAbsolute(rawPath)) {
    return path.resolve(rawPath);
  }

  return path.resolve(baseDir, rawPath);
}

export function createPathContext(options = {}) {
  const getBaseDir = typeof options.getBaseDir === 'function'
    ? options.getBaseDir
    : () => options.baseDir || options.workingDir || process.cwd();
  const getWorkspaceDir = typeof options.getWorkspaceDir === 'function'
    ? options.getWorkspaceDir
    : () => options.workspaceDir || null;
  const getOpenAgentDir = typeof options.getOpenAgentDir === 'function'
    ? options.getOpenAgentDir
    : () => options.openAgentDir || null;

  return {
    getBaseDir: () => path.resolve(getBaseDir()),
    getWorkspaceDir: () => {
      const workspaceDir = getWorkspaceDir();
      return workspaceDir ? path.resolve(workspaceDir) : null;
    },
    getOpenAgentDir: () => {
      const openAgentDir = getOpenAgentDir();
      return openAgentDir ? path.resolve(openAgentDir) : null;
    },
    resolvePath: (inputPath = '.') => resolveAgentPath(inputPath, {
      baseDir: getBaseDir(),
      workspaceDir: getWorkspaceDir(),
      openAgentDir: getOpenAgentDir(),
    }),
  };
}

export function buildOpenAgentEnv(options = {}) {
  const workingDir = path.resolve(options.baseDir || process.cwd());
  const workspaceDir = options.workspaceDir ? path.resolve(options.workspaceDir) : '';

  return {
    OPENAGENT_WORKING_DIR: workingDir,
    OPENAGENT_WORKSPACE_DIR: workspaceDir,
  };
}

// ─── Installation Directory Detection ────────────────────────────
// Detects where OpenAgent's own source code lives so we can protect it
// from accidental writes by the AI agent.

let _cachedInstallationDir = undefined;

/**
 * Get the OpenAgent installation directory (where package.json lives).
 * This is cached after first call.
 * @returns {string|null} Absolute path to OpenAgent installation, or null if not found
 */
export function getInstallationDir() {
  if (_cachedInstallationDir !== undefined) return _cachedInstallationDir;

  try {
    // Start from this file's location and walk up to find package.json
    const thisFile = fileURLToPath(import.meta.url);
    let dir = path.dirname(thisFile);

    // Walk up directories looking for package.json with "openagent" name
    for (let i = 0; i < 10; i++) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.name === 'openagent' || pkg.name === 'windop') {
            _cachedInstallationDir = path.resolve(dir);
            return _cachedInstallationDir;
          }
        } catch {}
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }
  } catch {}

  _cachedInstallationDir = null;
  return null;
}

/**
 * Check if a path is inside the OpenAgent installation directory.
 * @param {string} resolvedPath - An absolute, resolved path
 * @returns {boolean}
 */
export function isInsideInstallationDir(resolvedPath) {
  const installDir = getInstallationDir();
  if (!installDir) return false;
  const canonical = path.resolve(resolvedPath);
  return canonical.startsWith(installDir + path.sep) || canonical === installDir;
}

/**
 * Protected paths inside the installation directory that should never be written to
 * by the AI agent. These are source code, config, and documentation files.
 * The .openagent/ directory inside the installation is still allowed for agent state.
 */
export const INSTALLATION_PROTECTED_PREFIXES = [
  'src' + path.sep,
  'node_modules' + path.sep,
  'package.json',
  'package-lock.json',
  '.env',
  '.git' + path.sep,
  'docs' + path.sep,
  'README.md',
  'CONTRIBUTING.md',
  'vitest.config.js',
  '.github' + path.sep,
  'plugins' + path.sep,
  'tests' + path.sep,
];

/**
 * Check if a path inside the installation directory is a protected path
 * that the AI should not write to.
 * @param {string} resolvedPath - An absolute, resolved path
 * @returns {boolean}
 */
export function isProtectedInstallationPath(resolvedPath) {
  if (!isInsideInstallationDir(resolvedPath)) return false;

  const installDir = getInstallationDir();
  if (!installDir) return false;

  const relative = path.relative(installDir, resolvedPath);
  if (!relative || relative === '') return true; // the install dir root itself

  // Allow .openagent/ directory (agent state lives there)
  if (relative === '.openagent' || relative.startsWith('.openagent' + path.sep)) {
    return false;
  }

  // Check against protected prefixes
  for (const prefix of INSTALLATION_PROTECTED_PREFIXES) {
    if (relative === prefix || relative.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}
