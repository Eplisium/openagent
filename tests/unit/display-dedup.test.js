import { describe, expect, it, vi } from 'vitest';
import {
  contentWasAlreadyRendered,
  printAIResponse,
  printIntermediateContent,
  stripAlreadyRenderedPrefix,
} from '../../src/cli/display.js';

function createCli() {
  return {
    theme: {
      accent: '#89b4fa',
      muted: '#6c7086',
      text: '#cdd6f4',
      assistant: '#cdd6f4',
      header: '#cba6f7',
    },
    taskStartTime: Date.now(),
    _toolLineStates: [],
    isMarkdownEnabled: () => false,
  };
}

describe('CLI display response render deduplication', () => {
  it('strips an already-rendered intermediate prefix and keeps only the final suffix', () => {
    const cli = createCli();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      printIntermediateContent(cli, 'I inspected the renderer and found the duplicate final print path.');

      expect(stripAlreadyRenderedPrefix(
        cli,
        'I inspected the renderer and found the duplicate final print path.\n\nThe fix is to print only this suffix.'
      )).toBe('The fix is to print only this suffix.');
    } finally {
      log.mockRestore();
    }
  });

  it('tracks multiple intermediate blocks, not only the most recent one', () => {
    const cli = createCli();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      printIntermediateContent(cli, 'First intermediate block that later appears at the start of the final answer.');
      printIntermediateContent(cli, 'Second intermediate block from the post-tool iteration callback.');

      expect(contentWasAlreadyRendered(
        cli,
        'First intermediate block that later appears at the start of the final answer.'
      )).toBe(true);
      expect(stripAlreadyRenderedPrefix(
        cli,
        'First intermediate block that later appears at the start of the final answer.\n\nNew final detail.'
      )).toBe('New final detail.');
    } finally {
      log.mockRestore();
    }
  });

  it('prints only the unrendered suffix when the final response extends intermediate content', () => {
    const cli = createCli();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      printIntermediateContent(cli, 'Intermediate answer already shown to the user.');
      printAIResponse(cli, 'Intermediate answer already shown to the user.\n\nAdditional final sentence.');

      const output = log.mock.calls.flat().join('\n');
      expect(output).toContain('Additional final sentence.');
      expect(output.match(/Intermediate answer already shown/g)).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });
});
