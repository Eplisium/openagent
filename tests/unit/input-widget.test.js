import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { MultilineInput } from '../../src/cli/multilineInput.js';

function makeInput(opts = {}) {
  const stdin = Object.assign(new EventEmitter(), {
    isRaw: false, setRawMode() {}, resume() {}, setEncoding() {},
  });
  const stdout = Object.assign(new EventEmitter(), { columns: 80, rows: 24, write() { return true; } });
  const input = new MultilineInput({ stdin, stdout, history: [], echo: false, ...opts });
  input.history = opts.history || [];
  input._saveHistory = () => {};
  input._active = true;
  return input;
}

describe('MultilineInput', () => {
  it('inserts bracketed paste as one block with normalized newlines', () => {
    const input = makeInput();
    input._onData('\x1b[200~line1\r\nline2\x1b[201~');
    expect(input.lines).toEqual(['line1', 'line2']);
  });

  it('buffers a paste split across chunks', () => {
    const input = makeInput();
    input._onData('\x1b[200~ab');
    input._onData('c\ndef\x1b[201~');
    expect(input.lines).toEqual(['abc', 'def']);
  });

  it('backspace removes a whole grapheme cluster', () => {
    const input = makeInput();
    input._onData('a👍🏽');
    input._onData('\x7f');
    expect(input.lines[0]).toBe('a');
  });

  it('recalls history with up/down and restores the draft', () => {
    const input = makeInput({ history: ['first', 'second'] });
    input._onData('draft');
    input._onData('\x1b[A');
    expect(input.lines[0]).toBe('second');
    input._onData('\x1b[A');
    expect(input.lines[0]).toBe('first');
    input._onData('\x1b[B');
    input._onData('\x1b[B');
    expect(input.lines[0]).toBe('draft');
  });

  it('cycles slash-command completions on repeated Tab', () => {
    const input = makeInput({ commands: ['/help', '/history', '/model'] });
    input._onData('/h');
    input._onData('\t');
    expect(input.lines[0]).toBe('/help');
    input._onData('\t');
    expect(input.lines[0]).toBe('/history');
  });

  it('Ctrl+C clears text first and only exits on a second press when empty', () => {
    const input = makeInput();
    let cancelled = false;
    input._cancel = () => { cancelled = true; };
    input._onData('hello');
    input._onData('\x03');
    expect(input.lines).toEqual(['']);
    expect(cancelled).toBe(false);
    input._onData('\x03');
    expect(cancelled).toBe(false);
    input._onData('\x03');
    expect(cancelled).toBe(true);
  });

  it('submits when a chunk is text followed by a single newline', () => {
    const input = makeInput();
    let submitted = null;
    input._submit = () => { submitted = input.lines.join('\n'); };
    input._onData('hello world\r');
    expect(submitted).toBe('hello world');
  });
});
