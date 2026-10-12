import { describe, it, expect, vi, afterEach } from 'vitest';
import stripAnsi from 'strip-ansi';
import { displayWidth, wrapLines, clipLine, indentBlock } from '../../src/cli/layout.js';
import { renderMarkdown } from '../../src/cli/markdown.js';
import { findCommitBoundary, createStreamingRenderer } from '../../src/cli/display.js';

const widest = (text) => Math.max(...stripAnsi(text).split('\n').map(displayWidth));

describe('layout helpers', () => {
  it('measures wide characters by display width', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日本')).toBe(4);
  });

  it('wraps and clips without exceeding the width', () => {
    const lines = wrapLines('word '.repeat(40), 30);
    expect(Math.max(...lines.map(displayWidth))).toBeLessThanOrEqual(30);
    expect(displayWidth(clipLine('x'.repeat(100), 20))).toBeLessThanOrEqual(20);
  });

  it('indentBlock keeps every physical line within the column budget', () => {
    const out = indentBlock('lorem ipsum '.repeat(30), '  ', 40);
    expect(widest(out)).toBeLessThanOrEqual(39);
  });
});

describe('markdown width safety', () => {
  const original = process.stdout.columns;
  afterEach(() => { process.stdout.columns = original; });

  it('keeps code, lists, quotes and tables inside a narrow terminal', () => {
    process.stdout.columns = 50;
    const md = [
      '# Title', '',
      'Paragraph with `inline` and **bold** text.', '',
      '```js', 'const veryLongVariableName = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);', 'x', 'y', '```', '',
      '- first item that is quite long and has to wrap across multiple lines of output',
      '- second', '',
      '> a quoted line that is also long enough to need wrapping in a narrow terminal', '',
      '| Name | Description |', '| --- | --- |', '| alpha | a fairly long description that must wrap inside the cell |',
    ].join('\n');
    const out = renderMarkdown(md);
    expect(widest(out)).toBeLessThanOrEqual(50 - 4);
    expect(stripAnsi(out)).toContain('Title');
    expect(stripAnsi(out)).not.toContain('**');
  });
});

describe('findCommitBoundary', () => {
  it('waits for a blank line and ignores blanks inside fences', () => {
    expect(findCommitBoundary('partial line')).toBe(0);
    expect(findCommitBoundary('para\n\nnext')).toBe('para\n\n'.length);
    const fenced = '```js\nconst a = 1;\n\nconst b = 2;\n';
    expect(findCommitBoundary(fenced)).toBe(0);
    expect(findCommitBoundary(`${fenced}\`\`\`\n`)).toBe(`${fenced}\`\`\`\n`.length);
  });
});

describe('streaming renderer', () => {
  it('writes append-only output with no cursor movement sequences', () => {
    const chunks = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { chunks.push(String(c)); return true; });
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => { chunks.push(`${a.join(' ')}\n`); });
    try {
      const cli = {
        theme: { accent: '#89b4fa', muted: '#6c7086', header: '#cba6f7' },
        isMarkdownEnabled: () => true,
        session: { agent: { model: 'test/model' } },
        taskStartTime: 1,
      };
      const r = createStreamingRenderer(cli);
      for (const piece of ['Hello ', 'world.\n', '\nSecond ', 'paragraph.']) r.write(piece);
      expect(r.finish('Hello world.\n\nSecond paragraph.')).toBe('rendered');
      const all = stripAnsi(chunks.join(''));
      expect(all).toContain('Hello world.');
      expect(all).toContain('Second paragraph.');
      expect(chunks.join('')).not.toMatch(/\x1b\[\d*A/);
      expect(all.match(/Hello world\./g)).toHaveLength(1);
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });
});
