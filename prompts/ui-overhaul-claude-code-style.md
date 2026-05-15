# OpenAgent UI Overhaul — Claude Code–Inspired Terminal & Web Interface

## Goal
Transform OpenAgent's CLI and gateway/web UI to match the polish, clarity, and information density of Claude Code's terminal interface. The current UI is functional but lacks the visual hierarchy, smooth streaming, and structured data presentation that makes Claude Code feel premium. Every piece of content the AI produces should render beautifully — markdown, code, tool calls, diffs, and status indicators.

---

## Current Architecture (what you're working with)

### CLI Layer (`src/cli/`)
- **`cli.js`** — Main orchestrator. Delegates to extracted modules. Uses `readline` for input, `chalk` for colors, `nanospinner` for spinners.
- **`display.js`** — All visual output: banners, tool call viz, task summaries, help/stats/cost/context panels. Uses a left accent bar (`│`) for AI responses. Tool calls show spinner frames + timing. Batch mode when 3+ tools run concurrently.
- **`markdown.js`** — Terminal markdown renderer using `marked`. Supports headers (h1 accent, h2-h6 progressively dimmer), code blocks with `┌─ lang ──┐` borders, blockquotes with `│` accent, tables, task lists, inline formatting. Falls back to `syntaxHighlight.js` for JS/TS/Python/JSON/Bash/YAML/Rust.
- **`syntaxHighlight.js`** — Regex-based syntax highlighter (no AST). Hardcoded `chalk` colors (magenta keywords, green strings, cyan numbers, gray comments, yellow functions). **Problem: ignores the theme system entirely.**
- **`themes.js`** — 8 themes (catppuccin, nord, dracula, monokai, gruvbox, light, tokyonight, solarized). Semantic color roles: `text`, `accent`, `success`, `error`, `warning`, `muted`, `tool`, `user`, `assistant`, `header`. **Problem: syntaxHighlight.js doesn't use these.**
- **`multilineInput.js`** — Full multiline editor with cursor, selection, undo/redo, autocomplete, reverse search (Ctrl+R). 902 lines. Works but rendering is basic — no syntax highlighting in the input area.
- **`formatting.js`** — Number/duration/text formatting helpers.
- **`ui.js`** — Stripped-down shared formatting (duplicate of some formatting.js functions).
- **`diffViewer.js`** — LCS-based diff with `┌─ filepath` header, line numbers, `+`/`-` coloring, addition/deletion stats.
- **`terminal.js`** — Terminal reset utilities for raw-mode transitions.
- **`spinners.js`** (in `utils/`) — `nanospinner` + `cli-spinners`. Three spinner types: `spinner()` (generic), `thinkingSpinner()` (elapsed time, theme-aware), `contextualSpinner()` (hardcoded yellow/gray/white — **not theme-aware**), `respondingIndicator()` (static `▌ responding…`).

### Gateway/Web Layer (`src/gateway/`)
- **`HttpChannel.js`** — Hono-based REST + SSE. `POST /api/task` submits tasks, `GET /api/events` streams SSE. Two formats: `legacy` (text-only events) and `structured` (full JSON events with IDs). Has backpressure handling and `Last-Event-ID` recovery.
- **`CompanionServer.js`** — WebSocket server for real-time companion apps. Broadcasts state every 5s.
- **`events.js`** — Event types: `connected`, `iteration_start/end`, `content_delta`, `tool_call_start/end`, `thinking`, `status`, `checkpoint`, `done`, `error`, `response`. `summarizeToolResult()` provides 500-char previews.
- **`OutputAdapter.js`** — Abstract base class for multi-channel output routing.
- **`ChannelAdapter.js`** / `ChannelRouter.js` — Route messages to the right channel/session.

### Key Pain Points
1. **Syntax highlighter ignores themes** — hardcoded chalk colors break the entire theme system for code blocks
2. **Streaming is line-by-line plain text** — no incremental markdown rendering during streaming; final markdown only renders after the full response arrives (the `finish()` method clears the raw stream and re-renders)
3. **Tool call visualization is cramped** — single-line spinner with truncated args; no expandable detail
4. **No visual distinction between user/assistant/system messages** — everything uses the same left bar
5. **Web SSE events are raw JSON** — no frontend rendering layer; consumers must build their own UI
6. **Diff viewer is minimal** — no side-by-side, no syntax highlighting within diffs
7. **Status line is static** — no dynamic updates during streaming (model, context %, elapsed time)
8. **`contextualSpinner()` and `respondingIndicator()` ignore themes**
9. **No markdown rendering in SSE stream** — `content_delta` events send raw text; the consumer must accumulate and render markdown themselves
10. **Tables in markdown are fragile** — `stripAnsi` for width calculation but ANSI from headers leaks into column sizing

---

## Acceptance Criteria

### 1. Theme-Aware Syntax Highlighting
**Files:** `src/cli/syntaxHighlight.js`, `src/cli/markdown.js`, `src/cli/themes.js`

- Replace all hardcoded `chalk.magenta`, `chalk.green`, etc. in `syntaxHighlight.js` with theme-resolved colors
- Add new theme roles: `syntaxKeyword`, `syntaxString`, `syntaxNumber`, `syntaxComment`, `syntaxFunction`, `syntaxType`, `syntaxProperty`, `syntaxOperator`, `syntaxPunctuation`
- Provide sensible defaults per existing theme (e.g., catppuccin: keyword=#cba6f7, string=#a6e3a1, number=#fab387, comment=#6c7086, function=#f9e2af, type=#89b4fa)
- `highlightCode(code, language, theme)` must accept theme as 3rd arg (backward compat: fall back to current hardcoded colors if no theme)
- `renderCodeBlock()` in `syntaxHighlight.js` must also use theme colors for line numbers and borders

### 2. Streaming Markdown Rendering
**Files:** `src/cli/display.js` (the `createStreamingRenderer` function)

Current behavior: stream raw text with left bar → on `finish()`, clear everything → re-render final markdown. This causes a visible "flash" and loses the smooth streaming feel.

New behavior:
- Render markdown incrementally as deltas arrive. Use a **line-level incremental renderer**:
  - Maintain a buffer of the accumulated content
  - On each delta, re-parse markdown from the last paragraph/block boundary (not from scratch — use `marked` with a custom tokenizer that tracks byte offsets)
  - Only re-render lines that changed since the last frame
  - Use double-buffering: write the new frame to an offscreen buffer, diff against the current screen, emit only changed cells
- During streaming, render partial code blocks with a dim `▌` cursor at the end (like the current `▌` but inside the code block border)
- When the response completes, do a final full markdown render (no flash — just smoothly fill in any remaining formatting)
- Fallback: if the incremental renderer encounters an error, fall back to the current raw-text-then-render approach

### 3. Rich AI Message Presentation
**Files:** `src/cli/display.js`

- **User messages**: Show with a distinct left bar color (`theme.user`) and a `▸` prefix instead of `│`. Display the user's input text (not markdown-rendered, just plain with wrapping).
- **Assistant messages**: Keep the `│` left bar in `theme.assistant`, but add a subtle header line before the first assistant message in a turn:
  ```
    ╭────────────────────────╮
    │  claude-sonnet-4-20250514  │  3.2s · 4 tools · 2.1K/200K ctx
    ╰────────────────────────╯
  ```
  This card uses `theme.tool` for the model name, `theme.muted` for stats, and `theme.accent` for the border.
- **System/tool messages**: Use `theme.muted` with a `○` prefix for system messages (like "Session restored", "Context compacted").
- **Thinking indicator**: Replace the static `▌ responding…` with an animated spinner that shows elapsed time AND current activity verb (e.g., `⠋ Reading files… 2.1s`, `⠙ Running shell command… 3.4s`). The verb comes from the current tool call; when no tool is active, show `⠋ Thinking… 1.2s`.

### 4. Enhanced Tool Call Visualization
**Files:** `src/cli/display.js` (the `printEnhancedToolCallStart/End` functions)

Current: Single-line spinner → single-line result with truncated args.

New:
- **Start**: Show tool name in `theme.tool` with full argument preview (not truncated to 50 chars — use smart truncation that preserves file paths and command structure):
  ```
    ▸ read_file  src/cli/display.js  [0.3s]
  ```
  For `exec`/`shell_exec`, show the full command (wrapped if needed):
  ```
    ▸ exec  npm run test -- --filter=auth  [1.2s]
  ```
- **End**: Show result summary with structured data:
  ```
    ✓ read_file  src/cli/display.js  954 lines · 12.4KB  [0.3s]
    ✓ write_file  src/config.js  +24 -8  [0.1s]
    ✗ exec  npm run build  exit:1  [4.2s]
      └─ Error: Cannot find module '../src/index.js'
  ```
- **Expandable detail**: When a tool call fails or produces notable output, show 2-3 lines of detail indented under the result line (in `theme.muted`). For `exec`, show the last 3 lines of stderr. For `read_file` on first read, show the first 3 lines as a preview.
- **Batch mode**: When 3+ tools run concurrently, show a compact batch view:
  ```
    ◑ 3 tools running… 2.1s
      ▸ read_file  src/cli/display.js
      ▸ exec  npm test
      ▸ write_file  src/config.js
  ```
  Each tool gets its own line with status icon. Completed tools collapse to their result line.

### 5. Dynamic Status Line
**Files:** `src/cli/display.js`, `src/cli/multilineInput.js`

The prompt status line (model, context %, task count, workspace) should update in real-time during streaming:
- **During streaming**: Show `model │ ██░░░░░░ 28% ctx │ 2.1s elapsed` with a mini progress bar for context usage
- **After task**: Show the task summary inline (keep current behavior but add the progress bar)
- **Idle**: Show current model + context % + workspace (current behavior, but add the bar)
- The status line should be rendered as the first line of the `MultilineInput` widget (it already has a `statusLine` prop — just wire it up to `buildPromptStatusLine` with the bar)

### 6. Diff Viewer Improvements
**Files:** `src/cli/diffViewer.js`

- Add syntax highlighting within diff lines (use the theme-aware `highlightCode` on each line's content, then apply `+`/`-` coloring on top)
- Add a `--stat` compact mode that shows only the file header + `+additions -deletions` bar (like `git diff --stat`)
- Improve the header to show full file path (not truncated) and file size
- Add 3 lines of context around each hunk (currently shows all context — add a `contextLines` param defaulting to 3)

### 7. SSE Event Enrichment for Web Clients
**Files:** `src/gateway/events.js`, `src/gateway/channels/HttpChannel.js`

Current SSE events are raw JSON with content strings. Web clients have to build their own rendering. Add:

- **`content_delta`** events: Add a `rendered_markdown` field that contains terminal-ANSI-rendered markdown (for terminal clients that want pre-rendered output) AND a `content_block` field that identifies the markdown block type (`paragraph`, `code_block`, `list`, `table`, `heading`, `blockquote`) so web clients can do partial rendering
- **`tool_call_start`** events: Add `tool_category` (file_ops, shell, search, web, git), `arg_summary` (human-readable summary of args, not just raw JSON), and `estimated_duration` (based on tool type: file reads = fast, exec = medium, web_search = slow)
- **`tool_call_end`** events: Add `result_type` (content, error, empty), `result_preview` (first 200 chars of result for display), and `line_diff` (for write_file/edit_file: `{additions, deletions}`)
- **`done`** events: Add `summary` object with `{iterations, toolExecutions, totalTokens, duration, model, contextPercent, cost}` — all the data a web client needs to show a task card without making a second API call
- Add a new `message_role` field to ALL events: `user`, `assistant`, `system` — so web clients can style messages by role without maintaining state

### 8. Companion Protocol Enrichment
**Files:** `src/gateway/CompanionServer.js`, `src/gateway/WsSink.js`

- Add a `render` event type that sends pre-rendered markdown chunks (ANSI for terminal companions, HTML for web companions — negotiated on connect via a `format` query param)
- Add a `tool_progress` event that sends intermediate tool status (e.g., exec stdout lines as they arrive, search results as they stream in)
- The `_getState()` method should include: `lastModel`, `lastDuration`, `lastToolCount`, `contextPercent` (currently missing most of these)

---

## Constraints
- **Do NOT break the existing tool registry or agent session API** — all changes are display-layer only
- **Do NOT introduce new runtime dependencies** — use `marked` (already installed), `chalk` (already installed), `nanospinner` (already installed). If you need a diffing library, use the existing LCS implementation in `diffViewer.js`
- **Maintain backward compatibility** for SSE clients — the `legacy` format must still work. All new fields are additive
- **Theme system must remain backward compatible** — existing themes get new syntax color fields with sensible defaults. Missing fields fall back to current hardcoded colors
- **Windows terminal compatibility** — test with Windows Terminal, CMD, and PowerShell. Avoid box-drawing characters that break in CMD (use ASCII fallbacks)
- **Performance** — the incremental markdown renderer must not add >5ms latency per delta on a 200-column terminal. Profile with `performance.now()` in the streaming hot path
- **No React/Ink dependency** — the CLI stays with raw ANSI output. The web rendering layer is the consumer's responsibility; we just provide better structured data

---

## Implementation Order
1. **Theme-aware syntax highlighting** (unblocks everything else)
2. **Streaming markdown renderer** (biggest UX win)
3. **Rich AI message presentation** (user/assistant/system distinction + message cards)
4. **Enhanced tool call visualization** (expandable detail + smart truncation)
5. **Dynamic status line** (context bar + elapsed time)
6. **Diff viewer improvements** (syntax highlighting in diffs + stat mode)
7. **SSE event enrichment** (additive, no breaking changes)
8. **Companion protocol enrichment** (additive, no breaking changes)
