/**
 * Unit tests for OpenRouter prompt caching (Anthropic cache_control breakpoints)
 * and cached-token usage parsing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { OpenRouterClient } from '../../src/OpenRouterClient.js';

function countBreakpoints(messages) {
  let n = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) if (p && p.cache_control) n++;
    }
  }
  return n;
}

const history = () => ([
  { role: 'system', content: 'You are a helpful agent.' },
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'second question' },
  { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 't1', content: 'file contents' },
  { role: 'user', content: 'third question' },
]);

describe('OpenRouterClient prompt caching', () => {
  let client;
  afterEach(() => {
    client?.destroy();
    client = null;
  });

  it('detects Anthropic models only', () => {
    expect(OpenRouterClient.supportsCacheControl('anthropic/claude-sonnet-4.5')).toBe(true);
    expect(OpenRouterClient.supportsCacheControl('openai/gpt-5')).toBe(false);
    expect(OpenRouterClient.supportsCacheControl('google/gemini-2.5-pro')).toBe(false);
    expect(OpenRouterClient.supportsCacheControl('deepseek/deepseek-chat')).toBe(false);
    expect(OpenRouterClient.supportsCacheControl(undefined)).toBe(false);
  });

  it('adds cache_control to system + last two messages for anthropic models', () => {
    client = new OpenRouterClient({ apiKey: 'test', promptCaching: true });
    const input = history();
    const payload = client.buildPayload(input, { model: 'anthropic/claude-sonnet-4.5' });
    const msgs = payload.messages;

    expect(Array.isArray(msgs[0].content)).toBe(true);
    expect(msgs[0].content).toEqual([
      { type: 'text', text: 'You are a helpful agent.', cache_control: { type: 'ephemeral' } },
    ]);
    // last message (user) and the tool result before it
    expect(msgs[6].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(msgs[5].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(msgs[5].tool_call_id).toBe('t1');
    // earlier messages untouched
    expect(msgs[1].content).toBe('first question');
    expect(countBreakpoints(msgs)).toBe(3);
  });

  it('does not mutate the caller messages', () => {
    client = new OpenRouterClient({ apiKey: 'test', promptCaching: true });
    const input = history();
    const snapshot = JSON.stringify(input);
    client.buildPayload(input, { model: 'anthropic/claude-opus-4' });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('leaves non-anthropic payloads untouched (automatic provider caching)', () => {
    client = new OpenRouterClient({ apiKey: 'test', promptCaching: true });
    const input = history();
    const payload = client.buildPayload(input, { model: 'openai/gpt-5' });
    expect(payload.messages).toBe(input);
    expect(countBreakpoints(payload.messages)).toBe(0);
  });

  it('respects the disabled flag', () => {
    client = new OpenRouterClient({ apiKey: 'test', promptCaching: false });
    const payload = client.buildPayload(history(), { model: 'anthropic/claude-sonnet-4.5' });
    expect(countBreakpoints(payload.messages)).toBe(0);
    expect(typeof payload.messages[0].content).toBe('string');
  });

  it('marks the last text part of array content and skips empty/null content', () => {
    const msgs = OpenRouterClient.applyCacheControl([
      { role: 'system', content: [{ type: 'text', text: 'part A' }, { type: 'text', text: 'part B' }] },
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:x' } }] },
      { role: 'assistant', content: null, tool_calls: [] },
    ]);
    expect(msgs[0].content[0].cache_control).toBeUndefined();
    expect(msgs[0].content[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(msgs[1].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(msgs[1].content[1].cache_control).toBeUndefined();
    expect(msgs[2].content).toBeNull();
  });

  it('never exceeds 4 breakpoints counting pre-existing markers', () => {
    const marked = (text) => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
    const msgs = OpenRouterClient.applyCacheControl([
      { role: 'system', content: 'sys' },
      { role: 'user', content: marked('a') },
      { role: 'assistant', content: marked('b') },
      { role: 'user', content: marked('c') },
      { role: 'assistant', content: 'd' },
      { role: 'user', content: 'e' },
    ]);
    expect(countBreakpoints(msgs)).toBe(4);
    expect(msgs[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(msgs[5].content).toBe('e');
  });

  it('is idempotent', () => {
    const once = OpenRouterClient.applyCacheControl(history());
    const twice = OpenRouterClient.applyCacheControl(once);
    expect(countBreakpoints(twice)).toBe(3);
    expect(twice).toEqual(once);
  });

  it('normalizes bare strings inside content arrays to text parts', () => {
    client = new OpenRouterClient({ apiKey: 'test' });
    const out = client.normalizeMessages([{ role: 'user', content: ['hi', { type: 'text', text: 'there' }] }]);
    expect(out[0].content).toEqual([{ type: 'text', text: 'hi' }, { type: 'text', text: 'there' }]);
  });

  it('parses cached tokens from OpenAI-style and Anthropic-style usage', () => {
    expect(OpenRouterClient.getCachedTokens({ prompt_tokens_details: { cached_tokens: 1200 } })).toBe(1200);
    expect(OpenRouterClient.getCachedTokens({ cache_read_input_tokens: 800 })).toBe(800);
    expect(OpenRouterClient.getCachedTokens({ prompt_tokens: 10 })).toBe(0);
    expect(OpenRouterClient.getCachedTokens(null)).toBe(0);
    expect(OpenRouterClient.getCacheWriteTokens({ cache_creation_input_tokens: 500 })).toBe(500);
    expect(OpenRouterClient.getCacheWriteTokens({ prompt_tokens_details: { cache_write_tokens: 42 } })).toBe(42);
  });

  it('tracks cached tokens in client stats', () => {
    client = new OpenRouterClient({ apiKey: 'test' });
    client.trackRequest('r1', { model: 'anthropic/claude-sonnet-4.5' }, {
      usage: { prompt_tokens: 1000, completion_tokens: 10, cache_read_input_tokens: 600, cache_creation_input_tokens: 300, cost: 0.01 },
    }, 100);
    client.trackRequest('r2', { model: 'openai/gpt-5' }, {
      usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 400 }, cost: 0.01 },
    }, 100);
    const stats = client.getStats();
    expect(stats.totalCachedTokens).toBe(1000);
    expect(stats.totalCacheWriteTokens).toBe(300);
    expect(stats.cacheHitRate).toBe(50);
    expect(stats.promptCachingEnabled).toBe(true);
    expect(stats.recentRequests[0].cachedTokens).toBe(600);
  });
});
