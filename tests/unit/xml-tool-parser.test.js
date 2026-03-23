import { describe, it, expect } from 'vitest';
import { parseXmlToolCalls, hasXmlToolCalls } from '../../src/tools/xmlToolParser.js';

describe('xmlToolParser', () => {
  it('parses canonical xml tool calls', () => {
    const content = `I'll help with that.\n<tool_call>\n  <function_name>web_search</function_name>\n  <parameters>\n    <query>top tech news</query>\n    <count>5</count>\n  </parameters>\n</tool_call>`;

    const result = parseXmlToolCalls(content);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
    expect(result.toolCalls[0].arguments).toEqual({ query: 'top tech news', count: 5 });
    expect(result.cleanContent).toBe("I'll help with that.");
  });

  it('parses inline function/parameter format from mimo-style output', () => {
    const content = `I'll search for the latest news for you today.<tool_call>\n<function=web_search>\n<parameter=query>latest news today March 22 2026</parameter>\n<parameter=count>10</parameter>\n</function>\n</tool_call>`;

    const result = parseXmlToolCalls(content);
    expect(hasXmlToolCalls(content)).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
    expect(result.toolCalls[0].arguments).toEqual({
      query: 'latest news today March 22 2026',
      count: 10,
    });
    expect(result.cleanContent).toBe("I'll search for the latest news for you today.");
  });

  it('detects xml-ish tool call hints beyond canonical tags', () => {
    const content = '<tool_call><function=web_search><parameter=query>hi</parameter></function></tool_call>';
    expect(hasXmlToolCalls(content)).toBe(true);
  });
});
