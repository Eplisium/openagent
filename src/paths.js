import fs from 'fs';
import path from 'path';

export const OPENAGENT_HOME_DIRNAME = '.openagent';
export const LEGACY_TASK_STATE_DIRNAME = '.openagent-tasks';
export const OPENAGENT_WORKSPACE_PREFIX = 'workspace:';
export const OPENAGENT_PROJECT_PREFIX = 'project:';
export const OPENAGENT_WORKDIR_PREFIX = 'workdir:';

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

  if (WINDOWS_ABSOLUTE_PATH.test(rawPath) || path.isAbsolute(rawPath)) {
    return path.resolve(rawPath);
  }

  return path.resolve(baseDir, rawPath);
}

export function buildOpenAgentEnv(options = {}) {
  const workingDir = path.resolve(options.baseDir || process.cwd());
  const workspaceDir = options.workspaceDir ? path.resolve(options.workspaceDir) : '';

  return {
    OPENAGENT_WORKING_DIR: workingDir,
    OPENAGENT_WORKSPACE_DIR: workspaceDir,
  };
}
