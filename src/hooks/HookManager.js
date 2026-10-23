/**
 * 🪝 Hook Manager v6.0
 * Deterministic commands that fire at lifecycle points.
 *
 * Events: PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, PreCompact,
 *         Notification, Stop, SubagentStop
 *
 * Configuration sources (all merged):
 *   1. Legacy  <openAgentDir>/hooks.json
 *        { "hooks": { "PreToolUse": [{ "matcher": "write_file", "command": "...", "blocking": true, "timeout": 30000 }] } }
 *        (timeout in ms; runs under PowerShell on Windows, /bin/sh elsewhere)
 *   2. Claude-Code compatible `hooks` section of
 *        <workingDir>/.openagent/settings.json and ~/.openagent/settings.json
 *        { "hooks": { "PreToolUse": [{ "matcher": "exec|write_file", "hooks": [{ "type": "command", "command": "...", "timeout": 30 }] }] } }
 *        (timeout in seconds; runs in the platform default shell)
 *
 * Protocol (Claude-Code compatible):
 *   - Event JSON is written to the command's stdin
 *     ({ session_id, hook_event_name, cwd, tool_name, tool_input, tool_response, prompt, ... }).
 *   - Exit code 0: success. If stdout is JSON it may contain
 *       { decision: 'block'|'approve', reason, updatedInput, additionalContext,
 *         continue: false, stopReason,
 *         hookSpecificOutput: { permissionDecision: 'allow'|'deny'|'ask', permissionDecisionReason, updatedInput, additionalContext } }
 *     For UserPromptSubmit/SessionStart plain stdout is added as context.
 *   - Exit code 2: block; stderr is the reason (fed back to the model).
 *   - Other non-zero exit codes: non-blocking error (legacy `blocking: true` hooks block).
 *
 * Hooks are MANDATORY — the agent cannot override them.
 */

import fs from '../utils/fs-compat.js';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import chalk from '../utils/chalk-compat.js';

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

const HOOKS_FILE = 'hooks.json';
const HOOK_TIMEOUT_MS = 30000; // 30 seconds
const MAX_OUTPUT_CHARS = 64 * 1024;

const HookType = {
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
  USER_PROMPT_SUBMIT: 'UserPromptSubmit',
  SESSION_START: 'SessionStart',
  PRE_COMPACT: 'PreCompact',
  NOTIFICATION: 'Notification',
  STOP: 'Stop',
  SUBAGENT_STOP: 'SubagentStop',
};

const ALL_EVENTS = Object.values(HookType);

function emptyHookMap() {
  const map = {};
  for (const event of ALL_EVENTS) map[event] = [];
  return map;
}

function truncate(text) {
  const s = String(text ?? '');
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) : s;
}

/**
 * Parse hook stdout as JSON when it looks like JSON.
 * @param {string} stdout
 * @returns {object|null}
 */
export function parseHookOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text || (text[0] !== '{')) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // Some shells add a trailing banner; try the last JSON-looking line
    const lines = text.split(/\r?\n/).reverse();
    for (const line of lines) {
      const l = line.trim();
      if (l.startsWith('{') && l.endsWith('}')) {
        try { return JSON.parse(l); } catch { /* keep looking */ }
      }
    }
    return null;
  }
}

/**
 * Run a shell command, writing `input` to stdin.
 * @param {string} command
 * @param {{cwd: string, env: object, input?: string, timeoutMs: number, shell: string|boolean}} opts
 * @returns {Promise<{exitCode: number|null, stdout: string, stderr: string, timedOut: boolean, error?: string}>}
 */
export function runHookCommand(command, opts) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    try {
      child = spawn(command, {
        cwd: opts.cwd,
        env: opts.env,
        shell: opts.shell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, error: err.message });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* already gone */ }
      finish({ exitCode: null, stdout: stdout.trim(), stderr: stderr.trim(), timedOut: true, error: `Hook timed out after ${opts.timeoutMs}ms` });
    }, opts.timeoutMs);

    child.stdout.on('data', (chunk) => { stdout = truncate(stdout + chunk); });
    child.stderr.on('data', (chunk) => { stderr = truncate(stderr + chunk); });
    child.on('error', (err) => {
      finish({ exitCode: null, stdout: stdout.trim(), stderr: stderr.trim(), timedOut, error: err.message });
    });
    child.on('close', (code) => {
      finish({ exitCode: code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
    });

    // Commands that never read stdin close the pipe early — ignore EPIPE.
    child.stdin.on('error', () => {});
    try {
      child.stdin.end(opts.input ?? '');
    } catch { /* stdin already closed */ }
  });
}

// ═══════════════════════════════════════════════════════════════════
// 🪝 Hook Manager
// ═══════════════════════════════════════════════════════════════════

export class HookManager {
  /**
   * @param {object} [options]
   * @param {string} [options.workingDir]
   * @param {string} [options.openAgentDir] - dir holding legacy hooks.json
   * @param {string} [options.hooksFile]
   * @param {string|null} [options.projectSettingsPath] - null disables <workingDir>/.openagent/settings.json
   * @param {string|null} [options.userSettingsPath] - null disables ~/.openagent/settings.json
   * @param {object} [options.settingsHooks] - inline Claude-style hooks config (merged with files)
   * @param {string} [options.sessionId]
   * @param {boolean} [options.verbose]
   */
  constructor(options = {}) {
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.openAgentDir = options.openAgentDir || path.join(this.workingDir, '.openagent');
    this.hooksFile = options.hooksFile || path.join(this.openAgentDir, HOOKS_FILE);
    this.verbose = options.verbose !== false;
    this.sessionId = options.sessionId || null;
    this.projectSettingsPath = options.projectSettingsPath === null
      ? null
      : (options.projectSettingsPath || path.join(this.workingDir, '.openagent', 'settings.json'));
    this.userSettingsPath = options.userSettingsPath === null
      ? null
      : (options.userSettingsPath || path.join(os.homedir(), '.openagent', 'settings.json'));
    this.inlineSettingsHooks = options.settingsHooks || null;

    /** Legacy hooks.json entries: { matcher, command, blocking, timeout(ms) } */
    this.hooks = emptyHookMap();
    /** Claude-style groups: { matcher, hooks: [{ type, command, timeout(s) }], source } */
    this.settingsHooks = emptyHookMap();

    this._loaded = false;
    this.loadErrors = [];

    // Execution history
    this.history = [];
    this.maxHistorySize = 100;
  }

  /**
   * Load hooks from hooks.json and settings.json files. Safe to call repeatedly.
   */
  async load() {
    this._loaded = true;
    this.hooks = emptyHookMap();
    this.settingsHooks = emptyHookMap();
    this.loadErrors = [];

    if (await fs.pathExists(this.hooksFile)) {
      try {
        const config = await fs.readJson(this.hooksFile);
        for (const [type, hooks] of Object.entries(config.hooks || {})) {
          if (this.hooks[type]) {
            this.hooks[type] = Array.isArray(hooks) ? hooks.filter(h => h && typeof h.command === 'string') : [];
          }
        }
      } catch (err) {
        this.loadErrors.push(`hooks.json: ${err.message}`);
        if (this.verbose) console.log(chalk.red(`✗ Failed to load hooks: ${err.message}`));
      }
    }

    const sources = [];
    if (this.inlineSettingsHooks) sources.push({ hooks: this.inlineSettingsHooks, source: 'inline' });
    for (const [file, label] of [[this.projectSettingsPath, 'project'], [this.userSettingsPath, 'user']]) {
      if (!file || !await fs.pathExists(file)) continue;
      try {
        const text = await fs.readFile(file, 'utf-8');
        const data = text.trim() ? JSON.parse(text) : {};
        if (data && typeof data.hooks === 'object') sources.push({ hooks: data.hooks, source: label });
      } catch (err) {
        this.loadErrors.push(`${file}: ${err.message}`);
      }
    }
    for (const { hooks, source } of sources) this._addSettingsHooks(hooks, source);

    if (this.verbose) {
      const total = this.listHooks().length;
      if (total > 0) console.log(chalk.green(`✓ Loaded ${total} hook(s)`));
    }
  }

  /** @private */
  _addSettingsHooks(config, source) {
    if (!config || typeof config !== 'object') return;
    for (const [event, groups] of Object.entries(config)) {
      if (!this.settingsHooks[event] || !Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!group || typeof group !== 'object') continue;
        // Accept both {matcher, hooks:[...]} and a flat {matcher, command}
        const list = Array.isArray(group.hooks)
          ? group.hooks
          : (typeof group.command === 'string' ? [{ type: 'command', command: group.command, timeout: group.timeout }] : []);
        const commands = list.filter(h => h && (h.type === undefined || h.type === 'command') && typeof h.command === 'string');
        if (commands.length === 0) continue;
        this.settingsHooks[event].push({ matcher: group.matcher || '', hooks: commands, source });
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
   * Check if a hook matches a tool call (regex, case-insensitive; empty/`*` = all)
   * @param {object} hook - Hook configuration
   * @param {string} toolName - Name of the tool being called
   * @returns {boolean}
   */
  matchesTool(hook, toolName) {
    if (!hook.matcher || hook.matcher === '*') {
      return true;
    }
    if (!toolName) return true;

    try {
      const regex = new RegExp(hook.matcher, 'i');
      return regex.test(toolName);
    } catch {
      return toolName.toLowerCase().includes(hook.matcher.toLowerCase());
    }
  }

  /**
   * Whether any hook is configured for an event.
   * @param {string} event
   */
  hasHooks(event) {
    return (this.hooks[event]?.length || 0) + (this.settingsHooks[event]?.length || 0) > 0;
  }

  /**
   * Flatten configured hooks for an event into runnable entries.
   * @private
   */
  _entriesFor(event, matchTarget) {
    const entries = [];
    for (const hook of this.hooks[event] || []) {
      if (!this.matchesTool(hook, matchTarget)) continue;
      entries.push({
        command: hook.command,
        timeoutMs: hook.timeout || HOOK_TIMEOUT_MS,
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
        blocking: hook.blocking === true,
        source: 'hooks.json',
      });
    }
    for (const group of this.settingsHooks[event] || []) {
      if (!this.matchesTool(group, matchTarget)) continue;
      for (const hook of group.hooks) {
        const seconds = Number(hook.timeout);
        entries.push({
          command: hook.command,
          timeoutMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : HOOK_TIMEOUT_MS,
          // Platform default shell (cmd.exe / /bin/sh) preserves exit codes like 2
          shell: true,
          blocking: false,
          source: group.source,
        });
      }
    }
    return entries;
  }

  /** @private */
  _buildEnv(context = {}) {
    return {
      ...process.env,
      OPENAGENT_HOOK_TYPE: context.hookType || '',
      OPENAGENT_TOOL_NAME: context.toolName || '',
      OPENAGENT_TOOL_ARGS: JSON.stringify(context.toolArgs || {}),
      OPENAGENT_WORKING_DIR: this.workingDir,
      OPENAGENT_PROJECT_DIR: this.workingDir,
      CLAUDE_PROJECT_DIR: this.workingDir,
      OPENAGENT_FILE_PATH: context.filePath || '',
      OPENAGENT_SESSION_ID: this.sessionId || '',
    };
  }

  /**
   * Execute a hook command (legacy API — returns success/stdout/stderr).
   * @param {object} hook - { command, timeout(ms) }
   * @param {object} context - { hookType, toolName, toolArgs, filePath, ... }
   * @param {object} [payload] - JSON written to stdin
   * @returns {Promise<object>} Hook result
   */
  async executeHook(hook, context = {}, payload = null) {
    const startTime = Date.now();
    const run = await runHookCommand(hook.command, {
      cwd: this.workingDir,
      env: this._buildEnv(context),
      input: JSON.stringify(payload || this._payload(context.hookType || '', {
        tool_name: context.toolName,
        tool_input: context.toolArgs,
      })),
      timeoutMs: hook.timeoutMs || hook.timeout || HOOK_TIMEOUT_MS,
      shell: hook.shell || (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'),
    });
    const duration = Date.now() - startTime;
    const success = run.exitCode === 0 && !run.timedOut && !run.error;
    return {
      success,
      command: hook.command,
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.exitCode,
      duration,
      ...(success ? {} : { error: run.error || `Hook exited with code ${run.exitCode}` }),
    };
  }

  /** @private */
  _payload(event, extra = {}) {
    const payload = {
      session_id: this.sessionId || '',
      hook_event_name: event,
      cwd: this.workingDir,
    };
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) payload[key] = value;
    }
    return payload;
  }

  /**
   * Run every hook for an event and aggregate their decisions.
   * @private
   * @param {string} event
   * @param {string} matchTarget - tool name (tool events) or source/trigger
   * @param {object} payload - event JSON for stdin
   * @param {object} context - env context
   * @returns {Promise<{blocked: boolean, reason: string, updatedInput: object|null, additionalContext: string[], permissionDecision: string|null, results: Array}>}
   */
  async _runEvent(event, matchTarget, payload, context = {}) {
    await this.ensureLoaded();
    const outcome = {
      blocked: false,
      reason: '',
      updatedInput: null,
      additionalContext: [],
      permissionDecision: null,
      results: [],
    };
    const entries = this._entriesFor(event, matchTarget);
    if (entries.length === 0) return outcome;

    let currentPayload = payload;
    for (const entry of entries) {
      const result = await this.executeHook(entry, { ...context, hookType: event }, currentPayload);
      result.source = entry.source;
      outcome.results.push(result);
      this.recordExecution(event, context.toolName || matchTarget || event.toLowerCase(), result);

      const json = result.exitCode === 0 ? parseHookOutput(result.stdout) : null;
      result.output = json;

      if (result.exitCode === 2) {
        outcome.blocked = true;
        outcome.reason = result.stderr || result.stdout || `Blocked by ${event} hook: ${entry.command}`;
      } else if (json) {
        const specific = json.hookSpecificOutput && typeof json.hookSpecificOutput === 'object' ? json.hookSpecificOutput : {};
        const decision = String(specific.permissionDecision || json.decision || '').toLowerCase();
        const reason = specific.permissionDecisionReason || json.reason || json.stopReason || '';
        if (decision === 'block' || decision === 'deny' || json.continue === false) {
          outcome.blocked = true;
          outcome.reason = reason || `Blocked by ${event} hook: ${entry.command}`;
        } else if (decision === 'approve' || decision === 'allow') {
          outcome.permissionDecision = 'allow';
          if (reason) outcome.reason = reason;
        } else if (decision === 'ask') {
          outcome.permissionDecision = 'ask';
          if (reason) outcome.reason = reason;
        }
        const updated = specific.updatedInput || json.updatedInput;
        if (updated && typeof updated === 'object' && !Array.isArray(updated)) {
          outcome.updatedInput = { ...(outcome.updatedInput || {}), ...updated };
          if (currentPayload.tool_input) {
            currentPayload = { ...currentPayload, tool_input: { ...currentPayload.tool_input, ...updated } };
          }
        }
        const extra = specific.additionalContext || json.additionalContext;
        if (typeof extra === 'string' && extra.trim()) outcome.additionalContext.push(extra.trim());
      } else if (result.exitCode === 0 && result.stdout
        && (event === HookType.USER_PROMPT_SUBMIT || event === HookType.SESSION_START)) {
        // Plain stdout from these events is injected as context (Claude-Code behavior)
        outcome.additionalContext.push(result.stdout);
      } else if (!result.success && entry.blocking) {
        // Legacy hooks.json `blocking: true` semantics: any failure blocks
        outcome.blocked = true;
        outcome.reason = result.stderr || result.error || `Blocked by ${event} hook: ${entry.command}`;
      }

      if (outcome.blocked) {
        if (this.verbose) console.log(chalk.red(`🪝 ${event} hook blocked: ${entry.command}`));
        break;
      }
    }
    return outcome;
  }

  /**
   * Run PreToolUse hooks.
   * @param {string} toolName
   * @param {object} toolArgs
   * @returns {Promise<{proceed: boolean, blocked: boolean, reason: string, updatedInput: object|null, permissionDecision: string|null, additionalContext: string[], results: Array}>}
   */
  async runPreToolUse(toolName, toolArgs = {}) {
    const outcome = await this._runEvent(
      HookType.PRE_TOOL_USE,
      toolName,
      this._payload(HookType.PRE_TOOL_USE, { tool_name: toolName, tool_input: toolArgs || {} }),
      { toolName, toolArgs, filePath: toolArgs?.path || toolArgs?.filePath || '' },
    );
    return { ...outcome, proceed: !outcome.blocked };
  }

  /**
   * Run PostToolUse hooks.
   * @param {string} toolName
   * @param {object} toolArgs
   * @param {object} toolResult
   * @returns {Promise<{results: Array, additionalContext: string[], blocked: boolean, reason: string}>}
   */
  async runPostToolUse(toolName, toolArgs = {}, toolResult = {}) {
    const outcome = await this._runEvent(
      HookType.POST_TOOL_USE,
      toolName,
      this._payload(HookType.POST_TOOL_USE, { tool_name: toolName, tool_input: toolArgs || {}, tool_response: toolResult }),
      { toolName, toolArgs, filePath: toolArgs?.path || toolArgs?.filePath || '' },
    );
    // A PostToolUse "block" cannot undo the call; surface its reason as context.
    if (outcome.blocked && outcome.reason) outcome.additionalContext.push(outcome.reason);
    return outcome;
  }

  /**
   * Run UserPromptSubmit hooks. Can block the prompt or inject context.
   * @param {string} prompt
   */
  async runUserPromptSubmit(prompt) {
    return this._runEvent(
      HookType.USER_PROMPT_SUBMIT,
      '',
      this._payload(HookType.USER_PROMPT_SUBMIT, { prompt: String(prompt ?? '') }),
      {},
    );
  }

  /**
   * Run SessionStart hooks (matcher tested against source: startup|resume|clear).
   * @param {{source?: string}} [context]
   */
  async runSessionStart(context = {}) {
    const source = context.source || 'startup';
    return this._runEvent(HookType.SESSION_START, source, this._payload(HookType.SESSION_START, { source }), {});
  }

  /**
   * Run PreCompact hooks (matcher tested against trigger: auto|manual).
   * @param {{trigger?: string, customInstructions?: string}} [context]
   */
  async runPreCompact(context = {}) {
    const trigger = context.trigger || 'auto';
    return this._runEvent(
      HookType.PRE_COMPACT,
      trigger,
      this._payload(HookType.PRE_COMPACT, { trigger, custom_instructions: context.customInstructions || '' }),
      {},
    );
  }

  /**
   * Run Notification hooks.
   * @param {{message: string, toolName?: string}} context
   */
  async runNotification(context = {}) {
    return this._runEvent(
      HookType.NOTIFICATION,
      context.toolName || '',
      this._payload(HookType.NOTIFICATION, { message: context.message || '', tool_name: context.toolName }),
      { toolName: context.toolName },
    );
  }

  /**
   * Run Stop hooks
   * @param {object} context - Stop context (reason, stats, etc.)
   * @returns {Promise<{results: Array, blocked: boolean, reason: string}>}
   */
  async runStop(context = {}) {
    return this._runEvent(
      HookType.STOP,
      '',
      this._payload(HookType.STOP, { stop_hook_active: false, reason: context.reason, error: context.error }),
      context,
    );
  }

  /**
   * Run SubagentStop hooks (matcher tested against the specialization).
   * @param {object} context - { taskId, specialization, success, error }
   */
  async runSubagentStop(context = {}) {
    return this._runEvent(
      HookType.SUBAGENT_STOP,
      context.specialization || '',
      this._payload(HookType.SUBAGENT_STOP, {
        stop_hook_active: false,
        task_id: context.taskId,
        specialization: context.specialization,
        success: context.success,
        error: context.error,
      }),
      {},
    );
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
      exitCode: result.exitCode,
      duration: result.duration,
      timestamp: new Date().toISOString(),
    });

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
    const configuredHooks = {};
    for (const event of ALL_EVENTS) {
      configuredHooks[event] = this.hooks[event].length
        + this.settingsHooks[event].reduce((sum, g) => sum + g.hooks.length, 0);
    }

    return {
      totalExecutions: total,
      successful,
      failed,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) + '%' : 'N/A',
      configuredHooks,
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
          source: 'hooks.json',
        });
      }
    }
    for (const [type, groups] of Object.entries(this.settingsHooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          list.push({
            type,
            matcher: group.matcher || '*',
            command: hook.command,
            blocking: false,
            timeout: Number(hook.timeout) > 0 ? Number(hook.timeout) * 1000 : HOOK_TIMEOUT_MS,
            source: group.source,
          });
        }
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

export { HookType, ALL_EVENTS as HOOK_EVENTS };
export default HookManager;
