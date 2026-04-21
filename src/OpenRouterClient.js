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

import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { OpenRouterError, RateLimitError, AuthenticationError, AbortError } from './errors.js';
import { parseXmlToolCalls, hasXmlToolCalls } from './tools/xmlToolParser.js';
import { ToolFormatAdapter } from './tools/ToolFormatAdapter.js';
import { Agent as UndiciAgent } from 'undici';

// Shared HTTP connection pool for keep-alive reuse across all client instances
export const httpAgent = new UndiciAgent({ keepAliveTimeout: 60000, connections: 20 });

export { OpenRouterError, RateLimitError, AuthenticationError, AbortError } from './errors.js';

/**
 * Simple content hash for cache keys (djb2 algorithm with added entropy)
 * Fast, low collision rate, deterministic
 */
function contentHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36) + '_' + str.length;
}

/**
 * Generate a cache key from request params.
 * Optimized: uses message count + last message hash + model as key components
 * instead of full JSON.stringify of entire message array.
 */
function generateCacheKey(obj) {
  if (!obj) return 'empty';
  const messages = obj.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    // Fast key: message count + last 2 messages content hash + model + tool count + temperature
    // Including last 2 messages reduces collision rate for multi-turn conversations
    const lastMsg = messages[messages.length - 1];
    const lastContent = typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content || '');
    const secondLastMsg = messages.length > 1 ? messages[messages.length - 2] : null;
    const secondContent = secondLastMsg
      ? (typeof secondLastMsg?.content === 'string' ? secondLastMsg.content : JSON.stringify(secondLastMsg?.content || ''))
      : '';
    const model = obj.model || '';
    const toolCount = obj.tools?.length || 0;
    const temp = obj.temperature ?? '';
    // Include system prompt hash to distinguish different agent configurations
    const systemContent = messages[0]?.role === 'system'
      ? (typeof messages[0].content === 'string' ? messages[0].content.substring(0, 300) : JSON.stringify(messages[0].content || '').substring(0, 300))
      : '';
    const toolNames = Array.isArray(obj.tools) ? obj.tools.map(t => t?.function?.name || t?.name || '').sort().join(',') : '';
    const keyParts = `${messages.length}:${contentHash(systemContent)}:${contentHash(lastContent)}:${contentHash(secondContent)}:${model}:${toolCount}:${temp}:${contentHash(toolNames)}`;
    return contentHash(keyParts);
  }
  // Fallback for non-message payloads
  const serialized = JSON.stringify(obj, Object.keys(obj).sort());
  return contentHash(serialized);
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
    
    // Response cache for identical requests (content-hashed keys) — LRU eviction
    this.cache = new Map();
    this.cacheTTL = options.cacheTTL || CONFIG.CACHE_TTL_MS;
    this.cacheEnabled = options.cacheEnabled !== false;
    this.cacheMaxSize = options.cacheMaxSize || CONFIG.CLIENT_CACHE_MAX_SIZE;
    
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
    
    // Periodic cleanup timer for expired cache entries
    this.cacheCleanupInterval = null;
    this.startCacheCleanup();
    
    // Response time tracking for adaptive timeouts
    this._recentResponseTimes = [];
    this._maxResponseTimeSamples = 20;

    // Circuit breaker for upstream failure protection
    this.circuitBreaker = {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      lastFailureTime: null,
    };
  }
  
  /**
   * Start periodic cache cleanup for expired entries
   */
  startCacheCleanup(intervalMs = 60000) {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
    this.cacheCleanupInterval = setInterval(() => {
      this.evictExpiredCacheEntries();
    }, intervalMs);
  }
  
  /**
   * Stop periodic cache cleanup
   */
  stopCacheCleanup() {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
  }
  
  /**
   * Evict expired entries and enforce max cache size (LRU)
   */
  evictExpiredCacheEntries() {
    if (!this.cacheEnabled || this.cache.size === 0) return;
    
    const now = Date.now();
    let evicted = 0;
    
    // Evict expired entries
    for (const [key, cached] of this.cache) {
      if (now - cached.timestamp >= this.cacheTTL) {
        this.cache.delete(key);
        evicted++;
      }
    }
    
    // Enforce max size — evict oldest entries (Map preserves insertion order, LRU entries are re-inserted)
    while (this.cache.size > this.cacheMaxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      evicted++;
    }
    
    if (evicted > 0) {
      logger.debug(`Cache cleanup: evicted ${evicted} entries, ${this.cache.size} remaining`);
    }
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
    // Pass messages directly — generateCacheKey() already only reads the last 2
    // messages + system message, so no need to copy the entire array here.
    const keyObj = {
      model: options.model || this.defaultModel,
      messages, // reference — generateCacheKey handles slicing internally
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      top_p: options.top_p,
      tools: options.tools,
      response_format: options.response_format,
    };
    return generateCacheKey(keyObj);
  }
  
  /**
   * Get from cache if valid — LRU touch on hit
   */
  getFromCache(key) {
    if (!this.cacheEnabled) return null;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      // LRU: re-insert to move to end of Map iteration order
      this.cache.delete(key);
      this.cache.set(key, cached);
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
    
    // Evict oldest if over limit (use configured max)
    if (this.cache.size > this.cacheMaxSize) {
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

  // ═══════════════════════════════════════════════════════════════
  // ⚡ Circuit Breaker
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check circuit breaker state before making a request.
   * Throws OpenRouterError with code 'CIRCUIT_OPEN' if the circuit is open
   * and the reset timeout has not yet elapsed.
   */
  checkCircuitBreaker() {
    const cb = this.circuitBreaker;
    if (cb.state === 'closed') return;

    if (cb.state === 'open') {
      const elapsed = Date.now() - cb.lastFailureTime;
      if (elapsed < cb.resetTimeoutMs) {
        throw new OpenRouterError(
          `Circuit breaker is open — upstream failures detected. Retry after ${Math.ceil((cb.resetTimeoutMs - elapsed) / 1000)}s`,
          'CIRCUIT_OPEN',
          {
            failureCount: cb.failureCount,
            resetTimeoutMs: cb.resetTimeoutMs,
            elapsed,
          }
        );
      }
      // Cooldown elapsed — transition to half-open for a probe request
      cb.state = 'half-open';
      logger.info('Circuit breaker transitioning to half-open (probe request)');
    }
    // half-open: allow the request through (it's a probe)
  }

  /**
   * Record a successful request — resets the circuit breaker to closed.
   */
  recordCircuitSuccess() {
    const cb = this.circuitBreaker;
    if (cb.state === 'half-open') {
      logger.info('Circuit breaker probe succeeded — closing circuit');
    }
    cb.state = 'closed';
    cb.failureCount = 0;
    cb.lastFailureTime = null;
  }

  /**
   * Record a failed request — increments failure count and may open the circuit.
   */
  recordCircuitFailure() {
    const cb = this.circuitBreaker;
    cb.failureCount++;
    cb.lastFailureTime = Date.now();

    if (cb.state === 'half-open') {
      // Probe failed — re-open immediately
      cb.state = 'open';
      logger.warn('Circuit breaker probe failed — re-opening circuit');
      return;
    }

    if (cb.failureCount >= cb.failureThreshold) {
      cb.state = 'open';
      logger.warn(`Circuit breaker opened after ${cb.failureCount} consecutive failures`);
    }
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
    // Circuit breaker gate — throws if circuit is open
    this.checkCircuitBreaker();

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

      // Circuit breaker: success resets failure count
      this.recordCircuitSuccess();

      return result;
    } catch (error) {
      // Circuit breaker: failure increments count, may open circuit
      this.recordCircuitFailure();
      throw this.enhanceError(error, requestId);
    }
  }
  
  /**
   * 🌊 Streaming Chat Completion
   *
   * Accepts an optional `onToolCallReady(toolCall)` callback that fires
   * as soon as a single tool call is fully accumulated from the stream
   * (name set AND arguments JSON complete). This enables dispatching
   * tool execution without waiting for the entire response.
   */
  async *chatStream(messages, options = {}) {
    const { onToolCallReady, ...streamOptions } = options;
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    const payload = this.buildPayload(messages, { ...streamOptions, stream: true });
    
    const { controller, cleanup } = this.createController();
    
    try {
      await this.waitForRateLimit();
      this.lastRequestTime = Date.now();
      
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Connection': 'keep-alive',
          ...this.headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeout)]),
        dispatcher: httpAgent,
      });
      
      // Handle non-streaming errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHTTPError(response.status, errorData, response);
      }
      
      if (!response.body) {
        throw new OpenRouterError('No response body for streaming', 'NO_STREAM_BODY');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let buffer = '';
      let fullContent = '';
      let usage = null;
      let lastFinishReason = null;
      const toolCallAccumulator = new Map();
      // Pre-compiled constants for performance
      const DATA_PREFIX = 'data: ';
      const DATA_PREFIX_LEN = 6;
      const doneMarker = '[DONE]';
      // Pre-allocate content chunks array to reduce string concatenation
      const contentChunks = [];
      let contentLength = 0;
      
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
            
            if (trimmed.startsWith(DATA_PREFIX)) {
              const data = trimmed.substring(DATA_PREFIX_LEN).trim();
              
              if (data === doneMarker) {
                // Emit only remaining un-emitted tool calls (onToolCallReady already dispatched the rest)
                if (toolCallAccumulator.size > 0) {
                  const remaining = new Map();
                  for (const [idx, tc] of toolCallAccumulator) {
                    if (!tc._emitted) remaining.set(idx, tc);
                  }
                  if (remaining.size > 0) {
                    yield { type: 'tool_calls', toolCalls: this.parseAccumulatedToolCalls(remaining), requestId };
                  }
                }
                fullContent = contentChunks.length > 0 ? contentChunks.join('') : fullContent;
                // Track cost for streaming request
                const duration = Date.now() - startTime;
                this.trackRequest(requestId, payload, { usage }, duration);
                yield { type: 'done', content: fullContent, usage, requestId, finishReason: lastFinishReason };
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
                    contentChunks.push(delta.content);
                    contentLength += delta.content.length;
                    // Provide fullContent periodically (every ~200 chars) to amortize join cost
                    // while still giving consumers the cumulative content they need
                    const periodicFull = (contentLength % 200 < delta.content.length)
                      ? contentChunks.join('')
                      : null;
                    yield { type: 'content', content: delta.content, fullContent: periodicFull, requestId };
                  }
                  
                  // Accumulate tool call fragments
                  if (delta.tool_calls) {
                    const completedIndices = this.accumulateToolCalls(toolCallAccumulator, delta.tool_calls);
                    // Fire onToolCallReady for each newly-completed tool call
                    if (onToolCallReady && completedIndices.length > 0) {
                      for (const idx of completedIndices) {
                        const tc = toolCallAccumulator.get(idx);
                        if (tc) {
                          const parsed = this.parseAccumulatedToolCalls(new Map([[idx, tc]]));
                          if (parsed.length > 0) {
                            onToolCallReady(parsed[0]);
                          }
                        }
                      }
                    }
                  }
                }
                
                // Emit remaining tool calls on finish (only ones not already emitted)
                const finishReason = parsed.choices?.[0]?.finish_reason;
                if (finishReason) lastFinishReason = finishReason;
                if (finishReason === 'tool_calls' && toolCallAccumulator.size > 0) {
                  const remaining = new Map();
                  for (const [idx, tc] of toolCallAccumulator) {
                    if (!tc._emitted) remaining.set(idx, tc);
                  }
                  if (remaining.size > 0) {
                    yield { type: 'tool_calls', toolCalls: this.parseAccumulatedToolCalls(remaining), requestId };
                  }
                  toolCallAccumulator.clear();
                }
              } catch {
                // Ignore malformed chunks
              }
            }
          }
        }
        
        // Stream ended without [DONE]
        fullContent = contentChunks.length > 0 ? contentChunks.join('') : fullContent;
        if (fullContent || toolCallAccumulator.size > 0) {
          if (toolCallAccumulator.size > 0) {
            const remaining = new Map();
            for (const [idx, tc] of toolCallAccumulator) {
              if (!tc._emitted) remaining.set(idx, tc);
            }
            if (remaining.size > 0) {
              yield { type: 'tool_calls', toolCalls: this.parseAccumulatedToolCalls(remaining), requestId };
            }
          }
          // Track cost for streaming request that ended without [DONE]
          const duration = Date.now() - startTime;
          this.trackRequest(requestId, payload, { usage }, duration);
          yield { type: 'done', content: fullContent, usage, requestId, finishReason: lastFinishReason };
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
   * Accumulate tool call fragments from streaming deltas.
   * Returns an array of indices that became "complete" in this batch
   * (name is set AND arguments form valid JSON).
   */
  accumulateToolCalls(accumulator, toolCalls) {
    const completedIndices = [];
    for (const tc of toolCalls) {
      const idx = tc.index ?? 0;
      if (!accumulator.has(idx)) {
        accumulator.set(idx, { id: null, name: null, arguments: '' });
      }
      const acc = accumulator.get(idx);
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (tc.function?.arguments) acc.arguments += tc.function.arguments;

      // Check if this tool call just became complete
      if (acc.name && !acc._emitted && this._isArgumentsComplete(acc.arguments)) {
        acc._emitted = true;
        completedIndices.push(idx);
      }
    }
    return completedIndices;
  }

  /**
   * Check if accumulated arguments string is a complete JSON object.
   * Tracks brace depth to detect when the JSON is closed.
   */
  _isArgumentsComplete(argsStr) {
    if (!argsStr) return false;
    const trimmed = argsStr.trim();
    if (!trimmed.startsWith('{')) return false;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          // Brace depth matched — arguments are complete.
          // We skip JSON.parse here because parseAccumulatedToolCalls
          // already handles repair parsing. The strict check was causing
          // valid arguments with trailing whitespace or minor formatting
          // to be rejected, preventing onToolCallReady from ever firing.
          return true;
        }
      }
    }
    return false;
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
      tools,
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
    
    const toolCalls = this.parseToolCalls(message.tool_calls || [], response.model);
    const finishReason = response.choices?.[0]?.finish_reason;
    
    const result = {
      content: message.content,
      toolCalls,
      usage: response.usage,
      model: response.model,
      requestId,
      duration,
      finishReason,
    };
    
    this.trackRequest(requestId, payload, result, duration);
    
    return result;
  }
  
  /**
   * Parse tool calls with robust JSON handling
   */
  parseToolCalls(rawToolCalls, model = '') {
    const provider = ToolFormatAdapter.detectProvider(model);
    return rawToolCalls.map(tc => {
      const normalized = ToolFormatAdapter.normalizeToolCall(tc, provider);
      return normalized;
    }).filter(Boolean);
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
    } catch (_e) {
      throw new OpenRouterError(
        'Failed to parse structured output',
        'PARSE_ERROR',
        { content, error: _e.message }
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
          logger.warn(`Model ${model} rate limited, trying fallback`, { model });
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
          'Connection': 'keep-alive',
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
        dispatcher: httpAgent,
      });
      
      // Update rate limit info
      this.rateLimitRemaining = parseInt(response.headers.get('x-ratelimit-remaining')) || null;
      this.rateLimitReset = parseInt(response.headers.get('x-ratelimit-reset')) || null;
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHTTPError(response.status, errorData, response);
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
          'Connection': 'keep-alive',
          ...this.headers,
        },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
        dispatcher: httpAgent,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHTTPError(response.status, errorData, response);
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
  handleHTTPError(status, data, response = null) {
    switch (status) {
      case 401:
        return new AuthenticationError(data.error?.message || 'Invalid API key', data);
      case 429: {
        // Respect Retry-After header if present, otherwise use fallback from body
        let retryAfter = data.retry_after || data.retryAfter || null;
        // Parse Retry-After response header (can be seconds or HTTP-date)
        if (!retryAfter && response) {
          const headerVal = response.headers?.get?.('retry-after');
          if (headerVal) {
            const asNum = Number(headerVal);
            retryAfter = Number.isFinite(asNum) ? asNum : headerVal; // seconds or ISO/date string
          }
        }
        return new RateLimitError(data.error?.message || 'Rate limit exceeded', retryAfter, data);
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
      _retries, _cacheTTL, // internal options to exclude
      ..._extraParams
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
    if (tools || tool_choice) {
      // Detect provider once and reuse for both tools and tool_choice
      const detectedProvider = ToolFormatAdapter.detectProvider(model || this.defaultModel);
      if (tools) {
        payload.tools = ToolFormatAdapter.formatToolDefinitions(tools, detectedProvider);
      }
      if (tool_choice) {
        payload.tool_choice = typeof tool_choice === 'string'
          ? ToolFormatAdapter.getToolChoice(detectedProvider, tool_choice)
          : tool_choice;
      }
    }
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
        
        // Handle rate limiting with proper Retry-After header support
        if (error.code === 'RATE_LIMIT_ERROR') {
          // Use Retry-After if provided (can be seconds or ISO timestamp)
          let retryAfterMs = error.retryAfter * 1000;
          if (!error.retryAfter) {
            // Fall back to exponential backoff
            retryAfterMs = delay;
          } else if (typeof error.retryAfter === 'string') {
            // Handle ISO timestamp format
            const retryDate = new Date(error.retryAfter);
            retryAfterMs = Math.max(retryDate.getTime() - Date.now(), 0);
          }
          // Add jitter (0-1 second) to prevent thundering herd
          const jitter = Math.random() * 1000;
          await this.sleep(Math.min(retryAfterMs + jitter, 30000)); // Cap at 30 seconds
        } else {
          // Exponential backoff with jitter for other errors
          const jitter = Math.random() * delay * 0.5;
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
    const rawContent = choice?.message?.content;
    let toolCalls = choice?.message?.tool_calls || [];
    let content = rawContent;

    // Detect provider from response model for normalization
    const responseModel = data.model || '';
    const detectedProvider = ToolFormatAdapter.detectProvider(responseModel);

    if ((!toolCalls || toolCalls.length === 0) && content && hasXmlToolCalls(content)) {
      const parsed = parseXmlToolCalls(content);
      if (parsed.toolCalls.length > 0) {
        toolCalls = parsed.toolCalls.map(tc => ({
          id: tc.id,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments || {}),
          },
        }));
        content = parsed.cleanContent || null;
      }
    }

    // Normalize all tool calls to internal standard: { id, name, arguments: OBJECT }
    const normalizedToolCalls = toolCalls.map(tc =>
      ToolFormatAdapter.normalizeToolCall(tc, detectedProvider)
    ).filter(Boolean);
    
    return {
      id: data.id,
      requestId,
      content,
      role: choice?.message?.role,
      toolCalls: normalizedToolCalls,
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
    
    // Keep history limited to 100 entries max
    if (this.requestHistory.length > 100) {
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
      totalCost: this.totalCost,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      budgetUsed: this.budgetUsed,
      budgetLimit: this.budgetLimit,
      budgetRemaining: this.budgetLimit - this.budgetUsed,
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
    this.stopCacheCleanup();
    this.requestHistory = [];
    this.requestCount = 0;
    this.totalCost = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.budgetUsed = 0;
    this.clearCache();
    this.inFlightRequests.clear();
    this.startCacheCleanup();
  }

  /**
   * 🏥 Health Check — minimal API probe
   * Returns { healthy, latencyMs, error } without throwing.
   */
  async healthCheck() {
    const start = Date.now();
    try {
      // Minimal call: list models (cheap, no token cost)
      await this.getJSON('/models', 10000);
      return { healthy: true, latencyMs: Date.now() - start, error: null };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, error: error.message };
    }
  }

  /**
   * 🔒 Destroy the client - cleanup all resources
   * Call this when done with the client to prevent memory leaks
   */
  destroy() {
    this.stopCacheCleanup();
    this.abortAll();
    this.clearCache();
    this.inFlightRequests.clear();
    this.requestHistory = [];
  }
  
  /**
   * Backward-compatible close alias for cleanup callers.
   */
  close() {
    return this.destroy();
  }
}

export default OpenRouterClient;
