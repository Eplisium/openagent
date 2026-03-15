/**
 * 🔀 Git Tools
 * Full git workflow integration
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(execCb);

async function gitExec(args, cwd = '.') {
  const resolvedCwd = path.resolve(cwd);
  try {
    const result = await execAsync(`git ${args}`, {
      cwd: resolvedCwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { success: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
  }
}

/**
 * Git status
 */
export const gitStatusTool = {
  name: 'git_status',
  description: 'Show working tree status: branch, staged/modified/untracked files, ahead/behind.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path (default: current dir)' },
      short: { type: 'boolean', description: 'Short format output' },
    },
  },
  async execute({ cwd = '.', short = false }) {
    const result = await gitExec(`status ${short ? '--short' : '--porcelain=v1'}`, cwd);
    if (!result.success) return result;
    
    // Also get branch info
    const branchResult = await gitExec('branch --show-current', cwd);
    const branch = branchResult.success ? branchResult.stdout.trim() : 'unknown';
    
    // Get ahead/behind
    const trackingResult = await gitExec('rev-list --left-right --count HEAD...@{upstream}', cwd);
    let ahead = 0, behind = 0;
    if (trackingResult.success) {
      const parts = trackingResult.stdout.trim().split(/\s+/);
      ahead = parseInt(parts[0]) || 0;
      behind = parseInt(parts[1]) || 0;
    }
    
    const lines = result.stdout.trim().split('\n').filter(l => l);
    const staged = lines.filter(l => l[0] !== ' ' && l[0] !== '?').length;
    const modified = lines.filter(l => l[1] === 'M' || l[1] === 'D').length;
    const untracked = lines.filter(l => l.startsWith('??')).length;
    
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

/**
 * Git log
 */
export const gitLogTool = {
  name: 'git_log',
  description: 'Show commit history with details.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
      count: { type: 'integer', description: 'Number of commits (default: 10)' },
      oneline: { type: 'boolean', description: 'Compact one-line format' },
    },
  },
  async execute({ cwd = '.', count = 10, oneline = false }) {
    const format = oneline
      ? '--oneline'
      : '--pretty=format:"%H|%h|%an|%ae|%ad|%s" --date=short';
    
    const result = await gitExec(`log ${format} -n ${count}`, cwd);
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

/**
 * Git diff
 */
export const gitDiffTool = {
  name: 'git_diff',
  description: 'Show changes in working tree or staged changes.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
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
    
    const result = await gitExec(cmd, cwd);
    return {
      success: result.success,
      diff: result.stdout,
      error: result.error,
    };
  },
};

/**
 * Git add
 */
export const gitAddTool = {
  name: 'git_add',
  description: 'Stage files for commit.',
  category: 'git',
  destructive: false,
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
      files: { type: 'string', description: 'Files to stage ("." for all, or specific paths)' },
    },
    required: ['files'],
  },
  async execute({ cwd = '.', files }) {
    const result = await gitExec(`add "${files}"`, cwd);
    return {
      success: result.success,
      message: result.success ? `Staged: ${files}` : result.error,
    };
  },
};

/**
 * Git commit
 */
export const gitCommitTool = {
  name: 'git_commit',
  description: 'Commit staged changes with a message.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
      message: { type: 'string', description: 'Commit message' },
      amend: { type: 'boolean', description: 'Amend last commit' },
    },
    required: ['message'],
  },
  async execute({ cwd = '.', message, amend = false }) {
    const cmd = `commit -m "${message.replace(/"/g, '\\"')}" ${amend ? '--amend' : ''}`;
    const result = await gitExec(cmd, cwd);
    return {
      success: result.success,
      output: result.stdout,
      error: result.error,
    };
  },
};

/**
 * Git push
 */
export const gitPushTool = {
  name: 'git_push',
  description: 'Push commits to remote repository.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
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
    
    const result = await gitExec(cmd, cwd);
    return {
      success: result.success,
      output: result.stdout,
      error: result.error,
    };
  },
};

/**
 * Git pull
 */
export const gitPullTool = {
  name: 'git_pull',
  description: 'Pull changes from remote repository.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
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
    
    const result = await gitExec(cmd, cwd);
    return {
      success: result.success,
      output: result.stdout,
      error: result.error,
    };
  },
};

/**
 * Git branch
 */
export const gitBranchTool = {
  name: 'git_branch',
  description: 'List, create, or delete branches.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
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
    
    const result = await gitExec(cmd, cwd);
    return {
      success: result.success,
      output: result.stdout,
      error: result.error,
    };
  },
};

/**
 * Git info (repo overview)
 */
export const gitInfoTool = {
  name: 'git_info',
  description: 'Get repository overview: remote, branches, last commit.',
  category: 'git',
  parameters: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Repository path' },
    },
  },
  async execute({ cwd = '.' }) {
    const info = {};
    
    const remoteResult = await gitExec('remote -v', cwd);
    info.remotes = remoteResult.success ? remoteResult.stdout.trim().split('\n') : [];
    
    const branchResult = await gitExec('branch --show-current', cwd);
    info.currentBranch = branchResult.success ? branchResult.stdout.trim() : 'unknown';
    
    const allBranches = await gitExec('branch -a', cwd);
    info.branches = allBranches.success ? allBranches.stdout.trim().split('\n').map(b => b.trim().replace(/^\* /, '')) : [];
    
    const lastCommit = await gitExec('log -1 --pretty=format:"%H|%h|%an|%ad|%s" --date=short', cwd);
    if (lastCommit.success) {
      const [hash, shortHash, author, date, message] = lastCommit.stdout.split('|');
      info.lastCommit = { hash, shortHash, author, date, message };
    }
    
    return { success: true, ...info };
  },
};

export const gitTools = [
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

export default gitTools;
