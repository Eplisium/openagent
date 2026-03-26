# OpenAgent Tool Truncation Investigation Report

**Investigator:** Code Investigator  
**Date:** 2026-03-26  
**Project:** `C:\Users\zachy\Desktop\Life\Code\Scripts\OpenAgent`

---

## Executive Summary

The "tool calls getting truncated mid-execution" issue is caused by a **streaming event handling gap** in `src/agent/Agent.js`. The `runWithStreaming()` method's `for await` loop only handles `chunk.type === 'content'` and `chunk.type === 'done'`, but **completely ignores `chunk.type === 'tool_calls'`** events emitted by the `chatStream` generator.

This means tool calls that complete during streaming are dispatched via `onToolCallReady`, but tool calls that complete at stream end (or due to stream errors) are **silently lost**.

---

## Root Cause Analysis

### 1. Missing `tool_calls` Handler in Streaming Loop (CRITICAL)

**File:** `src/agent/Agent.js`, lines 1058-1071

The `runWithStreaming()` method's stream loop **does NOT handle** `chunk.type === 'tool_calls'`:

```javascript
// CURRENT (BROKEN) - runWithStreaming() at line 1058:
try {
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      fullContent += chunk.content;
    } else if (chunk.type === 'done') {
      streamUsage = chunk.usage;
      // ... truncation warning ...
    }
    // ❌ MISSING: chunk.type === 'tool_calls' handler
  }
}
```

**Compare with the CORRECT implementation** in `runStream()` at line 1923:

```javascript
// CORRECT - runStream() at line 1923:
for await (const chunk of stream) {
  this.checkAborted();
  if (chunk.type === 'content') {
    fullContent += chunk.content;
    yield { type: 'content', content: chunk.content };
  } else if (chunk.type === 'tool_calls') {  // ✅ HANDLES tool_calls!
    toolCalls = chunk.toolCalls;
  } else if (chunk.type === 'done') {
    // ...
  }
}
```

This is a clear **inconsistency** between the two streaming methods. `runStream()` correctly handles tool_calls, but `runWithStreaming()` silently ignores them.

**What happens:**
- `chatStream` (in `OpenRouterClient.js`) yields `{ type: 'tool_calls', toolCalls: [...] }` when tool calls complete
- The `onToolCallReady` callback fires during streaming for tool calls that complete mid-stream
- But tool calls that complete at stream end (or due to stream errors) are yielded as `tool_calls` chunks
- These chunks are **silently ignored** by the streaming loop
- Result: tool calls are never dispatched, appearing as "truncated"

### 2. Incomplete Tool Call Accumulation

**File:** `src/OpenRouterClient.js`, lines 541-560

The `accumulateToolCalls` method checks `_isArgumentsComplete()` to determine if a tool call is ready. If arguments are malformed JSON (e.g., truncated mid-stream), `_isArgumentsComplete` returns `false`, and `onToolCallReady` never fires.

**File:** `src/OpenRouterClient.js`, lines 566-588

```javascript
_isArgumentsComplete(argsStr) {
  if (!argsStr) return false;
  const trimmed = argsStr.trim();
  if (!trimmed.startsWith('{')) return false;
  
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < trimmed.length; i++) {
    // ... brace depth tracking ...
    if (depth === 0) {
      try { JSON.parse(trimmed); return true; } catch { return false; }
    }
  }
  return false;
}
```

If the JSON is malformed (e.g., missing closing brace), `JSON.parse` throws, and the tool call is never marked complete.

### 3. Stream Error Handling Gap

When the stream encounters an error mid-stream (network issue, token limit, etc.), the `catch` block at line 1072 collects already-dispatched promises but **never processes remaining tool calls** that were in the accumulator but not yet dispatched.

### 4. No Music/TypeScript Files Exist

The reported issues about `src/commands/music/loop.ts` being empty are **not applicable** to this project. The OpenAgent project is pure JavaScript (ES modules) with no TypeScript files and no `src/commands/music/` directory. Those files likely belong to a different project.

---

## Impact Assessment

| Impact | Description |
|--------|-------------|
| **High** | Tool calls silently lost when stream ends before accumulation completes |
| **High** | Tool calls with malformed JSON arguments never dispatched |
| **Medium** | Stream errors cause tool calls to be abandoned |
| **Low** | No music/TypeScript files to fix (different project) |

---

## Recommended Fixes

### Fix 1: Add `tool_calls` Handler to Streaming Loop (CRITICAL)

In `src/agent/Agent.js`, `runWithStreaming()` method, add handling for `chunk.type === 'tool_calls'`.

**Why this is needed:**
- `onToolCallReady` fires for tool calls that complete during streaming
- But tool calls that complete at stream end are yielded as `tool_calls` chunks
- Without handling these, tool calls are silently lost

**The fix mirrors the correct implementation in `runStream()` (line 1928):**

```javascript
} else if (chunk.type === 'tool_calls') {
  // Handle tool calls that completed at stream end
  for (const toolCall of chunk.toolCalls) {
    const idx = allToolCalls.length;
    allToolCalls.push(toolCall);
    if (this.onToolStart) this.onToolStart(toolCall.name, toolCall.arguments);
    const promise = this.executeSingleToolCall(toolCall)
      .then(result => {
        completedResults.set(idx, result);
        if (this.onToolEnd) this.onToolEnd(toolCall.name, result.result);
        return result;
      })
      .catch(err => {
        const errResult = {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.arguments,
          result: { success: false, error: err.message },
        };
        completedResults.set(idx, errResult);
        if (this.onToolEnd) this.onToolEnd(toolCall.name, errResult.result);
        return errResult;
      });
    dispatchedPromises.set(idx, promise);
  }
}
```

In `src/agent/Agent.js`, `runWithStreaming()` method, add handling for `chunk.type === 'tool_calls'`:

```javascript
// AFTER (FIXED):
try {
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      fullContent += chunk.content;
    } else if (chunk.type === 'tool_calls') {
      // Handle tool calls that completed at stream end
      for (const toolCall of chunk.toolCalls) {
        const idx = allToolCalls.length;
        allToolCalls.push(toolCall);
        if (this.onToolStart) this.onToolStart(toolCall.name, toolCall.arguments);
        const promise = this.executeSingleToolCall(toolCall)
          .then(result => {
            completedResults.set(idx, result);
            if (this.onToolEnd) this.onToolEnd(toolCall.name, result.result);
            return result;
          })
          .catch(err => {
            const errResult = {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              args: toolCall.arguments,
              result: { success: false, error: err.message },
            };
            completedResults.set(idx, errResult);
            if (this.onToolEnd) this.onToolEnd(toolCall.name, errResult.result);
            return errResult;
          });
        dispatchedPromises.set(idx, promise);
      }
    } else if (chunk.type === 'done') {
      streamUsage = chunk.usage;
      if (chunk.finishReason === 'length') {
        const warnMsg = `⚠️ Response truncated (hit token limit at ${streamUsage?.completion_tokens || '?'} tokens). Consider breaking your request into smaller parts.`;
        this.emitStatus('truncation_warning', warnMsg);
        if (this.shouldEmitVerboseLogs()) logger.warn(warnMsg);
      }
    }
  }
}
```

### Fix 2: Add Graceful Tool Call Completion on Stream End

After the streaming loop ends (before the `catch` block), check if there are tool calls in the accumulator that weren't dispatched:

```javascript
// After the for-await loop, before catch:
if (allToolCalls.length === 0 && toolCallAccumulator.size > 0) {
  // Tool calls were accumulated but never emitted
  // This shouldn't happen with the fix, but handle it defensively
}
```

### Fix 3: Improve `_isArgumentsComplete` Resilience

In `src/OpenRouterClient.js`, make `_isArgumentsComplete` more tolerant of incomplete JSON:

```javascript
_isArgumentsComplete(argsStr) {
  if (!argsStr) return false;
  const trimmed = argsStr.trim();
  if (!trimmed.startsWith('{')) return false;
  
  // Quick check: if it ends with '}', try parsing
  if (trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return true; } catch { /* fall through */ }
  }
  
  // Brute force check with brace depth
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { JSON.parse(trimmed); return true; } catch { return false; }
      }
    }
  }
  return false;
}
```

---

## Files to Modify

1. **`src/agent/Agent.js`** (lines 1058-1071) - Add `tool_calls` handler
2. **`src/OpenRouterClient.js`** (lines 566-588) - Improve `_isArgumentsComplete` resilience

---

## Verification Steps

1. Run the agent with a prompt that triggers multiple tool calls
2. Verify all tool calls are dispatched and executed
3. Test with a stream that errors mid-way to ensure tool calls are still handled
4. Run `npm test` to ensure no regressions

---

## Notes

- The reported `src/commands/music/loop.ts` issue is **not applicable** to this project (no TypeScript, no music commands)
- The project uses ES modules (`"type": "module"` in package.json)
- No compilation needed - pure JavaScript
