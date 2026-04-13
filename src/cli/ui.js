/**
 * UI helpers and styles for OpenAgent CLI
 */

import chalk from '../utils/chalk-compat.js';
import boxen from 'boxen';
import gradient from 'gradient-string';
import { renderMarkdown as _renderMarkdown } from './markdown.js';

// ═══════════════════════════════════════════════════════════════════
// 🎨 Gradients
// ═══════════════════════════════════════════════════════════════════

export const g = {
  title: gradient(['#00D9FF', '#FF006E', '#38B000']),
  ai: gradient(['#00D9FF', '#3A86FF']),
  tool: gradient(['#FFBE0B', '#FF006E']),
  success: gradient(['#38B000', '#00D9FF']),
};

// ═══════════════════════════════════════════════════════════════════
// 📦 Box Styles
// ═══════════════════════════════════════════════════════════════════

export const box = {
  default: { padding: 1, borderStyle: 'round', borderColor: 'cyan' },
  response: { padding: 1, borderStyle: 'round', borderColor: 'magenta' },
  tool: { padding: 1, borderStyle: 'round', borderColor: 'yellow' },
  result: { padding: 1, borderStyle: 'single', borderColor: 'green' },
  error: { padding: 1, borderStyle: 'double', borderColor: 'red' },
  info: { padding: 1, borderStyle: 'single', borderColor: 'blue' },
  stats: { padding: 1, borderStyle: 'round', borderColor: 'cyan' },
};

// ═══════════════════════════════════════════════════════════════════
// 📏 Terminal Utilities
// ═══════════════════════════════════════════════════════════════════

const getTerminalWidth = () => Math.min(process.stdout.columns || 80, 65);
export const DIVIDER = () => chalk.dim('─'.repeat(getTerminalWidth()));

/**
 * Strip ANSI escape codes from a string
 * @param {string} str - String with potential ANSI codes
 * @returns {string} Clean string without ANSI codes
 */
export function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

// ═══════════════════════════════════════════════════════════════════
// 🎨 Markdown Rendering
// ═══════════════════════════════════════════════════════════════════

export const renderMarkdown = _renderMarkdown;

// ═══════════════════════════════════════════════════════════════════
// 🎯 Formatting Functions
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// 🎯 Formatting Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Format a duration in milliseconds for display
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a compact number (e.g., 1.2K, 3.4M)
 * @param {number} value - Number to format
 * @returns {string} Compact number string
 */
export function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return Math.round(value).toString();
}

/**
 * Format tool arguments for compact display
 * @param {string} toolName - Name of the tool
 * @param {object} args - Tool arguments
 * @returns {string} Formatted argument preview
 */
export function formatToolArgs(toolName, args) {
  if (!args || Object.keys(args).length === 0) return '';
  
  // Show the most relevant arg for common tools
  if (args.path) return chalk.dim(args.path);
  if (args.command) return chalk.dim(args.command.substring(0, 50) + (args.command.length > 50 ? '...' : ''));
  if (args.query) return chalk.dim(`"${args.query.substring(0, 40)}${args.query.length > 40 ? '...' : ''}"`);
  if (args.url) return chalk.dim(args.url.substring(0, 50));
  if (args.file) return chalk.dim(args.file);
  
  // Fallback: show first arg
  const firstKey = Object.keys(args)[0];
  const firstVal = typeof args[firstKey] === 'string' 
    ? args[firstKey].substring(0, 40) 
    : JSON.stringify(args[firstKey]).substring(0, 40);
  return chalk.dim(`${firstKey}: ${firstVal}${firstVal.length >= 40 ? '...' : ''}`);
}

/**
 * Truncate text inline with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateInline(text, maxLength = 56) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.substring(0, maxLength - 3).trimEnd()}...`;
}

/**
 * Shorten a model label for display
 * @param {string} modelId - Full model ID
 * @returns {string} Shortened model label
 */
export function shortenModelLabel(modelId) {
  if (!modelId) {
    return 'no-model';
  }
  return truncateInline(modelId, 28);
}

// ═══════════════════════════════════════════════════════════════════
// 🖨️ Print Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Print the OpenAgent banner
 * @param {string} version - Version string
 */
export function printBanner(version) {
  console.log(`
 ${g.title('╔═══════════════════════════════════════════════════════════════╗')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('║')}   ${gradient.rainbow('🚀 OpenAgent')} ${chalk.gray(`v${version}`)}                                           ${g.title('║')}
 ${g.title('║')}   ${chalk.gray('AI-Powered Agentic Assistant with 400+ Models')}               ${g.title('║')}
 ${g.title('║')}   ${chalk.gray('Production-grade • Tool calling • Multi-agent')}                ${g.title('║')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('╚═══════════════════════════════════════════════════════════════╝')}
 `);
}

/**
 * Print a smart error with suggestions
 * @param {string} errorType - Type of error
 * @param {object} details - Error details including message and suggestions
 */
export function showSmartError(errorType, details = {}) {
  const { message, suggestions = [] } = details;
  
  let content = `${chalk.red('❌ Error')}\n\n${chalk.white(message || 'An error occurred')}`;
  
  if (suggestions.length > 0) {
    content += `\n\n${chalk.bold('Suggestions:')}`;
    for (const suggestion of suggestions) {
      content += `\n${chalk.green('•')} ${suggestion}`;
    }
  }
  
  console.log(boxen(content, box.error));
}

/**
 * Format a tool call for display
 * @param {string} toolName - Name of the tool
 * @param {object} args - Tool arguments
 * @param {number} count - Call count
 * @param {number} startTime - Task start time
 * @returns {string} Formatted tool call string
 */
export function formatToolCall(toolName, args, count, startTime) {
  const elapsed = Date.now() - startTime;
  const elapsedStr = formatDuration(elapsed);
  const argPreview = formatToolArgs(toolName, args);
  return `${chalk.yellow('⚙')} ${chalk.yellow(toolName)} ${argPreview}${chalk.dim(` [${elapsedStr}]`)}`;
}

/**
 * Print goodbye banner
 */
export function printGoodbye() {
  console.log(`
 ${g.title('╔═══════════════════════════════════════════════════════════════╗')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('║')}   ${g.success('👋 Session Complete')}                                         ${g.title('║')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('╚═══════════════════════════════════════════════════════════════╝')}
 `);
}

/**
 * Print AI response in a box
 * @param {string} content - Response content
 */
export function printAIResponse(content) {
  if (!content) return;
  console.log('');
  console.log(boxen(
    `${g.ai('🤖 AI')}\n\n${chalk.white(content)}`,
    box.response
  ));
}

/**
 * Create a mini progress bar
 * @param {number} current - Current value
 * @param {number} total - Total value
 * @param {number} length - Bar length
 * @returns {string} Progress bar string
 */
export function miniBar(current, total, length = 12) {
  if (total === 0) return chalk.dim('░'.repeat(length));
  const filled = Math.round((current / total) * length);
  return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(length - filled));
}
