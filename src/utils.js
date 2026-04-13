/**
 * 🎨 UI Utilities & Helpers
 * Making the CLI experience beautiful and functional
 */

import chalk from './utils/chalk-compat.js';
import { spinner } from './utils/spinners.js';
import boxen from 'boxen';
import gradient from 'gradient-string';
import Table from 'cli-table3';

/**
 * 🌈 Color Presets
 */
export const colors = {
  primary: chalk.cyan,
  secondary: chalk.magenta,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray,
  bold: chalk.bold,
  dim: chalk.dim,
};

/**
 * 🎨 Gradient Strings
 */
export const gradients = {
  title: gradient(['#00D9FF', '#FF006E', '#38B000']),
  ai: gradient(['#00D9FF', '#3A86FF']),
  tool: gradient(['#FFBE0B', '#FF006E']),
  success: gradient(['#38B000', '#00D9FF']),
  warning: gradient(['#FFBE0B', '#FF006E']),
  info: gradient(['#3A86FF', '#00D9FF']),
  rainbow: gradient.rainbow,
  passion: gradient.passion,
  vice: gradient.vice,
  retro: gradient.retro,
};

/**
 * 📦 Box Styles
 */
export const boxStyles = {
  default: {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
  },
  response: {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'magenta',
  },
  tool: {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'yellow',
  },
  result: {
    padding: 1,
    borderStyle: 'single',
    borderColor: 'green',
  },
  success: {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'green',
  },
  error: {
    padding: 1,
    borderStyle: 'double',
    borderColor: 'red',
  },
  warning: {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'yellow',
  },
  info: {
    padding: 1,
    borderStyle: 'single',
    borderColor: 'blue',
  },
  stats: {
    padding: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
  },
};

/**
 * 🖨️ Print Title
 */
export function printTitle(text) {
  console.log('\n' + gradients.title(text) + '\n');
}

/**
 * 📦 Print Box
 */
export function printBox(text, type = 'default') {
  console.log(boxen(text, boxStyles[type]));
}

/**
 * ✅ Print Success
 */
export function printSuccess(message) {
  console.log(colors.success('✓ ' + message));
}

/**
 * ❌ Print Error
 */
export function printError(message) {
  console.log(colors.error('✗ ' + message));
}

/**
 * ⚠️ Print Warning
 */
export function printWarning(message) {
  console.log(colors.warning('⚠ ' + message));
}

/**
 * ℹ️ Print Info
 */
export function printInfo(message) {
  console.log(colors.info('ℹ ' + message));
}

/**
 * 🔄 Create Spinner
 */
export function createSpinner(text) {
  return spinner(colors.muted(text), { color: 'cyan' });
}

/**
 * 📊 Create Table
 */
export function createTable(headers, rows = []) {
  const table = new Table({
    head: headers.map(h => colors.bold(h)),
    style: {
      head: ['cyan'],
      border: ['gray'],
    },
  });
  
  if (rows.length > 0) {
    table.push(...rows);
  }
  
  return table;
}

/**
 * 📋 Print Model Info
 */
export function printModelInfo(model) {
  const lines = [
    colors.bold(model.name || model.id),
    colors.muted(`ID: ${model.id}`),
    colors.muted(`Context: ${model.context_length?.toLocaleString()} tokens`),
    colors.muted(`Pricing: $${model.pricing?.prompt}/1K input, $${model.pricing?.completion}/1K output`),
  ];
  
  if (model.description) {
    lines.push('');
    lines.push(model.description.slice(0, 100) + '...');
  }
  
  printBox(lines.join('\n'), 'info');
}

/**
 * 💬 Format Chat Message
 */
export function formatMessage(role, content) {
  const roleColors = {
    user: colors.primary,
    assistant: colors.secondary,
    system: colors.muted,
    tool: colors.warning,
  };
  
  const roleEmoji = {
    user: '👤',
    assistant: '🤖',
    system: '⚙️',
    tool: '🛠️',
  };
  
  const colorFn = roleColors[role] || colors.muted;
  const emoji = roleEmoji[role] || '💬';
  
  return `${emoji} ${colorFn.bold(role.toUpperCase())}\n${content}\n`;
}

/**
 * 📈 Print Usage Stats
 */
export function printUsageStats(usage, duration) {
  if (!usage) return;
  
  const table = createTable(['Metric', 'Value'], [
    ['Prompt Tokens', usage.prompt_tokens?.toLocaleString() || 'N/A'],
    ['Completion Tokens', usage.completion_tokens?.toLocaleString() || 'N/A'],
    ['Total Tokens', usage.total_tokens?.toLocaleString() || 'N/A'],
    ['Duration', `${duration}ms`],
  ]);
  
  console.log('\n' + table.toString());
}

/**
 * 🎭 Print Tool Call
 */
export function printToolCall(toolCall) {
  console.log('\n' + boxen(
    `${colors.warning.bold('🔧 Tool Call')}\n` +
    `${colors.primary('Name:')} ${toolCall.name}\n` +
    `${colors.primary('Arguments:')}\n${JSON.stringify(toolCall.arguments, null, 2)}`,
    boxStyles.warning
  ));
}

/**
 * 🌊 Print Streaming Chunk
 */
export function printStreamingChunk(content, isFirst = false) {
  if (isFirst) {
    process.stdout.write(colors.secondary('🤖 '));
  }
  process.stdout.write(content);
}

/**
 * ✨ Print Divider
 */
export function printDivider(char = '─', length = 60) {
  console.log(colors.muted(char.repeat(length)));
}

/**
 * 🎯 Print Menu
 */
export function printMenu(title, items) {
  console.log('\n' + colors.bold.underline(title));
  items.forEach((item, index) => {
    console.log(`  ${colors.primary(`${index + 1}.`)} ${item}`);
  });
  console.log();
}

/**
 * 📊 Create Progress Bar
 */
export function createProgressBar(current, total, length = 30) {
  if (!total || total <= 0) return `${colors.primary('[')}${colors.success('░'.repeat(length))}${colors.primary(']')} 0%`;
  const percentage = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((length * percentage) / 100);
  const empty = length - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${colors.primary('[')}${colors.success(bar)}${colors.primary(']')} ${percentage}%`;
}

/**
 * 📝 Format JSON
 */
export function formatJSON(obj, pretty = true) {
  if (pretty) {
    return JSON.stringify(obj, null, 2)
      .replace(/"(\w+)":/g, colors.primary('"$1":'))
      .replace(/: "([^"]+)"/g, ': ' + colors.success('"$1"'))
      .replace(/: (true|false|null|\d+)/g, ': ' + colors.warning('$1'));
  }
  return JSON.stringify(obj);
}

/**
 * ⏱️ Format Duration
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * 💰 Format Cost
 */
export function formatCost(cost) {
  if (!Number.isFinite(cost)) return '$0.0000';
  if (cost < 0.01) return `${(cost * 100).toFixed(4)}¢`;
  return `$${cost.toFixed(4)}`;
}

/**
 * 🎨 Clear Screen
 */
export function clearScreen() {
  console.clear();
}

/**
 * 💤 Sleep
 */
export function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * 🔀 Random Element
 */
export function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * 📅 Timestamp
 */
export function timestamp() {
  return new Date().toISOString();
}

/**
 * 🎯 Truncate Text
 */
export function truncate(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * 🔢 Normalize Optional Limit
 * Parses a value as a positive integer, returning null for disabled/unlimited states.
 * Accepts '0', 'none', 'null', 'unlimited', 'infinity', 'inf', 'auto' as null.
 */
export function normalizeOptionalLimit(value, fallback = null) {
  const candidate = value ?? fallback;

  if (candidate === undefined || candidate === null || candidate === '') {
    return null;
  }

  const normalized = String(candidate).trim().toLowerCase();
  if (!normalized || ['0', 'none', 'null', 'unlimited', 'infinity', 'inf', 'auto'].includes(normalized)) {
    return null;
  }

  const parsed = parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 🔢 Normalize Positive Integer
 * Parses a value as a positive integer with a required fallback.
 */
export function normalizePositiveInt(value, fallback) {
  const candidate = value ?? fallback;

  if (candidate === undefined || candidate === null || candidate === '') {
    return fallback;
  }

  const parsed = parseInt(candidate, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Pre-compiled regexes for token estimation (avoid recompilation on every call)
const CODE_PATTERN_REGEX = /[{}[\]()=><;]|(?:^|\s)(function|const|let|var|class|import|export|return|if|else|for|while|async|await|def |print |from |require\(|module\.)(?:\s|$)/gm;
const JSON_STRUCTURE_REGEX = /[{}[\]]/g;

// Token estimation LRU cache — avoids re-estimating identical strings
const _tokenCache = new Map();
const TOKEN_CACHE_MAX = 2048;
function _tokenCacheKey(text) {
  // Fast key: length + first 32 chars + last 32 chars (covers most collisions cheaply)
  const len = text.length;
  if (len <= 64) return text;
  return text.slice(0, 32) + '\x00' + text.slice(-32) + '\x00' + len;
}

/**
 * 🔢 Estimate token count from text with content-aware heuristics
 * - Code content (braces, keywords): ~3.5 chars/token
 * - Prose content: ~4 chars/token
 * - Mixed: weighted average based on code density
 * 
 * Optimized: pre-compiled regexes, fast-path for short strings
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  const len = text.length;
  if (len === 0) return 0;

  // Fast path: for very short strings, use simple heuristic
  if (len < 20) {
    return Math.ceil(len / 4);
  }

  // Check LRU cache
  const cacheKey = _tokenCacheKey(text);
  const cached = _tokenCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Count code indicators using pre-compiled regex
  const codeMatches = (text.match(CODE_PATTERN_REGEX) || []).length;

  // Determine code density: code indicators per 100 chars
  const codeDensity = (codeMatches / Math.max(len / 100, 1));

  // Classify content
  let charsPerToken;
  if (codeDensity > 2) {
    // Heavy code: ~3.2-3.5 chars/token
    charsPerToken = 3.2 + Math.min(codeDensity * 0.05, 0.3);
  } else if (codeDensity > 0.5) {
    // Mixed code/prose: weighted average ~3.5-3.8
    charsPerToken = 3.5 + (0.3 * (1 - codeDensity / 2));
  } else {
    // Prose: ~4 chars/token, but structured prose (JSON, markdown) gets slightly fewer
    const hasJsonStructure = (text.match(JSON_STRUCTURE_REGEX) || []).length > len / 50;
    charsPerToken = hasJsonStructure ? 3.8 : 4.0;
  }

  const result = Math.ceil(len / charsPerToken);

  // Store in cache, evict oldest if full
  if (_tokenCache.size >= TOKEN_CACHE_MAX) {
    const firstKey = _tokenCache.keys().next().value;
    _tokenCache.delete(firstKey);
  }
  _tokenCache.set(cacheKey, result);

  return result;
}

/**
 * 🧹 Clear the token estimation cache (call after large context changes)
 */
export function clearTokenCache() {
  _tokenCache.clear();
}

export default {
  colors,
  gradients,
  printTitle,
  printBox,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  createSpinner,
  createTable,
  printModelInfo,
  formatMessage,
  printUsageStats,
  printToolCall,
  printStreamingChunk,
  printDivider,
  printMenu,
  createProgressBar,
  formatJSON,
  formatDuration,
  formatCost,
  clearScreen,
  sleep,
  randomElement,
  timestamp,
  truncate,
  normalizeOptionalLimit,
  normalizePositiveInt,
  estimateTokens,
  clearTokenCache,
};
