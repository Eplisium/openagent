/**
 * Shared terminal formatting utilities for OpenAgent CLI.
 */

import chalk from '../utils/chalk-compat.js';

const DEFAULT_THEME = {
  muted: '#6c7086',
  success: '#a6e3a1',
};

const getTerminalWidth = () => Math.min(process.stdout.columns || 80, 65);
export const DIVIDER = () => chalk.hex(DEFAULT_THEME.muted)('─'.repeat(getTerminalWidth()));

export function stripAnsi(str = '') {
  return String(str).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return Math.round(value).toString();
}

export function formatToolArgs(toolName, args) {
  const dim = chalk.hex(DEFAULT_THEME.muted);
  if (!args || Object.keys(args).length === 0) return '';

  if (args.path) return dim(args.path);
  if (args.command) return dim(args.command.substring(0, 50) + (args.command.length > 50 ? '...' : ''));
  if (args.query) return dim(`"${args.query.substring(0, 40)}${args.query.length > 40 ? '...' : ''}"`);
  if (args.url) return dim(args.url.substring(0, 50));
  if (args.file) return dim(args.file);

  const firstKey = Object.keys(args)[0];
  const firstVal = typeof args[firstKey] === 'string'
    ? args[firstKey].substring(0, 40)
    : JSON.stringify(args[firstKey]).substring(0, 40);
  return dim(`${firstKey}: ${firstVal}${firstVal.length >= 40 ? '...' : ''}`);
}

export function truncateInline(text, maxLength = 56) {
  if (!text || text.length <= maxLength) return text || '';
  return `${text.substring(0, maxLength - 3).trimEnd()}...`;
}

export function shortenModelLabel(modelId) {
  if (!modelId) return 'no-model';
  const [provider, model] = String(modelId).split('/');
  const knownProviders = new Set(['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'moonshotai', 'x-ai']);
  const label = model && knownProviders.has(provider) ? model : String(modelId).split('/').pop();
  return truncateInline(label.replace(/-\d{8}$/, ''), 28);
}

export function miniBar(current, total, length = 12) {
  if (total === 0) return chalk.hex(DEFAULT_THEME.muted)('░'.repeat(length));
  const filled = Math.round((current / total) * length);
  return chalk.hex(DEFAULT_THEME.success)('█'.repeat(filled)) + chalk.hex(DEFAULT_THEME.muted)('░'.repeat(length - filled));
}
