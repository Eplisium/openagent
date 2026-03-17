/**
 * 🤖 OpenRouterClient - Ultimate AI Client v3.0
 * Full-featured client for OpenRouter API with 2026 capabilities
 * 
 * Features:
 * - Automatic retry with exponential backoff
 * - Request/response caching
 * - Rate limit handling
 * - Cost tracking and budget controls
 * - Streaming support
 * - Tool calling
 * - Vision/multimodal support
 * - Structured output
 * - Model routing and fallback
 */

import axios from 'axios';
import { CONFIG, PLUGINS } from './config.js';

/**
 * Custom Error Classes
 */
export class OpenRouterError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class RateLimitError extends OpenRouterError {
  constructor(message, retryAfter) {
    super(message, 'RATE_LIMIT_ERROR', { retryAfter });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class AuthenticationError extends OpenRouterError {
  constructor(message) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

/**
 * 🚀 OpenRouterClient Class
 */
export class OpenRouterClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || CONFIG.API_KEY;
    this.baseURL = options.baseURL || CONFIG.BASE_URL;
    this.headers = {
      ...CONFIG.HEADERS,
      ...options.headers,
    };
    this.defaultModel = options.defaultModel || CONFIG.DEFAULT_MODEL;
    this.maxRetries = options.maxRetries || CONFIG.MAX_RETRIES;
    this.timeout = options.timeout || CONFIG.TIMEOUT_MS;
    
    // Request tracking
    this.requestCount = 0;
    this.totalCost = 0;
    this.requestHistory = [];
    
    // Response cache for identical requests
    this.cache = new Map();
    this.cacheTTL = options.cacheTTL || 5 * 60 * 1000; // 5 minutes default
    this.cacheEnabled = options.cacheEnabled !== false;
    
    // Rate limit tracking
    this.rateLimitRemaining = null;
    this.rateLimitReset = null;
    
    // Budget tracking
    this.budgetUsed = 0;
    this.budgetLimit = options.budgetLimit || CONFIG.MAX_COST_PER_REQUEST_USD * 100;
    
    // Request queue for rate limiting
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.minRequestInterval = options.minRequestInterval || 100; // ms between requests
    this.lastRequestTime = 0;
    
    // Initialize axios instance
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...this.headers,
      },
    });
    
    // Add request interceptor for rate limiting
    this.client.interceptors.request.use(
      async (config) => {
        await this.waitForRateLimit();
        this.lastRequestTime = Date.now();
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    // Add response interceptor for error handling and rate limit tracking
    this.client.interceptors.response.use(
      (response) => {
        // Update rate limit info from headers
        this.rateLimitRemaining = parseInt(response.headers['x-ratelimit-remaining']) || null;
        this.rateLimitReset = parseInt(response.headers['x-ratelimit-reset']) || null;
        return response;
      },
      (error) => this.handleError(error)
    );
  }
  
  /**
   * Wait for rate limit if needed
   */
  async waitForRateLimit() {
    if (this.rateLimitRemaining !== null && this.rateLimitRemaining <= 1) {
      const waitTime = this.rateLimitReset ? (this.rateLimitReset * 1000 - Date.now()) : 1000;
      if (waitTime > 0) {
        await this.sleep(Math.min(waitTime, 10000)); // Max 10s wait
      }
    }
    
    // Ensure minimum interval between requests
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.sleep(this.minRequestInterval - timeSinceLastRequest);
    }
  }
  
  /**
   * Generate cache key for a request
   */
  getCacheKey(messages, options) {
    const key = {
      model: options.model || this.defaultModel,
      messages: messages.map(m => ({ role: m.role, content: m.content?.substring(0, 100) })),
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    };
    return JSON.stringify(key);
  }
  
  /**
   * Get from cache if valid
   */
  getFromCache(key) {
    if (!this.cacheEnabled) return null;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }
  
  /**
   * Store in cache
   */
  storeInCache(key, data) {
    if (!this.cacheEnabled) return;
    this.cache.set(key, { data, timestamp: Date.now() });
    
    // Limit cache size
    if (this.cache.size > 100) {
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
   * 🎯 Main Chat Completion Method
   */
  async chat(messages, options = {}) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    // Check cache first
    const cacheKey = this.getCacheKey(messages, options);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return { ...cached, _cached: true };
    }
    
    // Check budget
    if (this.budgetUsed >= this.budgetLimit) {
      throw new OpenRouterError('Budget limit exceeded', 'BUDGET_EXCEEDED', {
        budgetUsed: this.budgetUsed,
        budgetLimit: this.budgetLimit,
      });
    }
    
    const payload = this.buildPayload(messages, options);
    
    try {
      const response = await this.executeWithRetry(
        () => this.client.post('/chat/completions', payload),
        options.retries || this.maxRetries
      );
      
      const duration = Date.now() - startTime;
      const result = this.processResponse(response.data, requestId, duration);
      
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
    
    const response = await this.client.post('/chat/completions', payload, {
      responseType: 'stream',
    });
    
    let buffer = '';
    let fullContent = '';
    let usage = null;
    
    for await (const chunk of response.data) {
      const lines = chunk.toString().split('\n');
      
      for (const line of lines) {
        if (line.trim() === '') continue;
        if (line.startsWith(':')) continue; // SSE comment
        
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') {
            yield { type: 'done', content: fullContent, usage };
            return;
          }
          
          try {
            const parsed = JSON.parse(data);
            
            // Handle usage info in stream
            if (parsed.usage) {
              usage = parsed.usage;
            }
            
            // Extract delta content
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              if (delta.content) {
                fullContent += delta.content;
                yield {
                  type: 'content',
                  content: delta.content,
                  fullContent,
                  requestId,
                };
              }
              
              // Handle tool calls in stream
              if (delta.tool_calls) {
                yield {
                  type: 'tool_calls',
                  toolCalls: delta.tool_calls,
                  requestId,
                };
              }
            }
          } catch (e) {
            // Ignore parse errors for malformed chunks
          }
        }
      }
    }
  }

  /**
   * 🛠️ Tool/Function Calling
   */
  async chatWithTools(messages, tools, options = {}) {
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
    
    const response = await this.client.post('/chat/completions', payload);
    const data = response.data;
    
    const message = data.choices[0]?.message;
    
    const toolCalls = (message?.tool_calls || []).map(tc => {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch (e) {
        // Handle truncated/malformed JSON from model
        console.warn(`Warning: Could not parse arguments for ${tc.function.name}, attempting recovery`);
        try {
          // Try to fix common issues: trailing commas, missing closing braces
          let fixed = tc.function.arguments.trim();
          if (!fixed.endsWith('}')) fixed += '}';
          args = JSON.parse(fixed);
        } catch {
          args = { _raw: tc.function.arguments, _error: 'Could not parse arguments' };
        }
      }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: args,
      };
    });
    
    return {
      content: message?.content,
      toolCalls,
      usage: data.usage,
      model: data.model,
    };
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
    
    const response = await this.client.post('/chat/completions', payload);
    const content = response.data.choices[0]?.message?.content;
    
    try {
      return {
        data: JSON.parse(content),
        usage: response.data.usage,
        model: response.data.model,
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
   * 🔄 Multi-Model Routing
   */
  async routeToBestModel(messages, preferredModels, options = {}) {
    const models = preferredModels || [this.defaultModel, CONFIG.FALLBACK_MODEL];
    
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
   * 🧠 Reasoning Mode (for reasoning models like o1, o3)
   */
  async reasoningChat(messages, options = {}) {
    return this.chat(messages, {
      ...options,
      model: options.model || 'openai/o1',
      reasoning_effort: options.reasoning_effort || 'medium',
    });
  }

  /**
   * 📚 Get Available Models
   */
  async getModels() {
    const response = await this.client.get('/models');
    return response.data.data;
  }

  /**
   * 💰 Get Generation Stats
   */
  async getGenerationStats(id) {
    const response = await this.client.get(`/generation?id=${id}`);
    return response.data.data;
  }

  /**
   * 🔍 Get Model Pricing
   */
  async getModelPricing(modelId) {
    const models = await this.getModels();
    const model = models.find(m => m.id === modelId);
    return model?.pricing || null;
  }

  /**
   * 🏷️ Build Request Payload
   */
  buildPayload(messages, options = {}) {
    const payload = {
      model: options.model || this.defaultModel,
      messages: this.normalizeMessages(messages),
      stream: options.stream || false,
      ...CONFIG.DEFAULT_PARAMS,
      ...options,
    };
    
    // Add plugins if specified
    if (options.plugins) {
      payload.plugins = options.plugins.map(p => 
        typeof p === 'string' ? { id: p, enabled: true } : p
      );
    }
    
    // Add provider preferences
    if (options.provider) {
      payload.provider = options.provider;
    }
    
    // Add transforms
    if (options.transforms) {
      payload.transforms = options.transforms;
    }
    
    // Add routing preferences
    if (options.route) {
      payload.route = options.route;
    }
    
    // Add models for fallback routing
    if (options.models) {
      payload.models = options.models;
    }
    
    // Clean up undefined values
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) delete payload[key];
    });
    
    return payload;
  }

  /**
   * 📝 Normalize Messages
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

  /**
   * ⚡ Execute with Retry Logic and exponential backoff
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
        
        // Don't retry on auth errors
        if (error.response?.status === 401) {
          throw error;
        }
        
        // Don't retry on bad requests (client errors)
        if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
          throw error;
        }
        
        // Handle rate limiting with jitter
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'] || delay / 1000;
          const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
          await this.sleep((retryAfter * 1000) + jitter);
        } else {
          // Exponential backoff with jitter for other errors
          const jitter = Math.random() * 500;
          await this.sleep(delay + jitter);
        }
        
        delay *= CONFIG.RETRY_BACKOFF_MULTIPLIER;
      }
    }
    
    throw lastError;
  }

  /**
   * 🎨 Process Response
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
   * 📊 Track Request with enhanced metrics
   */
  trackRequest(requestId, payload, result, duration) {
    this.requestCount++;
    
    // Estimate cost (rough calculation)
    if (result.usage) {
      const inputTokens = result.usage.prompt_tokens || 0;
      const outputTokens = result.usage.completion_tokens || 0;
      // Very rough estimate - actual pricing varies
      const estimatedCost = (inputTokens * 0.00001) + (outputTokens * 0.00003);
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
    if (this.requestHistory.length > 100) {
      this.requestHistory = this.requestHistory.slice(-100);
    }
  }

  /**
   * ❌ Error Handler
   */
  handleError(error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      switch (status) {
        case 401:
          return Promise.reject(new AuthenticationError('Invalid API key'));
        case 429:
          const retryAfter = error.response.headers['retry-after'];
          return Promise.reject(new RateLimitError('Rate limit exceeded', retryAfter));
        case 400:
          return Promise.reject(new OpenRouterError(data.error?.message || 'Bad request', 'BAD_REQUEST', data));
        case 500:
        case 502:
        case 503:
          return Promise.reject(new OpenRouterError('Service temporarily unavailable', 'SERVICE_ERROR', data));
        default:
          return Promise.reject(new OpenRouterError(data.error?.message || 'Unknown error', `HTTP_${status}`, data));
      }
    }
    
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new OpenRouterError('Request timeout', 'TIMEOUT'));
    }
    
    return Promise.reject(error);
  }

  /**
   * 🔧 Enhance Error
   */
  enhanceError(error, requestId) {
    if (error instanceof OpenRouterError) {
      error.details.requestId = requestId;
      return error;
    }
    return error;
  }

  /**
   * 🎲 Generate Request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 😴 Sleep Utility
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
      estimatedTotalCost: this.totalCost.toFixed(4),
      budgetUsed: this.budgetUsed.toFixed(4),
      budgetLimit: this.budgetLimit.toFixed(4),
      budgetRemaining: (this.budgetLimit - this.budgetUsed).toFixed(4),
      avgDuration: Math.round(avgDuration) + 'ms',
      cacheSize: this.cache.size,
      cacheEnabled: this.cacheEnabled,
      rateLimitRemaining: this.rateLimitRemaining,
      recentRequests: this.requestHistory.slice(-10),
    };
  }

  /**
   * 🧹 Clear History and reset stats
   */
  clearHistory() {
    this.requestHistory = [];
    this.requestCount = 0;
    this.totalCost = 0;
    this.budgetUsed = 0;
    this.clearCache();
  }
}

export default OpenRouterClient;
