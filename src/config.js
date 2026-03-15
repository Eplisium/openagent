/**
 * 🎛️ OpenRouter Configuration
 * Centralized configuration for all API interactions
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
  O3_MINI: 'openai/o3-mini',           // Reasoning model
  O1: 'openai/o1',                     // Advanced reasoning
  
  // 🎭 Anthropic Models
  CLAUDE_OPUS_4: 'anthropic/claude-opus-4',       // Most capable
  CLAUDE_SONNET_4: 'anthropic/claude-sonnet-4',   // Balanced
  CLAUDE_HAIKU_3: 'anthropic/claude-haiku-3',     // Fast & cheap
  
  // 🌟 Google Models
  GEMINI_2_5_PRO: 'google/gemini-2.5-pro',        // Latest Gemini
  GEMINI_2_FLASH: 'google/gemini-2-flash',        // Fast variant
  GEMINI_2_5_FLASH: 'google/gemini-2.5-flash',    // Ultra-fast
  
  // 🔥 Meta Models
  LLAMA_4_MAVERICK: 'meta/llama-4-maverick',      // Latest Llama
  LLAMA_4_SCOUT: 'meta/llama-4-scout',            // Efficient
  LLAMA_3_3_70B: 'meta/llama-3.3-70b',            // Open source
  
  // ⚡ High-Performance Open Source
  DEEPSEEK_V3: 'deepseek/deepseek-v3',
  DEEPSEEK_R1: 'deepseek/deepseek-r1',
  QWEN_2_5_72B: 'qwen/qwen-2.5-72b',
  MISTRAL_LARGE: 'mistral/mistral-large',
  
  // 🆓 Free Models (Rate limited)
  FREE_LLAMA: 'meta/llama-3.3-70b:free',
  FREE_QWEN: 'qwen/qwen-2.5-72b:free',
  FREE_GEMMA: 'google/gemma-2-9b:free',
};

/**
 * 🎯 Model Categories for Easy Selection
 */
export const MODEL_CATEGORIES = {
  CODING: [MODELS.GPT_5_4, MODELS.CLAUDE_OPUS_4, MODELS.GEMINI_2_5_PRO, MODELS.DEEPSEEK_V3],
  CREATIVE: [MODELS.CLAUDE_OPUS_4, MODELS.GPT_5_4, MODELS.GEMINI_2_5_PRO],
  FAST: [MODELS.GPT_5_MINI, MODELS.CLAUDE_HAIKU_3, MODELS.GEMINI_2_FLASH],
  CHEAP: [MODELS.GPT_5_MINI, MODELS.CLAUDE_HAIKU_3, MODELS.FREE_LLAMA],
  REASONING: [MODELS.O1, MODELS.O3_MINI, MODELS.DEEPSEEK_R1],
  VISION: [MODELS.GPT_5_4, MODELS.CLAUDE_SONNET_4, MODELS.GEMINI_2_5_PRO],
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
    'X-OpenRouter-Title': process.env.SITE_NAME || 'OpenRouter Master Script',
  },
  
  // Default Model
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || MODELS.GPT_5_4,
  FALLBACK_MODEL: process.env.FALLBACK_MODEL || MODELS.CLAUDE_SONNET_4,
  
  // Request Settings
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS) || 60000,
  STREAMING_ENABLED: process.env.STREAMING_ENABLED !== 'false',
  
  // Cost Control
  MAX_COST_PER_REQUEST_USD: parseFloat(process.env.MAX_COST_PER_REQUEST_USD) || 0.50,
  BUDGET_WARNING_THRESHOLD: parseFloat(process.env.BUDGET_WARNING_THRESHOLD) || 10.00,
  
  // Generation Parameters
  DEFAULT_PARAMS: {
    temperature: 0.7,
    max_tokens: 4096,
    top_p: 0.9,
    frequency_penalty: 0,
    presence_penalty: 0,
  },
  
  // Retry Configuration
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,
  
  // Streaming
  STREAM_KEEP_ALIVE: true,
};

/**
 * 🔌 Available Plugins
 */
export const PLUGINS = {
  WEB_SEARCH: { id: 'web', enabled: true },
  FILE_PARSER: { id: 'file-parser', enabled: true },
  RESPONSE_HEALING: { id: 'response-healing', enabled: true },
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
