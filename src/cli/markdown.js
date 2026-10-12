/**
 * Markdown rendering for OpenAgent terminal output.
 * Output is width-aware: code, lists, quotes and tables never exceed the
 * terminal width, so callers can safely indent and print the result.
 */

import chalk from '../utils/chalk-compat.js';
import { marked } from 'marked';
import { highlightCode } from './syntaxHighlight.js';
import { displayWidth, wrapLines, padEndWidth, termColumns } from './layout.js';

let activeTheme = {
  accent: '#89b4fa',
  muted: '#6c7086',
  text: '#cdd6f4',
  success: '#a6e3a1',
};
let listDepth = 0;

// Space left for markdown content after the caller's indent.
function contentWidth() {
  return Math.max(30, termColumns() - 6);
}

function renderInline(tokens) {
  if (!tokens || !Array.isArray(tokens)) return '';
  return tokens.map(token => {
    switch (token.type) {
      case 'text':
        if (token.tokens && token.tokens.length > 0) return renderInline(token.tokens);
        return token.text || '';
      case 'strong':
        return chalk.bold(token.tokens ? renderInline(token.tokens) : (token.text || ''));
      case 'em':
        return chalk.italic(token.tokens ? renderInline(token.tokens) : (token.text || ''));
      case 'del':
        return chalk.dim.strikethrough(token.text || '');
      case 'codespan':
        return chalk.hex(activeTheme.accent)(token.text || '');
      case 'link': {
        const label = token.tokens ? renderInline(token.tokens) : (token.text || '');
        const href = token.href || '';
        if (!href || label === href || token.text === href) return chalk.hex(activeTheme.accent).underline(href || label);
        return `${chalk.hex(activeTheme.accent)(label)} ${chalk.dim(`(${href})`)}`;
      }
      case 'image':
        return chalk.dim(`[Image: ${token.text || 'untitled'}]`);
      case 'br':
        return '\n';
      case 'html':
        return '';
      case 'escape':
        return token.text || '';
      default:
        return token.text || token.raw || '';
    }
  }).join('');
}

const renderer = {};

renderer.heading = function(token) {
  const text = token.tokens ? renderInline(token.tokens) : (token.text || '');
  const level = token.depth || 1;
  if (level === 1) return `\n${chalk.hex(activeTheme.accent).bold.underline(text)}\n`;
  if (level === 2) return `\n${chalk.hex(activeTheme.accent).bold(text)}\n`;
  if (level === 3) return `\n${chalk.bold(text)}\n`;
  return `\n${chalk.bold.dim(text)}\n`;
};

renderer.code = function(token) {
  const code = token?.text || '';
  const rawLanguage = String(token?.lang || '').trim().split(/\s+/)[0];
  const language = rawLanguage || 'text';
  const highlighted = highlightCode(code.replace(/\r/g, '').replace(/\n$/, ''), language, activeTheme);
  const gutter = chalk.hex(activeTheme.muted)('│ ');
  const width = contentWidth() - 2;
  const body = highlighted.split('\n').flatMap(line => (line === '' ? [''] : wrapLines(line, width)));
  const label = rawLanguage && rawLanguage !== 'text' ? ` ${rawLanguage}` : '';
  const top = chalk.hex(activeTheme.muted)(`╭─${label}`);
  const bottom = chalk.hex(activeTheme.muted)('╰─');
  return `\n${top}\n${body.map(line => `${gutter}${line}`).join('\n')}\n${bottom}\n`;
};

renderer.codespan = function(token) {
  return chalk.hex(activeTheme.accent)(token?.text || '');
};

renderer.link = function(token) {
  const label = token?.tokens ? renderInline(token.tokens) : (token?.text || '');
  return `${chalk.hex(activeTheme.accent)(label)} ${chalk.dim(`(${token?.href || ''})`)}`;
};

renderer.blockquote = function(token) {
  const inner = token.tokens ? marked.parser(token.tokens) : (token.text || '');
  const clean = inner.trim();
  const bar = chalk.hex(activeTheme.muted)('▎ ');
  const lines = clean.split('\n').flatMap(line => (line === '' ? [''] : wrapLines(line, contentWidth() - 2)));
  return `\n${lines.map(line => `${bar}${chalk.italic(line)}`).join('\n')}\n`;
};

renderer.list = function(token) {
  const items = token.items || [];
  const ordered = token.ordered;
  const depth = listDepth++;
  const indent = '  '.repeat(depth);
  try {
    const rendered = items.map((item, i) => {
      const isTask = item.task === true;
      const checked = item.checked === true;
      const marker = ordered ? `${(token.start || 1) + i}.` : '•';
      const bullet = isTask
        ? (checked ? chalk.hex(activeTheme.success || '#a6e3a1')('✔') : chalk.dim('○'))
        : chalk.hex(activeTheme.muted)(marker);
      const tokens = item.tokens || [];
      const primaryTokens = tokens.filter(child => child.type !== 'list');
      const nestedTokens = tokens.filter(child => child.type === 'list');
      const primary = primaryTokens.length > 0
        ? marked.parser(primaryTokens).trim().replace(/\n{2,}/g, '\n')
        : (item.text || '').trim();
      const content = checked ? chalk.dim.strikethrough(primary) : primary;
      const prefixWidth = indent.length + displayWidth(isTask ? '○' : marker) + 1;
      const hang = ' '.repeat(prefixWidth);
      const lines = content.split('\n').flatMap(line => wrapLines(line, Math.max(20, contentWidth() - prefixWidth)));
      const first = `${indent}${bullet} ${lines[0] ?? ''}`;
      const rest = lines.slice(1).map(line => `${hang}${line}`);
      const nested = nestedTokens.map(child => marked.parser([child]).replace(/^\n+|\n+$/g, '')).filter(Boolean);
      return [first, ...rest, ...nested].join('\n');
    }).join('\n');
    return `\n${rendered}\n`;
  } finally {
    listDepth--;
  }
};

renderer.listitem = function(token) {
  return token.tokens ? renderInline(token.tokens) : (token.text || '');
};

renderer.hr = function() {
  return `\n${chalk.hex(activeTheme.muted)('─'.repeat(Math.min(48, contentWidth())))}\n`;
};

renderer.paragraph = function(token) {
  const content = token.tokens ? renderInline(token.tokens) : (token.text || '');
  return `\n${content}\n`;
};

renderer.table = function(token) {
  try {
    const header = (token?.header || []).map(cell => (cell?.tokens ? renderInline(cell.tokens) : (cell?.text || '')));
    const rows = (token?.rows || []).map(row => row.map(cell => (cell?.tokens ? renderInline(cell.tokens) : (cell?.text || ''))));
    const cols = header.length;
    if (cols === 0) return '';
    const sep = chalk.hex(activeTheme.muted)(' │ ');
    const sepWidth = 3;
    const natural = header.map((h, i) => Math.max(
      displayWidth(h),
      ...rows.map(r => Math.max(...(r[i] || '').split('\n').map(displayWidth), 0)),
    ));
    const widths = [...natural];
    const available = contentWidth() - 2 - sepWidth * (cols - 1);
    const minCol = 6;
    while (widths.reduce((a, b) => a + b, 0) > available) {
      const maxIdx = widths.indexOf(Math.max(...widths));
      if (widths[maxIdx] <= minCol) break;
      widths[maxIdx]--;
    }
    const renderRow = (cells, style) => {
      const wrapped = cells.map((cell, i) => wrapLines(style ? style(cell) : cell, widths[i] || minCol));
      const height = Math.max(...wrapped.map(w => w.length));
      const out = [];
      for (let r = 0; r < height; r++) {
        out.push(`  ${wrapped.map((w, i) => padEndWidth(w[r] ?? '', widths[i])).join(sep)}`.trimEnd());
      }
      return out.join('\n');
    };
    const headerRow = renderRow(header, text => chalk.bold.hex(activeTheme.accent)(text));
    const rule = `  ${widths.map(w => '─'.repeat(w)).join('─┼─')}`;
    const body = rows.map(r => renderRow(Array.from({ length: cols }, (_, i) => r[i] || '')));
    return `\n${headerRow}\n${chalk.hex(activeTheme.muted)(rule)}\n${body.join('\n')}\n`;
  } catch {
    return `\n${token?.text || ''}\n`;
  }
};

renderer.strong = function(token) {
  return chalk.bold(token?.tokens ? renderInline(token.tokens) : (token?.text || ''));
};

renderer.em = function(token) {
  return chalk.italic(token?.tokens ? renderInline(token.tokens) : (token?.text || ''));
};

renderer.del = function(token) {
  return chalk.dim.strikethrough(token?.text || '');
};

renderer.html = function() {
  return '';
};

renderer.image = function(token) {
  return chalk.dim(`[Image: ${token?.text || 'untitled'}]`);
};

renderer.br = function() {
  return '\n';
};

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
    if (typeof result !== 'string') return text;
    return result.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  } catch {
    listDepth = 0;
    return text;
  }
}

export function renderCodeBlock(code, language = 'text', theme = activeTheme) {
  activeTheme = { ...activeTheme, ...(theme || {}) };
  return renderer.code({ text: code, lang: language });
}
