/**
 * Shared terminal formatting utilities for OpenAgent CLI.
 */

import chalk from '../utils/chalk-compat.js';

const DEFAULT_THEME = { muted: '#6c7086' };

const getTerminalWidth = () => Math.min(process.stdout.columns || 80, 65);
export const DIVIDER = () => chalk.hex(DEFAULT_THEME.muted)('─'.repeat(getTerminalWidth()));

export function stripAnsi(str = '') {
  return String(str).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1000000000) return `${sign}${(abs / 1000000000).toFixed(abs >= 10000000000 ? 0 : 1).replace(/\.0$/, '')}B`;
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `${sign}${Math.round(abs)}`;
}

export function truncateInline(text, maxLength = 56) {
  if (!text || text.length <= maxLength) return text || '';
  return `${text.substring(0, maxLength - 3).trimEnd()}...`;
}
