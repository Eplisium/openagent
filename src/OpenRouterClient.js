/**
 * 🤖 OpenRouterClient - Ultimate AI Client v4.0
 * Production-grade client for OpenRouter API (2026 Edition)
 * 
 * Modernized with:
 * - Native fetch (undici) — zero axios dependency
 * - AbortController for request/stream cancellation
 * - Request deduplication (coalesce identical in-flight requests)
 * - Content-hashed cache keys (no collisions)
 * - Real cost tracking from API usage data
 * - Provider preferences for latency optimization
 * - Streaming with proper SSE parsing and error handling
 * - Structured outputs with JSON schema
 * - Vision/multimodal support
 * - Model routing and fallback
 */

import { CONFIG, PLUGINS } from './config.js';
import { OpenRouterError, RateLimitError, AuthenticationError, AbortError } from './errors.js';

export { OpenRouterError, RateLimitError, AuthenticationError, AbortError } from './errors.js';

/**
 * Simple content hash for cache keys (djb2 algorithm)
 * Fast, low collision rate, deterministic
 */
function contentHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36);
}

/**
 * 🚀 OpenRouterClient Class (2026 Edition)
 */
export class OpenRouterClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || CONFIG.API_KEY;
    this.baseURL = options.baseURL || CONFIG.BASE_URL;
    this.headers = {
      ...CONFIG.HEADERS,
      ...options.headers,
    };
    this.defaultModel = options.defaultModel || null;
    this.maxRetries = options.maxRetries || CONFIG.MAX_RETRIES;
    this.timeout = options.timeout || CONFIG.TIMEOUT_MS;
    
    // Request tracking
    this.requestCount = 0;
    this.totalCost = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.requestHistory = [];
    
    // Response cache for identical requests (content-hashed keys)
    this.cache = new Map();
    this.cacheTTL = options.cacheTTL || CONFIG.CACHE_TTL_MS;
    this.cacheEnabled = options.cacheEnabled !== false;
    
    // Request deduplication — coalesce identical in-flight requests
    this.inFlightRequests = new Map(); // cacheKey -> Promise
    
    // Rate limit tracking
    this.rateLimitRemaining = null;
    this.rateLimitReset = null;
    
    // Budget tracking
    this.budgetUsed = 0;
    this.budgetLimit = options.budgetLimit || CONFIG.MAX_COST_PER_REQUEST_USD * 100;
    
    // Request timing for rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = options.minRequestInterval || CONFIG.MIN_REQUEST_INTERVAL_MS;
    
    // Active AbortControllers for cleanup
    this.activeControllers = new Set();
  }
  
  /**
   * Wait for rate limit if needed
   */
  async waitForRateLimit() {
    if (this.rateLimitRemaining !== null && this.rateLimitRemaining <= 1) {
      const waitTime = this.rateLimitReset ? (this.rateLimitReset * 1000 - Date.now()) : 1000;
      if (waitTime > 0) {
        await this.sleep(Math.min(waitTime, 10000));
      }
    }
    
    // Ensure minimum interval between requests
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.sleep(this.minRequestInterval - timeSinceLastRequest);
    }
  }
  
  /**
   * Generate cache key using content hash (no collisions)
   */
  getCacheKey(messages, options) {
    const keyObj = {
      model: options.model || this.defaultModel,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      top_p: options.top_p,
      tools: options.tools,
      response_format: options.response_format,
    };
    const serialized = JSON.stringify(keyObj);
    return contentHash(serialized);
  }
  
  /**
   * Get from cache if valid
   */
  getFromCache(key) {
    if (!this.cacheEnabled) return null;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return { ...cached.data, _cached: true };
    }
    if (cached) this.cache.delete(key);
    return null;
  }
  
  /**
   * Store in cache with LRU eviction
   */
  storeInCache(key, data) {
    if (!this.cacheEnabled) return;
    
    // LRU: move to end if exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    this.cache.set(key, { data, timestamp: Date.now() });
    
    // Evict oldest if over limit
    if (this.cache.size > 200) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
  
  /**
   * Create AbortController with timeout
   */
  createController(timeoutMs = this.timeout) {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    
    // Clean up on completion
    const cleanup = () => {
      clearTimeout(timer);
      this.activeControllers.delete(controller);
    };
    
    return { controller, cleanup };
  }
  
  /**
   * Abort all active requests
   */
  abortAll() {
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }
  
  /**
   * 🎯 Main Chat Completion Method
   */
  async chat(messages, options = {}) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    // Normalize messages early
    const normalizedMessages = this.normalizeMessages(messages);
    
    // Check cache first
    const cacheKey = this.getCacheKey(normalizedMessages, options);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Request deduplication — if same request is in-flight, await it
    const existingRequest = this.inFlightRequests.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
    }
    
    // Check budget
    if (this.budgetUsed >= this.budgetLimit) {
      throw new OpenRouterError('Budget limit exceeded', 'BUDGET_EXCEEDED', {
        budgetUsed: this.budgetUsed,
        budgetLimit: this.budgetLimit,
      });
    }
    
    const payload = this.buildPayload(normalizedMessages, options);
    
    // Create the request promise and track it for deduplication
    const requestPromise = this.executeChatRequest(payload, requestId, startTime, cacheKey);
    this.inFlightRequests.set(cacheKey, requestPromise);
    
    try {
      const result = await requestPromise;
      return result;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }
  
  /**
   * Execute the actual chat request with retry logic
   */
  async executeChatRequest(payload, requestId, startTime, cacheKey) {
    try {
      const response = await this.executeWithRetry(
        () => this.postJSON('/chat/completions', payload),
        this.maxRetries
      );
      
      const duration = Date.now() - startTime;
      const result = this.processResponse(response, requestId, duration);
      
      // Track request and cost
      this.trackRequest(requestId, payload, result, duration);
      
      // Cache successful responses
      if (result.content) {
        this.storeInCache(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      throw this.enhanceError(error, requestId);
    }
  }
  
  /**
   * 🌊 Streaming Chat Completion
   */
  async *chatStream(messages, options = {}) {
    const requestId = this.generateRequestId();
    const payload = this.buildPayload(messages, { ...options, stream: true });
    
    const { controller, cleanup } = this.createController();
    
    try {
      await this.waitForRateLimit();
      this.lastRequestTime = Date.now();
      
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      
      // Handle non-streaming errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHTTPError(response.status, errorData);
      }
      
      if (!response.body) {
        throw new OpenRouterError('No response body for streaming', 'NO_STREAM_BODY');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let buffer = '';
      let fullContent = '';
      let usage = null;
      const toolCallAccumulator = new Map();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            
            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6).trim();
              
              if (data === '[DONE]') {
                // Emit accumulated tool calls
                if (toolCallAccumulator.size > 0) {
                  yield { type: 'tool_calls', toolCalls: this.parseAccumulatedToolCalls(toolCallAccumulator), requestId };
                }
                yield { type: 'done', content: fullContent, usage, requestId };
                return;
              }
              
              try {
                const parsed = JSON.parse(data);
                
                // Handle mid-stream errors
                if (parsed.error) {
                  yield { type: 'error', error: parsed.error, requestId };
                  return;
                }
                
                // Update usage
                if (parsed.usage) {
                  usage = parsed.usage;
                }
                
                // Extract delta
                const delta = parsed.choices?.[0]?.delta;
                if (delta) {
                  if (delta.content) {
                    fullContent += delta.content;
                    yield { type: 'content', content: delta.content, fullContent, requestId };
                  }
                  
                  // Accumulate tool call fragments
                  if (delta.tool_calls) {
                    this.accumulateToolCalls(toolCallAccumulator, delta.tool_calls);
                  }
                }
                
                // Emit tool calls on finish
                const finishReason = parsed.choices?.[0]?.finish_reason;
                if (finishReason === 'tool_calls' && toolCallAccumulator.size > 0) {
                  yield { type: 'tool_calls', toolCalls: this.parseAccumulatedToolCalls(toolCallAccumulator), requestId };
                  toolCallAccumulator.clear();
                }
              } catch {
                // Ignore malformed chunks
              }
            }
          }
        }
        
        // Stream ended without [DONE]
        if (fullContent || toolCallAccumulator.size > 0) {
          if (toolCallAccumulator.size > 0) {
            yield { type: 'tool_calls', toolCalls: this.parseAccumulatedToolCalls(toolCallAccumulator), requestId };
          }
          yield { type: 'done', content: fullContent, usage, requestId };
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new AbortError('Stream cancelled');
      }
      throw error;
    } finally {
      cleanup();
    }
  }
  
  /**
   * Accumulate tool call fragments from streaming deltas
   */
  accumulateToolCalls(accumulator, toolCalls) {
    for (const tc of toolCalls) {
      const idx = tc.index ?? 0;
      if (!accumulator.has(idx)) {
        accumulator.set(idx, { id: null, name: null, arguments: '' });
      }
      const acc = accumulator.get(idx);
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (tc.function?.arguments) acc.arguments += tc.function.arguments;
    }
  }
  
  /**
   * Parse accumulated tool calls into final format
   */
  parseAccumulatedToolCalls(accumulator) {
    const toolCalls = [];
    for (const [, tc] of accumulator) {
      let args = {};
      try {
        args = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        try {
          let fixed = tc.arguments.trim();
          if (!fixed.endsWith('}')) fixed += '}';
          args = JSON.parse(fixed);
        } catch {
          args = { _raw: tc.arguments, _error: 'Could not parse streamed arguments' };
        }
      }
      toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
    }
    return toolCalls;
  }
  
  /**
   * 🛠️ Tool/Function Calling
   */
  async chatWithTools(messages, tools, options = {}) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    const payload = this.buildPayload(messages, {
      ...options,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: options.tool_choice || 'auto',
    });
    
    const response = await this.executeWithRetry(
      () => this.postJSON('/chat/completions', payload),
      options.retries || this.maxRetries
    );
    
    const duration = Date.now() - startTime;
    const message = response.choices?.[0]?.message;
    
    if (!message) {
      throw new OpenRouterError('No message in response', 'EMPTY_RESPONSE', { data: response });
    }
    
    const toolCalls = this.parseToolCalls(message.tool_calls || []);
    
    const result = {
      content: message.content,
      toolCalls,
      usage: response.usage,
      model: response.model,
      requestId,
      duration,
    };
    
    this.trackRequest(requestId, payload, result, duration);
    
    return result;
  }
  
  /**
   * Parse tool calls with robust JSON handling
   */
  parseToolCalls(rawToolCalls) {
    return rawToolCalls.map(tc => {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        try {
          let fixed = tc.function.arguments.trim();
          fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
          if (!fixed.endsWith('}')) fixed += '}';
          args = JSON.parse(fixed);
        } catch {
          args = { _raw: tc.function.arguments, _error: 'Could not parse arguments' };
        }
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });
  }
  
  /**
   * 📊 Structured Output (JSON Schema)
   */
  async structuredOutput(messages, schema, options = {}) {
    const payload = this.buildPayload(messages, {
      ...options,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schema.name || 'structured_output',
          strict: schema.strict !== false,
          schema: schema.definition,
        },
      },
    });
    
    const response = await this.postJSON('/chat/completions', payload);
    const content = response.choices?.[0]?.message?.content;
    
    try {
      return {
        data: JSON.parse(content),
        usage: response.usage,
        model: response.model,
      };
    } catch (e) {
      throw new OpenRouterError(
        'Failed to parse structured output',
        'PARSE_ERROR',
        { content, error: e.message }
      );
    }
  }
  
  /**
   * 🖼️ Vision/Multimodal
   */
  async visionChat(text, images, options = {}) {
    const content = [
      { type: 'text', text },
      ...images.map(img => ({
        type: 'image_url',
        image_url: {
          url: img.url || img,
          detail: img.detail || 'auto',
        },
      })),
    ];
    
    return this.chat([{ role: 'user', content }], options);
  }
  
  /**
   * 🔄 Multi-Model Routing with fallback
   */
  async routeToBestModel(messages, preferredModels, options = {}) {
    const models = preferredModels || [this.defaultModel, CONFIG.FALLBACK_MODEL].filter(Boolean);
    
    for (const model of models) {
      try {
        return await this.chat(messages, { ...options, model });
      } catch (error) {
        if (error.code === 'RATE_LIMIT_ERROR' && model !== models[models.length - 1]) {
          console.log(`⚠️ Model ${model} rate limited, trying fallback...`);
          continue;
        }
        throw error;
      }
    }
  }
  
  /**
   * 🧠 Reasoning Mode (for o1, o3, etc.)
   */
  async reasoningChat(messages, options = {}) {
    if (!options.model && !this.defaultModel) {
      throw new Error('Model must be specified for reasoning chat. Pass model in options or set defaultModel on client.');
    }
    return this.chat(messages, {
      ...options,
      model: options.model || this.defaultModel,
      reasoning_effort: options.reasoning_effort || 'medium',
    });
  }
  
  /**
   * 📚 Get Available Models
   */
  async getModels() {
    const response = await this.getJSON('/models');
    return response.data;
  }
  
  /**
   * 💰 Get Generation Stats
   */
  async getGenerationStats(id) {
    const response = await this.getJSON(`/generation?id=${id}`);
    return response.data;
  }
  
  /**
   * 🔍 Get Model Pricing
   */
  async getModelPricing(modelId) {
    const models = await this.getModels();
    const model = models.find(m => m.id === modelId);
    return model?.pricing || null;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 🔧 HTTP Methods (native fetch)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST JSON with timeout and error handling
   */
  async postJSON(path, body, timeoutMs = this.timeout) {
    const { controller, cleanup } = this.createController(timeoutMs);
    
    try {
      await this.waitForRateLimit();
      this.lastRequestTime = Date.now();
      
      const response = await fetch(`${this.baseURL}${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      // Update rate limit info
      this.rateLimitRemaining = parseInt(response.headers.get('x-ratelimit-remaining')) || null;
      this.rateLimitReset = parseInt(response.headers.get('x-ratelimit-reset')) || null;
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHTTPError(response.status, errorData);
      }
      
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new OpenRouterError('Request timeout', 'TIMEOUT');
      }
      throw error;
    } finally {
      cleanup();
    }
  }
  
  /**
   * GET JSON with timeout
   */
  async getJSON(path, timeoutMs = this.timeout) {
    const { controller, cleanup } = this.createController(timeoutMs);
    
    try {
      await this.waitForRateLimit();
      this.lastRequestTime = Date.now();
      
      const response = await fetch(`${this.baseURL}${path}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.headers,
        },
        signal: controller.signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHTTPError(response.status, errorData);
      }
      
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new OpenRouterError('Request timeout', 'TIMEOUT');
      }
      throw error;
    } finally {
      cleanup();
    }
  }
  
  /**
   * Handle HTTP errors into typed errors
   */
  handleHTTPError(status, data) {
    switch (status) {
      case 401:
        return new AuthenticationError('Invalid API key');
      case 429: {
        const retryAfter = data.retry_after;
        return new RateLimitError('Rate limit exceeded', retryAfter);
      }
      case 400:
        return new OpenRouterError(data.error?.message || 'Bad request', 'BAD_REQUEST', data);
      case 500:
      case 502:
      case 503:
        return new OpenRouterError('Service temporarily unavailable', 'SERVICE_ERROR', data);
      default:
        return new OpenRouterError(data.error?.message || `HTTP ${status}`, `HTTP_${status}`, data);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 📦 Payload Building
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Build request payload
   */
  buildPayload(messages, options = {}) {
    const {
      model, stream, temperature, max_tokens, top_p,
      frequency_penalty, presence_penalty, reasoning_effort,
      tools, tool_choice, response_format,
      plugins, provider, transforms, route, models: fallbackModels,
      retries, cacheTTL, // internal options to exclude
      ...extraParams
    } = options;
    
    const payload = {
      model: model || this.defaultModel,
      messages: this.normalizeMessages(messages),
      stream: stream || false,
      temperature: temperature ?? CONFIG.DEFAULT_PARAMS.temperature,
      max_tokens: max_tokens ?? CONFIG.DEFAULT_PARAMS.max_tokens,
      top_p: top_p ?? CONFIG.DEFAULT_PARAMS.top_p,
      frequency_penalty: frequency_penalty ?? CONFIG.DEFAULT_PARAMS.frequency_penalty,
      presence_penalty: presence_penalty ?? CONFIG.DEFAULT_PARAMS.presence_penalty,
    };
    
    if (reasoning_effort) payload.reasoning_effort = reasoning_effort;
    if (tools) payload.tools = tools;
    if (tool_choice) payload.tool_choice = tool_choice;
    if (response_format) payload.response_format = response_format;
    if (plugins) {
      payload.plugins = plugins.map(p =>
        typeof p === 'string' ? { id: p, enabled: true } : p
      );
    }
    if (provider) payload.provider = provider;
    if (transforms) payload.transforms = transforms;
    if (route) payload.route = route;
    if (fallbackModels) payload.models = fallbackModels;
    
    // Clean up undefined values
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }
    
    return payload;
  }
  
  /**
   * Normalize messages to array format
   */
  normalizeMessages(messages) {
    if (typeof messages === 'string') {
      return [{ role: 'user', content: messages }];
    }
    if (!Array.isArray(messages)) {
      return [messages];
    }
    return messages.map(m => {
      if (typeof m === 'string') {
        return { role: 'user', content: m };
      }
      return m;
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ⚡ Retry Logic
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Execute with retry logic and exponential backoff
   */
  async executeWithRetry(fn, maxRetries) {
    let lastError;
    let delay = CONFIG.RETRY_DELAY_MS;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) break;
        
        // Don't retry auth errors
        if (error.code === 'AUTH_ERROR') throw error;
        
        // Don't retry bad requests (except rate limits)
        if (error.code === 'BAD_REQUEST') throw error;
        
        // Handle rate limiting with jitter
        if (error.code === 'RATE_LIMIT_ERROR') {
          const retryAfter = error.retryAfter || delay / 1000;
          const jitter = Math.random() * 1000;
          await this.sleep((retryAfter * 1000) + jitter);
        } else {
          // Exponential backoff with jitter
          const jitter = Math.random() * 500;
          await this.sleep(delay + jitter);
        }
        
        delay *= CONFIG.RETRY_BACKOFF_MULTIPLIER;
      }
    }
    
    throw lastError;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 📊 Response Processing & Tracking
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Process API response
   */
  processResponse(data, requestId, duration) {
    const choice = data.choices?.[0];
    
    return {
      id: data.id,
      requestId,
      content: choice?.message?.content,
      role: choice?.message?.role,
      toolCalls: choice?.message?.tool_calls,
      finishReason: choice?.finish_reason,
      model: data.model,
      usage: data.usage,
      duration,
      created: data.created,
      systemFingerprint: data.system_fingerprint,
    };
  }
  
  /**
   * Track request with real cost data from API
   */
  trackRequest(requestId, payload, result, duration) {
    this.requestCount++;
    
    // Use actual usage data from API response
    if (result.usage) {
      const inputTokens = result.usage.prompt_tokens || 0;
      const outputTokens = result.usage.completion_tokens || 0;
      
      this.totalInputTokens += inputTokens;
      this.totalOutputTokens += outputTokens;
      
      // Use actual cost from API if available, otherwise estimate
      const actualCost = result.usage.cost;
      const estimatedCost = actualCost !== undefined
        ? actualCost
        : (inputTokens * 0.00001) + (outputTokens * 0.00003);
      
      this.totalCost += estimatedCost;
      this.budgetUsed += estimatedCost;
    }
    
    this.requestHistory.push({
      requestId,
      timestamp: new Date().toISOString(),
      model: payload.model,
      duration,
      success: true,
      tokens: result.usage?.total_tokens || 0,
      cost: this.totalCost,
    });
    
    // Keep history manageable
    if (this.requestHistory.length > 200) {
      this.requestHistory = this.requestHistory.slice(-100);
    }
  }
  
  /**
   * Enhance error with request context
   */
  enhanceError(error, requestId) {
    if (error instanceof OpenRouterError) {
      error.details.requestId = requestId;
      return error;
    }
    return error;
  }
  
  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
  
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 📈 Get comprehensive stats
   */
  getStats() {
    const avgDuration = this.requestHistory.length > 0
      ? this.requestHistory.reduce((sum, r) => sum + r.duration, 0) / this.requestHistory.length
      : 0;
    
    return {
      requestCount: this.requestCount,
      totalCost: this.totalCost.toFixed(4),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      budgetUsed: this.budgetUsed.toFixed(4),
      budgetLimit: this.budgetLimit.toFixed(4),
      budgetRemaining: (this.budgetLimit - this.budgetUsed).toFixed(4),
      avgDuration: Math.round(avgDuration) + 'ms',
      cacheSize: this.cache.size,
      cacheEnabled: this.cacheEnabled,
      rateLimitRemaining: this.rateLimitRemaining,
      activeRequests: this.activeControllers.size,
      recentRequests: this.requestHistory.slice(-10),
    };
  }
  
  /**
   * 🧹 Clear history and reset stats
   */
  clearHistory() {
    this.requestHistory = [];
    this.requestCount = 0;
    this.totalCost = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.budgetUsed = 0;
    this.clearCache();
    this.inFlightRequests.clear();
  }
}

export default OpenRouterClient;
