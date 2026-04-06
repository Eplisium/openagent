/**
 * 🏷️ Git-Native Checkpoint System for OpenAgent
 * Uses git tags/commits for reliable undo/redo operations
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
// path and fs removed — not used in this file

const execFileAsync = promisify(execFile);

/**
 * Git-native checkpoint system for OpenAgent
 * Uses git stash/commits for reliable undo/redo
 */
export class GitCheckpoint {
  /**
   * @param {Object} options - Configuration options
   * @param {string} [options.workingDir=process.cwd()] - Working directory for git operations
   * @param {string} [options.checkpointPrefix='openagent/checkpoint'] - Prefix for checkpoint tags
   */
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.checkpointPrefix = options.checkpointPrefix || 'openagent/checkpoint';
  }

  /**
   * Execute a git command and return the result
   * @param {string[]} args - Git command arguments
   * @returns {Promise<{stdout: string, stderr: string}>}
   * @private
   */
  async _git(...args) {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: this.workingDir,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), success: true };
    } catch (error) {
      return {
        stdout: '',
        stderr: error.message,
        success: false,
        code: error.code
      };
    }
  }

  /**
   * Check if the working directory is a git repository
   * @returns {Promise<boolean>}
   */
  async isGitRepo() {
    const result = await this._git('rev-parse', '--git-dir');
    return result.success;
  }

  /**
   * Check if there are uncommitted changes in the repository
   * @returns {Promise<boolean>}
   */
  async hasUncommittedChanges() {
    const result = await this._git('status', '--porcelain');
    return result.success && result.stdout.length > 0;
  }

  /**
   * Get the current git status
   * @returns {Promise<{branch: string, dirty: boolean, staged: number, unstaged: number}>}
   */
  async getCurrentStatus() {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return { branch: null, dirty: false, staged: 0, unstaged:0, error: 'Not a git repository' };
    }

    // Get current branch
    const branchResult = await this._git('rev-parse', '--abbrev-ref', 'HEAD');
    const branch = branchResult.success ? branchResult.stdout : 'unknown';

    // Get status porcelain
    const statusResult = await this._git('status', '--porcelain');
    const lines = statusResult.stdout ? statusResult.stdout.split('\n') : [];
    
    let staged = 0;
    let unstaged = 0;
    
    for (const line of lines) {
      if (line.length >= 2) {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        
        if (indexStatus !== ' ' && indexStatus !== '?') staged++;
        if (workTreeStatus !== ' ') unstaged++;
      }
    }

    return {
      branch,
      dirty: lines.length > 0,
      staged,
      unstaged,
    };
  }

  /**
   * Create a named checkpoint using git tag
   * @param {string} name - Checkpoint name
   * @returns {Promise<{id: string, name: string, hash: string, timestamp: string, filesChanged: number}>}
   */
  async createCheckpoint(name) {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      throw new Error('Not a git repository. Cannot create checkpoint.');
    }

    // Generate unique checkpoint ID
    const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tagName = `${this.checkpointPrefix}/${id}`;

    // Check for uncommitted changes and stage them
    const hasChanges = await this.hasUncommittedChanges();
    let filesChanged = 0;

    if (hasChanges) {
      // Stage all changes
      const addResult = await this._git('add', '-A');
      if (!addResult.success) {
        throw new Error(`Failed to stage changes: ${addResult.stderr}`);
      }

      // Get count of changed files
      const statusResult = await this._git('status', '--porcelain');
      filesChanged = statusResult.stdout ? statusResult.stdout.split('\n').filter(l => l.trim()).length : 0;

      // Commit changes with checkpoint message
      const commitResult = await this._git('commit', '-m', `checkpoint: ${name}`);
      if (!commitResult.success && !commitResult.stderr.includes('nothing to commit')) {
        throw new Error(`Failed to commit checkpoint: ${commitResult.stderr}`);
      }
    }

    // Get the current commit hash
    const hashResult = await this._git('rev-parse', 'HEAD');
    const hash = hashResult.success ? hashResult.stdout : '';

    // Create annotated tag
    const tagResult = await this._git('tag', '-a', tagName, '-m', name);
    if (!tagResult.success) {
      throw new Error(`Failed to create tag: ${tagResult.stderr}`);
    }

    return {
      id,
      name,
      hash,
      timestamp: new Date().toISOString(),
      filesChanged,
    };
  }

  /**
   * List all checkpoints
   * @returns {Promise<Array<{id: string, name: string, hash: string, timestamp: string}>>}
   */
  async listCheckpoints() {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return [];
    }

    // List tags matching the prefix
    const tagResult = await this._git('tag', '-l', `${this.checkpointPrefix}/*`);
    if (!tagResult.success || !tagResult.stdout) {
      return [];
    }

    const tags = tagResult.stdout.split('\n').filter(t => t.trim());
    const checkpoints = [];

    for (const tag of tags) {
      // Extract checkpoint ID from tag name
      const id = tag.replace(`${this.checkpointPrefix}/`, '');
      
      // Get tag message (checkpoint name)
      const msgResult = await this._git('tag', '-l', '--format=%(contents)', tag);
      const name = msgResult.success ? msgResult.stdout : '';
      
      // Get the commit hash for this tag
      const hashResult = await this._git('rev-list', '-n', '1', tag);
      const hash = hashResult.success ? hashResult.stdout : '';
      
      // Get tag date
      const dateResult = await this._git('log', '-1', '--format=%ai', tag);
      const timestamp = dateResult.success ? dateResult.stdout : new Date().toISOString();

      checkpoints.push({
        id,
        name,
        hash,
        timestamp,
      });
    }

    // Sort by timestamp descending (most recent first)
    return checkpoints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Restore to a specific checkpoint
   * @param {string} id - Checkpoint ID to restore
   * @returns {Promise<{restored: boolean, filesRestored: number}>}
   */
  async restoreCheckpoint(id) {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      throw new Error('Not a git repository. Cannot restore checkpoint.');
    }

    const tagName = `${this.checkpointPrefix}/${id}`;

    // Verify the checkpoint exists
    const tagExists = await this._git('cat-file', '-t', `refs/tags/${tagName}`);
    if (!tagExists.success) {
      throw new Error(`Checkpoint ${id} not found`);
    }

    // Get current status before reset
    const statusBefore = await this.getCurrentStatus();
    
    // Hard reset to the checkpoint commit
    const resetResult = await this._git('reset', '--hard', tagName);
    if (!resetResult.success) {
      throw new Error(`Failed to restore checkpoint: ${resetResult.stderr}`);
    }

    // Clean untracked files
    await this._git('clean', '-fd');

    return {
      restored: true,
      filesRestored: statusBefore.dirty ? (statusBefore.staged + statusBefore.unstaged) : 0,
    };
  }

  /**
   * Delete a checkpoint
   * @param {string} id - Checkpoint ID to delete
   * @returns {Promise<boolean>}
   */
  async deleteCheckpoint(id) {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return false;
    }

    const tagName = `${this.checkpointPrefix}/${id}`;
    
    // Delete the tag
    const result = await this._git('tag', '-d', tagName);
    return result.success;
  }

  /**
   * Get the diff between current state and a checkpoint
   * @param {string} id - Checkpoint ID
   * @returns {Promise<string>} Git diff output
   */
  async getCheckpointDiff(id) {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return '';
    }

    const tagName = `${this.checkpointPrefix}/${id}`;
    
    // Check if checkpoint exists
    const tagExists = await this._git('cat-file', '-t', `refs/tags/${tagName}`);
    if (!tagExists.success) {
      throw new Error(`Checkpoint ${id} not found`);
    }

    // Get diff between checkpoint and current state
    const diffResult = await this._git('diff', tagName, 'HEAD');
    return diffResult.stdout || '';
  }

  /**
   * Get the diff between two checkpoints
   * @param {string} fromId - Source checkpoint ID
   * @param {string} toId - Target checkpoint ID
   * @returns {Promise<string>} Git diff output
   */
  async getCheckpointDiffBetween(fromId, toId) {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return '';
    }

    const fromTag = `${this.checkpointPrefix}/${fromId}`;
    const toTag = `${this.checkpointPrefix}/${toId}`;
    
    const diffResult = await this._git('diff', fromTag, toTag);
    return diffResult.stdout || '';
  }
}

export default GitCheckpoint;