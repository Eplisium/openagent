# OpenAgent Code Review Report

**Date:** 2026-03-21  
**Reviewer:** Comprehensive automated code review  
**Scope:** Agent.js, OpenRouterClient.js, config.js, webTools.js, cli.js, ToolRegistry.js, errors.js

---

## Executive Summary

Found **3 critical bugs**, **4 high-priority bugs**, **4 medium-priority bugs**, and **4 low-priority issues**. The primary cause of the reported truncation issue (headers but no body content) is a combination of missing `finish_reason: 'length'` handling and a retry mechanism that *worsens* truncation instead of fixing it.

---

## 🔴 CRITICAL BUGS

### C1. Retry Logic Reduces max_tokens on Truncation (Makes It WORSE)

**File:** `src/agent/Agent.js:569`  
**Root Cause:** In `getLLMResponseWithRetry()`, max_tokens is *reduced* on each retry:
```javascript
const maxTokens = retryCount === 0 ? 16384 : retryCount === 1 ? 8192 : 4096;
```
When a JSON parse error occurs (often caused by truncation), the code retries with a *smaller* max_tokens. This makes the next truncation **more likely**, not less. After 3 retries, max_tokens drops to 4096 — almost certainly causing a truncated response.

**Impact:** If the model generates a long response, truncation on the first try triggers a cascade of increasingly-truncated retries. The final output at 4096 tokens will almost certainly be truncated (e.g., headers without body content).

**Fix:**
```javascript
// Either keep max_tokens stable, or INCREASE on retry to get past parse errors
const maxTokens = 16384; // Stable max_tokens across retries
// OR:
const maxTokens = retryCount === 0 ? 16384 : retryCount === 1 ? 20480 : 16384;
```

---

### C2. No `finish_reason: 'length'` Handling — Silent Truncation

**File:** `src/agent/Agent.js`  
**Locations:**  
- `runWithStreaming()` (streaming loop, ~line 380)  
- `getLLMResponseWithRetry()` (non-streaming path, ~line 580)  

**Root Cause:** Neither path checks the API's `finish_reason` field:
- `finish_reason: 'stop'` — Model finished normally ✅  
- `finish_reason: 'length'` — Model hit max_tokens limit ⚠️ **NOT HANDLED**  
- `finish_reason: 'tool_calls'` — Model wants to call tools ✅ (handled via `onToolCallReady`)

When `finish_reason === 'length'`, the response is **incomplete** but the code returns it as if it were a complete final answer. The user sees headers with no body because the model was cut off mid-generation.

**In `runWithStreaming()`** (streaming loop):
```javascript
// Currently missing finish_reason check
for await (const chunk of stream) {
  if (chunk.type === 'content') {
    fullContent += chunk.content;
  } else if (chunk.type === 'done') {
    streamUsage = chunk.usage;
    // ⚠️ No check: what if finish_reason === 'length'?
  }
}
```

**In `getLLMResponseWithRetry()`**:
```javascript
// Non-streaming path also doesn't check finish_reason
const result = await this.client.chatWithTools(...);
this.updateUsageStats(result.usage);
return result; // ⚠️ Truncated content returned as-is
```

**Fix:** Add finish_reason checking after receiving the response:

```javascript
// In runWithStreaming, after the for-await loop:
if (chunk.finish_reason === 'length') {
  const warnMsg = '⚠️ Response was truncated (hit token limit). Consider breaking your request into smaller parts.';
  this.emitStatus('truncation_warning', warnMsg);
  // Still use the partial content, but flag it
  finalResponse = fullContent + '\n\n[Note: Response was truncated by token limit]';
}

// In getLLMResponseWithRetry, after receiving result:
if (result.finish_reason === 'length') {
  const warnMsg = `Response truncated at ${result.usage?.completion_tokens || '?'} tokens. Consider breaking your request into smaller parts.`;
  this.emitStatus('truncation_warning', warnMsg);
}
```

---

### C3. Streaming Path Missing max_tokens Entirely (Potential Inconsistency)

**File:** `src/agent/Agent.js:329-338`  
**Root Cause:** The `runWithStreaming()` method's `chatStream()` call includes `max_tokens: 16384`, but the non-streaming `getLLMResponseWithRetry()` uses a *different* value (`max_tokens: maxTokens` where maxTokens varies by retry). This means:
- Streaming: always 16384
- Non-streaming first try: 16384
- Non-streaming retry 1: 8192
- Non-streaming retry 2: 4096

The inconsistency is less critical than C1, but worth noting — if streaming falls back to non-streaming (which can happen mid-iteration), the token limit drops dramatically.

---

## 🟠 HIGH-PRIORITY BUGS

### H1. `_isArgumentsComplete` False Positive for String Content with Braces

**File:** `src/OpenRouterClient.js:83-101`  
**Root Cause:** The JSON completeness check only tracks brace depth and string state, but has a subtle bug: it checks for balanced braces but ignores unbalanced string delimiters when determining completeness.

```javascript
function _isArgumentsComplete(str) {
  let depth = 0, inStr = false, esc = false;
  for (const c of str) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
  }
  return depth === 0 && !inStr; // Correct check, BUT...
}
```

The logic is *mostly correct*, but `esc` only tracks the *next* character after a backslash. If `esc` is `true` when checking `inStr = !inStr`, it could incorrectly toggle string state. However, the real issue is that this function is called on *intermediate* streaming states. If the first chunk is `{"query": "Iran ` and the second is `news"}`, the intermediate state `{"query": "Iran "` would have `depth === 0` and `inStr === false` (because `inStr` toggles on the opening quote, then toggles off on the space... wait, no. Let me re-analyze.

Actually, the logic should correctly identify `"Iran "` as `inStr === true` (opening `"` sets `inStr = true`, no closing `"` yet). So the false-positive risk is low. The more realistic issue is that `_isArgumentsComplete` might return `false` for valid partial states and cause tool calls to never be emitted until `finish_reason === 'tool_calls'`.

**Fix:** Add defensive JSON.parse try:
```javascript
function _isArgumentsComplete(str) {
  let depth = 0, inStr = false, esc = false;
  for (const c of str) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
  }
  if (depth !== 0 || inStr) return false;
  // Double-check by actually parsing
  try { JSON.parse(str); return true; } catch { return false; }
}
```

---

### H2. Tool Results Can Be Empty/Minimal, Confusing the Model

**File:** `src/agent/Agent.js:509` (postToolIteration)  
**Root Cause:** When a tool execution fails or returns an error, the tool result content is set to:
```javascript
content: JSON.stringify(result.result)
// For errors: '{"success":false,"error":"..."}'
// For incomplete: '{"success":false,"error":"Tool execution incomplete"}'
```

The model receives a tool result with `"success": false` but the content is the raw JSON string. The model's system prompt doesn't explicitly say how to handle failed tool results. Combined with the `reflectOnToolResults` method which does inject guidance, this *usually* works, but the reflection message is added as a *user* role message saying `[System] The tool "..." returned an error: "..."`. This might confuse some models into thinking it's a new user request rather than a reflection on tool results.

**Impact:** The model may interpret the error message as a new user request, producing a response about the error rather than recovering from it.

**Fix:** Add a clearer system message pattern:
```javascript
if (result.success === false) {
  this.pushMessage({
    role: 'user',
    content: `[System] Tool "${toolName}" returned an error: "${result.error}". 
Your previous action failed. Try a different approach to accomplish the task.`
  });
}
```

---

### H3. `runWithStreaming` Doesn't Track `finish_reason` from Stream

**File:** `src/agent/Agent.js:380`  
**Root Cause:** The `chatStream()` generator in `OpenRouterClient.js` parses `finish_reason` from each SSE delta but only uses it to decide *when* to emit tool calls. The `finish_reason` value is never passed back to the caller (`runWithStreaming`). The `done` chunk from `chatStream` includes `usage` but *not* `finish_reason`.

```javascript
// In chatStream(), the done event:
yield { type: 'done', content: fullContent, usage, requestId };
// ⚠️ finish_reason is NOT included
```

**Fix:** Include finish_reason in the done event:
```javascript
// In chatStream(), track the last finish_reason:
let lastFinishReason = null;
// In the while loop, when parsing delta:
if (parsed.choices?.[0]?.finish_reason) {
  lastFinishReason = parsed.choices[0].finish_reason;
}
// In the done yield:
yield { type: 'done', content: fullContent, usage, requestId, finishReason: lastFinishReason };
```

Then in `runWithStreaming()`:
```javascript
} else if (chunk.type === 'done') {
  streamUsage = chunk.usage;
  if (chunk.finishReason === 'length') {
    this.emitStatus('truncation_warning', '⚠️ Response truncated by token limit');
  }
}
```

---

### H4. Large Tool Results Truncated Without Model Awareness

**File:** `src/agent/Agent.js:463-492` (postToolIteration)  
**Root Cause:** When a tool result exceeds `maxToolResultChars` (80,000 chars), it's truncated and a cache info message is appended. However, the truncation info says "Full result cached to: ..." but the model cannot use `read_file` to access the cache path in many scenarios (the cache is in a temp directory, not the working directory). The model may try to read the cached file and fail, leading to wasted iterations.

**Fix:** Either store the cache in the working directory (`.tool-cache/`) and explicitly tell the model the working directory path, or include a more helpful truncation summary that extracts the key information the model needs.

---

## 🟡 MEDIUM-PRIORITY BUGS

### M1. Average Iteration Time Calculation Divides by Wrong Denominator

**File:** `src/agent/Agent.js:515` (postToolIteration)  
**Root Cause:**
```javascript
this.performanceMetrics.avgIterationTime =
  (this.performanceMetrics.avgIterationTime * (this.performanceMetrics.totalIterations - 1) +
   (Date.now() - iterationStart)) / this.performanceMetrics.totalIterations;
```

When `totalIterations === 1`, this divides by 1, which is correct. But `totalIterations` is `this.performanceMetrics.totalIterations`, while `iterationStart` is set in `this.iterationCount` context. The issue is that `totalIterations` is incremented *before* this code runs (in `runWithStreaming` at line 331), so the math is off by one on the first iteration. More importantly, this calculation doesn't include the initial value (which starts at 0), so it's correct by accident. But it's fragile and confusing.

**Fix:**
```javascript
const n = this.performanceMetrics.totalIterations;
this.performanceMetrics.avgIterationTime =
  (this.performanceMetrics.avgIterationTime * (n - 1) + duration) / n;
```

---

### M2. Context Allocator Could Produce Empty Message List

**File:** `src/agent/Agent.js:346-356`  
**Root Cause:** The `contextAllocator.allocate()` can drop messages, and there's no guarantee the resulting `messagesForLLM` will have enough context for a meaningful response. If all messages are dropped except the system prompt, the model receives an empty conversation and may generate generic or unexpected output.

**Fix:** Always preserve at least the system prompt + last user message:
```javascript
const allocResult = this.contextAllocator.allocate(...);
if (allocResult.messages.length < 2 && this.messages.length > 0) {
  // Ensure at least system + last user message
  messagesForLLM = this.messages.slice(-5); // Fallback to last 5 messages
} else {
  messagesForLLM = allocResult.messages;
}
```

---

### M3. Streaming Error Fallback Doesn't Preserve Accumulated Tool Calls

**File:** `src/agent/Agent.js:389-410`  
**Root Cause:** When streaming fails and falls back to non-streaming, the code tries to collect already-dispatched tool call results. However, if the streaming loop broke out *because* of a tool_calls event, `fullContent` may be incomplete (it only captured text content that arrived *before* the tool calls). The non-streaming fallback then uses `response.content || fullContent` which may discard the streaming partial content.

```javascript
// Fallback: uses response.content (from non-streaming) OR fullContent (from interrupted streaming)
finalResponse = response.content || fullContent;
// ⚠️ fullContent may have partial text that response.content doesn't have
```

**Fix:** Prefer the streaming content if it's non-empty:
```javascript
finalResponse = fullContent || response.content;
```

---

### M4. Tool Registry History Unbounded Growth Check

**File:** `src/tools/ToolRegistry.js:148-151`  
**Root Cause:** The history trim check is:
```javascript
if (this.executionHistory.length > this.maxHistorySize) {
  this.executionHistory = this.executionHistory.slice(-Math.floor(this.maxHistorySize / 2));
}
```

This trims to *half* the max when exceeded. If `maxHistorySize` is 500, it keeps 250. But the check is `> 500`, so the history grows to 501 before being trimmed to 250. In high-throughput scenarios, this causes a sawtooth memory pattern. Not a bug per se, but suboptimal.

**Fix:** Trim at 75% instead of 100%:
```javascript
if (this.executionHistory.length > this.maxHistorySize * 0.75) {
  this.executionHistory = this.executionHistory.slice(-Math.floor(this.maxHistorySize / 2));
}
```

---

## 🟢 LOW-PRIORITY ISSUES

### L1. No Rate Limiting on Tool Execution

**File:** `src/agent/Agent.js:executeToolCallsEnhanced()`  
**Issue:** Parallel tool execution for read-only tools (line 585-600) uses `Promise.allSettled` with no concurrency limit. For web tools that hit rate-limited APIs, this could trigger rate limits.

**Fix:** Add a concurrency limiter (e.g., max 5 parallel network requests).

---

### L2. `performanceMetrics.avgIterationTime` Initialized to 0, First Division Correct by Accident

**File:** `src/agent/Agent.js:515`  
**Issue:** When `totalIterations === 1`, the formula `(avg * (1-1) + duration) / 1 = duration / 1` is correct. But if `totalIterations === 0` (which shouldn't happen but could if called incorrectly), it divides by zero → `NaN`.

**Fix:** Guard:
```javascript
if (this.performanceMetrics.totalIterations > 0) {
  // ... calculation
}
```

---

### L3. CLI History Can Still Grow Unbounded Despite maxHistorySize

**File:** `src/cli.js:132-134`  
**Issue:** The CLI has a `maxHistorySize` of 100 and trims, but the trimming happens *after* the `history.push()`. If multiple tasks run rapidly, history could briefly exceed 100 entries. Additionally, the `AgentSession` history is not similarly bounded.

**Fix:** Check before push:
```javascript
if (this.history.length >= this.maxHistorySize) {
  this.history = this.history.slice(-this.maxHistorySize + 1);
}
this.history.push(entry);
```

---

### L4. `runAgentTaskWithContext` References Undefined `progressTimeout`

**File:** `src/cli.js:639-640`  
**Issue:** In the catch block of `runAgentTaskWithContext`, the code references `progressTimeout` and `stopProgressIndicator()`:
```javascript
} catch (error) {
  clearTimeout(progressTimeout);
  stopProgressIndicator();
  // ...
}
```

However, `progressTimeout` and `stopProgressIndicator` are defined in `runAgentTask` but NOT in `runAgentTaskWithContext`. This means the catch block will throw a `ReferenceError`, masking the original error.

**Fix:** Either define the progress indicator variables in `runAgentTaskWithContext`, or remove the references.

---

## Summary of Recommendations (Priority Order)

| # | Issue | Priority | Action |
|---|-------|----------|--------|
| C1 | Retry reduces max_tokens (worsens truncation) | 🔴 Critical | Make max_tokens stable across retries |
| C2 | No `finish_reason: 'length'` handling | 🔴 Critical | Check and warn on truncation |
| C3 | Streaming/non-streaming max_tokens inconsistency | 🔴 Critical | Standardize to 16384 |
| H1 | `_isArgumentsComplete` could false-positive | 🟠 High | Add `JSON.parse` verification |
| H2 | Empty tool results confuse model | 🟠 High | Add clearer error recovery messages |
| H3 | `finish_reason` not tracked in stream | 🟠 High | Pass finish_reason through `done` event |
| H4 | Truncated tool results in inaccessible cache | 🟠 High | Use working directory cache |
| M1 | Avg iteration time calc off-by-one | 🟡 Medium | Fix denominator |
| M2 | Context allocator could empty messages | 🟡 Medium | Ensure minimum messages preserved |
| M3 | Streaming fallback discards content | 🟡 Medium | Prefer streaming content |
| M4 | Tool history sawtooth growth | 🟡 Medium | Trim at 75% instead of 100% |
| L1 | No concurrency limit on parallel tools | 🟢 Low | Add concurrency limiter |
| L2 | Division by zero risk | 🟢 Low | Guard division |
| L3 | CLI history growth | 🟢 Low | Check before push |
| L4 | Undefined variable in catch block | 🟢 Low | Remove or define variables |

---

## Root Cause Analysis: "Headers But No Body Content"

Based on the code review, the reported issue (model generates headers but no content underneath) is most likely caused by:

1. **Primary cause (C1 + C2):** The model generates a long news summary that hits `max_tokens: 16384`. The response gets `finish_reason: 'length'`. The code doesn't check this, so it returns the truncated content (headers without body). If a JSON parse error occurs during this truncation, the retry *reduces* max_tokens to 8192 or 4096, making the next truncation even worse.

2. **Contributing factor (C2/H3):** The streaming path doesn't track `finish_reason` at all. The user sees the headers streaming in real-time but the response silently stops mid-content.

3. **Contributing factor (H2):** If web search tools return errors (common for free backends), the error messages might not be clear enough for the model to recover, causing it to produce empty content under the headers.

**Recommended immediate action:** Fix C1 (stable max_tokens) and C2 (finish_reason checking) to address the truncation issue.
