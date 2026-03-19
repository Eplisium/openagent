/**
 * Unit tests for ToolRegistry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';

describe('ToolRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool successfully', () => {
      const tool = {
        name: 'test_tool',
        description: 'A test tool',
        execute: async () => ({ success: true }),
      };

      registry.register(tool);
      expect(registry.get('test_tool')).toBeDefined();
      expect(registry.get('test_tool').name).toBe('test_tool');
    });

    it('should throw if tool has no name', () => {
      expect(() => {
        registry.register({ execute: async () => {} });
      }).toThrow('Tool must have a name');
    });

    it('should throw if tool has no execute function', () => {
      expect(() => {
        registry.register({ name: 'bad_tool' });
      }).toThrow("Tool 'bad_tool' must have an execute function");
    });

    it('should register multiple tools at once', () => {
      const tools = [
        { name: 'tool1', execute: async () => {} },
        { name: 'tool2', execute: async () => {} },
      ];
      registry.registerAll(tools);
      expect(registry.get('tool1')).toBeDefined();
      expect(registry.get('tool2')).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute a tool successfully', async () => {
      registry.register({
        name: 'add',
        description: 'Add two numbers',
        parameters: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
        },
        execute: async ({ a, b }) => ({ success: true, result: a + b }),
      });

      const result = await registry.execute('add', { a: 2, b: 3 });
      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
    });

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for disabled tool', async () => {
      registry.register({
        name: 'disabled_tool',
        execute: async () => ({ success: true }),
        enabled: false,
      });

      const result = await registry.execute('disabled_tool');
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should validate required parameters', async () => {
      registry.register({
        name: 'strict_tool',
        execute: async () => ({ success: true }),
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      });

      const result = await registry.execute('strict_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameter');
    });

    it('should track execution stats', async () => {
      registry.register({
        name: 'counter',
        execute: async () => ({ success: true }),
      });

      await registry.execute('counter');
      await registry.execute('counter');

      const stats = registry.getStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successful).toBe(2);
    });
  });

  describe('getFunctionDefinitions', () => {
    it('should return OpenAI-compatible tool definitions', () => {
      registry.register({
        name: 'my_tool',
        description: 'Does something',
        parameters: {
          type: 'object',
          properties: { input: { type: 'string' } },
        },
        execute: async () => {},
      });

      const defs = registry.getFunctionDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].type).toBe('function');
      expect(defs[0].function.name).toBe('my_tool');
    });

    it('should exclude disabled tools', () => {
      registry.register({ name: 'active', execute: async () => {} });
      registry.register({ name: 'disabled', execute: async () => {}, enabled: false });

      const defs = registry.getFunctionDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].function.name).toBe('active');
    });
  });

  describe('permissions', () => {
    it('should block shell tools when allowShell is false', async () => {
      registry.setPermissions({ allowShell: false });
      registry.register({
        name: 'run_cmd',
        category: 'shell',
        execute: async () => ({ success: true }),
      });

      const result = await registry.execute('run_cmd');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Shell execution is disabled');
    });

    it('should block network tools when allowNetwork is false', async () => {
      registry.setPermissions({ allowNetwork: false });
      registry.register({
        name: 'fetch_url',
        category: 'network',
        execute: async () => ({ success: true }),
      });

      const result = await registry.execute('fetch_url');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network access is disabled');
    });
  });

  describe('list', () => {
    it('should list all tools', () => {
      registry.register({ name: 'tool_a', description: 'First tool', execute: async () => ({ success: true }) });
      registry.register({ name: 'tool_b', description: 'Second tool', execute: async () => ({ success: true }) });

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map(t => t.name)).toContain('tool_a');
      expect(list.map(t => t.name)).toContain('tool_b');
    });
  });
});
