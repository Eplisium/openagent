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
import { normalizeOptionalLimit, normalizePositiveInt } from './utils.js';

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
  
  // Fallback model for routing (must be set via env or explicitly)
  FALLBACK_MODEL: process.env.FALLBACK_MODEL || null,
  
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
    max_tokens: 16384,
    top_p: 0.9,
    frequency_penalty: 0,
    presence_penalty: 0,
  },
  
  // Agent-specific params (lower temp for more deterministic tool use)
  AGENT_PARAMS: {
    temperature: 0.3,
    max_tokens: 16384,
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
  AGENT_MAX_ITERATIONS: normalizeOptionalLimit(process.env.AGENT_MAX_ITERATIONS, null),
  AGENT_MAX_RUNTIME_MS: normalizeOptionalLimit(process.env.AGENT_MAX_RUNTIME_MS, null),
  AGENT_MAX_TOOL_CALLS: normalizeOptionalLimit(process.env.AGENT_MAX_TOOL_CALLS, null),
  AGENT_MAX_STALL_ITERATIONS: normalizePositiveInt(process.env.AGENT_MAX_STALL_ITERATIONS, 8),
  
  // Tool Settings
  TOOL_TIMEOUT_MS: parseInt(process.env.TOOL_TIMEOUT_MS) || 300000,
  MAX_TOOL_RESULT_CHARS: parseInt(process.env.MAX_TOOL_RESULT_CHARS) || 80000,

  // Workspace Settings
  OPENAGENT_HOME: process.env.OPENAGENT_HOME || null,
  
  // Performance
  MIN_REQUEST_INTERVAL_MS: parseInt(process.env.MIN_REQUEST_INTERVAL_MS) || 100,
  CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS) || 5 * 60 * 1000, // 5 minutes
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Circuit Breaker
  CIRCUIT_BREAKER_THRESHOLD: normalizePositiveInt(process.env.CIRCUIT_BREAKER_THRESHOLD, 3),

  // ═══════════════════════════════════════════════════════════════
  // 📁 File Tool Limits
  // ═══════════════════════════════════════════════════════════════
  FILE_READ_MAX_LINES: 500,
  FILE_READ_MAX_CHARS: 50000,
  SEARCH_RESULTS_MAX_CHARS: 80000,
  SEARCH_MAX_MATCHES_PER_FILE: 3,
  DIFF_MAX_DIFFERENCES: 100,

  // ═══════════════════════════════════════════════════════════════
  // 🖥️ Shell Tool Limits
  // ═══════════════════════════════════════════════════════════════
  EXEC_MAX_BUFFER_BYTES: 10 * 1024 * 1024, // 10MB
  EXEC_DEFAULT_TIMEOUT_MS: 30000,
  BG_PROCESS_OUTPUT_LIMIT: 50000,
  BG_PROCESS_OUTPUT_TRIM: 25000,

  // ═══════════════════════════════════════════════════════════════
  // 🤖 Agent Behavior
  // ═══════════════════════════════════════════════════════════════
  AGENT_DEFAULT_MAX_RETRIES: 3,
  AGENT_DEFAULT_RETRY_DELAY_MS: 1000,
  AGENT_DEFAULT_RETRY_BACKOFF: 2,
  SINGLE_TOOL_STALL_THRESHOLD: 3,
  IMAGE_TOKEN_COST: 85,
  MESSAGE_OVERHEAD_TOKENS: 4,
  TRUNCATE_TEXT_DEFAULT_MAX: 160,
  COMPACTION_PRIOR_USER_MESSAGES: 3,
  COMPACTION_RECENT_HISTORY: 6,
  HISTORY_DISPLAY_LIMIT: 10,
  CONTEXT_WARNING_PERCENT: 60,
  CONTEXT_WARNING_UPPER_PERCENT: 70,
  RETRY_MAX_TOKENS_INITIAL: 16384,
  RETRY_MAX_TOKENS_SECOND: 8192,
  RETRY_MAX_TOKENS_FINAL: 4096,
  AGENT_TOOL_TEMPERATURE: 0.3,

  // ═══════════════════════════════════════════════════════════════
  // 🌐 Web Tool Settings
  // ═══════════════════════════════════════════════════════════════
  WEB_SEARCH_CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  WEB_SEARCH_CACHE_MAX_SIZE: 100,
  WEB_FETCH_TIMEOUT_MS: 15000,
  WEB_READ_TIMEOUT_MS: 20000,
  WEB_FETCH_URL_TIMEOUT_MS: 30000,
  WEB_READ_DEFAULT_MAX_CHARS: 15000,
  WEB_FETCH_DATA_MAX_CHARS: 10000,
  SEARX_TIMEOUT_MS: 10000,
  SERPER_TIMEOUT_MS: 10000,
  BRAVE_TIMEOUT_MS: 10000,

  // ═══════════════════════════════════════════════════════════════
  // 📋 Task Manager
  // ═══════════════════════════════════════════════════════════════
  TASK_MAX_SESSIONS: 50,
  TASK_DESCRIPTION_MAX_LENGTH: 500,

  // ═══════════════════════════════════════════════════════════════
  // 🔌 OpenRouter Client
  // ═══════════════════════════════════════════════════════════════
  CLIENT_CACHE_MAX_SIZE: 200,
  CLIENT_REQUEST_HISTORY_MAX: 200,
  CLIENT_REQUEST_HISTORY_TRIM: 100,
  CLIENT_RATE_LIMIT_DEFAULT_WAIT_MS: 1000,
  CLIENT_RATE_LIMIT_MAX_WAIT_MS: 10000,
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
