/**
 * PermissionEngine: decides whether a tool call may run.
 *
 * Modes:
 *   read-only     only read-class tools
 *   plan          read-class tools + exit_plan_mode (approval switches to accept-edits)
 *   ask           read allowed; write/execute/network/destructive prompt
 *   accept-edits  read + write allowed; execute/network/destructive prompt
 *   auto          everything allowed except hard denies (and explicit deny/ask rules)
 *
 * Decision order (first match wins):
 *   1. guard-rules hard deny            → deny (every mode)
 *   2. deny rules                       → deny
 *   3. read-only/plan mode, non-read    → deny
 *   4. ask rules                        → ask
 *   5. allow rules                      → allow
 *   6. guarded (dangerous) operation    → ask (allow in auto)
 *   7. mode default for the tool class
 *
 * Rules come from (merged): constructor allow/deny/ask, AgentSession
 * allowedTools/disallowedTools, project + user .openagent/settings.json.
 */

import { classifyTool } from './classify.js';
import { findMatchingRule, suggestRuleForCall } from './rules.js';
import {
  loadSettings,
  mergePermissionSettings,
  addPermissionRuleToFile,
  resolveSettingsPaths,
} from './settings.js';
import { ToolGuard } from '../tools/ToolGuard.js';

export const PERMISSION_MODES = Object.freeze(['read-only', 'plan', 'ask', 'accept-edits', 'auto']);
export const DEFAULT_PERMISSION_MODE = 'ask';
export const EXIT_PLAN_MODE_TOOL = 'exit_plan_mode';

const MODE_ALIASES = {
  readonly: 'read-only',
  read_only: 'read-only',
  default: 'ask',
  acceptedits: 'accept-edits',
  accept_edits: 'accept-edits',
  'accept-edits': 'accept-edits',
  bypasspermissions: 'auto',
  'full-access': 'auto',
  full: 'auto',
};

/**
 * Normalize a mode string (accepts Claude-Code names like acceptEdits/bypassPermissions).
 * @param {string} mode
 * @returns {string|null} canonical mode or null when unknown
 */
export function normalizePermissionMode(mode) {
  if (typeof mode !== 'string' || !mode.trim()) return null;
  const raw = mode.trim();
  if (PERMISSION_MODES.includes(raw)) return raw;
  const key = raw.toLowerCase();
  if (PERMISSION_MODES.includes(key)) return key;
  return MODE_ALIASES[key] || MODE_ALIASES[key.replace(/[\s-]/g, '')] || null;
}

/** Strip private (underscore-prefixed) keys such as _abortSignal for display/matching. */
export function publicArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args || {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (!key.startsWith('_')) out[key] = value;
  }
  return out;
}

function toList(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : [];
}

function unique(list) {
  return [...new Set(list)];
}

/** Default decision for each (mode, class) pair. */
const MODE_MATRIX = {
  'read-only': { read: 'allow', write: 'deny', execute: 'deny', network: 'deny', destructive: 'deny' },
  plan: { read: 'allow', write: 'deny', execute: 'deny', network: 'deny', destructive: 'deny' },
  ask: { read: 'allow', write: 'ask', execute: 'ask', network: 'ask', destructive: 'ask' },
  'accept-edits': { read: 'allow', write: 'allow', execute: 'ask', network: 'ask', destructive: 'ask' },
  auto: { read: 'allow', write: 'allow', execute: 'allow', network: 'allow', destructive: 'allow' },
};

export class PermissionEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.mode] - initial mode; falls back to settings defaultMode, then 'ask'
   * @param {string[]} [options.allow]
   * @param {string[]} [options.deny]
   * @param {string[]} [options.ask]
   * @param {string[]|string} [options.allowedTools] - AgentSession alias for allow
   * @param {string[]|string} [options.disallowedTools] - AgentSession alias for deny
   * @param {string} [options.workingDir] - base dir for path rules + project settings
   * @param {string|null} [options.projectSettingsPath] - null disables project settings
   * @param {string|null} [options.userSettingsPath] - null disables user settings
   * @param {boolean} [options.loadSettings=true]
   * @param {Function} [options.onApprovalRequest] - async ({toolName,args,reason,rule,permissionClass,mode,suggestedRule,plan}) => 'allow'|'deny'|'always'
   * @param {Function} [options.onNotification] - called with {message, toolName, ...} when approval is requested
   * @param {Function} [options.onModeChange] - (newMode, oldMode) => void
   * @param {ToolGuard} [options.guard]
   */
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.onApprovalRequest = typeof options.onApprovalRequest === 'function' ? options.onApprovalRequest : null;
    this.onNotification = typeof options.onNotification === 'function' ? options.onNotification : null;
    this.onModeChange = typeof options.onModeChange === 'function' ? options.onModeChange : null;
    this.guard = options.guard || new ToolGuard();

    this.settingsPaths = resolveSettingsPaths({
      workingDir: this.workingDir,
      projectSettingsPath: options.projectSettingsPath,
      userSettingsPath: options.userSettingsPath,
      homeDir: options.homeDir,
    });
    this.settingsErrors = [];
    this.settingsRules = { allow: [], deny: [], ask: [], defaultMode: null };
    this.hooksConfig = {};
    if (options.loadSettings !== false) this.reloadSettings();

    this.optionRules = {
      allow: unique([...toList(options.allow), ...toList(options.allowedTools)]),
      deny: unique([...toList(options.deny), ...toList(options.disallowedTools)]),
      ask: unique(toList(options.ask)),
    };
    /** Rules approved with 'always' during this session (also persisted). */
    this.sessionRules = { allow: [] };

    const requested = options.mode !== undefined ? normalizePermissionMode(options.mode) : null;
    if (options.mode !== undefined && !requested) {
      throw new Error(`Unknown permission mode "${options.mode}". Valid modes: ${PERMISSION_MODES.join(', ')}`);
    }
    this.mode = requested
      || normalizePermissionMode(this.settingsRules.defaultMode)
      || DEFAULT_PERMISSION_MODE;

    this.history = [];
    this.maxHistory = 100;
  }

  /** Re-read settings.json files (rules + hooks section). */
  reloadSettings() {
    const loaded = loadSettings({
      projectSettingsPath: this.settingsPaths.project,
      userSettingsPath: this.settingsPaths.user,
    });
    this.settingsErrors = loaded.errors;
    this.settingsRules = mergePermissionSettings(loaded);
    this.loadedSettings = loaded;
    return loaded;
  }

  getMode() {
    return this.mode;
  }

  /**
   * Change the permission mode.
   * @param {string} mode
   * @returns {string} the canonical mode now in effect
   */
  setMode(mode) {
    const next = normalizePermissionMode(mode);
    if (!next) {
      throw new Error(`Unknown permission mode "${mode}". Valid modes: ${PERMISSION_MODES.join(', ')}`);
    }
    const prev = this.mode;
    this.mode = next;
    if (prev !== next && this.onModeChange) {
      try { this.onModeChange(next, prev); } catch { /* listener errors are non-fatal */ }
    }
    return next;
  }

  setApprovalHandler(fn) {
    this.onApprovalRequest = typeof fn === 'function' ? fn : null;
  }

  /** All effective rules, merged by list. */
  getRules() {
    const merge = (key) => unique([
      ...this.optionRules[key],
      ...(this.sessionRules[key] || []),
      ...this.settingsRules[key],
    ]);
    return { allow: merge('allow'), deny: merge('deny'), ask: merge('ask') };
  }

  /** Add a rule for this session only. */
  addRule(list, rule) {
    if (!['allow', 'deny', 'ask'].includes(list) || !rule) return;
    if (!this.optionRules[list].includes(rule)) this.optionRules[list].push(rule);
  }

  /**
   * Pure decision (no prompting).
   * @param {string} toolName
   * @param {object} args
   * @param {object} [tool] - registered tool definition
   * @returns {{decision: 'allow'|'deny'|'ask', reason: string, rule: string|null, permissionClass: string, mode: string, source: string}}
   */
  evaluate(toolName, args = {}, tool = null) {
    const cleanArgs = publicArgs(args);
    const permissionClass = classifyTool(toolName, tool, cleanArgs);
    const mode = this.mode;
    const base = { permissionClass, mode };
    const ctx = { baseDir: this.workingDir };

    // 1. Hard deny (guard-rules) — every mode
    const hard = this.guard.checkHardDeny(toolName, cleanArgs, { permissionClass });
    if (hard.denied) {
      return { ...base, decision: 'deny', reason: hard.reason, rule: 'guard-rules', source: 'guard' };
    }

    // exit_plan_mode is handled by the tool itself (it asks for plan approval)
    if (toolName === EXIT_PLAN_MODE_TOOL) {
      return { ...base, decision: 'allow', reason: 'Plan mode exit tool', rule: null, source: 'builtin' };
    }

    const rules = this.getRules();

    // 2. Deny rules
    const denyRule = findMatchingRule(rules.deny, toolName, cleanArgs, { ...ctx, kind: 'deny' });
    if (denyRule) {
      return { ...base, decision: 'deny', reason: `Denied by rule ${denyRule}`, rule: denyRule, source: 'rule' };
    }

    // 3. Read-only / plan modes never run non-read tools
    if ((mode === 'read-only' || mode === 'plan') && permissionClass !== 'read') {
      const hint = mode === 'plan'
        ? ' Plan mode is active: investigate with read-only tools, then call exit_plan_mode with your plan to request approval.'
        : '';
      return {
        ...base,
        decision: 'deny',
        reason: `${toolName} (${permissionClass}) is not allowed in ${mode} mode.${hint}`,
        rule: null,
        source: 'mode',
      };
    }

    // 4. Ask rules
    const askRule = findMatchingRule(rules.ask, toolName, cleanArgs, { ...ctx, kind: 'ask' });
    if (askRule) {
      return { ...base, decision: 'ask', reason: `Rule ${askRule} requires approval`, rule: askRule, source: 'rule' };
    }

    // 5. Allow rules
    const allowRule = findMatchingRule(rules.allow, toolName, cleanArgs, { ...ctx, kind: 'allow' });
    if (allowRule) {
      return { ...base, decision: 'allow', reason: `Allowed by rule ${allowRule}`, rule: allowRule, source: 'rule' };
    }

    // 6. Guarded dangerous operations
    const guarded = this.guard.checkGuarded(toolName, cleanArgs);
    if (guarded.guarded && mode !== 'auto') {
      return { ...base, decision: 'ask', reason: guarded.reason, rule: 'guard-rules', source: 'guard' };
    }

    // 7. Mode default
    const decision = MODE_MATRIX[mode]?.[permissionClass] || 'ask';
    const reason = decision === 'allow'
      ? `${permissionClass} tools are allowed in ${mode} mode`
      : `${toolName} is a ${permissionClass} operation; ${mode} mode requires approval`;
    return { ...base, decision, reason, rule: null, source: 'mode' };
  }

  /**
   * Ask the approval handler. Returns 'allow' | 'deny' | 'always'.
   * Without a handler the answer is 'deny'.
   * @private
   */
  async _requestApproval(request) {
    if (this.onNotification) {
      try {
        await this.onNotification({
          message: `OpenAgent needs your permission to use ${request.toolName}`,
          toolName: request.toolName,
          reason: request.reason,
        });
      } catch { /* notification failures never block approval */ }
    }
    if (!this.onApprovalRequest) return { answer: 'deny', noHandler: true };
    try {
      const raw = await this.onApprovalRequest(request);
      let answer = typeof raw === 'string' ? raw.toLowerCase().trim() : raw;
      if (answer === true) answer = 'allow';
      if (answer === false || answer == null) answer = 'deny';
      if (answer === 'yes' || answer === 'y' || answer === 'once') answer = 'allow';
      if (answer === 'always-allow' || answer === 'a') answer = 'always';
      if (!['allow', 'deny', 'always'].includes(answer)) answer = 'deny';
      return { answer };
    } catch (err) {
      return { answer: 'deny', error: err?.message || String(err) };
    }
  }

  /**
   * Persist an 'always' approval to the project settings allow list.
   * @returns {Promise<string|null>} the rule added, or null
   */
  async persistAllowRule(rule) {
    if (!rule) return null;
    if (!this.sessionRules.allow.includes(rule)) this.sessionRules.allow.push(rule);
    const target = this.settingsPaths.project;
    if (!target) return rule;
    try {
      await addPermissionRuleToFile(target, 'allow', rule);
      if (!this.settingsRules.allow.includes(rule)) this.settingsRules.allow.push(rule);
    } catch (err) {
      this.settingsErrors.push(err.message);
    }
    return rule;
  }

  /**
   * Full check: evaluate and, when needed, ask the user.
   * @param {string} toolName
   * @param {object} args
   * @param {object} [tool]
   * @returns {Promise<{allowed: boolean, decision: string, reason: string, rule: string|null, permissionClass: string, mode: string, message?: string}>}
   */
  async check(toolName, args = {}, tool = null) {
    const evaluation = this.evaluate(toolName, args, tool);
    let result;

    if (evaluation.decision === 'allow') {
      result = { ...evaluation, allowed: true };
    } else if (evaluation.decision === 'deny') {
      result = {
        ...evaluation,
        allowed: false,
        message: evaluation.source === 'rule'
          ? `Permission denied by rule ${evaluation.rule}: ${toolName} was not run.`
          : `Permission denied: ${evaluation.reason}`,
      };
    } else {
      const cleanArgs = publicArgs(args);
      const suggestedRule = suggestRuleForCall(toolName, cleanArgs);
      const { answer, noHandler, error } = await this._requestApproval({
        toolName,
        args: cleanArgs,
        reason: evaluation.reason,
        rule: evaluation.rule,
        permissionClass: evaluation.permissionClass,
        mode: this.mode,
        suggestedRule,
      });
      if (answer === 'allow' || answer === 'always') {
        if (answer === 'always') await this.persistAllowRule(suggestedRule);
        result = {
          ...evaluation,
          allowed: true,
          decision: 'allow',
          reason: answer === 'always' ? `Approved by user (saved rule ${suggestedRule})` : 'Approved by user',
          source: 'user',
        };
      } else {
        const why = noHandler
          ? `${evaluation.reason}, but no interactive approval is available in this session. Ask the user to allow it (e.g. an allow rule like "${suggestedRule}" or a more permissive mode).`
          : (error ? `approval request failed (${error})` : 'the user declined');
        result = {
          ...evaluation,
          allowed: false,
          decision: 'deny',
          source: noHandler ? 'no-handler' : 'user',
          message: noHandler
            ? `Permission denied: ${why}`
            : `Permission denied by user: ${toolName} was not run (${why}). Do not retry the same call; adjust your approach or ask the user.`,
        };
      }
    }

    this._record(toolName, result);
    return result;
  }

  /**
   * Plan-mode exit: present the plan for approval. Approved → accept-edits.
   * @param {string} plan
   * @returns {Promise<{approved: boolean, mode: string, message: string}>}
   */
  async requestPlanApproval(plan) {
    const text = typeof plan === 'string' ? plan.trim() : '';
    if (!text) {
      return { approved: false, mode: this.mode, message: 'exit_plan_mode requires a non-empty "plan" argument.' };
    }
    if (this.mode !== 'plan') {
      return { approved: true, mode: this.mode, message: `Not in plan mode (current mode: ${this.mode}); proceed with the plan.` };
    }
    const { answer, noHandler, error } = await this._requestApproval({
      toolName: EXIT_PLAN_MODE_TOOL,
      args: { plan: text },
      plan: text,
      reason: 'Approve this plan and switch to accept-edits mode?',
      rule: null,
      permissionClass: 'read',
      mode: this.mode,
      suggestedRule: null,
    });
    if (answer === 'allow' || answer === 'always') {
      this.setMode('accept-edits');
      return {
        approved: true,
        mode: this.mode,
        message: 'Plan approved by the user. Permission mode is now accept-edits: file edits are allowed, shell/network/destructive actions still need approval. Implement the plan now.',
      };
    }
    let message = 'The user did not approve the plan. Stay in plan mode, refine the plan based on any feedback, and call exit_plan_mode again.';
    if (noHandler) message = 'Plan could not be approved: no interactive approval is available. Present the plan to the user as your final answer instead.';
    if (error) message = `Plan approval failed (${error}). Remain in plan mode.`;
    return { approved: false, mode: this.mode, message };
  }

  /** @private */
  _record(toolName, result) {
    this.history.push({
      toolName,
      decision: result.decision,
      allowed: result.allowed,
      reason: result.reason,
      rule: result.rule,
      mode: result.mode,
      timestamp: new Date().toISOString(),
    });
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
  }

  getHistory(limit = 20) {
    return this.history.slice(-limit);
  }
}

/**
 * Build the exit_plan_mode tool bound to an engine.
 * @param {PermissionEngine} engine
 */
export function createExitPlanModeTool(engine) {
  return {
    name: EXIT_PLAN_MODE_TOOL,
    description: 'Use ONLY in plan mode, after investigating with read-only tools. Presents your implementation plan to the user for approval. If approved, the session switches to accept-edits mode and you may start making changes.',
    category: 'meta',
    core: true,
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'The implementation plan (markdown): steps, files to change, verification.' },
      },
      required: ['plan'],
    },
    async execute({ plan } = {}) {
      const result = await engine.requestPlanApproval(plan);
      return { success: result.approved, approved: result.approved, mode: result.mode, message: result.message, ...(result.approved ? {} : { error: result.message }) };
    },
  };
}

export default PermissionEngine;
