/**
 * 🎛️ OpenRouter Configuration v3.0
 * Centralized configuration for all API interactions
 * 
 * Enhanced with:
 * - Better model categorization
 * - Performance presets
 * - Budget controls
 * - Retry configuration
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

/**
 * 🏆 Latest 2026 Models - Curated List
 * These are the most capable models available on OpenRouter
 */
export const MODELS = {
  // 🥇 OpenAI Models
  GPT_5_4: 'openai/gpt-5.4',           // Latest GPT with 1M+ context
  GPT_5_2: 'openai/gpt-5.2',           // Fast GPT model
  GPT_5_MINI: 'openai/gpt-5-mini',     // Cost-effective
  GPT_4O: 'openai/gpt-4o',             // Reliable workhorse
  O3_MINI: 'openai/o3-mini',           // Reasoning model
  O1: 'openai/o1',                     // Advanced reasoning
  O1_MINI: 'openai/o1-mini',           // Fast reasoning
  
  // 🎭 Anthropic Models
  CLAUDE_OPUS_4: 'anthropic/claude-opus-4',       // Most capable
  CLAUDE_SONNET_4: 'anthropic/claude-sonnet-4',   // Balanced (recommended)
  CLAUDE_HAIKU_3: 'anthropic/claude-haiku-3',     // Fast & cheap
  CLAUDE_SONNET_3_5: 'anthropic/claude-3.5-sonnet', // Previous gen
  
  // 🌟 Google Models
  GEMINI_2_5_PRO: 'google/gemini-2.5-pro',        // Latest Gemini
  GEMINI_2_FLASH: 'google/gemini-2-flash',        // Fast variant
  GEMINI_2_5_FLASH: 'google/gemini-2.5-flash',    // Ultra-fast
  GEMINI_1_5_PRO: 'google/gemini-1.5-pro',        // Reliable
  
  // 🔥 Meta Models
  LLAMA_4_MAVERICK: 'meta/llama-4-maverick',      // Latest Llama
  LLAMA_4_SCOUT: 'meta/llama-4-scout',            // Efficient
  LLAMA_3_3_70B: 'meta/llama-3.3-70b',            // Open source
  LLAMA_3_1_405B: 'meta/llama-3.1-405b',          // Large open source
  
  // ⚡ High-Performance Open Source
  DEEPSEEK_V3: 'deepseek/deepseek-v3',
  DEEPSEEK_R1: 'deepseek/deepseek-r1',
  QWEN_2_5_72B: 'qwen/qwen-2.5-72b',
  QWEN_2_5_CODER: 'qwen/qwen-2.5-coder-32b',     // Coding specialist
  MISTRAL_LARGE: 'mistral/mistral-large',
  MISTRAL_MEDIUM: 'mistral/mistral-medium',
  COMMAND_R: 'cohere/command-r',
  
  // 🆓 Free Models (Rate limited)
  FREE_LLAMA: 'meta/llama-3.3-70b:free',
  FREE_QWEN: 'qwen/qwen-2.5-72b:free',
  FREE_GEMMA: 'google/gemma-2-9b:free',
  FREE_MISTRAL: 'mistralai/mistral-7b-instruct:free',
};

/**
 * 🎯 Model Categories for Easy Selection
 */
export const MODEL_CATEGORIES = {
  CODING: [MODELS.CLAUDE_SONNET_4, MODELS.GPT_5_4, MODELS.GEMINI_2_5_PRO, MODELS.DEEPSEEK_V3, MODELS.QWEN_2_5_CODER],
  CREATIVE: [MODELS.CLAUDE_OPUS_4, MODELS.GPT_5_4, MODELS.GEMINI_2_5_PRO],
  FAST: [MODELS.CLAUDE_HAIKU_3, MODELS.GPT_5_MINI, MODELS.GEMINI_2_FLASH],
  CHEAP: [MODELS.FREE_LLAMA, MODELS.FREE_QWEN, MODELS.GPT_5_MINI, MODELS.CLAUDE_HAIKU_3],
  REASONING: [MODELS.O1, MODELS.O3_MINI, MODELS.DEEPSEEK_R1, MODELS.O1_MINI],
  VISION: [MODELS.GPT_5_4, MODELS.CLAUDE_SONNET_4, MODELS.GEMINI_2_5_PRO, MODELS.GPT_4O],
  BALANCED: [MODELS.CLAUDE_SONNET_4, MODELS.GPT_5_2, MODELS.GEMINI_2_5_FLASH],
  AGENTS: [MODELS.CLAUDE_SONNET_4, MODELS.GPT_5_4, MODELS.GEMINI_2_5_PRO], // Best for tool calling
};

/**
 * ⚙️ Default Configuration
 */
export const CONFIG = {
  // API Settings
  BASE_URL: 'https://openrouter.ai/api/v1',
  API_KEY: process.env.OPENROUTER_API_KEY || '',
  
  // App Attribution Headers
  HEADERS: {
    'HTTP-Referer': process.env.SITE_URL || 'https://localhost',
    'X-OpenRouter-Title': process.env.SITE_NAME || 'OpenAgent',
  },
  
  // Default Model (Claude Sonnet 4 is best for agents)
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || MODELS.CLAUDE_SONNET_4,
  FALLBACK_MODEL: process.env.FALLBACK_MODEL || MODELS.GPT_5_MINI,
  
  // Request Settings
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS) || 120000, // 2 minutes
  STREAMING_ENABLED: process.env.STREAMING_ENABLED !== 'false',
  
  // Cost Control
  MAX_COST_PER_REQUEST_USD: parseFloat(process.env.MAX_COST_PER_REQUEST_USD) || 1.00,
  BUDGET_WARNING_THRESHOLD: parseFloat(process.env.BUDGET_WARNING_THRESHOLD) || 10.00,
  DAILY_BUDGET_USD: parseFloat(process.env.DAILY_BUDGET_USD) || 50.00,
  
  // Generation Parameters
  DEFAULT_PARAMS: {
    temperature: 0.7,
    max_tokens: 8192, // Increased for better responses
    top_p: 0.9,
    frequency_penalty: 0,
    presence_penalty: 0,
  },
  
  // Agent-specific params (lower temp for more deterministic tool use)
  AGENT_PARAMS: {
    temperature: 0.3,
    max_tokens: 8192,
    top_p: 0.95,
  },
  
  // Retry Configuration
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,
  
  // Streaming
  STREAM_KEEP_ALIVE: true,
  
  // Context Management
  MAX_CONTEXT_TOKENS: parseInt(process.env.MAX_CONTEXT_TOKENS) || 800000,
  COMPACT_THRESHOLD: parseFloat(process.env.COMPACT_THRESHOLD) || 0.7,
  
  // Tool Settings
  TOOL_TIMEOUT_MS: parseInt(process.env.TOOL_TIMEOUT_MS) || 120000, // 2 minutes (as per changelog)
  MAX_TOOL_RESULT_CHARS: parseInt(process.env.MAX_TOOL_RESULT_CHARS) || 15000,
  
  // Performance
  MIN_REQUEST_INTERVAL_MS: parseInt(process.env.MIN_REQUEST_INTERVAL_MS) || 100,
  CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS) || 5 * 60 * 1000, // 5 minutes
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
};

/**
 * 🔌 Available Plugins
 */
export const PLUGINS = {
  WEB_SEARCH: { id: 'web', enabled: true },
  FILE_PARSER: { id: 'file-parser', enabled: true },
  RESPONSE_HEALING: { id: 'response-healing', enabled: true },
  CODE_INTERPRETER: { id: 'code-interpreter', enabled: false },
};

/**
 * 🎯 Performance Presets
 */
export const PRESETS = {
  FAST: {
    model: MODELS.CLAUDE_HAIKU_3,
    temperature: 0.5,
    max_tokens: 2048,
    maxIterations: 10,
  },
  BALANCED: {
    model: MODELS.CLAUDE_SONNET_4,
    temperature: 0.7,
    max_tokens: 4096,
    maxIterations: 20,
  },
  QUALITY: {
    model: MODELS.CLAUDE_OPUS_4,
    temperature: 0.3,
    max_tokens: 8192,
    maxIterations: 30,
  },
  CODING: {
    model: MODELS.CLAUDE_SONNET_4,
    temperature: 0.2,
    max_tokens: 8192,
    maxIterations: 25,
  },
};

/**
 * 🎨 UI Configuration
 */
export const UI = {
  COLORS: {
    primary: '#00D9FF',
    secondary: '#FF006E',
    success: '#38B000',
    warning: '#FFBE0B',
    error: '#FF006E',
    info: '#3A86FF',
    muted: '#6C757D',
  },
  SPINNER_STYLE: 'dots',
};

export default { MODELS, MODEL_CATEGORIES, CONFIG, PLUGINS, UI };
