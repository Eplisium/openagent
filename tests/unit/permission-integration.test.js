/**
 * Integration tests: PermissionEngine + HookManager wired into ToolRegistry,
 * SubagentManager and AgentSession.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';
import { ToolErrorType } from '../../src/errors.js';
import { HookManager } from '../../src/hooks/HookManager.js';
import { PermissionEngine } from '../../src/permissions/PermissionEngine.js';
import { SubagentManager } from '../../src/agent/SubagentManager.js';
import { AgentSession } from '../../src/agent/AgentSession.js';

/** Cross-shell hook command: `node -e "<js>"` works under cmd.exe and /bin/sh. */
const nodeHook = (js) => `node -e "${js}"`;

function makeRegistry({ engine = null, hooks = null } = {}) {
  const runs = [];
  const registry = new ToolRegistry({ permissions: { allowFileWrite: true, allowShell: true } });
  registry.register({
    name: 'write_note',
    description: 'test write tool',
    category: 'file',
    permission: 'write',
    core: true,
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async execute(args) {
      runs.push(args);
      return { success: true, written: args.text };
    },
  });
  if (engine) registry.setPermissionEngine(engine);
  if (hooks) registry.setHookManager(hooks);
  return { registry, runs };
}

function makeEngine(options = {}) {
  return new PermissionEngine({ loadSettings: false, projectSettingsPath: null, userSettingsPath: null, ...options });
}

describe('ToolRegistry + PermissionEngine', () => {
  it('blocks denied calls before the tool runs', async () => {
    const { registry, runs } = makeRegistry({ engine: makeEngine({ mode: 'read-only' }) });
    const result = await registry.execute('write_note', { text: 'hi' });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ToolErrorType.PERMISSION_DENIED);
    expect(result.permission.mode).toBe('read-only');
    expect(runs).toHaveLength(0);
  });

  it('runs the tool once the user approves', async () => {
    const engine = makeEngine({ mode: 'ask', onApprovalRequest: async () => 'allow' });
    const { registry, runs } = makeRegistry({ engine });
    const result = await registry.execute('write_note', { text: 'hi' });
    expect(result.success).toBe(true);
    expect(runs).toHaveLength(1);
  });
});

describe('ToolRegistry + HookManager', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openagent-hookint-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const hookManager = (settingsHooks) => new HookManager({
    workingDir: tmp,
    openAgentDir: path.join(tmp, '.openagent'),
    projectSettingsPath: null,
    userSettingsPath: null,
    settingsHooks,
    verbose: false,
  });

  it('PreToolUse exit code 2 blocks the call with stderr as the reason', async () => {
    const hooks = hookManager({
      PreToolUse: [{ matcher: 'write_note', hooks: [{ type: 'command', command: nodeHook("console.error('no notes today');process.exit(2)") }] }],
    });
    const { registry, runs } = makeRegistry({ hooks });
    const result = await registry.execute('write_note', { text: 'hi' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no notes today/);
    expect(runs).toHaveLength(0);
  });

  it('PreToolUse updatedInput rewrites the arguments', async () => {
    const hooks = hookManager({
      PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: nodeHook("console.log(JSON.stringify({hookSpecificOutput:{updatedInput:{text:'rewritten'}}}))") }] }],
    });
    const { registry, runs } = makeRegistry({ hooks });
    const result = await registry.execute('write_note', { text: 'original' });
    expect(result.success).toBe(true);
    expect(runs[0].text).toBe('rewritten');
  });

  it('PreToolUse allow skips the approval prompt but never overrides a deny', async () => {
    const allowHook = { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: nodeHook("console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'allow'}}))") }] }] };
    let prompts = 0;
    const askEngine = makeEngine({ mode: 'ask', onApprovalRequest: async () => { prompts++; return 'deny'; } });
    const approved = makeRegistry({ engine: askEngine, hooks: hookManager(allowHook) });
    expect((await approved.registry.execute('write_note', { text: 'x' })).success).toBe(true);
    expect(prompts).toBe(0);

    const denyEngine = makeEngine({ mode: 'ask', deny: ['write_note'] });
    const denied = makeRegistry({ engine: denyEngine, hooks: hookManager(allowHook) });
    expect((await denied.registry.execute('write_note', { text: 'x' })).success).toBe(false);
    expect(denied.runs).toHaveLength(0);
  });

  it('PostToolUse additionalContext is returned as hook_feedback', async () => {
    const hooks = hookManager({
      PostToolUse: [{ matcher: 'write_note', hooks: [{ type: 'command', command: nodeHook("console.log(JSON.stringify({additionalContext:'lint: 0 problems'}))") }] }],
    });
    const { registry } = makeRegistry({ hooks });
    const result = await registry.execute('write_note', { text: 'hi' });
    expect(result.success).toBe(true);
    expect(result.hook_feedback).toBe('lint: 0 problems');
  });

  it('does not attach hook_feedback when no hooks are configured', async () => {
    const { registry } = makeRegistry({ hooks: hookManager({}) });
    const result = await registry.execute('write_note', { text: 'hi' });
    expect(result.hook_feedback).toBeUndefined();
  });
});

describe('SubagentManager permission propagation', () => {
  it('gates shared and restricted subagent registries with the parent engine', () => {
    const mgr = new SubagentManager({ verbose: false });
    try {
      const engine = makeEngine({ mode: 'plan' });
      const hooks = new HookManager({ projectSettingsPath: null, userSettingsPath: null, verbose: false });
      mgr.setPermissionEngine(engine);
      mgr.setHookManager(hooks);
      expect(mgr.sharedTools.permissionEngine).toBe(engine);
      expect(mgr.sharedTools.hookManager).toBe(hooks);
      const restricted = mgr.getToolsForSpec({ tools: ['Read'] });
      expect(restricted).not.toBe(mgr.sharedTools);
      expect(restricted.permissionEngine).toBe(engine);
      expect(restricted.hookManager).toBe(hooks);
    } finally {
      mgr.cleanup();
    }
  });
});

describe('AgentSession default permission mode', () => {
  // Exercised on a stub so the test doesn't construct a full session (MCP, SQLite, ...)
  const stub = (overrides = {}) => {
    const engine = makeEngine({ mode: 'auto' });
    return {
      permissionEngine: engine,
      allowFullAccess: false,
      onApprovalRequest: null,
      _permissionModeExplicit: false,
      _defaultPermissionMode: AgentSession.prototype._defaultPermissionMode,
      ...overrides,
    };
  };

  it('keeps programmatic sessions without an approval handler on auto', () => {
    expect(AgentSession.prototype._defaultPermissionMode.call(stub())).toBe('auto');
  });

  it('uses ask when an approval handler exists, settings defaultMode first', () => {
    expect(AgentSession.prototype._defaultPermissionMode.call(stub({ onApprovalRequest: () => 'allow' }))).toBe('ask');
    const s = stub({ onApprovalRequest: () => 'allow' });
    s.permissionEngine.settingsRules.defaultMode = 'acceptEdits';
    expect(AgentSession.prototype._defaultPermissionMode.call(s)).toBe('accept-edits');
  });

  it('re-derives the mode when a resumed session gets its approval handler', () => {
    const s = stub();
    AgentSession.prototype.setOnApprovalRequest.call(s, async () => 'allow');
    expect(s.permissionEngine.getMode()).toBe('ask');
    expect(s.permissionEngine.onApprovalRequest).toBeTypeOf('function');
  });

  it('does not override an explicitly chosen mode', () => {
    const s = stub({ _permissionModeExplicit: true });
    s.permissionEngine.setMode('plan');
    AgentSession.prototype.setOnApprovalRequest.call(s, async () => 'allow');
    expect(s.permissionEngine.getMode()).toBe('plan');
  });
});
