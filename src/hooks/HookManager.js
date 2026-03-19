/**
 * 🪝 Hook Manager v5.0
 * Deterministic rules that fire at specific lifecycle points
 * 
 * Inspired by Claude Code's Hooks:
 * - PreToolUse: Run before a tool executes (validation, blocking)
 * - PostToolUse: Run after a tool executes (formatting, logging)
 * - Stop: Run when agent stops (cleanup, notifications)
 * 
 * Hooks are MANDATORY — the agent cannot override them.
 * They're configured in .openagent/hooks.json
 */

import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

const HOOKS_FILE = 'hooks.json';
const HOOK_TIMEOUT_MS = 30000; // 30 seconds

const HookType = {
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
  STOP: 'Stop',
};

// ═══════════════════════════════════════════════════════════════════
// 🪝 Hook Manager
// ═══════════════════════════════════════════════════════════════════

export class HookManager {
  constructor(options = {}) {
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.openAgentDir = options.openAgentDir || path.join(this.workingDir, '.openagent');
    this.hooksFile = options.hooksFile || path.join(this.openAgentDir, HOOKS_FILE);
    this.verbose = options.verbose !== false;
    
    // Loaded hooks configuration
    this.hooks = {
      [HookType.PRE_TOOL_USE]: [],
      [HookType.POST_TOOL_USE]: [],
      [HookType.STOP]: [],
    };
    
    this._loaded = false;
    
    // Execution history
    this.history = [];
    this.maxHistorySize = 100;
  }

  /**
   * Load hooks from configuration file
   */
  async load() {
    this._loaded = true;

    if (!await fs.pathExists(this.hooksFile)) {
      return;
    }

    try {
      const config = await fs.readJson(this.hooksFile);
      
      // Parse each hook type
      for (const [type, hooks] of Object.entries(config.hooks || {})) {
        if (this.hooks[type]) {
          this.hooks[type] = Array.isArray(hooks) ? hooks : [];
        }
      }

      if (this.verbose) {
        const total = Object.values(this.hooks).reduce((sum, h) => sum + h.length, 0);
        if (total > 0) {
          console.log(chalk.green(`✓ Loaded ${total} hook(s)`));
        }
      }
    } catch (err) {
      if (this.verbose) {
        console.log(chalk.red(`✗ Failed to load hooks: ${err.message}`));
      }
    }
  }

  /**
   * Ensure hooks are loaded
   */
  async ensureLoaded() {
    if (!this._loaded) {
      await this.load();
    }
  }

  /**
   * Check if a hook matches a tool call
   * @param {object} hook - Hook configuration
   * @param {string} toolName - Name of the tool being called
   * @returns {boolean}
   */
  matchesTool(hook, toolName) {
    if (!hook.matcher) {
      return true; // No matcher = matches all tools
    }

    // Support regex patterns
    try {
      const regex = new RegExp(hook.matcher, 'i');
      return regex.test(toolName);
    } catch {
      // Fall back to simple string matching
      return toolName.toLowerCase().includes(hook.matcher.toLowerCase());
    }
  }

  /**
   * Execute a hook command
   * @param {object} hook - Hook configuration
   * @param {object} context - Execution context
   * @returns {Promise<object>} Hook result
   */
  async executeHook(hook, context = {}) {
    const startTime = Date.now();
    
    // Build environment variables for the hook
    const env = {
      ...process.env,
      OPENAGENT_HOOK_TYPE: context.hookType || '',
      OPENAGENT_TOOL_NAME: context.toolName || '',
      OPENAGENT_TOOL_ARGS: JSON.stringify(context.toolArgs || {}),
      OPENAGENT_WORKING_DIR: this.workingDir,
      OPENAGENT_FILE_PATH: context.filePath || '',
    };

    try {
      const { stdout, stderr } = await execAsync(hook.command, {
        cwd: this.workingDir,
        env,
        timeout: hook.timeout || HOOK_TIMEOUT_MS,
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      });

      const duration = Date.now() - startTime;

      return {
        success: true,
        command: hook.command,
        stdout: stdout?.trim() || '',
        stderr: stderr?.trim() || '',
        duration,
      };
    } catch (err) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        command: hook.command,
        error: err.message,
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || '',
        exitCode: err.code,
        duration,
      };
    }
  }

  /**
   * Run PreToolUse hooks
   * @param {string} toolName - Name of the tool about to execute
   * @param {object} toolArgs - Tool arguments
   * @returns {Promise<{ proceed: boolean, results: Array }>}
   */
  async runPreToolUse(toolName, toolArgs = {}) {
    await this.ensureLoaded();
    
    const hooks = this.hooks[HookType.PRE_TOOL_USE].filter(h => 
      this.matchesTool(h, toolName)
    );

    if (hooks.length === 0) {
      return { proceed: true, results: [] };
    }

    const results = [];
    let proceed = true;

    for (const hook of hooks) {
      const result = await this.executeHook(hook, {
        hookType: HookType.PRE_TOOL_USE,
        toolName,
        toolArgs,
      });

      results.push(result);

      // Record in history
      this.recordExecution(HookType.PRE_TOOL_USE, toolName, result);

      // If hook failed and it's marked as blocking, stop execution
      if (!result.success && hook.blocking) {
        proceed = false;
        if (this.verbose) {
          console.log(chalk.red(`🪝 PreToolUse hook blocked: ${hook.command}`));
        }
        break;
      }
    }

    return { proceed, results };
  }

  /**
   * Run PostToolUse hooks
   * @param {string} toolName - Name of the tool that executed
   * @param {object} toolArgs - Tool arguments
   * @param {object} toolResult - Tool result
   * @returns {Promise<{ results: Array }>}
   */
  async runPostToolUse(toolName, toolArgs = {}, toolResult = {}) {
    await this.ensureLoaded();
    
    const hooks = this.hooks[HookType.POST_TOOL_USE].filter(h => 
      this.matchesTool(h, toolName)
    );

    if (hooks.length === 0) {
      return { results: [] };
    }

    const results = [];
    const filePath = toolArgs.path || toolArgs.filePath || '';

    for (const hook of hooks) {
      const result = await this.executeHook(hook, {
        hookType: HookType.POST_TOOL_USE,
        toolName,
        toolArgs,
        filePath,
      });

      results.push(result);
      this.recordExecution(HookType.POST_TOOL_USE, toolName, result);
    }

    return { results };
  }

  /**
   * Run Stop hooks
   * @param {object} context - Stop context (reason, stats, etc.)
   * @returns {Promise<{ results: Array }>}
   */
  async runStop(context = {}) {
    await this.ensureLoaded();
    
    const hooks = this.hooks[HookType.STOP];

    if (hooks.length === 0) {
      return { results: [] };
    }

    const results = [];

    for (const hook of hooks) {
      const result = await this.executeHook(hook, {
        hookType: HookType.STOP,
        ...context,
      });

      results.push(result);
      this.recordExecution(HookType.STOP, 'stop', result);
    }

    return { results };
  }

  /**
   * Record hook execution in history
   */
  recordExecution(type, toolName, result) {
    this.history.push({
      type,
      toolName,
      success: result.success,
      command: result.command,
      duration: result.duration,
      timestamp: new Date().toISOString(),
    });

    // Keep history manageable
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-Math.floor(this.maxHistorySize / 2));
    }
  }

  /**
   * Get hook execution history
   */
  getHistory(limit = 20) {
    return this.history.slice(-limit);
  }

  /**
   * Get hook stats
   */
  getStats() {
    const total = this.history.length;
    const successful = this.history.filter(h => h.success).length;
    const failed = total - successful;

    return {
      totalExecutions: total,
      successful,
      failed,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) + '%' : 'N/A',
      configuredHooks: {
        PreToolUse: this.hooks[HookType.PRE_TOOL_USE].length,
        PostToolUse: this.hooks[HookType.POST_TOOL_USE].length,
        Stop: this.hooks[HookType.STOP].length,
      },
    };
  }

  /**
   * List all configured hooks
   */
  listHooks() {
    const list = [];

    for (const [type, hooks] of Object.entries(this.hooks)) {
      for (const hook of hooks) {
        list.push({
          type,
          matcher: hook.matcher || '*',
          command: hook.command,
          blocking: hook.blocking || false,
          timeout: hook.timeout || HOOK_TIMEOUT_MS,
        });
      }
    }

    return list;
  }

  /**
   * Initialize hooks file with example configuration
   */
  async initHooks() {
    await fs.ensureDir(this.openAgentDir);

    if (await fs.pathExists(this.hooksFile)) {
      return { exists: true };
    }

    const exampleConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'write_file|edit_file',
            command: 'echo "About to modify: $OPENAGENT_FILE_PATH"',
            blocking: false,
          },
        ],
        PostToolUse: [
          {
            matcher: 'write_file|edit_file',
            command: 'echo "Modified: $OPENAGENT_FILE_PATH"',
            blocking: false,
          },
        ],
        Stop: [
          {
            command: 'echo "Agent session ended"',
            blocking: false,
          },
        ],
      },
    };

    await fs.writeJson(this.hooksFile, exampleConfig, { spaces: 2 });

    if (this.verbose) {
      console.log(chalk.green(`✓ Created hooks config: ${this.hooksFile}`));
    }

    return { created: true, path: this.hooksFile };
  }
}

export { HookType };
export default HookManager;
