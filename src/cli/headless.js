/**
 * 🤖 Headless Mode — `openagent -p "<prompt>"`
 *
 * Non-interactive execution with parity to `claude -p`, `codex exec`, `opencode run`.
 *   - text        → final answer only on stdout (logs/progress on stderr)
 *   - json        → a single JSON result object on stdout
 *   - stream-json → newline-delimited JSON events on stdout
 *
 * This module is intentionally lightweight: it only depends on node built-ins at
 * import time. AgentSession and friends are loaded lazily inside runHeadless().
 *
 * Exit codes: 0 = success, 1 = runtime error, 2 = bad arguments.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const OUTPUT_FORMATS = Object.freeze(['text', 'json', 'stream-json']);
export const PERMISSION_MODES = Object.freeze(['read-only', 'plan', 'ask', 'accept-edits', 'auto']);
export const HEADLESS_DEFAULT_PERMISSION_MODE = 'accept-edits';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_BAD_ARGS = 2;

/** Flags that take a required value. */
const VALUE_FLAGS = new Map([
  ['--output-format', 'outputFormat'],
  ['--max-turns', 'maxTurns'],
  ['--model', 'model'],
  ['-m', 'model'],
  ['--permission-mode', 'permissionMode'],
  ['--allowed-tools', 'allowedTools'],
  ['--allowedTools', 'allowedTools'],
  ['--disallowed-tools', 'disallowedTools'],
  ['--disallowedTools', 'disallowedTools'],
  ['--cwd', 'cwd'],
  ['--port', 'port'],
  ['--channels', 'channels'],
]);

/** Boolean flags. */
const BOOL_FLAGS = new Map([
  ['--continue', 'continue'],
  ['-c', 'continue'],
  ['--quiet', 'quiet'],
  ['-q', 'quiet'],
  ['--full-access', 'fullAccess'],
  ['--daemon', 'daemon'],
  ['--companion', 'companion'],
  ['--perf', 'perf'],
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-v', 'version'],
]);

/**
 * Split a tool-rule list. Commas separate rules, except commas inside
 * parentheses (so `exec(npm test:*),read_file` → ['exec(npm test:*)', 'read_file']).
 * @param {string} value
 * @returns {string[]}
 */
export function splitToolRules(value) {
  if (Array.isArray(value)) return value.flatMap(splitToolRules);
  if (typeof value !== 'string') return [];
  const rules = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (current.trim()) rules.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) rules.push(current.trim());
  return rules;
}

/**
 * Parse OpenAgent CLI arguments (both interactive and headless flags).
 * Pure function — never touches process state.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{
 *   print: boolean, prompt: string|null, outputFormat: string, maxTurns: number|null,
 *   model: string|null, permissionMode: string|null, allowedTools: string[],
 *   disallowedTools: string[], continue: boolean, resume: true|string|null,
 *   cwd: string|null, quiet: boolean, fullAccess: boolean, daemon: boolean,
 *   companion: boolean, perf: boolean, help: boolean, version: boolean,
 *   port: string|null, channels: string|null, subcommand: string|null,
 *   subcommandArgs: string[], positionals: string[], errors: string[]
 * }}
 */
export function parseCliArgs(argv = []) {
  const parsed = {
    print: false,
    prompt: null,
    outputFormat: 'text',
    maxTurns: null,
    model: null,
    permissionMode: null,
    allowedTools: [],
    disallowedTools: [],
    continue: false,
    resume: null,
    cwd: null,
    quiet: false,
    fullAccess: false,
    daemon: false,
    companion: false,
    perf: false,
    help: false,
    version: false,
    port: null,
    channels: null,
    subcommand: null,
    subcommandArgs: [],
    positionals: [],
    unknownFlags: [],
    errors: [],
  };

  const args = Array.isArray(argv) ? [...argv] : [];

  // Shell subcommands (e.g. `openagent skills list`) consume the rest verbatim.
  if (args[0] === 'skills') {
    parsed.subcommand = 'skills';
    parsed.subcommandArgs = args.slice(1);
    return parsed;
  }

  const isFlagLike = (token) => typeof token === 'string' && token.startsWith('-') && token !== '-';

  for (let i = 0; i < args.length; i++) {
    let token = args[i];
    let inlineValue;

    if (token === '--') {
      parsed.positionals.push(...args.slice(i + 1));
      break;
    }

    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      inlineValue = token.slice(eq + 1);
      token = token.slice(0, eq);
    }

    if (token === '-p' || token === '--print') {
      parsed.print = true;
      if (inlineValue !== undefined) {
        parsed.prompt = inlineValue;
      } else if (i + 1 < args.length && !isFlagLike(args[i + 1])) {
        parsed.prompt = args[++i];
      }
      continue;
    }

    if (token === '--resume' || token === '-r') {
      if (inlineValue !== undefined) {
        parsed.resume = inlineValue || true;
      } else if (i + 1 < args.length && !isFlagLike(args[i + 1])) {
        parsed.resume = args[++i];
      } else {
        parsed.resume = true;
      }
      continue;
    }

    if (VALUE_FLAGS.has(token)) {
      const key = VALUE_FLAGS.get(token);
      let value = inlineValue;
      if (value === undefined) {
        if (i + 1 >= args.length || (isFlagLike(args[i + 1]) && key !== 'allowedTools' && key !== 'disallowedTools')) {
          parsed.errors.push(`Missing value for ${token}`);
          continue;
        }
        value = args[++i];
      }
      if (key === 'allowedTools' || key === 'disallowedTools') {
        parsed[key].push(...splitToolRules(value));
      } else {
        parsed[key] = value;
      }
      continue;
    }

    if (BOOL_FLAGS.has(token)) {
      parsed[BOOL_FLAGS.get(token)] = true;
      continue;
    }

    if (isFlagLike(token)) {
      parsed.unknownFlags.push(token);
      continue;
    }

    parsed.positionals.push(token);
  }

  // Positionals after -p are treated as (additional) prompt text, like `claude -p fix the bug`.
  if (parsed.print && parsed.positionals.length > 0) {
    const extra = parsed.positionals.join(' ');
    parsed.prompt = parsed.prompt ? `${parsed.prompt} ${extra}` : extra;
    parsed.positionals = [];
  }

  // ── Validation ──
  if (!OUTPUT_FORMATS.includes(parsed.outputFormat)) {
    parsed.errors.push(`Invalid --output-format "${parsed.outputFormat}" (expected: ${OUTPUT_FORMATS.join(', ')})`);
  }

  if (parsed.maxTurns !== null) {
    const n = Number(parsed.maxTurns);
    if (!Number.isInteger(n) || n < 1) {
      parsed.errors.push(`Invalid --max-turns "${parsed.maxTurns}" (expected a positive integer)`);
    } else {
      parsed.maxTurns = n;
    }
  }

  if (parsed.permissionMode !== null && !PERMISSION_MODES.includes(parsed.permissionMode)) {
    parsed.errors.push(`Invalid --permission-mode "${parsed.permissionMode}" (expected: ${PERMISSION_MODES.join(', ')})`);
  }

  // --full-access is an alias for --permission-mode auto (explicit mode wins).
  if (parsed.fullAccess && parsed.permissionMode === null) {
    parsed.permissionMode = 'auto';
  }

  if (parsed.continue && typeof parsed.resume === 'string') {
    parsed.errors.push('Use either --continue or --resume <id>, not both');
  }

  if (parsed.print && parsed.unknownFlags.length > 0) {
    parsed.errors.push(`Unknown option${parsed.unknownFlags.length > 1 ? 's' : ''}: ${parsed.unknownFlags.join(', ')}`);
  }

  return parsed;
}

/**
 * Resolve the effective permission mode for a run.
 * @param {ReturnType<typeof parseCliArgs>} parsed
 * @param {{ headless?: boolean }} [opts]
 */
export function resolvePermissionMode(parsed, { headless = false } = {}) {
  if (parsed.permissionMode) return parsed.permissionMode;
  if (parsed.fullAccess) return 'auto';
  return headless ? HEADLESS_DEFAULT_PERMISSION_MODE : null;
}

// ═══════════════════════════════════════════════════════════════════
// Prompt assembly & stdin
// ═══════════════════════════════════════════════════════════════════

/**
 * Combine the -p prompt with piped stdin. Stdin is prepended as context.
 * @param {string|null} promptArg
 * @param {string} [stdinText]
 * @returns {string}
 */
export function buildPrompt(promptArg, stdinText = '') {
  const prompt = typeof promptArg === 'string' ? promptArg.trim() : '';
  const context = typeof stdinText === 'string' ? stdinText.replace(/\s+$/, '') : '';
  if (prompt && context.trim()) return `${context}\n\n---\n\n${prompt}`;
  if (prompt) return prompt;
  return context.trim() ? context : '';
}

/**
 * Read all of stdin when it is piped. Returns '' for a TTY.
 * When a prompt was already supplied, waits at most `idleTimeoutMs` for the
 * first chunk so a non-closing, empty stdin (some CI runners) can't hang us.
 * @param {NodeJS.ReadableStream & { isTTY?: boolean }} [stream]
 * @param {{ idleTimeoutMs?: number|null }} [opts]
 * @returns {Promise<string>}
 */
export function readStdin(stream = process.stdin, { idleTimeoutMs = null } = {}) {
  if (!stream || stream.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    let timer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stream.off?.('data', onData);
      stream.off?.('end', finish);
      stream.off?.('error', finish);
      stream.pause?.();
      resolve(Buffer.concat(chunks.map(c => (Buffer.isBuffer(c) ? c : Buffer.from(String(c))))).toString('utf8'));
    };
    const onData = (chunk) => {
      if (timer) { clearTimeout(timer); timer = null; }
      chunks.push(chunk);
    };

    if (Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0) {
      timer = setTimeout(() => { if (chunks.length === 0) finish(); }, idleTimeoutMs);
      timer.unref?.();
    }

    stream.on('data', onData);
    stream.once('end', finish);
    stream.once('error', finish);
    stream.resume?.();
  });
}

// ═══════════════════════════════════════════════════════════════════
// Output formatting
// ═══════════════════════════════════════════════════════════════════

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_PATTERN, '');
}

/**
 * Collect token usage + cost from a session (main client + subagents + teams).
 * @param {any} session
 */
export function collectUsage(session) {
  const stats = safeCall(() => session?.agent?.client?.getStats?.()) || {};
  const subagent = safeCall(() => session?.subagentManager?.getStats?.()) || {};
  const autoGen = safeCall(() => session?.autoGenBridge?.getStats?.()) || {};
  const agentStats = safeCall(() => session?.agent?.getStats?.()) || {};
  const totalCost = toNumber(stats.totalCost) + toNumber(subagent.totalCost) + toNumber(autoGen.totalTeamCost);
  return {
    usage: {
      input_tokens: toNumber(stats.totalInputTokens) + toNumber(subagent.totalInputTokens),
      output_tokens: toNumber(stats.totalOutputTokens) + toNumber(subagent.totalOutputTokens),
      cached_tokens: toNumber(stats.totalCachedTokens) || toNumber(agentStats.totalCachedTokens),
    },
    total_cost_usd: Number(totalCost.toFixed(6)),
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeCall(fn) {
  try { return fn(); } catch { return null; }
}

/**
 * Map an agent stopReason to a result subtype (Claude Code compatible names).
 */
export function resultSubtype({ isError = false, stopReason = null } = {}) {
  if (isError) return 'error_during_execution';
  if (stopReason === 'max_iterations') return 'error_max_turns';
  return 'success';
}

/**
 * Build the final JSON result object.
 * @param {{
 *   result?: string, sessionId?: string|null, numTurns?: number, usage?: object,
 *   totalCostUsd?: number, durationMs?: number, isError?: boolean, error?: string|null,
 *   stopReason?: string|null, model?: string|null, permissionDenials?: object[]
 * }} info
 */
export function buildResultObject(info = {}) {
  const isError = info.isError === true;
  const usage = info.usage || {};
  const obj = {
    type: 'result',
    subtype: resultSubtype({ isError, stopReason: info.stopReason }),
    is_error: isError,
    result: typeof info.result === 'string' ? info.result : '',
    session_id: info.sessionId ?? null,
    num_turns: Number.isFinite(info.numTurns) ? info.numTurns : 0,
    duration_ms: Number.isFinite(info.durationMs) ? Math.round(info.durationMs) : 0,
    total_cost_usd: Number.isFinite(info.totalCostUsd) ? info.totalCostUsd : 0,
    usage: {
      input_tokens: toNumber(usage.input_tokens),
      output_tokens: toNumber(usage.output_tokens),
      cached_tokens: toNumber(usage.cached_tokens),
    },
  };
  if (info.stopReason) obj.stop_reason = info.stopReason;
  if (info.model) obj.model = info.model;
  if (Array.isArray(info.permissionDenials) && info.permissionDenials.length > 0) {
    obj.permission_denials = info.permissionDenials;
  }
  if (isError) obj.error = info.error || 'Unknown error';
  return obj;
}

function previewValue(value, maxChars = 2000) {
  let text;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  text = stripAnsi(text ?? '');
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}... [${text.length - maxChars} chars omitted]`;
}

/**
 * Creates the NDJSON event factory for --output-format stream-json.
 * Event `type`s follow Claude Code's stream-json naming; the `event` field mirrors
 * the gateway event names from src/gateway/events.js (content_delta,
 * tool_call_start, tool_call_end, done) so existing consumers can map them.
 * (events.js itself is not imported: it pulls in the terminal markdown renderer
 * and adds ANSI-rendered fields, both unwanted in headless mode.)
 */
export function createStreamEvents({ sessionId = null, now = () => new Date().toISOString() } = {}) {
  let toolSeq = 0;
  const pending = new Map(); // toolName -> [ids] (FIFO)
  let currentSessionId = sessionId;

  const base = (type, extra) => ({ type, ...extra, session_id: currentSessionId, timestamp: now() });

  return {
    setSessionId(id) { currentSessionId = id; },
    init({ model = null, cwd = null, permissionMode = null, tools = [], resumed = false } = {}) {
      return base('system', { subtype: 'init', model, cwd, permission_mode: permissionMode, tools, resumed });
    },
    textDelta(delta, iteration = null) {
      return base('assistant', { subtype: 'text_delta', event: 'content_delta', message_role: 'assistant', delta: stripAnsi(delta), iteration });
    },
    toolUse(toolName, args, iteration = null) {
      const id = `toolu_${String(++toolSeq).padStart(4, '0')}`;
      if (!pending.has(toolName)) pending.set(toolName, []);
      pending.get(toolName).push(id);
      return base('tool_use', { event: 'tool_call_start', id, name: toolName, input: args ?? {}, iteration });
    },
    toolResult(toolName, result, iteration = null) {
      const queue = pending.get(toolName);
      const id = queue?.shift() || `toolu_${String(++toolSeq).padStart(4, '0')}`;
      const isError = result?.success === false || Boolean(result?.error);
      return base('tool_result', {
        event: 'tool_call_end',
        tool_use_id: id,
        name: toolName,
        is_error: isError,
        content: previewValue(result),
        ...(isError ? { error: previewValue(result?.error ?? 'Tool failed', 500) } : {}),
        iteration,
      });
    },
    status(message, kind = 'status') {
      return base('system', { subtype: kind, message: stripAnsi(message) });
    },
    permissionDenied(denial) {
      return base('system', { subtype: 'permission_denied', ...denial });
    },
    result(resultObject) {
      return { ...resultObject, event: 'done', session_id: resultObject.session_id ?? currentSessionId, timestamp: now() };
    },
  };
}

/** Serialize one NDJSON line. */
export function toNdjson(event) {
  return `${JSON.stringify(event)}\n`;
}

// ═══════════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════════

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ERROR_STOP_REASONS = new Set(['consecutive_api_errors', 'aborted', 'dead_end']);
const LOCAL_PROVIDER_PREFIX = /^(ollama|lmstudio|llamacpp|llama\.cpp|local|vllm)\//i;
const PROVIDER_KEY_ENVS = [
  'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
  'GOOGLE_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'XAI_API_KEY',
];

class HeadlessUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HeadlessUsageError';
  }
}

/**
 * Pick a model when --model was not passed: env → resumed session → recents → fallback.
 */
export function resolveDefaultModel({ env = process.env, config = {}, recentsFile = path.join(__dirname, '..', '..', '.model-recents.json') } = {}) {
  if (env.OPENAGENT_MODEL) return env.OPENAGENT_MODEL;
  try {
    if (recentsFile && fs.existsSync(recentsFile)) {
      const recents = JSON.parse(fs.readFileSync(recentsFile, 'utf8'));
      if (Array.isArray(recents)) {
        const first = recents.find(r => (typeof r === 'string' && r) || (r && typeof r.id === 'string'));
        if (first) return typeof first === 'string' ? first : first.id;
      }
    }
  } catch {
    // Unreadable recents file — fall through to configured fallback.
  }
  return config.DEFAULT_MODEL || config.FALLBACK_MODEL || null;
}

/** True when some credential is available for the chosen model. */
export function hasCredentials({ model, config = {}, env = process.env }) {
  if (config.API_KEY) return true;
  if (model && LOCAL_PROVIDER_PREFIX.test(model)) return true;
  return PROVIDER_KEY_ENVS.some(name => Boolean(env[name]));
}

/**
 * Default session factory: lazily loads AgentSession (+ sessionOps for resume).
 * @returns {Promise<{ session: any, resumed: boolean }>}
 */
async function defaultCreateSession({ workingDir, model, resume, continueLast, sessionOptions }) {
  if (resume || continueLast) {
    const { resumeSavedSession } = await import('./sessionOps.js');
    const session = await resumeSavedSession({
      workingDir,
      sessionId: typeof resume === 'string' ? resume : null,
      sessionOptions,
    });
    if (!session) {
      throw new HeadlessUsageError(typeof resume === 'string'
        ? `Session not found: ${resume}`
        : `No saved sessions to continue in ${workingDir}`);
    }
    if (model && session.agent) {
      session.model = model;
      session.agent.model = model;
    }
    return { session, resumed: true };
  }

  const { AgentSession } = await import('../agent/AgentSession.js');
  return { session: new AgentSession({ ...sessionOptions, workingDir, model }), resumed: false };
}

async function defaultLoadConfig() {
  const { CONFIG } = await import('../config.js');
  return CONFIG;
}

async function defaultBeginTurn(userInput) {
  const mod = await import('../agent/TurnCheckpointer.js').catch(() => null);
  await mod?.beginTurn?.(userInput);
}

/**
 * Install stdout/console redirection so only our own output reaches stdout.
 * Returns { out, err, restore }.
 */
function captureStdio({ stdout, stderr, quiet, redirectProcessStdout }) {
  const out = (text) => new Promise((resolve) => {
    if (!text) { resolve(); return; }
    try { stdout.write(text, () => resolve()); } catch { resolve(); }
  });
  const errWrite = (text) => { try { stderr.write(text); } catch { /* stderr closed */ } };
  const err = (text) => { if (!quiet) errWrite(text); };

  const original = {
    log: console.log, info: console.info, warn: console.warn,
    debug: console.debug, error: console.error, stdoutWrite: null,
  };
  const toStderr = (...args) => err(`${args.map(a => (typeof a === 'string' ? a : safeInspect(a))).join(' ')}\n`);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;
  console.error = (...args) => errWrite(`${args.map(a => (typeof a === 'string' ? a : safeInspect(a))).join(' ')}\n`);

  if (redirectProcessStdout && process.stdout && stdout === process.stdout) {
    original.stdoutWrite = process.stdout.write;
    const realWrite = original.stdoutWrite.bind(process.stdout);
    // Any stray library write → stderr. Our own output uses realWrite via `out`.
    process.stdout.write = (chunk, encoding, cb) => {
      if (!quiet) stderr.write(chunk, encoding);
      const callback = typeof encoding === 'function' ? encoding : cb;
      if (typeof callback === 'function') callback();
      return true;
    };
    const outReal = (text) => new Promise((resolve) => {
      if (!text) { resolve(); return; }
      try { realWrite(text, () => resolve()); } catch { resolve(); }
    });
    return { out: outReal, err, errAlways: errWrite, restore: () => restore(original) };
  }

  return { out, err, errAlways: errWrite, restore: () => restore(original) };
}

function restore(original) {
  console.log = original.log;
  console.info = original.info;
  console.warn = original.warn;
  console.debug = original.debug;
  console.error = original.error;
  if (original.stdoutWrite) process.stdout.write = original.stdoutWrite;
}

function safeInspect(value) {
  if (value instanceof Error) return value.message;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return previewValue(args ?? '', 120);
  const target = args.path || args.file || args.filePath || args.command || args.query || args.url || args.pattern;
  return previewValue(target ?? args, 120);
}

/**
 * Run OpenAgent headlessly.
 * @param {ReturnType<typeof parseCliArgs>} parsed
 * @param {object} [deps] - injectable for tests
 * @returns {Promise<number>} exit code
 */
export async function runHeadless(parsed, deps = {}) {
  const {
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    createSession = defaultCreateSession,
    loadConfig = defaultLoadConfig,
    beginTurn = defaultBeginTurn,
    now = () => Date.now(),
    redirectProcessStdout = stdout === process.stdout,
    installSignalHandlers = stdout === process.stdout,
    stdinIdleTimeoutMs = 1500,
    // Without -p text, stdin is the prompt; still bound the wait for the FIRST chunk
    // because Windows/CI can hand us an inherited stdin that never closes.
    stdinPromptTimeoutMs = Number(env.OPENAGENT_STDIN_TIMEOUT_MS) || 5000,
  } = deps;

  const startedAt = now();
  const format = OUTPUT_FORMATS.includes(parsed?.outputFormat) ? parsed.outputFormat : 'text';
  const quiet = parsed?.quiet === true;
  const io = captureStdio({ stdout, stderr, quiet, redirectProcessStdout });
  const events = createStreamEvents();
  const permissionDenials = [];
  let session = null;
  let sigintHandler = null;

  const emit = async (event) => { if (format === 'stream-json') await io.out(toNdjson(event)); };
  const finishWithError = async (message, exitCode, extra = {}) => {
    const resultObject = buildResultObject({
      isError: true,
      error: message,
      sessionId: session?.sessionId ?? null,
      durationMs: now() - startedAt,
      permissionDenials,
      ...extra,
    });
    if (format === 'json') await io.out(`${JSON.stringify(resultObject)}\n`);
    else if (format === 'stream-json') await io.out(toNdjson(events.result(resultObject)));
    io.errAlways(`openagent: ${message}\n`);
    return exitCode;
  };

  try {
    if (!parsed || !Array.isArray(parsed.errors)) {
      return await finishWithError('Invalid arguments', EXIT_BAD_ARGS);
    }
    if (parsed.errors.length > 0) {
      return await finishWithError(`${parsed.errors.join('; ')}\nRun "openagent --help" for usage.`, EXIT_BAD_ARGS);
    }

    const workingDir = path.resolve(parsed.cwd || process.cwd());
    if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
      return await finishWithError(`--cwd directory does not exist: ${workingDir}`, EXIT_BAD_ARGS);
    }

    const hasPromptArg = typeof parsed.prompt === 'string' && parsed.prompt.trim().length > 0;
    const stdinText = await readStdin(stdin, { idleTimeoutMs: hasPromptArg ? stdinIdleTimeoutMs : stdinPromptTimeoutMs });
    const prompt = buildPrompt(parsed.prompt, stdinText);
    if (!prompt) {
      return await finishWithError('No prompt provided. Pass -p "<prompt>" or pipe input via stdin.', EXIT_BAD_ARGS);
    }

    const config = (await loadConfig()) || {};
    const permissionMode = resolvePermissionMode(parsed, { headless: true });
    const allowFullAccess = permissionMode === 'auto' || env.OPENAGENT_FULL_ACCESS === 'true';
    const model = parsed.model || null;
    const resuming = Boolean(parsed.resume || parsed.continue);
    const effectiveModel = model || (resuming ? null : resolveDefaultModel({ env, config }));

    if (!effectiveModel && !resuming) {
      return await finishWithError('No model selected. Pass --model <id> or set OPENAGENT_MODEL.', EXIT_BAD_ARGS);
    }
    if (!hasCredentials({ model: effectiveModel, config, env })) {
      return await finishWithError('No API key found. Set OPENROUTER_API_KEY (or a provider key) in your environment or .env file.', EXIT_ERROR);
    }

    const onApprovalRequest = async (req = {}) => {
      const denial = {
        tool_name: req.toolName ?? null,
        tool_input: req.args ?? null,
        reason: req.reason ?? null,
        rule: req.rule ?? null,
      };
      permissionDenials.push(denial);
      const hint = permissionMode === 'ask'
        ? 'permission-mode "ask" cannot prompt in headless mode'
        : 'no interactive approval available in headless mode';
      io.errAlways(`openagent: denied ${req.toolName || 'tool'} (${hint})${req.reason ? ` — ${req.reason}` : ''}. ` +
        `Re-run with --permission-mode accept-edits|auto or --allowed-tools "${req.rule || req.toolName || '<rule>'}".\n`);
      await emit(events.permissionDenied({ ...denial, message: hint }));
      return 'deny';
    };

    const sessionOptions = {
      verbose: false,
      streaming: true,
      permissions: { allowFileDelete: true, allowFullAccess },
      allowFullAccess,
      ...(permissionMode && { permissionMode }),
      allowedTools: Array.isArray(parsed.allowedTools) ? parsed.allowedTools : [],
      disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
      onApprovalRequest,
      headless: true,
      ...(parsed.maxTurns && { maxIterations: parsed.maxTurns }),
    };

    let resumed = false;
    try {
      const created = await createSession({
        workingDir,
        model: effectiveModel,
        resume: parsed.resume,
        continueLast: parsed.continue,
        sessionOptions,
      });
      session = created?.session ?? created;
      resumed = created?.resumed === true;
    } catch (error) {
      const code = error instanceof HeadlessUsageError ? EXIT_BAD_ARGS : EXIT_ERROR;
      return await finishWithError(error.message || String(error), code);
    }

    if (!session?.agent || typeof session.run !== 'function') {
      return await finishWithError('Failed to initialize agent session', EXIT_ERROR);
    }
    if (permissionMode && typeof session.setPermissionMode === 'function') {
      try { session.setPermissionMode(permissionMode); } catch { /* mode applied via constructor */ }
    }
    events.setSessionId(session.sessionId ?? null);

    const agent = session.agent;
    agent.verbose = false;
    if (parsed.maxTurns && typeof agent.setRunLimits === 'function') {
      // AgentSession derives per-task budgets on each run; clamp them to --max-turns.
      const originalSetRunLimits = agent.setRunLimits.bind(agent);
      agent.setRunLimits = (limits) => originalSetRunLimits({
        ...(limits || {}),
        maxIterations: Math.min(Number(limits?.maxIterations) || parsed.maxTurns, parsed.maxTurns),
      });
      agent.maxIterations = parsed.maxTurns;
    }

    let iteration = null;
    agent.onIterationStart = (n) => { iteration = Number.isFinite(n) ? n : iteration; };
    agent.onContentDelta = (delta) => {
      if (format === 'stream-json' && delta) void emit(events.textDelta(delta, iteration));
    };
    agent.onIntermediateContent = null;
    agent.onResponse = null;
    agent.onStreamProgress = null;
    agent.onToolStart = (toolName, args) => {
      if (format === 'stream-json') void emit(events.toolUse(toolName, args, iteration));
      else io.err(`→ ${toolName} ${summarizeArgs(args)}\n`);
    };
    agent.onToolEnd = (toolName, result) => {
      if (format === 'stream-json') void emit(events.toolResult(toolName, result, iteration));
      else if (result?.success === false || result?.error) io.err(`✗ ${toolName}: ${previewValue(result?.error ?? 'failed', 200)}\n`);
    };
    agent.onStatus = (info = {}) => {
      if (format === 'stream-json') void emit(events.status(info.message ?? '', info.type || 'status'));
      else if (info.message) io.err(`${stripAnsi(info.message)}\n`);
    };

    await emit(events.init({
      model: agent.model || effectiveModel,
      cwd: workingDir,
      permissionMode,
      tools: safeCall(() => session.toolRegistry?.list?.()?.map(t => t?.name ?? t)) || [],
      resumed,
    }));

    if (installSignalHandlers) {
      sigintHandler = () => {
        try { agent.abort?.(); } catch { /* best-effort abort */ }
        try { session.subagentManager?.abort?.(); } catch { /* best-effort abort */ }
      };
      process.on('SIGINT', sigintHandler);
    }

    try { await beginTurn(prompt); } catch { /* checkpointing is best-effort */ }

    let result;
    try {
      result = await session.run(prompt);
    } catch (error) {
      const aborted = error?.name === 'AgentAbortError' || error?.name === 'AbortError';
      await saveQuietly(session);
      const { usage, total_cost_usd } = collectUsage(session);
      return await finishWithError(aborted ? 'Aborted' : (error?.message || String(error)), EXIT_ERROR, {
        stopReason: aborted ? 'aborted' : null,
        numTurns: agent.iterationCount || 0,
        usage,
        totalCostUsd: total_cost_usd,
        model: agent.model,
      });
    }

    await saveQuietly(session);

    const stopReason = result?.stopReason ?? null;
    const isError = ERROR_STOP_REASONS.has(stopReason);
    const responseText = stripAnsi(typeof result?.response === 'string' ? result.response : '');
    const { usage, total_cost_usd } = collectUsage(session);
    const resultObject = buildResultObject({
      result: responseText,
      sessionId: session.sessionId ?? null,
      numTurns: result?.iterations ?? agent.iterationCount ?? 0,
      usage,
      totalCostUsd: total_cost_usd,
      durationMs: now() - startedAt,
      isError,
      error: isError ? `Agent stopped: ${stopReason}` : null,
      stopReason,
      model: agent.model,
      permissionDenials,
    });

    if (format === 'json') {
      await io.out(`${JSON.stringify(resultObject)}\n`);
    } else if (format === 'stream-json') {
      await io.out(toNdjson(events.result(resultObject)));
    } else {
      if (responseText) await io.out(responseText.endsWith('\n') ? responseText : `${responseText}\n`);
      if (isError) io.errAlways(`openagent: agent stopped (${stopReason})\n`);
      if (session.sessionId) io.err(`session: ${session.sessionId}\n`);
    }

    return isError ? EXIT_ERROR : EXIT_OK;
  } catch (error) {
    return await finishWithError(error?.message || String(error), EXIT_ERROR);
  } finally {
    if (sigintHandler) process.off('SIGINT', sigintHandler);
    io.restore();
  }
}

async function saveQuietly(session) {
  try { await session?.save?.(); } catch { /* persistence is best-effort in headless mode */ }
}
