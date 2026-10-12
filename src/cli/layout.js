/**
 * Terminal layout helpers: display-width measurement, ANSI-aware wrapping
 * and truncation. All UI code should use these instead of String#length.
 */

import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import sliceAnsi from 'slice-ansi';

export function termColumns(fallback = 80) {
  const cols = process.stdout.columns;
  return Number.isFinite(cols) && cols > 0 ? cols : fallback;
}

export function displayWidth(text) {
  return stringWidth(String(text ?? ''));
}

/** Wrap text (ANSI-safe) to `width` columns; returns an array of physical lines. */
export function wrapLines(text, width) {
  const w = Math.max(10, Math.floor(width));
  return wrapAnsi(String(text ?? ''), w, { hard: true, trim: false, wordWrap: true })
    .split('\n')
    .map(line => line.replace(/ +$/, ''));
}

/** Truncate to `width` display columns, adding an ellipsis when cut. */
export function clipLine(text, width) {
  const str = String(text ?? '');
  const w = Math.max(1, Math.floor(width));
  if (displayWidth(str) <= w) return str;
  return `${sliceAnsi(str, 0, Math.max(0, w - 1))}…\x1b[0m`;
}

/**
 * Indent a (possibly multi-line) block with `prefix` on every physical line,
 * wrapping so no line exceeds the terminal width. Continuation lines of a
 * wrapped line keep the same prefix.
 */
export function indentBlock(text, prefix = '  ', columns = termColumns()) {
  const inner = Math.max(20, columns - displayWidth(prefix) - 1);
  return String(text ?? '')
    .split('\n')
    .flatMap(line => (line === '' ? [''] : wrapLines(line, inner)))
    .map(line => (line === '' ? '' : `${prefix}${line}`))
    .join('\n');
}

/** Pad to an exact display width. */
export function padEndWidth(text, width) {
  const str = String(text ?? '');
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}
