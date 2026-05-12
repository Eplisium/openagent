# OpenAgent Reliability Improvement Plan

## Problem Analysis

From the attached session log, the agent was asked to redesign a website to "look like a $4000 website design." It ran for 11 iterations, 34 tool calls, and then **gave up with a dead-end UNKNOWN error** — despite having 88% tool success rate (30/34 succeeded). The actual failures were:

1. **Iteration 5**: `edit_file` failed with `endLine (0) must be greater than startLine (0)` — the model sent `startLine=0, endLine=0` which is invalid (lines are 1-indexed)
2. **Iteration 9**: Same `edit_file` error repeated — model retried the exact same broken approach
3. **Iteration 8**: `npm run build` failed due to a TypeScript error (`Cannot find namespace 'JSX'`)
4. **Iteration 11**: `git_status` failed because the project wasn't a git repo

These 4 failures (all categorized as `UNKNOWN`) triggered the dead-end detector, which killed the task despite 30 successful operations and a partially-completed redesign.

---

## Root Causes (5 Problems)

### Problem 1: `edit_file` line-based mode accepts `startLine=0, endLine=0` silently
**File**: `src/tools/fileTools.js` (line 478-489)

The model sometimes generates `startLine: 0, endLine: 0` (or `startLine: 0` alone). The tool's line-based path requires BOTH `startLine` and `endLine` to be `undefined` to skip, but a value of `0` passes the `!== undefined` check. Then the validation `endIdx <= startIdx` fires with `0 <= 0`, producing the confusing error.

**Fix**: 
- Add early validation: if `startLine` is provided but ≤ 0, return a clear error: `"startLine must be ≥ 1 (lines are 1-indexed)"`
- If `endLine` is provided but ≤ 0, return: `"endLine must be ≥ 1 (lines are 1-indexed)"`
- If `startLine` is provided without `endLine`, default `endLine = startLine` (replace single line)
- This prevents the confusing `endLine (0) must be greater than startLine (0)` message

### Problem 2: `categorizeError()` doesn't recognize validation/argument errors
**File**: `src/agent/Agent.js` (line 2671-2700)

The error `"endLine (0) must be greater than startLine (0)"` doesn't match any pattern in `categorizeError()`, so it falls through to `UNKNOWN`. This means:
- The circuit breaker can't distinguish "bad arguments" from "fundamentally broken"
- The dead-end detector sees `UNKNOWN` dominating and kills the task
- The recovery suggestion is generic and unhelpful

**Fix**: Add a `VALIDATION_ERROR` category:
```js
if (message.includes('must be greater') || message.includes('must be') || 
    message.includes('invalid') || message.includes('required') ||
    message.includes('expected') || message.includes('1-indexed')) {
  return 'VALIDATION_ERROR';
}
```
And add a specific recovery suggestion:
```js
VALIDATION_ERROR: `The ${toolName} tool received invalid arguments. Check the parameter types and ranges. For edit_file, line numbers are 1-indexed (start at 1, not 0). Re-read the file to get correct line numbers.`
```
Mark `VALIDATION_ERROR` as **non-retryable** in `isRetryableToolFailure()` — retrying the same broken args never helps.

### Problem 3: Dead-end detector is too aggressive — 4 UNKNOWN errors out of 34 calls kills the task
**File**: `src/agent/Agent.js` (line 464-479)

`hasDeadEnded()` uses a sliding window of recent error categories. If one category hits >60%, the task is killed. But:
- 4 errors out of 34 total calls is only 12% failure rate
- The window only looks at *errors*, not *all tool calls*
- A few argument mistakes early on can dominate the error window even as the agent self-corrects

**Fix**: Make dead-end detection consider overall success rate:
- If overall success rate > 70%, don't trigger dead-end even if errors cluster — the agent is making progress
- Add a minimum error count threshold: need at least 5 errors in the window before considering dead-end
- Weight recent errors: if the last 3 iterations all succeeded, reset the dead-end window
- Add a "recovering" state: if errors were clustered but the agent changed approach and succeeded, clear the window

### Problem 4: No self-correction guidance when `edit_file` fails with argument errors
**File**: `src/agent/Agent.js` (line 1520-1533)

When `edit_file` fails with "text not found", there's a great targeted hint injected. But when it fails with line-number validation errors, there's no equivalent guidance. The model just retries the same broken approach.

**Fix**: Add targeted reflection for line-based edit failures:
```js
// In reflectOnToolResults or postToolIteration
if (editFailure && failure.error.includes('must be greater') || failure.error.includes('1-indexed')) {
  this.pushMessage({
    role: 'user',
    content: `[System] edit_file line-based editing failed because line numbers were invalid. ` +
      `Line numbers are 1-indexed (start at 1, not 0). ` +
      `IMMEDIATE FIX: Use read_file on the same path to get correct line numbers, ` +
      `then retry with valid startLine (≥1) and endLine (≥ startLine). ` +
      `Or switch to find/replace mode instead of line-based mode.`
  });
}
```

### Problem 5: `git_status` failure on non-git projects causes unnecessary error tracking
**File**: `src/tools/gitTools.js` (or wherever `git_status` is defined)

The agent ran `git_status` on a project that isn't a git repo. This produced `fatal: not a git repository`, which was categorized as `UNKNOWN` and counted toward the dead-end threshold.

**Fix**: 
- In the `git_status` tool (and all git tools), catch the "not a git repository" error and return a clean, categorized result:
  ```js
  return { success: false, error: 'Not a git repository', errorType: 'NOT_GIT_REPO' };
  ```
- Add `NOT_GIT_REPO` to `categorizeError()` mapping to `NOT_FOUND` (or a new `NOT_GIT_REPO` category)
- Mark `NOT_GIT_REPO` as non-retryable — retrying git commands won't magically create a repo
- In the agent loop, when git tools fail with this error, inject a hint: "This project is not a git repository. Git commands will not work here. Skip git operations and continue with other tools."

---

## Implementation Tasks

### Task 1: Fix `edit_file` line-number validation
**Priority**: P0 — This is the bug that started the cascade
**Files**: `src/tools/fileTools.js`
**Changes**:
- [x] Add validation at line ~478: reject `startLine < 1` and `endLine < 1` with clear 1-indexed error messages
- [x] Default `endLine` to `startLine` when only `startLine` is provided (single-line replace)
- [ ] Add same validation to `preview_edit` tool (line ~1421) — preview_edit only supports find/replace mode, no line-based
- [x] Add tests for edge cases: startLine=0, endLine=0, startLine=-1, endLine < startLine, startLine alone

### Task 2: Add `VALIDATION_ERROR` category to error classifier
**Priority**: P0 — Without this, argument errors are always UNKNOWN
**Files**: `src/agent/Agent.js`
**Changes**:
- [x] Add `VALIDATION_ERROR` pattern matching to `categorizeError()` (line ~2671)
- [x] Add `VALIDATION_ERROR` recovery suggestion to `getRecoverySuggestion()` (line ~2751)
- [x] Mark `VALIDATION_ERROR` as non-retryable in `isRetryableToolFailure()` (line ~2702)
- [x] Add `NOT_GIT_REPO` / git-related error patterns to `categorizeError()`

### Task 3: Improve dead-end detector with success-rate awareness
**Priority**: P1 — Prevents premature task termination
**Files**: `src/agent/Agent.js`
**Changes**:
- [x] Modify `hasDeadEnded()` to check overall success rate before triggering
- [x] Add minimum error count threshold (≥5 errors in window)
- [x] Add recovery detection: if last 3 iterations all succeeded, clear error window
- [x] Add `VALIDATION_ERROR` and `NOT_GIT_REPO` as "non-dead-end" categories — these are fixable, not systemic

### Task 4: Add targeted self-correction for line-based edit failures
**Priority**: P1 — Prevents the model from retrying the same broken approach
**Files**: `src/agent/Agent.js`
**Changes**:
- [x] In `reflectOnToolResults()` (or equivalent), detect line-number validation errors from `edit_file`
- [x] Inject a specific nudge explaining 1-indexed lines and suggesting read_file → retry
- [x] Also add nudge for git-on-non-git-repo failures

### Task 5: Make git tools fail gracefully on non-git directories
**Priority**: P2 — Reduces noise in error tracking
**Files**: `src/tools/gitTools.js`
**Changes**:
- [x] Wrap all git command execution with "not a git repository" detection
- [x] Return structured error with `errorType: 'NOT_GIT_REPO'` instead of raw stderr
- [x] In agent loop, when this error occurs, inject hint to skip git operations

### Task 6: Add integration test for the full failure cascade
**Priority**: P2 — Ensures fixes work together
**Files**: `tests/agent/dead-end-recovery.test.js` (new)
**Changes**:
- [x] Test: agent with line-number errors should self-correct, not dead-end
- [x] Test: agent on non-git project should skip git, not accumulate UNKNOWN errors
- [x] Test: VALIDATION_ERROR category is non-retryable
- [x] Test: dead-end detector respects success rate > 70%

---

## Expected Impact

| Scenario | Before | After |
|----------|--------|-------|
| `edit_file` with startLine=0 | Cryptic error → dead-end | Clear "lines are 1-indexed" → model self-corrects |
| 4 UNKNOWN errors in 34 calls | Task killed as dead-end | Task continues (success rate 88%) |
| Git commands on non-git project | UNKNOWN error accumulation | Clean "not a git repo" → skip git ops |
| Model retries same broken args | No guidance → repeats mistake | Targeted nudge → switches approach |

The core insight: **the agent was actually succeeding** (88% success rate, files were being written, build was fixing errors) but the error tracking system couldn't distinguish "fixable argument mistakes" from "fundamentally broken" — so it killed a task that was on track to succeed.
