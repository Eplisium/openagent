# OpenAgent CLI — UI Polish, Streaming Quality & Task Abort Overhaul

## Goal

Fix three interrelated problems in the OpenAgent CLI that make it feel unpolished and unreliable:

1. **Streaming feels janky** — tokens flicker, the cursor `▌` leaves artifacts, the final markdown re-render causes a visible flash, and intermediate content (text the model emits between tool calls) sometimes appears twice.
2. **Response duplication** — the `deduplicateResponse()` heuristic in `formatting.js` only catches exact half-matches and near-duplicate halves (>0.95 Jaccard on content >4000 chars). Real duplication happens when `onResponse` fires AND the stream renderer's `finish()` also prints, or when `onIntermediateContent` and the final response overlap. The dedup function is a band-aid; the real fix is preventing double-rendering at the callback level.
3. **No way to stop a running task** — Ctrl+C is the only abort mechanism, and it's fragile. It sets `process.stdin` to raw mode and listens for byte `0x03`, but this breaks when the `MultilineInput` widget is active (it already owns stdin). There's no visual stop button, no `/stop` command, and no way to cancel mid-tool-execution from the prompt line. The abort also doesn't cleanly stop running child processes (shell tools).

---

## Architecture Context (what you're working with)

### Display & Streaming Layer
- **`src/cli/display.js`** — `createStreamingRenderer()` (lines 304–418): The streaming renderer. It accumulates `content` string, renders frames at 24ms intervals using `renderMarkdown()`, and clears the previous frame with ANSI cursor-up + erase. On `finish()`, it does a final render with `renderFrame(true)` and appends a usage summary line. On `commitIntermediate()`, it renders the current buffer, writes `\n`, and resets — used when tool calls interrupt a streaming response.
- **`src/cli/markdown.js`** — Terminal markdown renderer using `marked` v15. Has a `renderMarkdown(text, theme)` export. Code blocks use `┌─ lang ──┐`/`└────┘` borders. Tables use heavy box-drawing chars. Lists don't nest properly.
- **`src/cli/syntaxHighlight.js`** — Regex-based highlighter. **Ignores the theme system entirely** — uses hardcoded `chalk.magenta`, `chalk.green`, `chalk.cyan`, etc. This means code blocks in AI responses break the theme.
- **`src/cli/formatting.js`** — `deduplicateResponse()` (lines 109–141): Checks if the first half ≈ second half of the content. Only triggers for content >200 chars (exact match) or >4000 chars (Jaccard >0.95). This is a post-hoc fix for a rendering pipeline bug.

### Callback & Task Execution Layer
- **`src/cli.js`** — `runAgentTask()` (lines 541–703): Sets up callbacks on `session.agent` before each task:
  - `onContentDelta` → feeds `streamRenderer.write(delta)` (line 587–589)
  - `onResponse` → calls `printAIResponse(cli, deduplicateResponse(content))` (line 581)
  - `onIntermediateContent` → if stream renderer is active, calls `commitIntermediate()`, otherwise calls `printIntermediateContent()` (lines 591–597)
  - `onToolStart` / `onToolEnd` → tool call visualization (lines 570–577)
  - `onStatus` → prints status messages (lines 599–602)
  - After `session.run(task)` resolves, it also calls `printAIResponse()` on `result.response` if not already printed (lines 647–649)
  - **The duplication bug**: `onResponse` can fire with the full content while the stream renderer is still active (it hasn't called `finish()` yet). Then `finish()` also prints the content. Or `onResponse` fires after the stream is done, and then the `result.response` check also fires. Three codepaths all trying to print the same response.

### Abort Layer
- **`src/agent/Agent.js`** — `abort()` (line 327–333): Sets `this.aborted = true`, calls `this.abortController.abort()`, sets `state = 'aborted'`. The `checkAborted()` method (line 338–342) throws `AgentAbortError` if aborted.
- **`src/agent/Agent.js`** — `runWithStreaming()` (line 1826+): The main agentic loop. Checks `this.checkAborted()` at the top of each iteration. During streaming, it iterates `for await (const chunk of stream)` — there's **no abort check inside the stream consumption loop**. If the model is mid-stream, abort won't take effect until the stream finishes and the next iteration starts.
- **`src/agent/Agent.js`** — `executeSingleToolCall()` (called from `onToolCallReady` in streaming mode): Tool execution is awaited. There's no abort signal passed to tool execution — a long-running `exec` tool will keep running even after abort.
- **`src/tools/ProcessManager.js`** — Manages child processes for shell tools. Has a `kill()` method but it's not wired to the abort signal.
- **`src/cli.js`** — Ctrl+C handler (lines 622–641): Sets raw mode on stdin, listens for byte `0x03`, calls `session.agent.abort()` and `session.subagentManager.abort()`. **Problem**: This conflicts with `MultilineInput` which also uses raw stdin. The handler is added/removed per-task, but if the input widget is active between tasks, Ctrl+C exits the process instead of being caught.

### Tool Visualization
- **`src/cli/display.js`** — `printEnhancedToolCallStart/End` (lines 570–636): Already has batch mode for 3+ concurrent tools. Tool spinners use braille frames at 80ms intervals. Results show ✓/✗ with timing and smart result summaries. Detail lines show stderr tail, file preview, etc.
- **`src/cli/display.js`** — `printAssistantHeader()` (lines 211–254): Prints model name, duration, tool count, and context bar before AI responses. Uses theme colors correctly.

---

## What To Fix

### Fix 1: Eliminate Response Duplication at the Source

**Root cause**: Three codepaths in `runAgentTask()` all try to print the AI response:
1. `onResponse` callback (line 581)
2. `streamRenderer.finish()` (called by `printAIResponse` at line 257–260)
3. Post-run `result.response` check (line 647–649)

**Fix**: Make the stream renderer the **single source of truth** for AI response output. Remove the `onResponse` callback entirely — it's redundant because the stream renderer already receives every delta via `onContentDelta`. The `finish()` method already handles the final render. The `responsePrinted` flag is the right idea but it's checked in the wrong places.

Specific changes in **`src/cli.js`** `runAgentTask()`:
- **Remove the `onResponse` callback** (lines 579–584). The stream renderer already handles all content display.
- **Remove the `responsePrinted` flag** and the post-run `result.response` check (lines 647–649, 651–656). Instead, after `session.run()` resolves, call `this._streamRenderer?.finish(result.response, usage)` if the renderer is still active, OR if `result.response` exists and the renderer already finished, print it directly. The logic should be:
  ```js
  // After session.run() resolves:
  if (this._streamRenderer?.active) {
    // Stream is still going (shouldn't happen normally, but handle gracefully)
    this._streamRenderer.finish(result.response, usage);
  }
  // If the stream renderer already finished (normal case), the response was already printed.
  // Only print if nothing was rendered at all:
  if (!this._streamRenderer?._rendered && result.response?.trim()) {
    printAIResponse(this, result.response, usage);
  }
  ```
- Add a `_rendered` boolean to the stream renderer that's set to `true` after `finish()` or `commitIntermediate()` completes a full render.
- **Remove the `deduplicateResponse()` calls** from `cli.js` (lines 581, 648, 742, 785). Once the double-rendering bug is fixed, deduplication is unnecessary. Keep the function in `formatting.js` as a safety net but don't call it proactively.
- Apply the same fix to `runAgentTaskWithContext()` (lines 706–860) — it has the same three codepaths.

### Fix 2: Smooth Streaming Without Flash

**Problem**: The streaming renderer in `createStreamingRenderer()` works by:
1. Accumulating raw text deltas into `content`
2. Every 24ms, clearing the entire rendered region with ANSI cursor-up + erase
3. Re-rendering the full content through `renderMarkdown()` from scratch
4. On `finish()`, doing one final full render

This causes:
- **Flash on finish**: The entire rendered area is cleared and re-rendered. If the markdown changes between the last streaming frame and the final frame (e.g., a code block closes, a list item completes), the user sees a brief blank flash.
- **Cursor artifacts**: The `▌` cursor is appended to the content before rendering. If a render frame happens right as a code fence closes, the cursor appears inside the code block border.
- **Performance**: Re-rendering the entire markdown on every frame is O(n) in content length. For long responses, this gets slow.

**Fix**: Refactor `createStreamingRenderer()` in **`src/cli/display.js`**:

1. **Incremental rendering**: Instead of re-rendering the full content every frame, track the last rendered line count. Only re-render from the line where content changed. Use a simple diff:
   ```js
   // Track what we've already rendered
   let renderedLines = [];
   let renderedLineCount = 0;
   
   const renderFrame = (final = false) => {
     const source = final ? content : content + cursor;
     const rendered = cli.isMarkdownEnabled() ? renderMarkdown(source, cli.theme) : source;
     const newLines = renderWithLeftBar(cli, rendered).split('\n');
     
     // Only update lines that changed
     const commonLength = Math.min(renderedLineCount, newLines.length);
     let firstDiff = 0;
     for (let i = 0; i < commonLength; i++) {
       if (newLines[i] !== renderedLines[i]) { firstDiff = i; break; }
     }
     
     // Move cursor up to first diff line and rewrite from there
     if (renderedLineCount > firstDiff) {
       process.stdout.write(`\x1b[${renderedLineCount - firstDiff}A`);
     }
     process.stdout.write('\r\x1b[J'); // Clear from cursor to end
     process.stdout.write(newLines.slice(firstDiff).join('\n'));
     
     renderedLines = newLines;
     renderedLineCount = newLines.length;
   };
   ```

2. **No-flash finish**: On `finish()`, don't clear and re-render. Instead, just remove the cursor character from the last line (overwrite the line where the cursor was with the cursor-free version) and append the usage summary. This is a 1-line update instead of a full re-render.
   ```js
   finish(finalContent = content, usage = null) {
     if (scheduled) clearTimeout(scheduled);
     scheduled = null;
     if (!active) {
       if (finalContent?.trim()) printAIResponse(cli, finalContent, usage);
       return;
     }
     content = finalContent;
     active = false;
     _rendered = true;
     
     // Remove cursor: find the line with ▌ and rewrite it without ▌
     // This is a targeted update, not a full re-render
     const finalRendered = cli.isMarkdownEnabled() ? renderMarkdown(content, cli.theme) : content;
     const finalLines = renderWithLeftBar(cli, finalRendered).split('\n');
     
     // Replace the last rendered line (which has cursor) with the clean version
     // Move up to the line with cursor, clear it, write the clean line
     process.stdout.write(`\x1b[${1}A\r\x1b[K`); // Move up 1, clear line
     // Actually, we need to find how many lines the cursor occupied
     // Simpler approach: just rewrite the last few lines
     const cursorLineCount = (content + cursor).split('\n').length - content.split('\n').length;
     // ... rewrite just the affected lines
     
     // Append usage summary
     if (usage) { /* ... existing usage code ... */ }
     process.stdout.write('\n');
   }
   ```

3. **Smart cursor placement**: Don't append `▌` to the content string before markdown rendering. Instead, after rendering, find the last visible line and append `▌` to it in the ANSI output. This prevents the cursor from appearing inside code block borders or breaking markdown structure.
   ```js
   const sourceWithCursor = (final = false) => {
     if (final) return content;
     // Don't modify content — add cursor after rendering
     return content;
   };
   
   // In renderFrame, after getting the rendered lines:
   if (!final) {
     // Append cursor to the last line
     newLines[newLines.length - 1] += chalk.hex(cli.theme?.accent || '#89b4fa')(cursor);
   }
   ```

4. **Throttle more aggressively for long content**: When `content.length > 5000`, increase the render interval from 24ms to 48ms. The visual difference is negligible but it prevents the renderer from becoming a CPU bottleneck.

5. **Safety: fallback path**: If `renderFrame()` throws (e.g., markdown parser chokes on partial content), set a `fallback` flag and switch to plain-text streaming (just write deltas directly with the left bar, no markdown). This already exists but make sure the fallback also handles the cursor correctly.

### Fix 3: Proper Task Abort with Visual Stop Control

**Problem**: Ctrl+C is the only way to stop a task, and it's broken in several ways:
- It conflicts with `MultilineInput` raw mode ownership
- It doesn't interrupt mid-stream LLM responses (the `for await` loop doesn't check abort)
- It doesn't kill running child processes from shell tools
- There's no visual indicator that stop is possible, and no `/stop` command

**Fix**: Implement a proper multi-layer abort system:

#### 3a. Add a `/stop` command in **`src/cli.js`**

Add `/stop` (alias `/abort`, `/cancel`) to the command resolver. When invoked during an active task:
- Call `this.session.agent.abort()`
- Call `this.session.subagentManager?.abort()`
- Kill any running child processes via `ProcessManager.killAll()`
- Print `⏹ stopped by user` in `theme.warning`
- Reset `this.currentTask = null`, `this.taskStartTime = null`

This requires checking `this.currentTask` — if null, print `No task is running`.

Also add this to the help text under commands: `/stop  Stop the current task`.

#### 3b. Fix the Ctrl+C handler to coexist with MultilineInput

**`src/cli.js`** lines 622–641: The current handler sets raw mode and listens for `0x03`. This breaks when `MultilineInput` is active because it already owns stdin in raw mode.

Fix: Instead of adding a separate `data` listener, register a global `SIGINT` handler during task execution:
```js
// Replace the stdin raw-mode hack with a proper SIGINT handler
let sigintHandler = null;
const setupAbortHandler = () => {
  sigintHandler = () => {
    if (this.currentTask) {
      this.session.agent.abort();
      this.session.subagentManager?.abort();
      ProcessManager.killAll();
    }
  };
  process.once('SIGINT', sigintHandler);
};
const teardownAbortHandler = () => {
  if (sigintHandler) {
    process.removeListener('SIGINT', sigintHandler);
    sigintHandler = null;
  }
};
```

**But**: Node.js doesn't reliably deliver SIGINT on Windows. On Windows, Ctrl+C in raw mode generates a `data` event with byte `0x03` on stdin. So we need both approaches:

```js
// Cross-platform abort handler
let abortHandler = null;
let sigintHandler = null;

const setupAbortHandler = () => {
  // Unix: SIGINT
  sigintHandler = () => { this._abortCurrentTask(); };
  process.once('SIGINT', sigintHandler);
  
  // Windows: raw stdin byte 0x03
  if (process.platform === 'win32' && process.stdin.isTTY) {
    const wasRaw = process.stdin.isRaw;
    // Don't set raw mode if MultilineInput already has it
    if (!process.stdin.isRaw) process.stdin.setRawMode(true);
    process.stdin.resume();
    abortHandler = (data) => {
      if (data[0] === 0x03) this._abortCurrentTask();
    };
    process.stdin.on('data', abortHandler);
  }
};

const teardownAbortHandler = () => {
  if (sigintHandler) process.removeListener('SIGINT', sigintHandler);
  if (abortHandler) process.stdin.removeListener('data', abortHandler);
  sigintHandler = null;
  abortHandler = null;
};
```

Add a helper method on the CLI class:
```js
_abortCurrentTask() {
  if (!this.currentTask) return;
  this.session.agent.abort();
  this.session.subagentManager?.abort();
  ProcessManager.killAll();
}
```

#### 3c. Make the streaming loop abort-aware

**`src/agent/Agent.js`** `runWithStreaming()` — the `for await (const chunk of stream)` loop (line 1929) doesn't check `this.aborted`. Add a check inside the loop:

```js
for await (const chunk of stream) {
  if (this.aborted) {
    // Abort mid-stream: break out of the stream consumption
    break;
  }
  // ... existing chunk handling ...
}
```

Also, pass the `AbortSignal` from `this.abortController` to the `client.chatStream()` call so the HTTP request itself is cancelled:

```js
const stream = this.client.chatStream(messagesForLLM, {
  model: this.model,
  // ... existing options ...
  signal: this.abortController?.signal,  // Cancel the HTTP request on abort
});
```

This requires `OpenRouterClient.chatStream()` to accept and forward a `signal` option to the `fetch()` call. Check **`src/OpenRouterClient.js`** for the `chatStream` method and add `signal` forwarding.

#### 3d. Kill child processes on abort

**`src/tools/ProcessManager.js`**: Add a static `killAll()` method that sends SIGTERM (or `taskkill /F /T /PID` on Windows) to all tracked child processes. Call this from `_abortCurrentTask()`.

Also, in **`src/agent/Agent.js`** `executeSingleToolCall()`, pass the abort signal to tool execution. For shell tools, this means passing `signal` to `ProcessManager.exec()` so the child process is killed when the signal fires.

#### 3e. Visual stop indicator

During task execution, the line `Ctrl+C stops this task` (cli.js line 563) should be more prominent and include the `/stop` alternative:

```js
console.log(chalk.hex(this.theme.muted)('  Ctrl+C or /stop to cancel'));
```

When a task is aborted, instead of just `stopped by user`, show what was happening:
```js
console.log(chalk.hex(this.theme.warning)('\n  ⏹ stopped · ' + 
  formatDuration(Date.now() - this.taskStartTime) + ' · ' + 
  this.session.agent.iterationCount + ' iterations · ' +
  this.session.agent.performanceMetrics.totalToolCalls + ' tools'));
```

### Fix 4: Polish the Streaming Visuals

These are smaller fixes that compound into a much better feel:

#### 4a. Theme-aware syntax highlighting

**`src/cli/syntaxHighlight.js`**: Replace all hardcoded `chalk.magenta`, `chalk.green`, `chalk.cyan`, `chalk.yellow`, `chalk.gray` with theme-resolved colors. Add a `highlightCode(code, language, theme)` signature (3rd arg optional, defaults to current hardcoded colors for backward compat).

Add these theme roles to **`src/cli/themes.js`** with sensible defaults per theme:
```js
syntaxKeyword: '#cba6f7',  // purple
syntaxString: '#a6e3a1',   // green
syntaxNumber: '#fab387',   // peach
syntaxComment: '#6c7086',  // muted
syntaxFunction: '#f9e2af', // yellow
syntaxType: '#89b4fa',     // blue
```

Each existing theme gets these with appropriate mappings. Missing fields fall back to the catppuccin defaults.

#### 4b. Markdown renderer edge cases

**`src/cli/markdown.js`**:
- Short code blocks (≤2 lines): Skip `┌─ lang ──┐`/`└────┘` borders. Show as `  lang │ code line` with a dim prefix.
- Tables: Replace heavy `┌┬┐├┼┤└┴┘` borders with lightweight `│` separators and `─` header divider (GitHub-style).
- Nested lists: Add 2 spaces indentation per nesting level. Track depth via a module-level counter.

#### 4c. Thinking indicator shows current activity

**`src/cli/display.js`** `showThinkingSpinner()` and `showRespondingIndicator()`: Currently these are static or generic. Replace with a contextual indicator that shows what the agent is doing:

- When a tool is running: `⠙ read_file src/config.js [2.1s]` (already handled by tool visualization)
- When waiting for LLM: `⠋ Thinking… [1.2s]` with elapsed time
- When streaming content: The `▌` cursor is sufficient — no additional indicator needed

The `respondingIndicator()` in **`src/utils/spinners.js`** currently shows a static `▌ responding…`. Make it show elapsed time like `thinkingSpinner()` does.

---

## Constraints

- **Do NOT change the AgentSession, ToolRegistry, or OpenRouterClient APIs** — only add `signal` forwarding to `chatStream()` and `ProcessManager` methods
- **Do NOT add new npm dependencies** — use existing packages (chalk, marked, nanospinner, cli-spinners)
- **Do NOT break existing commands** — `/help`, `/model`, `/stats`, `/cost`, `/ctx`, `/history`, `/agents`, `/tools`, `/theme`, `/new`, `/exit` must still work
- **All visual changes must use `theme.*` colors** — no hardcoded `chalk.cyan`, `chalk.green`, etc. in modified code
- **Windows compatibility** — test with Windows Terminal and PowerShell. The abort handler must work on Windows (byte `0x03` on stdin, `taskkill` for child processes)
- **The streaming renderer must stay performant** — no more than 5ms per frame on a 200-column terminal. Use `performance.now()` to verify
- **Keep the file structure** — don't split or merge files
- **Backward compat for `deduplicateResponse()`** — keep the function exported but don't call it from `cli.js` anymore. Third-party code may import it.

## Acceptance Criteria

After your changes, running `node src/cli.js` should show:

1. **No duplicate responses** — every AI response appears exactly once, whether it streamed or arrived all-at-once
2. **No flash on stream finish** — the transition from streaming (with `▌` cursor) to final markdown is seamless. The cursor disappears and formatting finalizes without clearing the screen
3. **`/stop` command works** — typing `/stop` during a running task aborts it cleanly, kills child processes, and returns to the prompt
4. **Ctrl+C works during tasks** — pressing Ctrl+C while a task is running stops the task (not the CLI). Pressing Ctrl+C when no task is running exits the CLI normally
5. **Mid-stream abort** — pressing Ctrl+C or `/stop` while the LLM is streaming stops the stream within 1 second (the HTTP request is cancelled via AbortSignal)
6. **Mid-tool abort** — pressing Ctrl+C or `/stop` while a shell tool is running kills the child process and stops the task
7. **Theme-aware code blocks** — syntax highlighting in code blocks respects the active theme, not hardcoded colors
8. **Lightweight markdown** — short code blocks skip heavy borders, tables use GitHub-style separators, nested lists indent properly
9. **Contextual thinking indicator** — the spinner shows elapsed time and current activity verb, not just a static label
10. **Abort summary** — when a task is stopped, show how long it ran, how many iterations/tools completed, so the user knows what happened

## Implementation Order

1. **Fix 1: Eliminate duplication** — this is the most impactful bug. Remove `onResponse` callback, make stream renderer the single source of truth, add `_rendered` flag
2. **Fix 3: Task abort** — add `/stop` command, fix Ctrl+C handler, make streaming loop abort-aware, kill child processes. This is the highest-value feature addition
3. **Fix 2: Smooth streaming** — refactor the renderer for incremental updates and no-flash finish. This is the most complex change
4. **Fix 4: Polish** — theme-aware syntax highlighting, markdown edge cases, thinking indicator. These are independent and can be done in any order
