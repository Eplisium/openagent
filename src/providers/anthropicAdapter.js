/**
 * 🟠 Anthropic Messages API adapter
 *
 * Translates OpenAI-style chat payloads (what OpenRouterClient.buildPayload produces)
 * into Anthropic `/v1/messages` requests, and translates Anthropic responses —
 * both JSON and SSE streams — back into OpenAI-style shapes:
 *   - non-streaming: { id, model, choices: [{ message: { content, tool_calls }, finish_reason }], usage }
 *   - streaming:     { choices: [{ delta: { content | reasoning | tool_calls[{index,id,function}] }, finish_reason }], usage }
 *
 * cache_control markers on content parts / tools are preserved (moved onto the
 * matching Anthropic block), so OpenRouterClient's prompt caching keeps working.
 */

export const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192;

const STOP_REASON_MAP = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  pause_turn: 'stop',
  max_tokens: 'length',
  model_context_window_exceeded: 'length',
  tool_use: 'tool_calls',
  refusal: 'content_filter',
};

/** Map an Anthropic stop_reason to an OpenAI finish_reason. */
export function mapStopReason(reason) {
  if (!reason) return null;
  return STOP_REASON_MAP[reason] || 'stop';
}

function safeParseJSON(str) {
  if (str && typeof str === 'object') return str;
  if (typeof str !== 'string' || !str.trim()) return {};
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return { _raw: str };
  }
}

function withCache(block, part) {
  if (part && typeof part === 'object' && part.cache_control) block.cache_control = part.cache_control;
  return block;
}

/** Convert an OpenAI image_url part to an Anthropic image block. */
function imageBlock(part) {
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
  if (typeof url !== 'string' || !url) return null;
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (m) {
    return withCache({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, part);
  }
  return withCache({ type: 'image', source: { type: 'url', url } }, part);
}

/** Convert OpenAI message content (string | parts[]) to Anthropic content blocks. */
export function toAnthropicBlocks(content) {
  if (content == null) return [];
  if (typeof content === 'string') return content.length ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content) }];
  const blocks = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) blocks.push({ type: 'text', text: part });
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' || part.type === 'input_text') {
      if (typeof part.text === 'string' && part.text.length) blocks.push(withCache({ type: 'text', text: part.text }, part));
      else if (part.cache_control && blocks.length) blocks[blocks.length - 1].cache_control = part.cache_control;
    } else if (part.type === 'image_url') {
      const img = imageBlock(part);
      if (img) blocks.push(img);
    } else if (['image', 'document', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking'].includes(part.type)) {
      blocks.push(part); // already Anthropic-native
    }
  }
  return blocks;
}

function toolResultBlock(msg) {
  const parts = toAnthropicBlocks(msg.content);
  let cacheControl = null;
  const inner = parts.map((b) => {
    if (b.cache_control) {
      cacheControl = b.cache_control;
      const { cache_control: _cc, ...rest } = b;
      return rest;
    }
    return b;
  });
  const block = {
    type: 'tool_result',
    tool_use_id: msg.tool_call_id || msg.id || 'unknown_tool_call',
    content: inner.length === 1 && inner[0].type === 'text' ? inner[0].text : (inner.length ? inner : ''),
  };
  if (msg.is_error === true) block.is_error = true;
  if (cacheControl) block.cache_control = cacheControl;
  return block;
}

function assistantBlocks(msg) {
  const blocks = toAnthropicBlocks(msg.content);
  for (const tc of msg.tool_calls || []) {
    if (!tc) continue;
    const fn = tc.function || {};
    blocks.push({
      type: 'tool_use',
      id: tc.id || `toolu_${Math.random().toString(36).slice(2, 12)}`,
      name: fn.name || tc.name || 'unknown',
      input: safeParseJSON(fn.arguments ?? tc.arguments ?? {}),
    });
  }
  return blocks;
}

/** Convert OpenAI tool definitions to Anthropic tool definitions. */
export function toAnthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    if (t.input_schema && t.name) { out.push(t); continue; }
    if (t.function_declarations) {
      for (const fd of t.function_declarations) {
        out.push({ name: fd.name, description: fd.description || '', input_schema: fd.parameters || { type: 'object', properties: {} } });
      }
      continue;
    }
    const fn = t.function || t;
    if (!fn.name) continue;
    out.push(withCache({
      name: fn.name,
      description: fn.description || '',
      input_schema: fn.parameters || { type: 'object', properties: {} },
    }, t));
  }
  return out.length ? out : undefined;
}

/** Convert an OpenAI tool_choice to Anthropic's shape. */
export function toAnthropicToolChoice(choice) {
  if (choice == null) return undefined;
  if (typeof choice === 'string') {
    switch (choice) {
      case 'auto': return { type: 'auto' };
      case 'required':
      case 'any': return { type: 'any' };
      case 'none': return { type: 'none' };
      default: return { type: 'auto' };
    }
  }
  if (typeof choice === 'object') {
    if (choice.type === 'function' && choice.function?.name) return { type: 'tool', name: choice.function.name };
    if (['auto', 'any', 'none', 'tool'].includes(choice.type)) return choice;
  }
  return undefined;
}

/**
 * Translate an OpenAI-style chat payload into an Anthropic Messages request body.
 * @param {object} payload - { model, messages, tools, tool_choice, stream, max_tokens, temperature, top_p, stop, response_format }
 * @returns {object}
 */
export function toAnthropicRequest(payload = {}) {
  const system = [];
  const messages = [];

  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };

  for (const msg of payload.messages || []) {
    if (!msg || typeof msg !== 'object') continue;
    switch (msg.role) {
      case 'system':
      case 'developer':
        system.push(...toAnthropicBlocks(msg.content).filter((b) => b.type === 'text'));
        break;
      case 'assistant':
        push('assistant', assistantBlocks(msg));
        break;
      case 'tool':
      case 'function':
        push('user', [toolResultBlock(msg)]);
        break;
      case 'user':
      default:
        push('user', toAnthropicBlocks(msg.content));
        break;
    }
  }

  // Tool results must come first inside a user turn
  for (const m of messages) {
    if (m.role === 'user' && m.content.some((b) => b.type === 'tool_result')) {
      m.content.sort((a, b) => (a.type === 'tool_result' ? 0 : 1) - (b.type === 'tool_result' ? 0 : 1));
    }
  }
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: '(continue)' }] });
  }

  const rf = payload.response_format;
  if (rf && (rf.type === 'json_schema' || rf.type === 'json_object')) {
    const schema = rf.json_schema?.schema ? `\nJSON schema:\n${JSON.stringify(rf.json_schema.schema)}` : '';
    system.push({ type: 'text', text: `Respond ONLY with a single valid JSON object and no other text.${schema}` });
  }

  const body = {
    model: payload.model,
    max_tokens: Number.isFinite(payload.max_tokens) && payload.max_tokens > 0 ? payload.max_tokens : DEFAULT_ANTHROPIC_MAX_TOKENS,
    messages,
  };
  if (system.length) body.system = system;
  // Newer Claude models reject temperature + top_p together; prefer temperature.
  if (payload.temperature != null) body.temperature = Math.max(0, Math.min(1, payload.temperature));
  else if (payload.top_p != null) body.top_p = payload.top_p;
  if (payload.stop) body.stop_sequences = Array.isArray(payload.stop) ? payload.stop : [payload.stop];
  const tools = toAnthropicTools(payload.tools);
  if (tools) body.tools = tools;
  const toolChoice = toAnthropicToolChoice(payload.tool_choice);
  if (toolChoice && tools) body.tool_choice = toolChoice;
  if (payload.stream) body.stream = true;
  if (payload.user) body.metadata = { user_id: String(payload.user) };
  return body;
}

/** Convert Anthropic usage into an OpenAI-style usage object (prompt_tokens includes cached tokens). */
export function toOpenAIUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const input = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const output = usage.output_tokens || 0;
  const promptTokens = input + cacheRead + cacheWrite;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: output,
    total_tokens: promptTokens + output,
    prompt_tokens_details: { cached_tokens: cacheRead, cache_write_tokens: cacheWrite },
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
  };
}

/** Translate a non-streaming Anthropic Messages response into an OpenAI chat completion. */
export function fromAnthropicResponse(data = {}) {
  const textParts = [];
  const reasoningParts = [];
  const toolCalls = [];
  for (const block of data.content || []) {
    if (!block) continue;
    if (block.type === 'text') textParts.push(block.text || '');
    else if (block.type === 'thinking') reasoningParts.push(block.thinking || '');
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const message = { role: 'assistant', content: textParts.length ? textParts.join('') : null };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (reasoningParts.length) message.reasoning = reasoningParts.join('');
  return {
    id: data.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [{ index: 0, message, finish_reason: mapStopReason(data.stop_reason) || (toolCalls.length ? 'tool_calls' : 'stop') }],
    usage: toOpenAIUsage(data.usage),
  };
}

/**
 * Stateful translator for Anthropic SSE events → OpenAI-style stream chunks.
 * Feed each parsed `data:` JSON object to push(); it returns zero or more chunks.
 * A chunk `{ done: true }` marks message_stop.
 */
export class AnthropicStreamTranslator {
  constructor() {
    this.id = null;
    this.model = null;
    this.usage = {};
    this.blocks = new Map(); // anthropic block index -> { type, toolIndex, argChars }
    this.nextToolIndex = 0;
    this.finishReason = null;
  }

  _chunk(delta, extra = {}) {
    return { id: this.id, model: this.model, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }], ...extra };
  }

  push(event) {
    if (!event || typeof event !== 'object') return [];
    switch (event.type) {
      case 'message_start': {
        const msg = event.message || {};
        this.id = msg.id || this.id;
        this.model = msg.model || this.model;
        this.usage = { ...this.usage, ...(msg.usage || {}) };
        return [this._chunk({ role: 'assistant' })];
      }
      case 'content_block_start': {
        const block = event.content_block || {};
        const state = { type: block.type, toolIndex: null, argChars: 0 };
        this.blocks.set(event.index, state);
        if (block.type === 'tool_use') {
          state.toolIndex = this.nextToolIndex++;
          const initial = block.input && Object.keys(block.input).length ? JSON.stringify(block.input) : '';
          state.argChars = initial.length;
          return [this._chunk({
            tool_calls: [{ index: state.toolIndex, id: block.id, type: 'function', function: { name: block.name, arguments: initial } }],
          })];
        }
        if (block.type === 'text' && block.text) return [this._chunk({ content: block.text })];
        return [];
      }
      case 'content_block_delta': {
        const d = event.delta || {};
        const state = this.blocks.get(event.index);
        if (d.type === 'text_delta') return d.text ? [this._chunk({ content: d.text })] : [];
        if (d.type === 'thinking_delta') return d.thinking ? [this._chunk({ reasoning: d.thinking })] : [];
        if (d.type === 'input_json_delta') {
          if (!state || state.toolIndex == null || !d.partial_json) return [];
          state.argChars += d.partial_json.length;
          return [this._chunk({ tool_calls: [{ index: state.toolIndex, function: { arguments: d.partial_json } }] })];
        }
        return [];
      }
      case 'content_block_stop': {
        const state = this.blocks.get(event.index);
        if (state && state.type === 'tool_use' && state.argChars === 0) {
          state.argChars = 2;
          return [this._chunk({ tool_calls: [{ index: state.toolIndex, function: { arguments: '{}' } }] })];
        }
        return [];
      }
      case 'message_delta': {
        if (event.usage) this.usage = { ...this.usage, ...event.usage };
        this.finishReason = mapStopReason(event.delta?.stop_reason) || this.finishReason;
        const chunk = this._chunk({}, { usage: toOpenAIUsage(this.usage) });
        chunk.choices[0].finish_reason = this.finishReason;
        return [chunk];
      }
      case 'message_stop':
        return [{ done: true }];
      case 'error': {
        const err = event.error || {};
        const code = err.type === 'overloaded_error' ? 529
          : err.type === 'api_error' ? 500
            : err.type === 'rate_limit_error' ? 429
              : err.type === 'invalid_request_error' ? 400
                : 500;
        return [{ error: { message: err.message || 'Anthropic stream error', code, type: err.type } }];
      }
      default:
        return []; // ping and unknown events
    }
  }
}

export default {
  toAnthropicRequest,
  fromAnthropicResponse,
  AnthropicStreamTranslator,
  toOpenAIUsage,
  mapStopReason,
};
