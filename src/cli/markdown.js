/**
 * Enhanced Markdown rendering for OpenAgent CLI terminal display.
 * Provides rich terminal output with proper formatting for code, headers, links, etc.
 */

import chalk from '../utils/chalk-compat.js';
import { marked } from 'marked';
import { highlightCode } from './syntaxHighlight.js';

let activeTheme = {
  accent: '#89b4fa',
  muted: '#6c7086',
  text: '#cdd6f4',
};
let listDepth = 0;

/**
 * Strip ANSI escape codes from a string for length calculations
 */
function stripAnsi(str) {
  if (!str) return '';
  return str.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Render inline tokens (text, strong, em, code, links, etc.) to terminal-styled string.
 * In marked v15, inline tokens have child content in token.text (already rendered as string).
 */
function renderInline(tokens) {
  if (!tokens || !Array.isArray(tokens)) return '';
  return tokens.map(token => {
    switch (token.type) {
      case 'text':
        // In marked v15, text tokens can have child tokens with inline formatting
        if (token.tokens && token.tokens.length > 0) {
          return renderInline(token.tokens);
        }
        return token.text || '';
      case 'strong':
        return chalk.bold(token.tokens ? renderInline(token.tokens) : (token.text || ''));
      case 'em':
        return chalk.italic(token.tokens ? renderInline(token.tokens) : (token.text || ''));
      case 'del':
        return chalk.dim.strikethrough(token.text || '');
      case 'codespan':
        return chalk.hex(activeTheme.accent)(token.text || '');
      case 'link':
        return `${chalk.hex(activeTheme.accent)(token.text || '')} ${chalk.dim('(' + (token.href || '') + ')')}`;
      case 'image':
        return chalk.dim(`[Image: ${token.text || 'untitled'}]`);
      case 'br':
        return '\n';
      case 'html':
        return '';
      default:
        return token.text || token.raw || '';
    }
  }).join('');
}

const renderer = {};

// Headers with subtle accent styling
renderer.heading = function(token) {
  const text = token.text || '';
  const level = token.depth || 1;

  if (level === 1) {
    return `\n${chalk.hex(activeTheme.accent).bold(text)}\n`;
  }
  if (level === 2) {
    const prefix = chalk.hex(activeTheme.accent).bold('## ');
    return `\n${prefix}${chalk.bold(text)}\n`;
  }
  if (level === 3) {
    const prefix = chalk.hex(activeTheme.muted).bold('### ');
    return `\n${prefix}${chalk.bold(text)}\n`;
  }
  // h4-h6: progressively dimmer
  const dimLevel = Math.min(level - 3, 3);
  const dimFn = dimLevel === 1 ? chalk.bold : dimLevel === 2 ? chalk : chalk.dim;
  return `\n${dimFn('#'.repeat(level) + ' ' + text)}\n`;
};

// Code blocks with reduced chrome and no line numbers by default.
renderer.code = function(token) {
  const code = token?.text || '';
  const rawLanguage = String(token?.lang || '').trim();
  const language = rawLanguage || 'text';
  const highlighted = highlightCode(code, language, activeTheme);
  const lines = highlighted.split('\n');
  const codeLines = code.replace(/\r/g, '').replace(/\n$/, '').split('\n');
  if (codeLines.length <= 2) {
    const label = rawLanguage && rawLanguage !== 'text' ? rawLanguage : '';
    const prefixText = label ? `${label} │ ` : '│ ';
    const padText = label ? `${' '.repeat(label.length)} │ ` : '│ ';
    const prefix = chalk.hex(activeTheme.muted)(prefixText);
    const pad = chalk.hex(activeTheme.muted)(padText);
    const compact = lines.map((line, index) => `${index === 0 ? prefix : pad}${line}`).join('\n');
    return `\n${compact}\n`;
  }
  const maxLineLen = Math.min(Math.max(...lines.map(l => stripAnsi(l).length), language.length + 2, 32), Math.min(90, process.stdout.columns || 80));
  const top = chalk.hex(activeTheme.muted)(`┌─ ${language} ${'─'.repeat(Math.max(1, maxLineLen - language.length - 3))}`);
  const bottom = chalk.hex(activeTheme.muted)(`└${'─'.repeat(Math.max(3, maxLineLen))}`);
  return `\n${top}\n${lines.join('\n')}\n${bottom}\n`;
};

// Inline code
renderer.codespan = function(token) {
  return chalk.hex(activeTheme.accent)(token?.text || '');
};

// Links
renderer.link = function(token) {
  return `${chalk.hex(activeTheme.accent)(token?.text || '')} ${chalk.dim('(' + (token?.href || '') + ')')}`;
};

// Blockquotes with left-bar accent
renderer.blockquote = function(token) {
  const inner = token.tokens ? marked.parser(token.tokens) : (token.text || '');
  const clean = inner
    .replace(/<\/?p>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  const bar = chalk.hex(activeTheme.accent)('│');
  return clean.split('\n').map(line => `${bar} ${chalk.italic(line)}`).join('\n') + '\n';
};

// Lists with task-list checkbox support
renderer.list = function(token) {
  const items = token.items || [];
  const ordered = token.ordered;
  const depth = listDepth++;
  const indent = '  ' + '  '.repeat(depth);
  const nestedIndent = '  ' + '  '.repeat(depth + 1);
  try {
    return '\n' + items.map((item, i) => {
      const isTask = item.task === true;
      const checked = item.checked === true;
      const bullet = isTask
        ? checked ? chalk.hex(activeTheme.success || '#a6e3a1')('✔ ') : chalk.dim('◻ ')
        : ordered ? chalk.dim(`${(token.start || 1) + i}. `) : chalk.dim('• ');
      const tokens = item.tokens || [];
      const primaryTokens = tokens.filter(child => child.type !== 'list');
      const nestedTokens = tokens.filter(child => child.type === 'list');
      const primary = primaryTokens.length > 0
        ? marked.parser(primaryTokens).trim().replace(/\n+/g, ' ')
        : (item.text || '').replace(/\n+/g, ' ').trim();
      const content = checked ? chalk.dim.strikethrough(primary) : primary;
      const nested = nestedTokens
        .map(child => marked.parser([child]).trim())
        .filter(Boolean)
        .join('\n');
      return `${indent}${bullet}${content}${nested ? `\n${nested.split('\n').map(line => line.startsWith('  ') ? line : `${nestedIndent}${line}`).join('\n')}` : ''}`;
    }).join('\n') + '\n';
  } finally {
    listDepth--;
  }
};

// List items (not typically called directly when list renderer is defined, but kept for safety)
renderer.listitem = function(token) {
  return token.tokens ? renderInline(token.tokens) : (token.text || '');
};

// Horizontal rules
renderer.hr = function() {
  return `\n${chalk.dim('─'.repeat(Math.min(60, process.stdout.columns || 80)))}\n`;
};

// Bold text (inline)
renderer.strong = function(token) {
  return chalk.bold(token?.text || '');
};

// Italic text (inline)
renderer.em = function(token) {
  return chalk.italic(token?.text || '');
};

// Strikethrough (inline)
renderer.del = function(token) {
  return chalk.dim.strikethrough(token?.text || '');
};

// Paragraphs - render inline tokens for proper formatting
renderer.paragraph = function(token) {
  const content = token.tokens ? renderInline(token.tokens) : (token.text || '');
  return `\n${content}\n`;
};

// Tables with lightweight separators
renderer.table = function(token) {
  try {
    const header = token?.header || [];
    const rows = token?.rows || [];
    const headerCells = header.map(cell => cell?.text || '');
    const colWidths = headerCells.map((col, i) => {
      let maxWidth = stripAnsi(col).length;
      rows.forEach(row => {
        maxWidth = Math.max(maxWidth, stripAnsi(row[i]?.text || '').length);
      });
      return Math.min(maxWidth, 40);
    });
    const padCell = (text, width) => {
      const visible = stripAnsi(text);
      const padding = Math.max(0, width - visible.length);
      return text + ' '.repeat(padding);
    };
    const formatRow = (cells, isHeader) => {
      const styled = cells.map((cell) => {
        const text = typeof cell === 'string' ? cell : cell?.text || '';
        return isHeader ? chalk.bold(text) : text;
      });
      return '  ' + styled.map((text, i) => padCell(text, colWidths[i])).join(chalk.dim('  │  '));
    };
    const headerRow = formatRow(headerCells, true);
    const separatorLen = stripAnsi(headerRow).length - 2;
    const separator = '  ' + '─'.repeat(Math.max(8, separatorLen));
    const bodyRows = rows.map(row => formatRow(row.map(cell => cell?.text || ''), false));
    return `\n${headerRow}\n${chalk.dim(separator)}\n${bodyRows.join('\n')}\n`;
  } catch {
    return '\n' + (token?.text || '') + '\n';
  }
};

// Image
renderer.image = function(token) {
  return chalk.dim(`[Image: ${token?.text || 'untitled'}]`);
};

// Line breaks
renderer.br = function() {
  return '\n';
};

// Configure marked with custom renderer
marked.use({ renderer });

/**
 * Render markdown text for terminal display.
 * Falls back to plain text if rendering fails.
 */
export function renderMarkdown(text, theme = activeTheme) {
  if (!text || typeof text !== 'string') return text || '';
  activeTheme = { ...activeTheme, ...(theme || {}) };
  listDepth = 0;
  try {
    const result = marked.parse(text);
    listDepth = 0;
    return typeof result === 'string' ? result.trimEnd() : text;
  } catch {
    listDepth = 0;
    return text;
  }
}

/**
 * Render a code block with custom styling.
 */
export function renderCodeBlock(code, language = 'text', theme = activeTheme) {
  activeTheme = { ...activeTheme, ...(theme || {}) };
  return renderer.code({ text: code, lang: language });
}
