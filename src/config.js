/**
 * 🎛️ OpenRouter Configuration v4.0
 * Centralized configuration for all API interactions
 * 
 * Enhanced with:
 * - Dynamic model selection from OpenRouter API
 * - No hardcoded models - everything comes from API
 * - Performance presets
 * - Budget controls
 * - Retry configuration
 * - Provider preferences for latency optimization
 * - Fallback model routing
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

/**
 * ⚙️ Default Configuration
 * All model settings are now dynamic from OpenRouter API
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
  
  // Fallback model for routing
  FALLBACK_MODEL: process.env.FALLBACK_MODEL || 'anthropic/claude-sonnet-4',
  
  // Request Settings
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS) || 300000, // 5 minutes
  STREAMING_ENABLED: process.env.STREAMING_ENABLED !== 'false',
  
  // Cost Control
  MAX_COST_PER_REQUEST_USD: parseFloat(process.env.MAX_COST_PER_REQUEST_USD) || 1.00,
  BUDGET_WARNING_THRESHOLD: parseFloat(process.env.BUDGET_WARNING_THRESHOLD) || 10.00,
  DAILY_BUDGET_USD: parseFloat(process.env.DAILY_BUDGET_USD) || 50.00,
  
  // Generation Parameters
  DEFAULT_PARAMS: {
    temperature: 0.7,
    max_tokens: 8192,
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
  TOOL_TIMEOUT_MS: parseInt(process.env.TOOL_TIMEOUT_MS) || 300000,
  MAX_TOOL_RESULT_CHARS: parseInt(process.env.MAX_TOOL_RESULT_CHARS) || 15000,
  
  // Performance
  MIN_REQUEST_INTERVAL_MS: parseInt(process.env.MIN_REQUEST_INTERVAL_MS) || 100,
  CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS) || 5 * 60 * 1000, // 5 minutes
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
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

export default { CONFIG, PLUGINS, UI };
