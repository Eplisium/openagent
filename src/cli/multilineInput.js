/**
 * 📝 Multiline Input Widget for OpenAgent CLI
 *
 * Features:
 * - Multi-line editing with cursor navigation
 * - Arrow keys, Home/End, Ctrl+arrows for word jump
 * - Shift+arrows for text selection
 * - Ctrl+C copy, Ctrl+V paste, Ctrl+X cut
 * - Ctrl+Z undo, Ctrl+Y redo
 * - Ctrl+K kill to end of line, Ctrl+U kill to start
 * - Ctrl+W delete word backward
 * - Ctrl+A select all
 * - Ctrl+O for newline, Enter to send
 * - Ctrl+K (when line is empty) to exit/cancel
 * - Paste support for multi-line text
 */

import chalk from '../utils/chalk-compat.js';
import { resetTerminalInput } from './terminal.js';
import fs from '../utils/fs-compat.js';
import path from 'path';
import os from 'os';
import { displayWidth, clipLine } from './layout.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const PASTE_ON = '\x1b[?2004h';
const PASTE_OFF = '\x1b[?2004l';
const PRINTABLE = /^[^\x00-\x1f\x7f]+$/u;
// One key per match: CSI/SS3/Alt sequences, CRLF, or a single code point.
const KEY_PATTERN = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1bO[\s\S]|\x1b[\s\S]?|\r\n|[\s\S]/gu;

function prevBoundary(line, col) {
  let prev = 0;
  for (const { index } of segmenter.segment(line)) {
    if (index >= col) break;
    prev = index;
  }
  return prev;
}

function nextBoundary(line, col) {
  for (const { index, segment } of segmenter.segment(line)) {
    if (index >= col) return index + segment.length;
  }
  return line.length;
}

// History file path
const HISTORY_FILE = path.join(os.homedir(), '.openagent', 'history.json');

// ═══════════════════════════════════════════════════════════════════
// 📋 In-process clipboard
// ═══════════════════════════════════════════════════════════════════

let _clip = '';

// ═══════════════════════════════════════════════════════════════════
// 📝 MultilineInput Class
// ═══════════════════════════════════════════════════════════════════

export class MultilineInput {
  constructor(opts = {}) {
    this.prompt = opts.prompt || '❯ ';
    this.placeholder = opts.placeholder || '';
    this.statusLine = opts.statusLine || '';
    this.echo = opts.echo !== false;
    this._acBase = null;
    this._exitArmedAt = 0;
    this._pasting = false;
    this._pasteBuf = '';
    this.theme = opts.theme || { muted: '#6c7086' };
    this.stdin = opts.stdin || process.stdin;
    this.stdout = opts.stdout || process.stdout;

    // Text state
    this.lines = [''];
    this.row = 0;
    this.col = 0;

    // Selection anchor
    this.sel = null; // {row, col} or null

    // Undo/redo
    this.undoStack = [];
    this.redoStack = [];

    // Input history
    this.history = [];         // Array of past inputs
    this.historyIndex = -1;    // Current position in history
    this.savedDraft = '';      // Save current text when browsing history

    // Rendering
    this._rendered = 0; // number of lines last rendered
    this._cursorRenderLine = 0; // cursor line within the rendered block
    this._renderedRows = 0;
    this._cursorRenderRow = 0;
    this._active = false;
    this._resolve = null;
    this._handler = null;
    this._wasRaw = false;

    // Autocomplete
    this.commands = opts.commands || [];  // Array of command strings like ['/help', '/model', ...]
    this._autocompleteMatches = [];
    this._autocompleteIndex = -1;

    // Reverse search
    this._searchMode = false;
    this._searchQuery = '';
    this._searchMatches = [];
    this._searchIndex = 0;

    // Load history from disk
    this._loadHistory();
  }

  /**
   * Load command history from disk
   */
  _loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readJSONSync(HISTORY_FILE);
        if (Array.isArray(data)) {
          this.history = data.slice(-500); // Keep last 500 entries
        }
      }
    } catch {
      // Silently ignore corrupt history files
      this.history = [];
    }
  }

  /**
   * Save command history to disk
   */
  _saveHistory() {
    try {
      fs.ensureDirSync(path.dirname(HISTORY_FILE));
      fs.writeJSONSync(HISTORY_FILE, this.history.slice(-500));
    } catch {
      // Silently ignore write failures
    }
  }

  setText(text) {
    if (!text) return;
    this.lines = text.split('\n');
    this.row = this.lines.length - 1;
    this.col = this.lines[this.row].length;
    this._pushUndo();
  }

  async start() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._wasRaw = this.stdin.isRaw;
      if (!this.stdin.isRaw) this.stdin.setRawMode(true);
      this.stdin.resume();
      this.stdin.setEncoding('utf8');
      this._handler = (d) => this._onData(d);
      this.stdin.on('data', this._handler);
      this._onResize = () => this._render();
      this.stdout.on?.('resize', this._onResize);
      try { this.stdout.write(PASTE_ON); } catch { /* non-tty stdout */ }
      this._active = true;
      this._render();
    });
  }

  cleanup() {
    if (!this._active) return;
    this._active = false;
    this.stdin.removeListener('data', this._handler);
    if (this._onResize) this.stdout.removeListener?.('resize', this._onResize);
    try { this.stdout.write(PASTE_OFF); } catch { /* non-tty stdout */ }
    if (!this._wasRaw) {
      try { this.stdin.setRawMode(false); } catch { /* setRawMode may fail if stream closed */ }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🎹 Key handling
  // ═══════════════════════════════════════════════════════════

  _onData(data) {
    if (!this._active) return;
    data = String(data);

    if (this._pasting || data.includes(PASTE_START)) {
      this._onBracketedPaste(data);
      return;
    }

    const keys = data.match(KEY_PATTERN) || [];
    if (keys.length <= 1) {
      if (keys.length === 1) this._onKey(keys[0]);
      return;
    }

    if (!data.includes('\x1b') && !this._searchMode) {
      if (PRINTABLE.test(data)) {
        this._insertText(data);
        return;
      }
      const newlines = (data.match(/\r\n|\r|\n/g) || []).length;
      if (newlines > 0) {
        const trailing = /(\r\n|\r|\n)$/.test(data);
        const body = data.replace(/\r\n|\r/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\t/g, '  ');
        if (trailing && newlines === 1) {
          this._insertText(body.replace(/\n$/, ''));
          this._submit();
        } else if (body) {
          this._insertText(body);
        }
        return;
      }
    }

    for (const key of keys) {
      if (!this._active) break;
      this._onKey(key);
    }
  }

  _onBracketedPaste(data) {
    let rest = data;
    while (rest.length && this._active) {
      if (!this._pasting) {
        const start = rest.indexOf(PASTE_START);
        if (start === -1) { this._onData(rest); return; }
        if (start > 0) this._onData(rest.slice(0, start));
        this._pasting = true;
        this._pasteBuf = '';
        rest = rest.slice(start + PASTE_START.length);
      } else {
        const end = rest.indexOf(PASTE_END);
        if (end === -1) { this._pasteBuf += rest; return; }
        this._pasteBuf += rest.slice(0, end);
        this._pasting = false;
        const cleaned = this._pasteBuf
          .replace(/\r\n|\r/g, '\n')
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
          .replace(/\t/g, '  ');
        this._pasteBuf = '';
        if (cleaned && !this._searchMode) this._insertText(cleaned);
        rest = rest.slice(end + PASTE_END.length);
      }
    }
  }

  _onKey(data) {
    if (!this._active) return;

    if (this._searchMode) {
      this._handleSearchKey(data);
      return;
    }

    if (data !== '\t') this._acBase = null;
    if (data !== '\x03') this._exitArmedAt = 0;

    // Enter variants: CR, LF and CRLF all submit (Windows terminals vary).
    if (data === '\r\n' || data === '\r' || data === '\n') {
      this._submit();
      return;
    }

    // Portable newline shortcuts (Ctrl+O, Alt+Enter, kitty/xterm modified Enter).
    if (data === '\x0f' || data === '\x1b\r' || data === '\x1b\n' || data === '\x1b[13;2u' || data === '\x1b[27;13;2~') {
      this._newline();
      return;
    }

    // Ctrl+C: copy selection, else clear the buffer, else (twice) exit.
    if (data === '\x03') {
      if (this._hasSel()) {
        this._copy();
      } else if (this.lines.some(l => l.length > 0)) {
        this.lines = [''];
        this.row = 0;
        this.col = 0;
        this.historyIndex = -1;
        this._render();
      } else if (this._exitArmedAt && Date.now() - this._exitArmedAt < 2000) {
        this._cancel();
      } else {
        this._exitArmedAt = Date.now();
        this._render();
      }
      return;
    }

    if (data === '\x7f' || data === '\b') { this._backspace(); return; }
    if (data === '\x1b[3~') { this._delete(); return; }
    if (data === '\x1b\x7f' || data === '\x1b\b') { this._delWordBack(); return; }

    if (data === '\t') { this._handleAutocomplete(); return; }

    if (data === '\x1b') {
      if (this.sel) { this.sel = null; this._render(); }
      return;
    }

    if (data === '\x01') { this._selectAll(); return; }
    if (data === '\x16') { this._paste(); return; }
    if (data === '\x18') { this._cut(); return; }
    if (data === '\x1a') { this._undo(); return; }
    if (data === '\x19') { this._redo(); return; }
    if (data === '\x17') { this._delWordBack(); return; }
    if (data === '\x0b') {
      if (this.lines.length === 1 && this.lines[0] === '' && !this._hasSel()) {
        this._cancel();
      } else {
        this._killToEnd();
      }
      return;
    }
    if (data === '\x15') { this._killToStart(); return; }
    if (data === '\x0c') {
      this._clearRenderedBlock();
      this.cleanup();
      if (this._resolve) this._resolve(MultilineInput.CLEAR_SCREEN);
      return;
    }
    if (data === '\x12') { this._enterSearchMode(); return; }
    if (data === '\x14') {
      this._clearRenderedBlock();
      this.cleanup();
      if (this._resolve) this._resolve(MultilineInput.CYCLE_THEME);
      return;
    }
    if (data === '\x10') {
      this._clearRenderedBlock();
      this.cleanup();
      if (this._resolve) this._resolve(MultilineInput.SHOW_STATS);
      return;
    }

    switch (data) {
      case '\x1b[D': case '\x1bOD': this._left(false); return;
      case '\x1b[C': case '\x1bOC': this._right(false); return;
      case '\x1b[A': case '\x1bOA': this._up(); return;
      case '\x1b[B': case '\x1bOB': this._down(); return;
      case '\x1b[1;2D': this._left(true); return;
      case '\x1b[1;2C': this._right(true); return;
      case '\x1b[1;2A': this._up(); return;
      case '\x1b[1;2B': this._down(); return;
      case '\x1b[1;5D': case '\x1b[1;3D': case '\x1bb': this._wordLeft(); return;
      case '\x1b[1;5C': case '\x1b[1;3C': case '\x1bf': this._wordRight(); return;
      case '\x1b[H': case '\x1b[1~': case '\x1bOH': this.col = 0; this.sel = null; this._render(); return;
      case '\x1b[F': case '\x1b[4~': case '\x1bOF': this.col = this.lines[this.row].length; this.sel = null; this._render(); return;
      default: break;
    }

    // Unknown escape sequences (function keys, mouse reports, ...) are ignored.
    if (data.startsWith('\x1b')) return;

    if (PRINTABLE.test(data)) this._insert(data);
  }

  // ═══════════════════════════════════════════════════════════
  // 🖥️ Rendering
  // ═══════════════════════════════════════════════════════════

  _render() {
    if (!this._active) return;

    const cols = this.stdout.columns || 80;
    const promptStr = this.prompt;
    const promptW = this._sw(promptStr);
    const contentW = Math.max(10, cols - promptW - 1);

    const disp = [];
    for (let i = 0; i < this.lines.length; i++) {
      for (const chunk of this._chunks(this.lines[i], contentW)) {
        disp.push({ li: i, text: chunk.text, w: chunk.start });
      }
    }

    let curIdx = 0;
    for (let d = 0; d < disp.length; d++) {
      if (disp[d].li === this.row && disp[d].w <= this.col) curIdx = d;
    }

    const cursorSegment = disp[curIdx] || { w: 0, text: '' };
    const curCol = promptW + Math.min(contentW, this._sw(cursorSegment.text.slice(0, Math.max(0, this.col - cursorSegment.w))));

    const out = [];
    if (this.statusLine) {
      out.push('');
      out.push(this._fitLine(this.statusLine, cols));
    }

    const isEmpty = this.lines.length === 1 && this.lines[0] === '';
    for (let d = 0; d < disp.length; d++) {
      const dl = disp[d];
      const prefix = dl.w > 0 || dl.li > 0 ? ' '.repeat(promptW) : promptStr;
      if (isEmpty && this.placeholder) {
        out.push(prefix + clipLine(chalk.dim(this.placeholder), contentW));
      } else {
        out.push(prefix + this._renderSel(dl.li, dl.text, dl.w));
      }
    }

    out.push(this._fitLine(' '.repeat(promptW) + this._hint(), cols));

    this._clearRenderedBlock();
    this.stdout.write(out.join('\n'));

    const cursorLine = (this.statusLine ? 2 : 0) + curIdx;
    const rowCounts = out.map(line => this._wrapRows(line, cols));
    const totalOutRows = rowCounts.reduce((sum, rows) => sum + rows, 0);
    const cursorVisualRow = rowCounts.slice(0, cursorLine).reduce((sum, rows) => sum + rows, 0);
    const linesUp = totalOutRows - 1 - cursorVisualRow;
    if (linesUp > 0) this.stdout.write(`\x1b[${linesUp}A`);
    this.stdout.write('\r');
    if (curCol > 0) this.stdout.write(`\x1b[${curCol}C`);

    this._rendered = out.length;
    this._cursorRenderLine = cursorLine;
    this._renderedRows = totalOutRows;
    this._cursorRenderRow = cursorVisualRow;
  }

  _clearRenderedBlock() {
    const renderedRows = this._renderedRows || this._rendered;
    const cursorRow = this._cursorRenderRow || this._cursorRenderLine;
    if (renderedRows <= 0) return;

    if (cursorRow > 0) {
      this.stdout.write(`\x1b[${cursorRow}A`);
    }

    for (let i = 0; i < renderedRows; i++) {
      this.stdout.write('\r\x1b[2K');
      if (i < renderedRows - 1) {
        this.stdout.write('\x1b[1B');
      }
    }

    if (renderedRows > 1) {
      this.stdout.write(`\x1b[${renderedRows - 1}A`);
    }

    this.stdout.write('\r');
    this._rendered = 0;
    this._cursorRenderLine = 0;
    this._renderedRows = 0;
    this._cursorRenderRow = 0;
  }

  _renderSel(li, text, colOff) {
    if (!this._hasSel()) return text;
    const s = this._normSel();
    if (li < s.sr || li > s.er) return text;

    const len = this.lines[li].length;
    let sc = 0, ec = len;
    if (li === s.sr) sc = Math.max(0, s.sc - colOff);
    if (li === s.er) ec = Math.min(len, s.ec - colOff);
    if (sc >= text.length) return text;

    return text.slice(0, sc) + chalk.bgCyan.black(text.slice(sc, ec)) + text.slice(ec);
  }

  _sw(s) {
    return displayWidth(s);
  }

  _wrapRows(line, cols) {
    const width = Math.max(1, cols || 80);
    return Math.max(1, Math.ceil(this._sw(String(line || '')) / width));
  }

  _fitLine(line, cols) {
    return clipLine(String(line || ''), Math.max(1, (cols || 80) - 1));
  }

  _chunks(line, width) {
    if (!line) return [{ start: 0, text: '' }];
    const out = [];
    let start = 0;
    let text = '';
    let used = 0;
    for (const { segment, index } of segmenter.segment(line)) {
      const w = displayWidth(segment);
      if (used + w > width && text) {
        out.push({ start, text });
        start = index;
        text = '';
        used = 0;
      }
      text += segment;
      used += w;
    }
    out.push({ start, text });
    return out;
  }

  _hint() {
    const dim = chalk.hex(this.theme.muted);
    if (this._searchMode) {
      const match = this._searchMatches[this._searchIndex];
      const shown = match ? match.split('\n')[0] : 'no match';
      return dim(`search: ${this._searchQuery}│ → ${shown}   Enter accept · Ctrl+R next · Esc cancel`);
    }
    if (this._exitArmedAt && Date.now() - this._exitArmedAt < 2000) {
      return chalk.hex(this.theme.warning || this.theme.muted)('Press Ctrl+C again to exit');
    }
    const before = (this.lines[this.row] || '').slice(0, this.col);
    const base = this._acBase ?? before;
    if (this.lines.length === 1 && /^\/\S*$/.test(base) && this.commands.length) {
      const matches = this.commands.filter(c => c.startsWith(base)).slice(0, 6);
      if (matches.length) return dim(`${matches.join('  ')}  · Tab completes`);
    }
    const parts = ['↵ send', '^O newline'];
    if (this.lines.length > 1) parts.push(`${this.lines.length} lines`);
    parts.push('^R search');
    return dim(parts.join(' · '));
  }

  // ═══════════════════════════════════════════════════════════
  // ✏️ Editing
  // ═══════════════════════════════════════════════════════════

  _pushUndo() {
    this.undoStack.push({ l: [...this.lines], r: this.row, c: this.col });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  _undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push({ l: [...this.lines], r: this.row, c: this.col });
    const s = this.undoStack.pop();
    this.lines = s.l; this.row = s.r; this.col = s.c; this.sel = null;
    this._render();
  }

  _redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push({ l: [...this.lines], r: this.row, c: this.col });
    const s = this.redoStack.pop();
    this.lines = s.l; this.row = s.r; this.col = s.c; this.sel = null;
    this._render();
  }

  _insert(ch) {
    this._delSel();
    this._pushUndo();
    const l = this.lines[this.row];
    this.lines[this.row] = l.slice(0, this.col) + ch + l.slice(this.col);
    this.col += ch.length;
    this.sel = null;
    this._render();
  }

  _newline() {
    this._delSel();
    this._pushUndo();
    const l = this.lines[this.row];
    this.lines.splice(this.row + 1, 0, l.slice(this.col));
    this.lines[this.row] = l.slice(0, this.col);
    this.row++;
    this.col = 0;
    this.sel = null;
    this._render();
  }

  _backspace() {
    if (this._hasSel()) { this._delSel(); return; }
    if (this.col > 0) {
      this._pushUndo();
      const l = this.lines[this.row];
      const to = prevBoundary(l, this.col);
      this.lines[this.row] = l.slice(0, to) + l.slice(this.col);
      this.col = to;
    } else if (this.row > 0) {
      this._pushUndo();
      this.col = this.lines[this.row - 1].length;
      this.lines[this.row - 1] += this.lines[this.row];
      this.lines.splice(this.row, 1);
      this.row--;
    }
    this.sel = null;
    this._render();
  }

  _delete() {
    if (this._hasSel()) { this._delSel(); return; }
    const l = this.lines[this.row];
    if (this.col < l.length) {
      this._pushUndo();
      this.lines[this.row] = l.slice(0, this.col) + l.slice(nextBoundary(l, this.col));
    } else if (this.row < this.lines.length - 1) {
      this._pushUndo();
      this.lines[this.row] += this.lines[this.row + 1];
      this.lines.splice(this.row + 1, 1);
    }
    this.sel = null;
    this._render();
  }

  _delWordBack() {
    if (this._hasSel()) { this._delSel(); return; }
    if (this.col === 0) { this._backspace(); return; }
    this._pushUndo();
    const l = this.lines[this.row];
    let c = this.col - 1;
    while (c > 0 && /\s/.test(l[c])) c--;
    while (c > 0 && /\w/.test(l[c - 1])) c--;
    this.lines[this.row] = l.slice(0, c) + l.slice(this.col);
    this.col = c;
    this.sel = null;
    this._render();
  }

  _killToEnd() {
    this._pushUndo();
    const l = this.lines[this.row];
    _clip = l.slice(this.col);
    this.lines[this.row] = l.slice(0, this.col);
    this.sel = null;
    this._render();
  }

  _killToStart() {
    this._pushUndo();
    const l = this.lines[this.row];
    _clip = l.slice(0, this.col);
    this.lines[this.row] = l.slice(this.col);
    this.col = 0;
    this.sel = null;
    this._render();
  }

  // ═══════════════════════════════════════════════════════════
  // 🧭 Navigation
  // ═══════════════════════════════════════════════════════════

  _left(shift) {
    if (shift) {
      this._startSel();
    } else if (this._hasSel()) {
      const s = this._normSel();
      this.row = s.sr; this.col = s.sc; this.sel = null;
      this._render(); return;
    } else {
      this.sel = null;
    }
    if (this.col > 0) this.col = prevBoundary(this.lines[this.row], this.col);
    else if (this.row > 0) { this.row--; this.col = this.lines[this.row].length; }
    if (shift) { this._anchor().r = this.row; this._anchor().c = this.col; }
    this._render();
  }

  _right(shift) {
    if (shift) {
      this._startSel();
    } else if (this._hasSel()) {
      const s = this._normSel();
      this.row = s.er; this.col = s.ec; this.sel = null;
      this._render(); return;
    } else {
      this.sel = null;
    }
    if (this.col < this.lines[this.row].length) this.col = nextBoundary(this.lines[this.row], this.col);
    else if (this.row < this.lines.length - 1) { this.row++; this.col = 0; }
    if (shift) { this._anchor().r = this.row; this._anchor().c = this.col; }
    this._render();
  }

  _up() {
    if (this._hasSel()) {
      const s = this._normSel();
      this.row = s.sr; this.col = s.sc;
    } else if (this.row > 0) {
      this.row--;
      this.col = Math.min(this.col, this.lines[this.row].length);
    } else {
      this.sel = null;
      this._historyPrev();
      return;
    }
    this.sel = null;
    this._render();
  }

  _down() {
    if (this._hasSel()) {
      const s = this._normSel();
      this.row = s.er; this.col = s.ec;
    } else if (this.row < this.lines.length - 1) {
      this.row++;
      this.col = Math.min(this.col, this.lines[this.row].length);
    } else {
      this.sel = null;
      this._historyNext();
      return;
    }
    this.sel = null;
    this._render();
  }

  _loadText(text) {
    this.lines = String(text).split('\n');
    this.row = this.lines.length - 1;
    this.col = this.lines[this.row].length;
    this.sel = null;
    this._render();
  }

  _historyPrev() {
    if (!this.history.length) return;
    if (this.historyIndex === -1) {
      this.savedDraft = this.lines.join('\n');
      this.historyIndex = this.history.length;
    }
    if (this.historyIndex === 0) return;
    this.historyIndex--;
    this._loadText(this.history[this.historyIndex]);
  }

  _historyNext() {
    if (this.historyIndex === -1) return;
    this.historyIndex++;
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = -1;
      this._loadText(this.savedDraft);
      return;
    }
    this._loadText(this.history[this.historyIndex]);
  }

  _wordLeft() {
    this.sel = null;
    if (this.col === 0 && this.row > 0) {
      this.row--; this.col = this.lines[this.row].length;
    } else {
      const l = this.lines[this.row];
      let c = this.col - 1;
      while (c > 0 && /\s/.test(l[c])) c--;
      while (c > 0 && /\w/.test(l[c - 1])) c--;
      this.col = Math.max(0, c);
    }
    this._render();
  }

  _wordRight() {
    this.sel = null;
    const l = this.lines[this.row];
    if (this.col >= l.length && this.row < this.lines.length - 1) {
      this.row++; this.col = 0;
    } else {
      let c = this.col;
      while (c < l.length && /\w/.test(l[c])) c++;
      while (c < l.length && /\s/.test(l[c])) c++;
      this.col = c;
    }
    this._render();
  }

  // ═══════════════════════════════════════════════════════════
  // 🔦 Selection
  // ═══════════════════════════════════════════════════════════

  _hasSel() {
    if (!this.sel) return false;
    return this.sel.row !== this.row || this.sel.col !== this.col;
  }

  _normSel() {
    const a = this.sel, b = { row: this.row, col: this.col };
    if (a.row < b.row || (a.row === b.row && a.col <= b.col))
      return { sr: a.row, sc: a.col, er: b.row, ec: b.col };
    return { sr: b.row, sc: b.col, er: a.row, ec: a.col };
  }

  _startSel() {
    if (!this.sel) this.sel = { row: this.row, col: this.col };
  }

  // Returns a mutable reference to the "anchor" end of the selection
  _anchor() {
    return this.sel;
  }

  _selectAll() {
    this.sel = { row: 0, col: 0 };
    this.row = this.lines.length - 1;
    this.col = this.lines[this.row].length;
    this._render();
  }

  // ═══════════════════════════════════════════════════════════
  // 📋 Clipboard
  // ═══════════════════════════════════════════════════════════

  _getSelText() {
    if (!this._hasSel()) return '';
    const s = this._normSel();
    if (s.sr === s.er) return this.lines[s.sr].slice(s.sc, s.ec);
    let t = this.lines[s.sr].slice(s.sc) + '\n';
    for (let i = s.sr + 1; i < s.er; i++) t += this.lines[i] + '\n';
    t += this.lines[s.er].slice(0, s.ec);
    return t;
  }

  _copy() { _clip = this._getSelText(); }

  _cut() {
    _clip = this._getSelText();
    this._delSel();
  }

  _paste() {
    if (_clip) this._insertText(_clip);
  }

  _delSel() {
    if (!this._hasSel()) return;
    this._pushUndo();
    const s = this._normSel();
    if (s.sr === s.er) {
      const l = this.lines[s.sr];
      this.lines[s.sr] = l.slice(0, s.sc) + l.slice(s.ec);
    } else {
      const first = this.lines[s.sr].slice(0, s.sc);
      const last = this.lines[s.er].slice(s.ec);
      this.lines.splice(s.sr, s.er - s.sr + 1, first + last);
    }
    this.row = s.sr;
    this.col = s.sc;
    this.sel = null;
    this._render();
  }

  _insertText(text) {
    this._delSel();
    this._pushUndo();
    const parts = text.split('\n');
    const line = this.lines[this.row];
    const before = line.slice(0, this.col);
    const after = line.slice(this.col);

    if (parts.length === 1) {
      this.lines[this.row] = before + parts[0] + after;
      this.col += parts[0].length;
    } else {
      this.lines[this.row] = before + parts[0];
      const mid = parts.slice(1);
      mid[mid.length - 1] = mid[mid.length - 1] + after;
      this.lines.splice(this.row + 1, 0, ...mid);
      this.row += parts.length - 1;
      this.col = mid[mid.length - 1].length - after.length;
    }
    this.sel = null;
    this._render();
  }

  // ═══════════════════════════════════════════════════════════
  // 🔍 Autocomplete & Reverse Search
  // ═══════════════════════════════════════════════════════════

  _handleAutocomplete() {
    const line = this.lines[this.row] || '';
    const before = line.slice(0, this.col);

    if (this._acBase == null) {
      if (!before.startsWith('/') || /\s/.test(before)) {
        this._insert('  ');
        return;
      }
      this._acBase = before;
      this._autocompleteIndex = -1;
    }

    const matches = (this.commands || []).filter(c => c.startsWith(this._acBase));
    if (matches.length === 0) {
      this._acBase = null;
      this._insert('  ');
      return;
    }

    this._autocompleteIndex = (this._autocompleteIndex + 1) % matches.length;
    const match = matches[this._autocompleteIndex] + (matches.length === 1 ? ' ' : '');
    this.lines[this.row] = match + line.slice(this.col);
    this.col = match.length;
    this._render();
  }

  _enterSearchMode() {
    this._searchMode = true;
    this._searchQuery = '';
    this._searchIndex = 0;
    this._searchMatches = [];
    this._render();
  }

  _exitSearchMode() {
    this._searchMode = false;
    this._searchQuery = '';
    this._searchMatches = [];
    this._render();
  }

  _handleSearchKey(data) {
    // Escape = exit search mode
    if (data === '\x1b') {
      this._exitSearchMode();
      return;
    }
    // Enter = accept current match and exit search mode
    if (data === '\r' || data === '\n') {
      if (this._searchMatches.length > 0 && this._searchIndex < this._searchMatches.length) {
        const match = this._searchMatches[this._searchIndex];
        this.lines = [match];
        this.row = 0;
        this.col = match.length;
      }
      this._exitSearchMode();
      return;
    }
    // Ctrl+R = cycle through matches
    if (data === '\x12') {
      if (this._searchMatches.length > 0) {
        this._searchIndex = (this._searchIndex + 1) % this._searchMatches.length;
      }
      this._render();
      return;
    }
    // Backspace = remove last char from query
    if (data === '\x7f' || data === '\b') {
      if (this._searchQuery.length > 0) {
        this._searchQuery = this._searchQuery.slice(0, -1);
        this._updateSearchMatches();
      } else {
        this._exitSearchMode();
      }
      this._render();
      return;
    }
    // Printable character = append to query
    if (/^[^\x00-\x1f\x7f]+$/u.test(data)) {
      this._searchQuery += data;
      this._updateSearchMatches();
      this._searchIndex = 0;
      this._render();
      return;
    }
  }

  _updateSearchMatches() {
    const q = this._searchQuery.toLowerCase();
    this._searchMatches = this.history.filter(line =>
      line.toLowerCase().includes(q)
    ).slice(0, 20);
    this._searchIndex = 0;
  }

  // ═══════════════════════════════════════════════════════════
  // ✅ Submit / Cancel
  // ═══════════════════════════════════════════════════════════

  _submit() {
    const result = this.lines.join('\n').trim();
    const promptW = this._sw(this.prompt);

    this._clearRenderedBlock();

    if (this.echo) {
      for (let i = 0; i < this.lines.length; i++) {
        const prefix = i === 0 ? this.prompt : ' '.repeat(promptW);
        this.stdout.write(prefix + this.lines[i] + '\n');
      }
    }

    if (result && this.history[this.history.length - 1] !== result) {
      this.history.push(result);
      if (this.history.length > 500) this.history.shift();
      this._saveHistory();
    }

    this.cleanup();
    if (this._resolve) this._resolve(this.lines.join('\n'));
  }

  // Cancel sentinel — returned when user explicitly exits
  static CANCEL = Symbol('CANCEL');
  // Keyboard shortcut sentinels
  static CLEAR_SCREEN = Symbol('CLEAR_SCREEN');
  static CYCLE_THEME = Symbol('CYCLE_THEME');
  static SHOW_STATS = Symbol('SHOW_STATS');
  static CLEAR_INPUT = Symbol('CLEAR_INPUT');

  _cancel() {
    // Clear rendered area
    this._clearRenderedBlock();

    this.cleanup();
    this.stdout.write(chalk.dim('(exit)\n'));
    if (this._resolve) this._resolve(MultilineInput.CANCEL);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🚀 Convenience
// ═══════════════════════════════════════════════════════════════════

export async function multilinePrompt(opts = {}) {
  const input = new MultilineInput(opts);
  if (opts.initialText) input.setText(opts.initialText);
  await resetTerminalInput(input.stdin);
  return input.start();
}

export default { MultilineInput, multilinePrompt };
