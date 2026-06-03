import { describe, expect, it } from 'vitest';
import {
  deduplicateResponse,
  responsesAreSimilar,
} from '../../src/cli/formatting.js';

describe('CLI formatting response deduplication', () => {
  it('deduplicates repeated LLM output beyond simple halves', () => {
    const line = 'TL;DR: the agent inspected the workspace, found the render overlap, and applied the display guard.';
    const repeated = Array.from({ length: 6 }, () => line).join('\n');

    expect(deduplicateResponse(repeated)).toBe(line);
  });

  it('deduplicates repeated near-identical paragraphs with formatting differences', () => {
    const paragraph = [
      'Summary:',
      '- The stream renderer committed the intermediate answer.',
      '- The final response should not print that same answer again.',
    ].join('\n');
    const repeated = [
      paragraph,
      'Summary:\n\n- The stream renderer committed the intermediate answer.\n- The final response should not print that same answer again.',
      paragraph,
    ].join('\n\n');

    expect(deduplicateResponse(repeated)).toBe(paragraph);
  });

  it('does not treat a much larger final answer as a duplicate of a short intermediate fragment', () => {
    const intermediate = 'I will inspect the renderer lifecycle and then patch the duplicate final print path.'.repeat(2);
    const final = `${intermediate}\n\nFindings:\n${'The final answer includes additional implementation and verification details. '.repeat(20)}`;

    expect(responsesAreSimilar(intermediate, final)).toBe(false);
  });
});
