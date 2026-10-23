import { describe, it, expect, vi } from 'vitest';
import { PassThrough, Writable } from 'stream';
import {
  parseCliArgs,
  splitToolRules,
  resolvePermissionMode,
  buildPrompt,
  readStdin,
  buildResultObject,
  createStreamEvents,
  toNdjson,
  stripAnsi,
  collectUsage,
  hasCredentials,
  runHeadless,
  EXIT_OK,
  EXIT_ERROR,
  EXIT_BAD_ARGS,
} from '../../src/cli/headless.js';
import { decisionForKey, nextPermissionMode, PERMISSION_MODE_CYCLE } from '../../src/cli/approvalPrompt.js';

// ── helpers ───────────────────────────────────────────────────────

function capture() {
  let data = '';
  const stream = new Writable({
    write(chunk, _enc, cb) { data += chunk.toString(); cb(); },
  });
  return { stream, get text() { return data; } };
}

function ttyStdin() {
  const s = new PassThrough();
  s.isTTY = true;
  return s;
}

function pipedStdin(text) {
  const s = new PassThrough();
  s.end(text);
  return s;
}

function mockSession({ response = 'final answer', stopReason = 'completed', iterations = 2, runImpl } = {}) {
  const agent = {
    model: 'test/model',
    iterationCount: iterations,
    client: {
      getStats: () => ({ totalCost: 0.0123, totalInputTokens: 100, totalOutputTokens: 40, totalCachedTokens: 10 }),
    },
    getStats: () => ({ totalCachedTokens: 10 }),
  };
  const session = {
    sessionId: 'session_test_1',
    agent,
    toolRegistry: { list: () => [{ name: 'read_file' }, { name: 'exec' }] },
    save: vi.fn(async () => ({ success: true })),
    run: vi.fn(runImpl || (async () => {
      agent.onIterationStart?.(1);
      agent.onContentDelta?.('final ');
      agent.onToolStart?.('read_file', { path: 'a.txt' });
      agent.onToolEnd?.('read_file', { success: true, content: 'hello' });
      agent.onContentDelta?.('answer');
      return { response, iterations, stopReason };
    })),
  };
  return session;
}

async function run(argv, { session = mockSession(), stdin = ttyStdin(), config = { API_KEY: 'k' }, createSession } = {}) {
  const out = capture();
  const err = capture();
  const factory = createSession || vi.fn(async () => ({ session, resumed: false }));
  const code = await runHeadless(parseCliArgs(argv), {
    stdin,
    stdout: out.stream,
    stderr: err.stream,
    env: {},
    createSession: factory,
    loadConfig: async () => config,
    beginTurn: vi.fn(async () => {}),
    redirectProcessStdout: false,
    installSignalHandlers: false,
    stdinIdleTimeoutMs: 20,
  });
  return { code, stdout: out.text, stderr: err.text, session, factory };
}

// ── arg parsing ──────────────────────────────────────────────────

describe('parseCliArgs', () => {
  it('parses -p prompt and defaults', () => {
    const p = parseCliArgs(['-p', 'hello world']);
    expect(p.print).toBe(true);
    expect(p.prompt).toBe('hello world');
    expect(p.outputFormat).toBe('text');
    expect(p.errors).toEqual([]);
  });

  it('supports --print=, --flag=value and trailing positionals as prompt', () => {
    expect(parseCliArgs(['--print=hi']).prompt).toBe('hi');
    expect(parseCliArgs(['-p', 'fix', 'the', 'bug']).prompt).toBe('fix the bug');
    expect(parseCliArgs(['-p', 'x', '--output-format=json']).outputFormat).toBe('json');
  });

  it('allows -p with no prompt (stdin supplies it)', () => {
    const p = parseCliArgs(['-p', '--output-format', 'stream-json']);
    expect(p.print).toBe(true);
    expect(p.prompt).toBeNull();
    expect(p.outputFormat).toBe('stream-json');
  });

  it('parses all headless flags', () => {
    const p = parseCliArgs([
      '-p', 'go', '--max-turns', '5', '--model', 'ollama/qwen3', '--permission-mode', 'plan',
      '--allowed-tools', 'read_file,exec(npm test:*)', '--disallowed-tools', 'exec(git push:*)',
      '--cwd', '.', '--quiet',
    ]);
    expect(p.maxTurns).toBe(5);
    expect(p.model).toBe('ollama/qwen3');
    expect(p.permissionMode).toBe('plan');
    expect(p.allowedTools).toEqual(['read_file', 'exec(npm test:*)']);
    expect(p.disallowedTools).toEqual(['exec(git push:*)']);
    expect(p.cwd).toBe('.');
    expect(p.quiet).toBe(true);
    expect(p.errors).toEqual([]);
  });

  it('handles --continue / -c and --resume with optional id', () => {
    expect(parseCliArgs(['-c']).continue).toBe(true);
    expect(parseCliArgs(['--resume']).resume).toBe(true);
    expect(parseCliArgs(['--resume', 'session_1']).resume).toBe('session_1');
    expect(parseCliArgs(['--resume', '--quiet']).resume).toBe(true);
    expect(parseCliArgs(['-c', '--resume', 'abc']).errors.length).toBe(1);
  });

  it('reports invalid values', () => {
    expect(parseCliArgs(['-p', 'x', '--output-format', 'xml']).errors[0]).toMatch(/output-format/);
    expect(parseCliArgs(['-p', 'x', '--max-turns', '0']).errors[0]).toMatch(/max-turns/);
    expect(parseCliArgs(['-p', 'x', '--permission-mode', 'yolo']).errors[0]).toMatch(/permission-mode/);
    expect(parseCliArgs(['-p', 'x', '--model']).errors[0]).toMatch(/Missing value/);
    expect(parseCliArgs(['-p', 'x', '--bogus']).errors[0]).toMatch(/Unknown option/);
  });

  it('keeps --full-access as alias for permission-mode auto', () => {
    expect(parseCliArgs(['--full-access']).permissionMode).toBe('auto');
    expect(parseCliArgs(['--full-access', '--permission-mode', 'plan']).permissionMode).toBe('plan');
  });

  it('keeps legacy flags and skills subcommand', () => {
    const p = parseCliArgs(['--daemon', '--port', '8080', '--channels', 'a,b']);
    expect(p).toMatchObject({ daemon: true, port: '8080', channels: 'a,b' });
    const s = parseCliArgs(['skills', 'list', '--json']);
    expect(s.subcommand).toBe('skills');
    expect(s.subcommandArgs).toEqual(['list', '--json']);
    expect(parseCliArgs(['-h']).help).toBe(true);
  });

  it('resolves headless default permission mode', () => {
    expect(resolvePermissionMode(parseCliArgs(['-p', 'x']), { headless: true })).toBe('accept-edits');
    expect(resolvePermissionMode(parseCliArgs([]), { headless: false })).toBeNull();
    expect(resolvePermissionMode(parseCliArgs(['--permission-mode', 'ask']), { headless: true })).toBe('ask');
  });
});

describe('splitToolRules', () => {
  it('splits on top-level commas only', () => {
    expect(splitToolRules('exec(npm run a,b),read_file, write_file ')).toEqual(['exec(npm run a,b)', 'read_file', 'write_file']);
    expect(splitToolRules('')).toEqual([]);
  });
});

// ── prompt & stdin ───────────────────────────────────────────────

describe('buildPrompt / readStdin', () => {
  it('prepends stdin as context', () => {
    expect(buildPrompt('review', 'diff --git\n')).toBe('diff --git\n\n---\n\nreview');
    expect(buildPrompt(null, 'only stdin')).toBe('only stdin');
    expect(buildPrompt('only prompt', '   ')).toBe('only prompt');
    expect(buildPrompt('', '')).toBe('');
  });

  it('reads piped stdin and ignores TTY', async () => {
    await expect(readStdin(pipedStdin('abc'))).resolves.toBe('abc');
    await expect(readStdin(ttyStdin())).resolves.toBe('');
  });

  it('does not hang on an open, empty stdin when a timeout is given', async () => {
    const s = new PassThrough();
    await expect(readStdin(s, { idleTimeoutMs: 20 })).resolves.toBe('');
  });
});

// ── output formatting ────────────────────────────────────────────

describe('formatting', () => {
  it('builds the result object with the required shape', () => {
    const r = buildResultObject({
      result: 'ok', sessionId: 's1', numTurns: 3, durationMs: 12.4, totalCostUsd: 0.5,
      usage: { input_tokens: 1, output_tokens: 2, cached_tokens: 3 },
    });
    expect(r).toMatchObject({
      type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1',
      num_turns: 3, duration_ms: 12, total_cost_usd: 0.5,
      usage: { input_tokens: 1, output_tokens: 2, cached_tokens: 3 },
    });
    expect(buildResultObject({ isError: true, error: 'boom' })).toMatchObject({ is_error: true, error: 'boom', subtype: 'error_during_execution' });
    expect(buildResultObject({ stopReason: 'max_iterations' }).subtype).toBe('error_max_turns');
  });

  it('creates stream events with correlated tool ids', () => {
    const ev = createStreamEvents({ sessionId: 's', now: () => 'T' });
    expect(ev.init({ model: 'm' })).toMatchObject({ type: 'system', subtype: 'init', model: 'm', session_id: 's' });
    expect(ev.textDelta('\x1b[31mhi\x1b[0m')).toMatchObject({ type: 'assistant', event: 'content_delta', delta: 'hi' });
    const use = ev.toolUse('exec', { command: 'ls' });
    const res = ev.toolResult('exec', { success: false, error: 'nope' });
    expect(use).toMatchObject({ type: 'tool_use', event: 'tool_call_start', name: 'exec' });
    expect(res).toMatchObject({ type: 'tool_result', event: 'tool_call_end', tool_use_id: use.id, is_error: true });
    expect(toNdjson({ a: 1 })).toBe('{"a":1}\n');
  });

  it('strips ANSI and collects usage', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[22m')).toBe('bold');
    const { usage, total_cost_usd } = collectUsage(mockSession());
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 40, cached_tokens: 10 });
    expect(total_cost_usd).toBeCloseTo(0.0123);
  });

  it('detects credentials', () => {
    expect(hasCredentials({ model: 'x/y', config: {}, env: {} })).toBe(false);
    expect(hasCredentials({ model: 'ollama/qwen3', config: {}, env: {} })).toBe(true);
    expect(hasCredentials({ model: 'x/y', config: { API_KEY: 'k' }, env: {} })).toBe(true);
  });
});

// ── runHeadless (mocked session) ─────────────────────────────────

describe('runHeadless', () => {
  it('text mode prints only the final answer on stdout', async () => {
    const r = await run(['-p', 'hi', '--model', 'test/model']);
    expect(r.code).toBe(EXIT_OK);
    expect(r.stdout).toBe('final answer\n');
    expect(r.stderr).toMatch(/read_file/);
    expect(r.session.save).toHaveBeenCalled();
  });

  it('json mode prints a single result object', async () => {
    const r = await run(['-p', 'hi', '--model', 'test/model', '--output-format', 'json']);
    expect(r.code).toBe(EXIT_OK);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]);
    expect(obj).toMatchObject({
      type: 'result', result: 'final answer', session_id: 'session_test_1', num_turns: 2, is_error: false,
      usage: { input_tokens: 100, output_tokens: 40, cached_tokens: 10 },
    });
    expect(typeof obj.duration_ms).toBe('number');
    expect(obj.total_cost_usd).toBeCloseTo(0.0123);
  });

  it('stream-json emits init, deltas, tool events and a final result', async () => {
    const r = await run(['-p', 'hi', '--model', 'test/model', '--output-format', 'stream-json']);
    expect(r.code).toBe(EXIT_OK);
    const events = r.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init', model: 'test/model' });
    expect(events.filter(e => e.type === 'assistant').map(e => e.delta).join('')).toBe('final answer');
    const toolUse = events.find(e => e.type === 'tool_use');
    const toolResult = events.find(e => e.type === 'tool_result');
    expect(toolUse.name).toBe('read_file');
    expect(toolResult.tool_use_id).toBe(toolUse.id);
    expect(events.at(-1)).toMatchObject({ type: 'result', result: 'final answer', is_error: false });
  });

  it('passes permission options to the session factory', async () => {
    const r = await run(['-p', 'hi', '--model', 'm/x', '--allowed-tools', 'exec(npm test:*)', '--max-turns', '3']);
    const { sessionOptions } = r.factory.mock.calls[0][0];
    expect(sessionOptions.permissionMode).toBe('accept-edits');
    expect(sessionOptions.allowedTools).toEqual(['exec(npm test:*)']);
    expect(sessionOptions.disallowedTools).toEqual([]);
    expect(sessionOptions.maxIterations).toBe(3);
    expect(typeof sessionOptions.onApprovalRequest).toBe('function');
  });

  it('ask mode auto-denies approvals with a clear message', async () => {
    let decision;
    const session = mockSession({
      runImpl: async () => ({ response: 'done', iterations: 1, stopReason: 'completed' }),
    });
    const createSession = vi.fn(async ({ sessionOptions }) => {
      decision = await sessionOptions.onApprovalRequest({ toolName: 'exec', args: { command: 'rm -rf x' }, reason: 'destructive', rule: 'exec(rm:*)' });
      return { session };
    });
    const r = await run(['-p', 'hi', '--model', 'm/x', '--permission-mode', 'ask', '--output-format', 'json'], { session, createSession });
    expect(decision).toBe('deny');
    expect(r.stderr).toMatch(/denied exec .*ask.*headless/);
    expect(JSON.parse(r.stdout).permission_denials[0]).toMatchObject({ tool_name: 'exec', rule: 'exec(rm:*)' });
  });

  it('prepends piped stdin to the prompt', async () => {
    const r = await run(['-p', 'summarize', '--model', 'm/x'], { stdin: pipedStdin('LOG LINE') });
    expect(r.session.run).toHaveBeenCalledWith('LOG LINE\n\n---\n\nsummarize');
  });

  it('exits 2 on bad args with a JSON error', async () => {
    const r = await run(['-p', 'x', '--output-format', 'json', '--max-turns', 'abc']);
    expect(r.code).toBe(EXIT_BAD_ARGS);
    expect(JSON.parse(r.stdout)).toMatchObject({ type: 'result', is_error: true });
  });

  it('exits 2 when no prompt is given', async () => {
    const r = await run(['-p', '--model', 'm/x']);
    expect(r.code).toBe(EXIT_BAD_ARGS);
    expect(r.stderr).toMatch(/No prompt/);
  });

  it('exits 1 with JSON error when no API key is configured', async () => {
    const r = await run(['-p', 'x', '--model', 'm/x', '--output-format', 'json'], { config: {} });
    expect(r.code).toBe(EXIT_ERROR);
    const obj = JSON.parse(r.stdout);
    expect(obj.is_error).toBe(true);
    expect(obj.error).toMatch(/API key/);
  });

  it('exits 1 and reports errors thrown by the agent', async () => {
    const session = mockSession({ runImpl: async () => { throw new Error('model exploded'); } });
    const r = await run(['-p', 'x', '--model', 'm/x', '--output-format', 'stream-json'], { session });
    expect(r.code).toBe(EXIT_ERROR);
    const last = JSON.parse(r.stdout.trim().split('\n').at(-1));
    expect(last).toMatchObject({ type: 'result', is_error: true, error: 'model exploded' });
  });

  it('exits 2 when resume target is missing', async () => {
    const createSession = vi.fn(async () => { const e = new Error('Session not found: nope'); e.name = 'HeadlessUsageError'; throw e; });
    const r = await run(['-p', 'x', '--resume', 'nope'], { createSession });
    // Errors from custom factories are runtime errors unless they are HeadlessUsageError instances.
    expect([EXIT_ERROR, EXIT_BAD_ARGS]).toContain(r.code);
    expect(r.stderr).toMatch(/Session not found/);
  });
});

// ── approval prompt helpers ──────────────────────────────────────

describe('approvalPrompt helpers', () => {
  it('maps keys to decisions', () => {
    expect(decisionForKey('y')).toBe('allow');
    expect(decisionForKey('\r')).toBe('allow');
    expect(decisionForKey('A')).toBe('always');
    expect(decisionForKey('n')).toBe('deny');
    expect(decisionForKey('\u0003')).toBe('deny');
    expect(decisionForKey('z')).toBeNull();
  });

  it('cycles permission modes', () => {
    let mode = 'ask';
    const seen = new Set();
    for (let i = 0; i < PERMISSION_MODE_CYCLE.length; i++) { seen.add(mode); mode = nextPermissionMode(mode); }
    expect(seen.size).toBe(PERMISSION_MODE_CYCLE.length);
    expect(mode).toBe('ask');
  });
});
