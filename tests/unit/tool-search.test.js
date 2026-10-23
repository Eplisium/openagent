/**
 * Unit tests for the cache-stable session tool set and the tool_search meta-tool.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';

const mk = (name, category, description = `${name} tool`) => ({
  name,
  category,
  description,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ success: true, name }),
});

/** Registry with 6 core tools and many deferred tools (> threshold total). */
function bigRegistry() {
  const r = new ToolRegistry();
  r.register(mk('write_file', 'file'));
  r.register(mk('read_file', 'file'));
  r.register(mk('exec', 'shell'));
  r.register(mk('git_status', 'git'));
  r.register(mk('web_search', 'network'));
  r.register(mk('fetch_url', 'web'));
  r.register(mk('browser_screenshot', 'browser', 'Capture a screenshot of the current browser page'));
  r.register(mk('browser_navigate', 'browser', 'Navigate the browser to a URL'));
  r.register(mk('memory_store', 'memory', 'Persist a fact to long-term memory'));
  r.register(mk('spawn_subagent', 'subagent', 'Delegate a task to a subagent'));
  for (let i = 0; i < 40; i++) {
    r.register(mk(`graph_op_${String(i).padStart(2, '0')}`, 'graph', 'Knowledge graph operation'));
  }
  return r;
}

const names = (defs) => defs.map(d => d.name);

describe('ToolRegistry session tool set', () => {
  let registry;
  beforeEach(() => {
    registry = bigRegistry();
  });

  it('sends all tools sorted when the registry is small', () => {
    const r = new ToolRegistry();
    r.register(mk('zeta', 'custom'));
    r.register(mk('alpha', 'file'));
    r.register(mk('mid', 'browser'));
    const defs = r.getSessionToolDefinitions();
    expect(names(defs)).toEqual(['alpha', 'mid', 'zeta']);
    expect(r.get('tool_search')).toBeUndefined();
  });

  it('sends core tools sorted + tool_search when large', () => {
    const defs = registry.getSessionToolDefinitions();
    expect(names(defs)).toEqual([
      'exec', 'fetch_url', 'git_status', 'read_file', 'web_search', 'write_file', 'tool_search',
    ]);
    const search = defs.find(d => d.name === 'tool_search');
    expect(search.description).toContain('browser: browser_navigate, browser_screenshot');
    expect(search.parameters.properties.query).toBeDefined();
  });

  it('returns an identical (cache-stable) list across calls with no activation', () => {
    const a = JSON.stringify(registry.getSessionToolDefinitions());
    const b = JSON.stringify(registry.getSessionToolDefinitions());
    expect(a).toBe(b);
  });

  it('searchTools ranks keyword matches over deferred tools only', () => {
    const results = registry.searchTools('screenshot');
    expect(results[0].name).toBe('browser_screenshot');
    expect(results.some(r => r.name === 'read_file')).toBe(false);
    const byCategory = registry.searchTools('', { category: 'browser' });
    expect(byCategory.map(r => r.name)).toEqual(['browser_navigate', 'browser_screenshot']);
  });

  it('tool_search activates matches and appends them after the stable prefix', async () => {
    const before = names(registry.getSessionToolDefinitions());
    const result = await registry.execute('tool_search', { query: 'browser' });
    expect(result.success).toBe(true);
    expect(result.activated).toEqual(['browser_navigate', 'browser_screenshot']);

    const after = names(registry.getSessionToolDefinitions());
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(['browser_navigate', 'browser_screenshot']);
  });

  it('activated set only grows, in activation order (prefix stays stable)', async () => {
    await registry.execute('tool_search', { query: 'memory' });
    const first = names(registry.getSessionToolDefinitions());
    await registry.execute('tool_search', { names: ['spawn_subagent', 'browser_navigate'] });
    const second = names(registry.getSessionToolDefinitions());
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.slice(first.length)).toEqual(['browser_navigate', 'spawn_subagent']);

    // Re-activating is a no-op
    const again = await registry.execute('tool_search', { query: 'memory' });
    expect(again.activated).toEqual([]);
    expect(names(registry.getSessionToolDefinitions())).toEqual(second);
  });

  it('does not activate core tools and reports unknown names', async () => {
    const result = await registry.execute('tool_search', { names: ['read_file', 'nope'] });
    expect(result.activated).toEqual([]);
    expect(result.unknown).toEqual(['nope']);
    expect(registry.activatedTools).toEqual([]);
  });

  it('requires a query, category, or names', async () => {
    registry.getSessionToolDefinitions();
    const result = await registry.execute('tool_search', {});
    expect(result.success).toBe(false);
  });

  it('directly executing a deferred tool activates it', async () => {
    const result = await registry.execute('memory_store', {});
    expect(result.success).toBe(true);
    expect(registry.isToolActivated('memory_store')).toBe(true);
    expect(names(registry.getSessionToolDefinitions())).toContain('memory_store');
  });

  it('resetActivatedTools clears session activation', async () => {
    await registry.execute('tool_search', { query: 'browser' });
    registry.resetActivatedTools();
    expect(names(registry.getSessionToolDefinitions())).not.toContain('browser_navigate');
  });
});
