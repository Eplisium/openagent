/* global ReadableStream, DOMException */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenRouterClient, StreamError, AbortError } from '../../src/OpenRouterClient.js';
import { CONFIG } from '../../src/config.js';

const enc = new TextEncoder();
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const contentChunk = (text, extra = {}) => sse({ choices: [{ delta: { content: text }, ...extra }] });

function streamResponse(parts, { stall = false, signal, state = {} } = {}) {
  let i = 0;
  let ctrl;
  const body = new ReadableStream({
    start(c) { ctrl = c; },
    pull(c) {
      if (i < parts.length) { c.enqueue(enc.encode(parts[i++])); return undefined; }
      if (stall) return new Promise(() => {});
      c.close();
      return undefined;
    },
    cancel() { state.cancelled = true; },
  });
  signal?.addEventListener('abort', () => {
    try { ctrl.error(new DOMException('aborted', 'AbortError')); } catch { /* already closed */ }
  }, { once: true });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(gen) {
  const chunks = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe('streaming resilience', () => {
  let client;
  const saved = {};

  beforeEach(() => {
    saved.idle = CONFIG.STREAM_IDLE_TIMEOUT_MS;
    saved.connect = CONFIG.STREAM_CONNECT_TIMEOUT_MS;
    client = new OpenRouterClient({ apiKey: 'test', minRequestInterval: 0 });
    client.abortableSleep = async () => {};
  });

  afterEach(() => {
    CONFIG.STREAM_IDLE_TIMEOUT_MS = saved.idle;
    CONFIG.STREAM_CONNECT_TIMEOUT_MS = saved.connect;
    client.destroy();
    vi.unstubAllGlobals();
  });

  it('parses CRLF, data: without a space, and an unterminated trailing line', async () => {
    vi.stubGlobal('fetch', async (_url, init) => streamResponse([
      'data:{"choices":[{"delta":{"content":"Hel"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
    ], { signal: init.signal }));

    const chunks = await collect(client.chatStream([{ role: 'user', content: 'hi' }], { model: 'm' }));
    expect(chunks.filter((c) => c.type === 'content').map((c) => c.content)).toEqual(['Hel', 'lo']);
    const done = chunks.find((c) => c.type === 'done');
    expect(done.content).toBe('Hello');
    expect(done.finishReason).toBe('stop');
    expect(done.interrupted).toBeUndefined();
  });

  it('throws STREAM_STALLED when no bytes arrive within the idle window', async () => {
    CONFIG.STREAM_IDLE_TIMEOUT_MS = 60;
    vi.stubGlobal('fetch', async (_url, init) => streamResponse([': PROCESSING\n\n'], { stall: true, signal: init.signal }));

    const err = await collect(client.chatStream([], { model: 'm', maxStreamRetries: 0 })).catch((e) => e);
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('STREAM_STALLED');
  });

  it('throws STREAM_TIMEOUT when the server never responds', async () => {
    CONFIG.STREAM_CONNECT_TIMEOUT_MS = 50;
    vi.stubGlobal('fetch', (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));

    const err = await collect(client.chatStream([], { model: 'm', maxStreamRetries: 0 })).catch((e) => e);
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('STREAM_TIMEOUT');
  });

  it('keeps partial content as an interrupted done when the stream stalls mid-answer', async () => {
    CONFIG.STREAM_IDLE_TIMEOUT_MS = 60;
    vi.stubGlobal('fetch', async (_url, init) => streamResponse([contentChunk('partial answer')], { stall: true, signal: init.signal }));

    const chunks = await collect(client.chatStream([], { model: 'm' }));
    const done = chunks.find((c) => c.type === 'done');
    expect(done.content).toBe('partial answer');
    expect(done.interrupted).toBe(true);
    expect(done.interruptReason).toBe('STREAM_STALLED');
  });

  it('reports a user abort as AbortError, not a stall', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', async (_url, init) => streamResponse([': hi\n\n'], { stall: true, signal: init.signal }));
    setTimeout(() => ac.abort(), 30);

    const err = await collect(client.chatStream([], { model: 'm', signal: ac.signal })).catch((e) => e);
    expect(err).toBeInstanceOf(AbortError);
  });

  it('retries a stream that closes before any output, then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (_url, init) => {
      calls++;
      return calls === 1
        ? streamResponse([], { signal: init.signal })
        : streamResponse([contentChunk('ok'), 'data: [DONE]\n\n'], { signal: init.signal });
    });

    const chunks = await collect(client.chatStream([], { model: 'm' }));
    const retry = chunks.find((c) => c.type === 'retry');
    expect(retry).toMatchObject({ attempt: 1, reason: 'STREAM_INTERRUPTED' });
    expect(chunks.find((c) => c.type === 'done').content).toBe('ok');
    expect(calls).toBe(2);
  });

  it('retries transient 503 responses before any output', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (_url, init) => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({}), { status: 503 });
      return streamResponse([contentChunk('back'), 'data: [DONE]\n\n'], { signal: init.signal });
    });

    const chunks = await collect(client.chatStream([], { model: 'm' }));
    expect(chunks.find((c) => c.type === 'done').content).toBe('back');
    expect(calls).toBe(2);
  });

  it('never retries once content has been produced', async () => {
    CONFIG.STREAM_IDLE_TIMEOUT_MS = 60;
    let calls = 0;
    const toolStart = sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"a' } }] } }] });
    vi.stubGlobal('fetch', async (_url, init) => {
      calls++;
      return streamResponse([contentChunk('working'), toolStart], { stall: true, signal: init.signal });
    });

    const err = await collect(client.chatStream([], { model: 'm' })).catch((e) => e);
    expect(err).toBeInstanceOf(StreamError);
    expect(calls).toBe(1);
  });

  it('does not retry auth errors', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    });

    const err = await collect(client.chatStream([], { model: 'm' })).catch((e) => e);
    expect(err.code).toBe('AUTH_ERROR');
    expect(calls).toBe(1);
  });

  it('cancels the underlying reader when the consumer stops early', async () => {
    const state = {};
    vi.stubGlobal('fetch', async (_url, init) => streamResponse(
      [contentChunk('one'), contentChunk('two')], { stall: true, signal: init.signal, state },
    ));

    for await (const chunk of client.chatStream([], { model: 'm' })) {
      if (chunk.type === 'content') break;
    }
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(state.cancelled).toBe(true);
    expect(client.activeControllers.size).toBe(0);
  });

  it('emits reasoning and tool_progress chunks', async () => {
    const parts = [
      sse({ choices: [{ delta: { reasoning: 'thinking...' } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt","content":"x"}' } }] } }] }),
      sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', async (_url, init) => streamResponse(parts, { signal: init.signal }));

    const ready = [];
    const chunks = await collect(client.chatStream([], { model: 'm', onToolCallReady: (tc) => ready.push(tc) }));
    expect(chunks.find((c) => c.type === 'reasoning').content).toBe('thinking...');
    expect(chunks.find((c) => c.type === 'tool_progress')).toMatchObject({ name: 'write_file' });
    expect(ready).toHaveLength(1);
    expect(ready[0].arguments).toEqual({ path: 'a.txt', content: 'x' });
  });

  it('emits completed tool calls as a chunk when no dispatcher is provided', async () => {
    const parts = [
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"a"}' } }] } }] }),
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', async (_url, init) => streamResponse(parts, { signal: init.signal }));

    const chunks = await collect(client.chatStream([], { model: 'm' }));
    const calls = chunks.find((c) => c.type === 'tool_calls');
    expect(calls.toolCalls[0]).toMatchObject({ name: 'read_file', arguments: { path: 'a' } });
  });
});
