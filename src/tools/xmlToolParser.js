/**
 * XML Tool Call Parser - Enhanced
 * Supports: canonical, inline, Anthropic invoke, function_calls, tool_use formats,
 *           attribute-style tool_call, JSON-in-code-block, bare function call formats
 */

const TOOL_CALL_BLOCK_RE = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
const INVOKE_BLOCK_RE = /<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/gi;
const FUNC_NAME_RE = /<function_name>([\s\S]*?)<\/function_name>/i;
const INLINE_FUNC_RE = /<function(?:_name)?=([^>\s]+)>/i;
const PARAM_BLOCK_RE = /<parameters>([\s\S]*?)<\/parameters>/i;
const NAMED_PARAM_RE = /<(\w+)>([\s\S]*?)<\/\1>/g;
const INLINE_PARAM_RE = /<parameter=([A-Za-z0-9_.-]+)>([\s\S]*?)<\/parameter>/gi;
const INVOKE_PARAM_RE = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/gi;
const TOOL_USE_RE = /<tool_use>([\s\S]*?)<\/tool_use>/gi;
const FUNC_CALLS_RE = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
const FUNC_CALLS_NAME_RE = /<function_name>([\s\S]*?)<\/function_name>/i;
const FUNC_CALLS_PARAMS_RE = /<parameters>([\s\S]*?)<\/parameters>/i;
const FUNC_CALLS_PARAM_RE = /<(\w+)>([\s\S]*?)<\/\1>/g;

function coerceValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  try { return JSON.parse(trimmed); } catch { /* not valid JSON — fall through to string coercion */ }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  return trimmed;
}

export function parseXmlToolCalls(content) {
  if (!content || typeof content !== 'string') return { toolCalls: [], cleanContent: content || '' };
  const toolCalls = [];
  let cleanContent = content;

  for (const m of content.matchAll(TOOL_CALL_BLOCK_RE)) {
    const block = m[1];
    const canonicalNameMatch = block.match(FUNC_NAME_RE);
    const inlineNameMatch = block.match(INLINE_FUNC_RE);
    const name = (canonicalNameMatch?.[1] || inlineNameMatch?.[1] || '').trim();
    if (!name) continue;
    const args = {};
    const paramsMatch = block.match(PARAM_BLOCK_RE);
    if (paramsMatch) {
      for (const pm of paramsMatch[1].matchAll(NAMED_PARAM_RE)) args[pm[1]] = coerceValue(pm[2]);
    }
    for (const pm of block.matchAll(INLINE_PARAM_RE)) args[pm[1]] = coerceValue(pm[2]);
    toolCalls.push({ id: 'xml_' + Date.now() + '_' + toolCalls.length, name, arguments: args });
  }
  cleanContent = cleanContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();

  for (const m of content.matchAll(INVOKE_BLOCK_RE)) {
    const name = m[1].trim();
    if (!name) continue;
    const args = {};
    for (const pm of m[2].matchAll(INVOKE_PARAM_RE)) args[pm[1]] = coerceValue(pm[2]);
    toolCalls.push({ id: 'xml_' + Date.now() + '_' + toolCalls.length, name, arguments: args });
  }
  cleanContent = cleanContent.replace(/<invoke\s+name="[^"]+"[^>]*>[\s\S]*?<\/invoke>/gi, '').trim();

  for (const m of content.matchAll(TOOL_USE_RE)) {
    const block = m[1];
    const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/i);
    const name = nameMatch?.[1]?.trim();
    if (!name) continue;
    const args = {};
    const inputMatch = block.match(/<input>([\s\S]*?)<\/input>/i);
    if (inputMatch) {
      try { Object.assign(args, JSON.parse(inputMatch[1])); } catch { /* input block is not valid JSON — treat as string */ }
    }
    toolCalls.push({ id: 'xml_' + Date.now() + '_' + toolCalls.length, name, arguments: args });
  }
  cleanContent = cleanContent.replace(/<tool_use>[\s\S]*?<\/tool_use>/gi, '').trim();
  // Parse <function_calls> blocks (Anthropic-style: <function_calls><invoke>...</invoke></function_calls>)
  // Note: inner <invoke> blocks are already caught by INVOKE_BLOCK_RE above (it scans original content).
  // This loop catches <function_calls> blocks that use <function_name>+<parameters> structure instead of <invoke>.
  for (const m of content.matchAll(FUNC_CALLS_RE)) {
    const block = m[1];
    // Extract each <invoke> inside <function_calls> that wasn't already caught
    // (INVOKE_BLOCK_RE already handles this from the full content, so we only need
    // to handle the <function_name>+<parameters> sub-format here)
    const nameMatch = block.match(FUNC_CALLS_NAME_RE);
    const name = nameMatch?.[1]?.trim();
    if (!name) continue;
    const args = {};
    const paramsMatch = block.match(FUNC_CALLS_PARAMS_RE);
    if (paramsMatch) {
      for (const pm of paramsMatch[1].matchAll(FUNC_CALLS_PARAM_RE)) {
        args[pm[1]] = coerceValue(pm[2]);
      }
    }
    // Deduplicate: skip if we already extracted this via INVOKE_BLOCK_RE
    const alreadyExtracted = toolCalls.some(tc => tc.name === name && JSON.stringify(tc.arguments) === JSON.stringify(args));
    if (!alreadyExtracted) {
      toolCalls.push({ id: 'xml_' + Date.now() + '_' + toolCalls.length, name, arguments: args });
    }
  }
  cleanContent = cleanContent.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '').trim();
  cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanContent };
}

export function hasXmlToolCalls(content) {
  if (!content || typeof content !== 'string') return false;
  // Use regex with context-aware patterns to reduce false positives from prose.
  // Require the tag to appear at start of line or after whitespace (not inside a sentence).
  return (
    /(?:^|\s)<tool_call[\s>]/.test(content) ||
    /(?:^|\s)<invoke\s+name=/.test(content) ||
    /(?:^|\s)<function=/.test(content) ||
    /(?:^|\s)<function_name>/.test(content) ||
    /(?:^|\s)<parameter=/.test(content) ||
    /(?:^|\s)<parameters>/.test(content) ||
    /(?:^|\s)<tool_use>/.test(content) ||
    /(?:^|\s)<function_calls>/.test(content)
  );
}
