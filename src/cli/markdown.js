/**
 * Enhanced Markdown rendering for OpenAgent CLI terminal display.
 * Provides rich terminal output with proper formatting for code, headers, links, etc.
 */

import chalk from '../utils/chalk-compat.js';
import { marked } from 'marked';
import { highlightCode } from './syntaxHighlight.js';

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
        return token.escaped ? token.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : token.text;
      case 'strong':
        return chalk.bold(token.text || '');
      case 'em':
        return chalk.italic(token.text || '');
      case 'del':
        return chalk.dim.strikethrough(token.text || '');
      case 'codespan':
        return chalk.cyan.bold.bgGray(` ${token.text || ''} `);
      case 'link':
        return `${chalk.cyan(token.text || '')} ${chalk.dim('(' + (token.href || '') + ')')}`;
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

// Headers with box-drawing characters
renderer.heading = function(token) {
  const text = token.text || '';
  const level = token.depth || 1;
  const widths = { 1: 50, 2: 40, 3: 30, 4: 25, 5: 20, 6: 18 };
  const width = widths[level] || 20;
  const prefix = '━'.repeat(Math.floor((width - text.length - 1) / 2));
  const suffix = '━'.repeat(Math.ceil((width - text.length - 1) / 2));
  
  if (level === 1) {
    return `\n${chalk.bold.underline(prefix + ' ' + text + ' ' + suffix)}\n`;
  }
  return `\n${chalk.bold(prefix + ' ' + text + ' ' + suffix)}\n`;
};

// Code blocks with syntax highlighting and line numbers
renderer.code = function(token) {
  const code = token?.text || '';
  const language = token?.lang || 'text';
  const highlighted = highlightCode(code, language);
  const lines = highlighted.split('\n');
  const numbered = lines.map((line, i) => {
    const num = String(i + 1).padStart(4);
    return `${chalk.dim.gray(num)} │ ${line}`;
  });
  const maxLineLen = Math.max(...lines.map(l => l.length), 40);
  const topBorder = chalk.dim('┌' + '─'.repeat(maxLineLen + 6) + '┐');
  const langLabel = chalk.dim(` ${language} `);
  const bottomBorder = chalk.dim('└' + '─'.repeat(maxLineLen + 6) + '┘');
  return `\n${topBorder}\n${langLabel}\n${numbered.join('\n')}\n${bottomBorder}\n`;
};

// Inline code
renderer.codespan = function(token) {
  return chalk.cyan.bold.bgGray(` ${token?.text || ''} `);
};

// Links
renderer.link = function(token) {
  return `${chalk.cyan(token?.text || '')} ${chalk.dim('(' + (token?.href || '') + ')')}`;
};

// Blockquotes
renderer.blockquote = function(token) {
  const inner = token.tokens ? marked.parser(token.tokens) : (token.text || '');
  const clean = inner.replace(/<\/?p>/g, '').trim();
  return clean.split('\n').map(line => `${chalk.dim('│')} ${chalk.dim(line)}`).join('\n') + '\n';
};

// Lists - iterate items properly
renderer.list = function(token) {
  const items = token.items || [];
  const ordered = token.ordered;
  return '\n' + items.map((item, i) => {
    const bullet = ordered ? `${(token.start || 1) + i}. ` : '• ';
    const content = item.tokens ? renderInline(item.tokens) : (item.text || '');
    return `  ${chalk.dim(bullet)}${content}`;
  }).join('\n') + '\n';
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

// Tables
renderer.table = function(token) {
  try {
    const header = token?.header || [];
    const rows = token?.rows || [];
    const headerCells = header.map(cell => cell?.text || '');
    const colWidths = headerCells.map((col, i) => {
      let maxWidth = col.length;
      rows.forEach(row => {
        maxWidth = Math.max(maxWidth, (row[i]?.text || '').length);
      });
      return maxWidth;
    });
    const formatRow = (cells) => {
      return cells.map((cell, i) => {
        const text = typeof cell === 'string' ? cell : cell?.text || '';
        return text.padEnd(colWidths[i] || text.length);
      }).join(' │ ');
    };
    const headerRow = formatRow(headerCells);
    const separator = colWidths.map(w => '─'.repeat(w)).join('─┼─');
    const bodyRows = rows.map(row => formatRow(row.map(cell => cell?.text || '')));
    return `\n${chalk.bold(headerRow)}\n${chalk.dim(separator)}\n${bodyRows.join('\n')}\n`;
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
export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';
  try {
    const result = marked.parse(text);
    return typeof result === 'string' ? result.trimEnd() : text;
  } catch {
    return text;
  }
}

/**
 * Render a code block with custom styling.
 */
export function renderCodeBlock(code, language = 'text') {
  return renderer.code({ text: code, lang: language });
}
