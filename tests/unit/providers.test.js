/* global ReadableStream */
/**
 * Multi-provider support: routing, Anthropic payload/response/SSE translation,
 * OpenRouterClient wiring (ollama no-key, anthropic direct), status + model listing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveModel,
  loadProviders,
  isConfigured,
  routingPrefixFor,
  resetProviderCache,
  normalizeCustomProvider,
} from '../../src/providers/registry.js';
import {
  toAnthropicRequest,
  fromAnthropicResponse,
  AnthropicStreamTranslator,
  toOpenAIUsage,
} from '../../src/providers/anthropicAdapter.js';
import { fetchProviderModels, clearModelsCache, buildProviderHeaders } from '../../src/providers/models.js';
import { listProviders } from '../../src/providers/status.js';
import { OpenRouterClient } from '../../src/OpenRouterClient.js';

const PROVIDER_ENV = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY',
  'XAI_API_KEY', 'MISTRAL_API_KEY', 'TOGETHER_API_KEY', 'OPENAGENT_PROVIDER_ANTHROPIC',
  'OPENAGENT_PROVIDER_OPENAI', 'OPENAGENT_DEFAULT_PROVIDER', 'OPENAGENT_OLLAMA_BASE_URL',
];

let tmpHome;
let tmpCwd;
const savedEnv = {};

function isolate() {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-prov-home-'));
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-prov-cwd-'));
  for (const k of [...PROVIDER_ENV, 'OPENAGENT_HOME']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OPENAGENT_HOME = tmpHome;
  vi.spyOn(process, 'cwd').mockReturnValue(tmpCwd);
  resetProviderCache();
  clearModelsCache();
}

function restore() {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetProviderCache();
  clearModelsCache();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
}

const enc = new TextEncoder();
function sseResponse(events) {
  const parts = events.map((e) => (typeof e === 'string' ? e : `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  const body = new ReadableStream({
    pull(c) {
      if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
      else c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
}

// Typical Anthropic stream with text + a tool call split into JSON fragments
const anthropicToolStream = () => [
  { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'ping' },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'check.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_A', name: 'read_file', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pa' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'th":"a.js"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_B', name: 'list_dir', input: {} } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
  { type: 'message_stop' },
];

describe('provider routing', () => {
  beforeEach(isolate);
  afterEach(restore);

  it('treats un-prefixed and OpenRouter vendor ids as OpenRouter models', () => {
    for (const id of ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'deepseek/deepseek-chat', 'google/gemini-2.5-pro', 'meta-llama/llama-3-70b', 'gpt-4o']) {
      const r = resolveModel(id);
      expect(r.provider.id).toBe('openrouter');
      expect(r.model).toBe(id);
    }
  });

  it('keeps anthropic/ on OpenRouter even when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(resolveModel('anthropic/claude-sonnet-4.5').provider.id).toBe('openrouter');
  });

  it('routes <id>-direct/ to the native provider and strips the prefix', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const r = resolveModel('anthropic-direct/claude-sonnet-4-5');
    expect(r.provider.id).toBe('anthropic');
    expect(r.provider.kind).toBe('anthropic');
    expect(r.model).toBe('claude-sonnet-4-5');
    expect(r.explicit).toBe(true);
  });

  it('OPENAGENT_PROVIDER_<ID>=direct opts plain prefixes into direct routing', () => {
    process.env.OPENAI_API_KEY = 'sk-oa';
    process.env.OPENAGENT_PROVIDER_OPENAI = 'direct';
    const r = resolveModel('openai/gpt-4o');
    expect(r.provider.id).toBe('openai');
    expect(r.model).toBe('gpt-4o');
  });

  it('routes non-colliding prefixes only when the provider is configured', () => {
    expect(resolveModel('groq/llama-3.3-70b').provider.id).toBe('openrouter');
    process.env.GROQ_API_KEY = 'gsk';
    const r = resolveModel('groq/llama-3.3-70b');
    expect(r.provider.id).toBe('groq');
    expect(r.model).toBe('llama-3.3-70b');
  });

  it('routes local providers without any API key and keeps nested model ids', () => {
    const r = resolveModel('ollama/llama3.2:3b');
    expect(r.provider.id).toBe('ollama');
    expect(r.model).toBe('llama3.2:3b');
    expect(isConfigured(r.provider)).toBe(true);
    const lm = resolveModel('lmstudio/qwen/qwen3-8b');
    expect(lm.provider.id).toBe('lmstudio');
    expect(lm.model).toBe('qwen/qwen3-8b');
  });

  it('honours OPENAGENT_DEFAULT_PROVIDER for unprefixed ids', () => {
    process.env.OPENAGENT_DEFAULT_PROVIDER = 'ollama';
    const r = resolveModel('llama3.2');
    expect(r.provider.id).toBe('ollama');
    expect(r.model).toBe('llama3.2');
  });

  it('reports the routing prefix per provider', () => {
    const map = loadProviders();
    expect(routingPrefixFor(map.get('openrouter'))).toBe('');
    expect(routingPrefixFor(map.get('anthropic'))).toBe('anthropic-direct/');
    expect(routingPrefixFor(map.get('ollama'))).toBe('ollama/');
  });

  it('loads custom providers from user and project providers.json (project wins)', () => {
    fs.writeFileSync(path.join(tmpHome, 'providers.json'), JSON.stringify([
      { id: 'vllm', baseURL: 'http://gpu-box:8000/v1/', apiKeyEnv: 'VLLM_KEY' },
      { id: 'shared', baseURL: 'https://user.example/v1' },
    ]));
    fs.mkdirSync(path.join(tmpCwd, '.openagent'));
    fs.writeFileSync(path.join(tmpCwd, '.openagent', 'providers.json'), JSON.stringify({
      providers: [
        { id: 'shared', baseURL: 'https://project.example/v1', kind: 'anthropic', apiKeyEnv: 'SHARED_KEY' },
        { id: 'openrouter', baseURL: 'https://evil.example' },
        { id: 'bad id!', baseURL: 'x' },
      ],
    }));
    const map = loadProviders();
    expect(map.get('vllm').baseURL).toBe('http://gpu-box:8000/v1');
    expect(map.get('vllm').kind).toBe('openai-compatible');
    expect(map.get('shared').baseURL).toBe('https://project.example/v1');
    expect(map.get('shared').kind).toBe('anthropic');
    expect(map.get('shared').headers['anthropic-version']).toBeTruthy();
    expect(map.get('openrouter').baseURL).toBe('https://openrouter.ai/api/v1');
    expect(map.has('bad id!')).toBe(false);

    expect(resolveModel('vllm/mixtral').provider.id).toBe('openrouter'); // key missing
    process.env.VLLM_KEY = 'k';
    try {
      expect(resolveModel('vllm/mixtral').provider.id).toBe('vllm');
    } finally {
      delete process.env.VLLM_KEY;
    }
  });

  it('ignores malformed providers.json', () => {
    fs.writeFileSync(path.join(tmpHome, 'providers.json'), '{ not json');
    expect(() => loadProviders()).not.toThrow();
    expect(loadProviders().has('openrouter')).toBe(true);
  });

  it('rejects invalid custom provider entries', () => {
    expect(normalizeCustomProvider({ id: 'x' })).toBeNull();
    expect(normalizeCustomProvider({ id: 'x-direct', baseURL: 'http://a' })).toBeNull();
    expect(normalizeCustomProvider({ id: 'loc', baseURL: 'http://127.0.0.1:8080/v1' }).local).toBe(true);
  });
});

describe('anthropic payload translation', () => {
  it('extracts system, maps tool calls/results, tools, tool_choice and preserves cache_control', () => {
    const cc = { type: 'ephemeral' };
    const body = toAnthropicRequest({
      model: 'claude-sonnet-4-5',
      stream: true,
      temperature: 0.3,
      top_p: 0.9,
      max_tokens: 1000,
      tool_choice: 'required',
      tools: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'You are helpful.', cache_control: cc }] },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Reading.', tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } },
          { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.js"}' } },
        ] },
        { role: 'tool', tool_call_id: 'call_1', content: 'AAA' },
        { role: 'tool', tool_call_id: 'call_2', content: [{ type: 'text', text: 'BBB', cache_control: cc }] },
        { role: 'user', content: [{ type: 'text', text: 'thanks' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }] },
      ],
    });

    expect(body.system).toEqual([{ type: 'text', text: 'You are helpful.', cache_control: cc }]);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1000);
    expect(body.temperature).toBe(0.3);
    expect(body.top_p).toBeUndefined();
    expect(body.tools).toEqual([{ name: 'read_file', description: 'Read', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }]);
    expect(body.tool_choice).toEqual({ type: 'any' });

    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const [, assistant, user] = body.messages;
    expect(assistant.content[0]).toEqual({ type: 'text', text: 'Reading.' });
    expect(assistant.content[1]).toEqual({ type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.js' } });
    expect(assistant.content[2].input).toEqual({ path: 'b.js' });
    // Both tool results merged into ONE user turn, before the user's text
    expect(user.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'call_1', content: 'AAA' });
    expect(user.content[1]).toEqual({ type: 'tool_result', tool_use_id: 'call_2', content: 'BBB', cache_control: cc });
    expect(user.content[2]).toEqual({ type: 'text', text: 'thanks' });
    expect(user.content[3]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
  });

  it('maps tool_choice variants and defaults max_tokens', () => {
    const tools = [{ type: 'function', function: { name: 't', parameters: {} } }];
    const base = { model: 'm', messages: [{ role: 'user', content: 'x' }], tools };
    expect(toAnthropicRequest({ ...base, tool_choice: 'auto' }).tool_choice).toEqual({ type: 'auto' });
    expect(toAnthropicRequest({ ...base, tool_choice: { type: 'function', function: { name: 't' } } }).tool_choice).toEqual({ type: 'tool', name: 't' });
    expect(toAnthropicRequest({ model: 'm', messages: [{ role: 'user', content: 'x' }] }).max_tokens).toBeGreaterThan(0);
  });

  it('translates non-streaming responses incl. tool_use and cached usage', () => {
    const out = fromAnthropicResponse({
      id: 'msg_9', model: 'claude-x', stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'ok ' },
        { type: 'tool_use', id: 'toolu_1', name: 'exec', input: { cmd: 'ls' } },
      ],
      usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 30 },
    });
    expect(out.choices[0].message.content).toBe('ok ');
    expect(out.choices[0].message.tool_calls).toEqual([{ id: 'toolu_1', type: 'function', function: { name: 'exec', arguments: '{"cmd":"ls"}' } }]);
    expect(out.choices[0].finish_reason).toBe('tool_calls');
    expect(out.usage.prompt_tokens).toBe(150);
    expect(out.usage.completion_tokens).toBe(7);
    expect(OpenRouterClient.getCachedTokens(out.usage)).toBe(100);
    expect(OpenRouterClient.getCacheWriteTokens(out.usage)).toBe(30);
  });

  it('translates SSE events into OpenAI-style deltas with indexed tool call fragments', () => {
    const t = new AnthropicStreamTranslator();
    const chunks = anthropicToolStream().flatMap((e) => t.push(e));
    const deltas = chunks.filter((c) => c.choices).map((c) => c.choices[0].delta);
    expect(deltas.filter((d) => d.content).map((d) => d.content).join('')).toBe('Let me check.');

    const tcDeltas = deltas.filter((d) => d.tool_calls).map((d) => d.tool_calls[0]);
    expect(tcDeltas[0]).toEqual({ index: 0, id: 'toolu_A', type: 'function', function: { name: 'read_file', arguments: '' } });
    expect(tcDeltas[1]).toEqual({ index: 0, function: { arguments: '{"pa' } });
    expect(tcDeltas[2]).toEqual({ index: 0, function: { arguments: 'th":"a.js"}' } });
    expect(tcDeltas[3]).toMatchObject({ index: 1, id: 'toolu_B', function: { name: 'list_dir' } });
    expect(tcDeltas[4]).toEqual({ index: 1, function: { arguments: '{}' } }); // empty input closed as {}

    const final = chunks.find((c) => c.choices?.[0]?.finish_reason);
    expect(final.choices[0].finish_reason).toBe('tool_calls');
    expect(final.usage).toEqual(toOpenAIUsage({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 42 }));
    expect(chunks[chunks.length - 1]).toEqual({ done: true });
  });

  it('maps stream error events to OpenAI-style errors', () => {
    const t = new AnthropicStreamTranslator();
    expect(t.push({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })).toEqual([
      { error: { message: 'Overloaded', code: 529, type: 'overloaded_error' } },
    ]);
  });
});

describe('OpenRouterClient multi-provider wiring', () => {
  let client;
  beforeEach(() => {
    isolate();
    client = new OpenRouterClient({ apiKey: 'or-key', minRequestInterval: 0, cacheEnabled: false, maxRetries: 0 });
  });
  afterEach(() => {
    client.destroy();
    restore();
  });

  it('sends ollama requests to localhost with no Authorization header and native model id', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        id: 'c1', model: 'llama3.2', choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const res = await client.chat([{ role: 'user', content: 'hi' }], { model: 'ollama/llama3.2', provider: { order: ['x'] }, transforms: ['middle-out'] });
    expect(res.content).toBe('hello');
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    const headers = calls[0].init.headers;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-OpenRouter-Title']).toBeUndefined();
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe('llama3.2');
    expect(body.provider).toBeUndefined();
    expect(body.transforms).toBeUndefined();
  });

  it('keeps OpenRouter requests (and their extras) unchanged', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'c', model: 'openai/gpt-5', choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }), { status: 200 });
    });
    await client.chat([{ role: 'user', content: 'hi' }], { model: 'openai/gpt-5', transforms: ['middle-out'] });
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].init.headers.Authorization).toBe('Bearer or-key');
    expect(calls[0].init.headers['X-OpenRouter-Title']).toBeDefined();
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe('openai/gpt-5');
    expect(body.transforms).toEqual(['middle-out']);
  });

  it('streams from Anthropic direct and reassembles tool calls', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return sseResponse(anthropicToolStream());
    });
    const chunks = await collect(client.chatStream(
      [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }],
      { model: 'anthropic-direct/claude-sonnet-4-5', tools: [{ name: 'read_file', description: 'r', parameters: { type: 'object', properties: {} } }] },
    ));

    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].init.headers['x-api-key']).toBe('sk-ant-test');
    expect(calls[0].init.headers['anthropic-version']).toBeTruthy();
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.stream).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' }); // prompt caching kept for direct Anthropic
    expect(body.tools[0]).toMatchObject({ name: 'read_file', input_schema: { type: 'object' } });

    expect(chunks.filter((c) => c.type === 'content').map((c) => c.content).join('')).toBe('Let me check.');
    const toolCalls = chunks.filter((c) => c.type === 'tool_calls').flatMap((c) => c.toolCalls);
    expect(toolCalls).toEqual([
      { id: 'toolu_A', name: 'read_file', arguments: { path: 'a.js' } },
      { id: 'toolu_B', name: 'list_dir', arguments: {} },
    ]);
    const done = chunks.find((c) => c.type === 'done');
    expect(done.finishReason).toBe('tool_calls');
    expect(done.usage.prompt_tokens_details.cached_tokens).toBe(90);
    expect(client.getStats().totalCachedTokens).toBe(90);
  });

  it('non-streaming Anthropic direct returns normalized tool calls', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      id: 'msg_2', model: 'claude-x', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_9', name: 'exec', input: { cmd: 'dir' } }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }), { status: 200 }));
    const res = await client.chat([{ role: 'user', content: 'run' }], { model: 'anthropic-direct/claude-x' });
    expect(res.toolCalls).toEqual([{ id: 'toolu_9', name: 'exec', arguments: { cmd: 'dir' } }]);
    expect(res.finishReason).toBe('tool_calls');
  });

  it('throws a clear auth error for an explicit but unconfigured provider', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('should not be called'); });
    await expect(client.chat([{ role: 'user', content: 'x' }], { model: 'anthropic-direct/claude-x' }))
      .rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('direct OpenAI-compatible streams request usage and drop cache_control', () => {
    process.env.GROQ_API_KEY = 'gsk';
    const payload = client.buildPayload([{ role: 'system', content: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }] }, { role: 'user', content: 'u' }], { model: 'groq/llama-3.3-70b', stream: true });
    const prepared = client.prepareRequest(payload);
    expect(prepared.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(prepared.headers.Authorization).toBe('Bearer gsk');
    expect(prepared.body.stream_options).toEqual({ include_usage: true });
    expect(prepared.body.messages[0].content[0].cache_control).toBeUndefined();
    expect(prepared.body.frequency_penalty).toBeUndefined();
  });

  it('a pinned custom baseURL keeps the legacy single-endpoint behaviour', () => {
    const pinned = new OpenRouterClient({ apiKey: 'k', baseURL: 'http://proxy.local/v1' });
    try {
      const prepared = pinned.prepareRequest({ model: 'ollama/llama3.2', messages: [] });
      expect(prepared.url).toBe('http://proxy.local/v1/chat/completions');
      expect(prepared.body.model).toBe('ollama/llama3.2');
    } finally {
      pinned.destroy();
    }
  });
});

describe('provider status + model listing', () => {
  beforeEach(isolate);
  afterEach(restore);

  it('listProviders reports configured/local state without probing by default', async () => {
    process.env.GROQ_API_KEY = 'gsk';
    const rows = await listProviders();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.ollama).toMatchObject({ configured: true, local: true });
    expect(byId.groq.configured).toBe(true);
    expect(byId.openai.configured).toBe(false);
    expect(byId.openrouter.isDefault).toBe(true);
    expect(byId.ollama.reachable).toBeUndefined();
  });

  it('listProviders probe marks unreachable local servers', async () => {
    const fetchImpl = async (url) => {
      if (url.startsWith('http://localhost:11434')) return new Response('{"data":[]}', { status: 200 });
      throw new Error('ECONNREFUSED');
    };
    const rows = await listProviders({ probe: true, fetchImpl });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.ollama.reachable).toBe(true);
    expect(byId.lmstudio.reachable).toBe(false);
    expect(byId.groq.reachable).toBeUndefined();
  });

  it('fetchProviderModels prefixes ids, caches, and fails silently', async () => {
    const map = loadProviders();
    let hits = 0;
    const fetchImpl = async () => {
      hits++;
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'llama3.2:latest', created: 1 }, { id: 'qwen3:8b' }] }), { status: 200 });
    };
    const models = await fetchProviderModels(map.get('ollama'), { fetchImpl });
    expect(models.map((m) => m.id)).toEqual(['ollama/llama3.2:latest', 'ollama/qwen3:8b']);
    await fetchProviderModels(map.get('ollama'), { fetchImpl });
    expect(hits).toBe(1);

    const failing = await fetchProviderModels(map.get('lmstudio'), { fetchImpl: async () => { throw new Error('down'); } });
    expect(failing).toEqual([]);
  });

  it('anthropic models are listed with the -direct prefix and x-api-key auth', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const map = loadProviders();
    let seen;
    const models = await fetchProviderModels(map.get('anthropic'), {
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', created_at: '2025-09-29T00:00:00Z' }] }), { status: 200 });
      },
    });
    expect(seen.url).toContain('https://api.anthropic.com/v1/models');
    expect(seen.init.headers['x-api-key']).toBe('sk-ant');
    expect(models[0].id).toBe('anthropic-direct/claude-sonnet-4-5');
    expect(models[0].name).toContain('Claude Sonnet 4.5');
  });

  it('buildProviderHeaders omits auth for keyless providers', () => {
    const map = loadProviders();
    expect(buildProviderHeaders(map.get('ollama'), '')).toEqual({});
    expect(buildProviderHeaders(map.get('openai'), 'k').Authorization).toBe('Bearer k');
  });
});
