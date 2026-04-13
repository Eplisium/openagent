import { describe, it, expect } from 'vitest';
import { ToolFormatAdapter } from '../../src/tools/ToolFormatAdapter.js';

describe('ToolFormatAdapter', () => {
  const internalTools = [
    {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['query'],
      },
    },
  ];

  it('detects providers from model names', () => {
    expect(ToolFormatAdapter.detectProvider('anthropic/claude-3.5-sonnet')).toBe('anthropic');
    expect(ToolFormatAdapter.detectProvider('google/gemini-2.0-flash')).toBe('google');
    expect(ToolFormatAdapter.detectProvider('mistralai/mistral-small')).toBe('mistral');
    expect(ToolFormatAdapter.detectProvider('gpt-4o')).toBe('openai');
  });

  it('formats tools for OpenAI-compatible providers', () => {
    const formatted = ToolFormatAdapter.formatToolDefinitions(internalTools, 'openai');

    expect(Array.isArray(formatted)).toBe(true);
    expect(formatted).toHaveLength(1);
    expect(formatted[0]).toEqual({
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web',
        parameters: internalTools[0].parameters,
      },
    });
  });

  it('formats tools for Anthropic', () => {
    const formatted = ToolFormatAdapter.formatToolDefinitions(internalTools, 'anthropic');

    expect(Array.isArray(formatted)).toBe(true);
    expect(formatted).toHaveLength(1);
    expect(formatted[0]).toEqual({
      name: 'web_search',
      description: 'Search the web',
      input_schema: internalTools[0].parameters,
    });
  });

  it('formats tools for Google Gemini', () => {
    const formatted = ToolFormatAdapter.formatToolDefinitions(internalTools, 'google');

    expect(formatted).toEqual({
      function_declarations: [
        {
          name: 'web_search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              count: { type: 'number' },
            },
            required: ['query'],
          },
        },
      ],
    });
  });
});
