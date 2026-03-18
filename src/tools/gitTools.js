/**
 * 🔀 Git Tools
 * Full git workflow integration
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { resolveAgentPath } from '../paths.js';

const execAsync = promisify(execCb);
const PATH_PREFIX_NOTE = 'Supports project:, workdir:, and workspace: prefixes.';

function createPathContext(options = {}) {
  const getBaseDir = typeof options.getBaseDir === 'function'
    ? options.getBaseDir
    : () => options.baseDir || options.workingDir || process.cwd();
  const getWorkspaceDir = typeof options.getWorkspaceDir === 'function'
    ? options.getWorkspaceDir
    : () => options.workspaceDir || null;

  return {
    resolvePath: (inputPath = '.') => resolveAgentPath(inputPath, {
      baseDir: getBaseDir(),
      workspaceDir: getWorkspaceDir(),
    }),
  };
}

async function gitExec(args, cwd = '.', resolvePathForAgent = input => path.resolve(input)) {
  const resolvedCwd = resolvePathForAgent(cwd);
  try {
    const result = await execAsync(`git ${args}`, {
      cwd: resolvedCwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { success: true, stdout: result.stdout, stderr: result.stderr, cwd: resolvedCwd };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout,
      stderr: error.stderr,
      cwd: resolvedCwd,
    };
  }
}

export function createGitTools(options = {}) {
  const pathContext = createPathContext(options);
  const runGit = (args, cwd = '.') => gitExec(args, cwd, pathContext.resolvePath);

  const gitStatusTool = {
    name: 'git_status',
    description: 'Show working tree status: branch, staged/modified/untracked files, ahead/behind.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path (default: project root). ${PATH_PREFIX_NOTE}` },
        short: { type: 'boolean', description: 'Short format output' },
      },
    },
    async execute({ cwd = '.', short = false }) {
      const result = await runGit(`status ${short ? '--short' : '--porcelain=v1'}`, cwd);
      if (!result.success) return result;

      const branchResult = await runGit('branch --show-current', cwd);
      const branch = branchResult.success ? branchResult.stdout.trim() : 'unknown';

      const trackingResult = await runGit('rev-list --left-right --count HEAD...@{upstream}', cwd);
      let ahead = 0;
      let behind = 0;
      if (trackingResult.success) {
        const parts = trackingResult.stdout.trim().split(/\s+/);
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }

      const lines = result.stdout.trim().split('\n').filter(Boolean);
      const staged = lines.filter(line => line[0] !== ' ' && line[0] !== '?').length;
      const modified = lines.filter(line => line[1] === 'M' || line[1] === 'D').length;
      const untracked = lines.filter(line => line.startsWith('??')).length;

      return {
        success: true,
        branch,
        staged,
        modified,
        untracked,
        ahead,
        behind,
        clean: lines.length === 0,
        raw: result.stdout,
      };
    },
  };

  const gitLogTool = {
    name: 'git_log',
    description: 'Show commit history with details.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
        count: { type: 'integer', description: 'Number of commits (default: 10)' },
        oneline: { type: 'boolean', description: 'Compact one-line format' },
      },
    },
    async execute({ cwd = '.', count = 10, oneline = false }) {
      const format = oneline
        ? '--oneline'
        : '--pretty=format:"%H|%h|%an|%ae|%ad|%s" --date=short';

      const result = await runGit(`log ${format} -n ${count}`, cwd);
      if (!result.success) return result;

      if (oneline) {
        return {
          success: true,
          commits: result.stdout.trim().split('\n').map(line => {
            const [hash, ...msgParts] = line.split(' ');
            return { hash, message: msgParts.join(' ') };
          }),
        };
      }

      const commits = result.stdout.trim().split('\n').map(line => {
        const [hash, shortHash, author, email, date, ...msgParts] = line.split('|');
        return { hash, shortHash, author, email, date, message: msgParts.join('|') };
      });

      return { success: true, commits };
    },
  };

  const gitDiffTool = {
    name: 'git_diff',
    description: 'Show changes in working tree or staged changes.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
        staged: { type: 'boolean', description: 'Show staged changes' },
        file: { type: 'string', description: 'Specific file to diff' },
        stat: { type: 'boolean', description: 'Show diffstat summary only' },
      },
    },
    async execute({ cwd = '.', staged = false, file, stat = false }) {
      let cmd = 'diff';
      if (staged) cmd += ' --cached';
      if (stat) cmd += ' --stat';
      if (file) cmd += ` -- "${file}"`;

      const result = await runGit(cmd, cwd);
      return {
        success: result.success,
        diff: result.stdout,
        error: result.error,
      };
    },
  };

  const gitAddTool = {
    name: 'git_add',
    description: 'Stage files for commit.',
    category: 'git',
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
        files: { type: 'string', description: 'Files to stage ("." for all, or specific paths)' },
      },
      required: ['files'],
    },
    async execute({ cwd = '.', files }) {
      const result = await runGit(`add "${files}"`, cwd);
      return {
        success: result.success,
        message: result.success ? `Staged: ${files}` : result.error,
      };
    },
  };

  const gitCommitTool = {
    name: 'git_commit',
    description: 'Commit staged changes with a message.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
        message: { type: 'string', description: 'Commit message' },
        amend: { type: 'boolean', description: 'Amend last commit' },
      },
      required: ['message'],
    },
    async execute({ cwd = '.', message, amend = false }) {
      const cmd = `commit -m "${message.replace(/"/g, '\\"')}" ${amend ? '--amend' : ''}`;
      const result = await runGit(cmd, cwd);
      return {
        success: result.success,
        output: result.stdout,
        error: result.error,
      };
    },
  };

  const gitPushTool = {
    name: 'git_push',
    description: 'Push commits to remote repository.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
        remote: { type: 'string', description: 'Remote name (default: origin)' },
        branch: { type: 'string', description: 'Branch name (default: current)' },
        force: { type: 'boolean', description: 'Force push (use with caution)' },
        setUpstream: { type: 'boolean', description: 'Set upstream tracking' },
      },
    },
    async execute({ cwd = '.', remote = 'origin', branch, force = false, setUpstream = false }) {
      let cmd = `push ${remote}`;
      if (branch) cmd += ` ${branch}`;
      if (force) cmd += ' --force';
      if (setUpstream) cmd += ' --set-upstream';

      const result = await runGit(cmd, cwd);
      return {
        success: result.success,
        output: result.stdout,
        error: result.error,
      };
    },
  };

  const gitPullTool = {
    name: 'git_pull',
    description: 'Pull changes from remote repository.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
        remote: { type: 'string', description: 'Remote name' },
        branch: { type: 'string', description: 'Branch name' },
        rebase: { type: 'boolean', description: 'Rebase instead of merge' },
      },
    },
    async execute({ cwd = '.', remote, branch, rebase = false }) {
      let cmd = 'pull';
      if (rebase) cmd += ' --rebase';
      if (remote) cmd += ` ${remote}`;
      if (branch) cmd += ` ${branch}`;

      const result = await runGit(cmd, cwd);
      return {
        success: result.success,
        output: result.stdout,
        error: result.error,
      };
    },
  };

  const gitBranchTool = {
    name: 'git_branch',
    description: 'List, create, or delete branches.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
        action: { type: 'string', enum: ['list', 'create', 'checkout', 'delete'], description: 'Action' },
        name: { type: 'string', description: 'Branch name (for create/checkout/delete)' },
      },
    },
    async execute({ cwd = '.', action = 'list', name }) {
      let cmd;
      switch (action) {
        case 'list':
          cmd = 'branch -a';
          break;
        case 'create':
          cmd = `checkout -b ${name}`;
          break;
        case 'checkout':
          cmd = `checkout ${name}`;
          break;
        case 'delete':
          cmd = `branch -d ${name}`;
          break;
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      const result = await runGit(cmd, cwd);
      return {
        success: result.success,
        output: result.stdout,
        error: result.error,
      };
    },
  };

  const gitInfoTool = {
    name: 'git_info',
    description: 'Get repository overview: remote, branches, last commit.',
    category: 'git',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: `Repository path. ${PATH_PREFIX_NOTE}` },
      },
    },
    async execute({ cwd = '.' }) {
      const info = {};

      const remoteResult = await runGit('remote -v', cwd);
      info.remotes = remoteResult.success ? remoteResult.stdout.trim().split('\n') : [];

      const branchResult = await runGit('branch --show-current', cwd);
      info.currentBranch = branchResult.success ? branchResult.stdout.trim() : 'unknown';

      const allBranches = await runGit('branch -a', cwd);
      info.branches = allBranches.success
        ? allBranches.stdout.trim().split('\n').map(branch => branch.trim().replace(/^\* /, ''))
        : [];

      const lastCommit = await runGit('log -1 --pretty=format:"%H|%h|%an|%ad|%s" --date=short', cwd);
      if (lastCommit.success) {
        const [hash, shortHash, author, date, message] = lastCommit.stdout.split('|');
        info.lastCommit = { hash, shortHash, author, date, message };
      }

      return { success: true, ...info };
    },
  };

  return [
    gitStatusTool,
    gitLogTool,
    gitDiffTool,
    gitAddTool,
    gitCommitTool,
    gitPushTool,
    gitPullTool,
    gitBranchTool,
    gitInfoTool,
  ];
}

const defaultGitTools = createGitTools();

export const [
  gitStatusTool,
  gitLogTool,
  gitDiffTool,
  gitAddTool,
  gitCommitTool,
  gitPushTool,
  gitPullTool,
  gitBranchTool,
  gitInfoTool,
] = defaultGitTools;

export const gitTools = defaultGitTools;

export default gitTools;
