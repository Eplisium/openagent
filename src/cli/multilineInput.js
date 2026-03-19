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
 * - Shift+Enter for newline, Enter to send
 * - Ctrl+K (when line is empty) to exit/cancel
 * - Paste support for multi-line text
 */

import chalk from 'chalk';

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
    this.stdin = process.stdin;
    this.stdout = process.stdout;

    // Text state
    this.lines = [''];
    this.row = 0;
    this.col = 0;

    // Selection anchor
    this.sel = null; // {row, col} or null

    // Undo/redo
    this.undoStack = [];
    this.redoStack = [];

    // Rendering
    this._rendered = 0; // number of lines last rendered
    this._cursorRenderLine = 0; // cursor line within the rendered block
    this._active = false;
    this._resolve = null;
    this._handler = null;
    this._wasRaw = false;
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
      this._active = true;
      this._render();
    });
  }

  cleanup() {
    if (!this._active) return;
    this._active = false;
    this.stdin.removeListener('data', this._handler);
    if (!this._wasRaw) {
      try { this.stdin.setRawMode(false); } catch {}
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🎹 Key handling
  // ═══════════════════════════════════════════════════════════

  _onData(data) {
    if (!this._active) return;

    // Some Windows terminals deliver Enter as CRLF in raw mode.
    if (data === '\r\n') {
      this._submit();
      return;
    }

    // Paste: multi-char non-escape
    if (data.length > 1 && !data.startsWith('\x1b')) {
      const cleaned = data
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      if (cleaned) {
        this._insertText(cleaned);
      }
      return;
    }

    // Ctrl+C — copy selection if any, otherwise ignore (use Ctrl+K or /exit to quit)
    if (data === '\x03') {
      if (this._hasSel()) {
        this._copy();
      }
      // If no selection, do nothing — prevents accidental exit
      return;
    }

    // Enter = submit
    if (data === '\r') {
      this._submit();
      return;
    }

    // Shift+Enter (some terminals send \n)
    if (data === '\n') {
      this._newline();
      return;
    }

    // Backspace
    if (data === '\x7f' || data === '\b') {
      this._backspace();
      return;
    }

    // Delete
    if (data === '\x1b[3~') {
      this._delete();
      return;
    }

    // Tab = insert 2 spaces
    if (data === '\t') {
      this._insert('  ');
      return;
    }

    // Escape = clear selection
    if (data === '\x1b') {
      if (this.sel) { this.sel = null; this._render(); }
      return;
    }

    // Ctrl+A = select all
    if (data === '\x01') { this._selectAll(); return; }
    // Ctrl+V = paste
    if (data === '\x16') { this._paste(); return; }
    // Ctrl+X = cut
    if (data === '\x18') { this._cut(); return; }
    // Ctrl+Z = undo
    if (data === '\x1a') { this._undo(); return; }
    // Ctrl+Y = redo
    if (data === '\x19') { this._redo(); return; }
    // Ctrl+W = delete word back
    if (data === '\x17') { this._delWordBack(); return; }
    // Ctrl+K = kill to end of line (or cancel if buffer is empty)
    if (data === '\x0b') {
      if (this.lines.length === 1 && this.lines[0] === '' && !this._hasSel()) {
        this._cancel();
      } else {
        this._killToEnd();
      }
      return;
    }
    // Ctrl+U = kill to start of line
    if (data === '\x15') { this._killToStart(); return; }

    // Arrow keys & shift variants
    if (data === '\x1b[D') { this._left(false); return; }
    if (data === '\x1b[C') { this._right(false); return; }
    if (data === '\x1b[A') { this._up(); return; }
    if (data === '\x1b[B') { this._down(); return; }
    if (data === '\x1b[1;2D') { this._left(true); return; }  // Shift+Left
    if (data === '\x1b[1;2C') { this._right(true); return; } // Shift+Right
    if (data === '\x1b[1;2A') { this._up(); return; }        // Shift+Up
    if (data === '\x1b[1;2B') { this._down(); return; }      // Shift+Down
    if (data === '\x1b[1;5D') { this._wordLeft(); return; }  // Ctrl+Left
    if (data === '\x1b[1;5C') { this._wordRight(); return; } // Ctrl+Right

    // Home / End
    if (data === '\x1b[H' || data === '\x1b[1~') { this.col = 0; this.sel = null; this._render(); return; }
    if (data === '\x1b[F' || data === '\x1b[4~') { this.col = this.lines[this.row].length; this.sel = null; this._render(); return; }

    // Printable character
    if (data >= ' ') {
      this._insert(data);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🖥️ Rendering
  // ═══════════════════════════════════════════════════════════

  _render() {
    if (!this._active) return;

    const cols = this.stdout.columns || 80;
    const promptStr = this.prompt;
    const promptW = this._sw(promptStr);
    const contentW = Math.max(20, cols - promptW - 1);

    // Build display lines with wrapping
    const disp = [];
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (line.length === 0) {
        disp.push({ li: i, text: '', w: 0 });
      } else {
        for (let j = 0; j < line.length; j += contentW) {
          disp.push({ li: i, text: line.slice(j, j + contentW), w: j });
        }
      }
    }
    if (disp.length === 0) disp.push({ li: 0, text: '', w: 0 });

    // Find cursor display index
    let curIdx = 0;
    for (let d = 0; d < disp.length; d++) {
      if (disp[d].li === this.row && disp[d].w <= this.col && (d + 1 >= disp.length || disp[d + 1].li !== this.row || disp[d + 1].w > this.col)) {
        curIdx = d;
        break;
      }
      if (disp[d].li > this.row) { curIdx = Math.max(0, d - 1); break; }
      curIdx = d;
    }

    const curCol = promptW + (this.col % contentW);

    // Build output lines
    const out = [];

    // Status line at top (blank line + model info)
    if (this.statusLine) {
      out.push('');
      out.push(this.statusLine);
    }

    // Placeholder when empty
    const isEmpty = this.lines.length === 1 && this.lines[0] === '';
    if (isEmpty && this.placeholder) {
      out.push(chalk.dim(this.placeholder));
    }

    // Content
    for (let d = 0; d < disp.length; d++) {
      const dl = disp[d];
      const prefix = dl.w > 0 ? ' '.repeat(promptW) : promptStr;
      const content = this._renderSel(dl.li, dl.text, dl.w);
      out.push(prefix + content);
    }

    // Status bar at bottom
    const totalChars = this.lines.reduce((s, l) => s + l.length, 0) + Math.max(0, this.lines.length - 1);
    const status = chalk.dim(`Ln ${this.row + 1}, Col ${this.col + 1} │ ${this.lines.length} lines, ${totalChars} chars`);
    const help = chalk.dim('↵ send · ⇧↵ newline · Ctrl+V paste · Ctrl+K exit');
    out.push(' '.repeat(promptW) + status);
    out.push(' '.repeat(promptW) + help);

    // Clear previous render
    this._clearRenderedBlock();

    // Write all lines
    this.stdout.write(out.join('\n'));

    // Position cursor within the content area
    // offset = how many lines before the content starts
    const contentOffset = (this.statusLine ? 2 : 0) + (isEmpty && this.placeholder ? 1 : 0);
    const cursorLine = contentOffset + curIdx;
    const totalOut = out.length;
    const linesUp = totalOut - 1 - cursorLine;
    if (linesUp > 0) {
      this.stdout.write(`\x1b[${linesUp}A`);
    }
    this.stdout.write('\r');
    if (curCol > 0) {
      this.stdout.write(`\x1b[${curCol}C`);
    }

    this._rendered = out.length;
    this._cursorRenderLine = cursorLine;
  }

  _clearRenderedBlock() {
    if (this._rendered <= 0) return;

    if (this._cursorRenderLine > 0) {
      this.stdout.write(`\x1b[${this._cursorRenderLine}A`);
    }

    for (let i = 0; i < this._rendered; i++) {
      this.stdout.write('\r\x1b[2K');
      if (i < this._rendered - 1) {
        this.stdout.write('\x1b[1B');
      }
    }

    if (this._rendered > 1) {
      this.stdout.write(`\x1b[${this._rendered - 1}A`);
    }

    this.stdout.write('\r');
    this._rendered = 0;
    this._cursorRenderLine = 0;
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
    return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').length;
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
      this.lines[this.row] = l.slice(0, this.col - 1) + l.slice(this.col);
      this.col--;
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
      this.lines[this.row] = l.slice(0, this.col) + l.slice(this.col + 1);
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
    if (this.col > 0) this.col--;
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
    if (this.col < this.lines[this.row].length) this.col++;
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
    }
    this.sel = null;
    this._render();
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
  // ✅ Submit / Cancel
  // ═══════════════════════════════════════════════════════════

  _submit() {
    const result = this.lines.join('\n').trim();

    // Print the final input with prompt prefix before cleaning up
    const promptW = this._sw(this.prompt);

    // Clear rendered area
    this._clearRenderedBlock();

    // Print submitted text
    for (let i = 0; i < this.lines.length; i++) {
      const prefix = i === 0 ? this.prompt : ' '.repeat(promptW);
      this.stdout.write(prefix + this.lines[i] + '\n');
    }

    this.cleanup();
    // Return the raw joined text (empty string is valid — means user submitted nothing)
    if (this._resolve) this._resolve(this.lines.join('\n'));
  }

  // Cancel sentinel — returned when user explicitly exits
  static CANCEL = Symbol('CANCEL');

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
  return input.start();
}

export default { MultilineInput, multilinePrompt };
