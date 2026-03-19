/**
 * Unit tests for HookManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HookManager, HookType } from '../../src/hooks/HookManager.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('HookManager', () => {
  let manager;
  let testDir;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `openagent-hooks-test-${Date.now()}`);
    await fs.ensureDir(testDir);
    manager = new HookManager({
      workingDir: testDir,
      openAgentDir: path.join(testDir, '.openagent'),
      verbose: false,
    });
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('load', () => {
    it('should load hooks from config file', async () => {
      await fs.ensureDir(path.join(testDir, '.openagent'));
      await fs.writeJson(path.join(testDir, '.openagent', 'hooks.json'), {
        hooks: {
          PreToolUse: [
            { matcher: 'write_file', command: 'echo pre', blocking: false },
          ],
          PostToolUse: [
            { matcher: 'edit_file', command: 'echo post' },
          ],
        },
      });

      await manager.load();

      const hooks = manager.listHooks();
      expect(hooks).toHaveLength(2);
      expect(hooks[0].type).toBe('PreToolUse');
      expect(hooks[0].matcher).toBe('write_file');
    });

    it('should handle missing config file gracefully', async () => {
      await manager.load();
      const hooks = manager.listHooks();
      expect(hooks).toHaveLength(0);
    });
  });

  describe('matchesTool', () => {
    it('should match all tools when no matcher specified', () => {
      expect(manager.matchesTool({}, 'any_tool')).toBe(true);
    });

    it('should match specific tool names', () => {
      expect(manager.matchesTool({ matcher: 'write_file' }, 'write_file')).toBe(true);
      expect(manager.matchesTool({ matcher: 'write_file' }, 'read_file')).toBe(false);
    });

    it('should support regex patterns', () => {
      expect(manager.matchesTool({ matcher: 'write|edit' }, 'write_file')).toBe(true);
      expect(manager.matchesTool({ matcher: 'write|edit' }, 'edit_file')).toBe(true);
      expect(manager.matchesTool({ matcher: 'write|edit' }, 'read_file')).toBe(false);
    });
  });

  describe('runPreToolUse', () => {
    it('should return proceed=true when no hooks match', async () => {
      await manager.load();
      const result = await manager.runPreToolUse('some_tool');
      expect(result.proceed).toBe(true);
      expect(result.results).toHaveLength(0);
    });

    it('should execute matching hooks', async () => {
      await fs.ensureDir(path.join(testDir, '.openagent'));
      await fs.writeJson(path.join(testDir, '.openagent', 'hooks.json'), {
        hooks: {
          PreToolUse: [
            { matcher: 'write_file', command: 'echo "pre-hook"' },
          ],
        },
      });

      await manager.load();
      const result = await manager.runPreToolUse('write_file', { path: 'test.txt' });
      
      expect(result.proceed).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
    });
  });

  describe('runPostToolUse', () => {
    it('should execute post hooks', async () => {
      await fs.ensureDir(path.join(testDir, '.openagent'));
      await fs.writeJson(path.join(testDir, '.openagent', 'hooks.json'), {
        hooks: {
          PostToolUse: [
            { matcher: 'write_file', command: 'echo "post-hook"' },
          ],
        },
      });

      await manager.load();
      const result = await manager.runPostToolUse('write_file', { path: 'test.txt' }, { success: true });
      
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
    });
  });

  describe('runStop', () => {
    it('should execute stop hooks', async () => {
      await fs.ensureDir(path.join(testDir, '.openagent'));
      await fs.writeJson(path.join(testDir, '.openagent', 'hooks.json'), {
        hooks: {
          Stop: [
            { command: 'echo "stopped"' },
          ],
        },
      });

      await manager.load();
      const result = await manager.runStop({ reason: 'complete' });
      
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
    });
  });

  describe('initHooks', () => {
    it('should create example hooks config', async () => {
      const result = await manager.initHooks();
      expect(result.created).toBe(true);
      expect(await fs.pathExists(path.join(testDir, '.openagent', 'hooks.json'))).toBe(true);
    });

    it('should not overwrite existing config', async () => {
      await fs.ensureDir(path.join(testDir, '.openagent'));
      await fs.writeJson(path.join(testDir, '.openagent', 'hooks.json'), { hooks: {} });

      const result = await manager.initHooks();
      expect(result.exists).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return hook statistics', async () => {
      await manager.load();
      const stats = manager.getStats();
      
      expect(stats.totalExecutions).toBe(0);
      expect(stats.configuredHooks).toBeDefined();
      expect(stats.configuredHooks.PreToolUse).toBe(0);
    });
  });
});
