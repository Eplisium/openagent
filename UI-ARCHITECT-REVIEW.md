# OpenAgent UI Integration — Architect Review Report

**Date:** 2026-03-25  
**Role:** Lead Architect  
**Scope:** Full-stack review of Ink/React UI ↔ AgentSession backend integration  
**Goal:** Ensure `npm run start -- --ui` works equivalently to the traditional CLI (`npm run start`)

---

## Executive Summary

The Ink/React UI is a **beautifully scaffolded but completely non-functional shell**. It renders splash screens, navigation, themes, and keyboard shortcuts — but **never connects to the agent backend, never sends messages, never receives responses, and never executes tools**. The traditional CLI (`cli.js`) is a fully working 3075-line production system. The UI (`App.jsx` + components) is a demo mockup with a `setTimeout` fake response.

**Bottom line:** `npm run start -- --ui` opens a UI that looks good but does nothing. The fix requires wiring the existing backend (AgentSession, Agent.runStream) into the existing UI components (Input, Chat, ToolOutput, Sidebar).

---

## Architecture Assessment

### What Works ✅

| Component | Status | Notes |
|-----------|--------|-------|
| `cli.js` (traditional CLI) | ✅ Fully functional | 3075 lines, streaming, tools, sessions, memory |
| `AgentSession.js` | ✅ Production-ready | 900 lines, tools, memory, skills, hooks, checkpoints |
| `Agent.js` → `runStream()` | ✅ Working async generator | Yields `{type: content\|tools_start\|tools_done\|done\|iteration\|stopped}` |
| `esbuild.config.mjs` | ✅ Builds correctly | `dist/cli-ink.mjs` = 1.7MB bundle, JSX compiled |
| `cli-ink.js` entry point | ✅ Correct routing | Detects bundle vs source, calls `launchUI()` |
| `--ui` flag detection | ✅ Works | `cli.js:3054` → `startInkUI({model, theme})` |
| Theme system | ✅ 3 themes | dark/light/high-contrast with full color palettes |
| Keyboard shortcuts | ✅ Implemented | Ctrl+Q, Ctrl+P, Ctrl+N, Ctrl+B, Ctrl+T, etc. |
| Build pipeline | ✅ Working | esbuild bundles all JSX, copies yoga.wasm + cfonts |

### What's Broken 🔴

| Component | Status | Issue |
|-----------|--------|-------|
| `App.jsx` → `processMessage()` | 🔴 **FAKE** | `setTimeout(() => setMessages(...), 1000)` — never calls AgentSession |
| `ChatArea.jsx` | 🔴 **No input** | Displays messages only, no text input mechanism |
| `Input.jsx` | 🔴 **Unused** | Full-featured input component exists but is never imported/used |
| `Chat.jsx` | 🔴 **Unused** | Better chat with code blocks, but orphaned — Layout imports ChatArea |
| `Sidebar.jsx` stats | 🟡 **Mock data** | `skills: 12, memoryEntries: 42` hardcoded |
| Streaming integration | 🔴 **Missing** | No code consumes `AgentSession.runStream()` async generator |
| Tool visualization | 🔴 **Disconnected** | `ToolOutput.jsx` exists but never receives tool events |
| Cost/token tracking | 🔴 **Missing** | Status bar shows `$0.0000` and `0 tok` — no data source |
| Non-chat views | 🟡 **Stubs** | Skills/Memory/Models/Settings show placeholder text |

---

## Root Cause Analysis

### The Disconnect Chain

```
User types message
       ↓
[MISSING] — No input handler connected
       ↓
App.jsx processMessage() ← setTimeout fake
       ↓
setMessages([{role:'assistant', content:'Processing: '+content}])
       ↓
ChatArea.jsx renders fake response
       ↓
[NEVER REACHED] AgentSession → Agent.runStream() → OpenRouter API
```

### Why This Happened

The UI was built as a **visual prototype** — components were created for layout, theme, and interaction patterns (keyboard shortcuts, navigation, input history) but the **integration layer was never implemented**. The `App.jsx` `processMessage` function was left as a placeholder with `setTimeout`.

### What the CLI Does Right (That UI Doesn't)

The traditional CLI (`cli.js:935-1075`) does this correctly:

1. Creates `AgentSession` with model, tools, memory, skills
2. Sets callbacks: `onToolStart`, `onToolEnd`, `onResponse`, `onIterationStart`, `onStatus`
3. Calls `agent.run(task)` (non-streaming with callbacks)
4. Prints tool calls with timing, prints AI responses, shows cost/tokens
5. Handles errors with smart suggestions

The UI needs to replicate this pattern but using React state + `runStream()` for real-time updates.

---

## Specialist Findings Summary

### 🔵 UI Expert (Uiexpert)
- **ChatArea.jsx** is too primitive — no input, no streaming display, no tool output
- **Chat.jsx** has code block detection but is orphaned (not imported by Layout)
- **Input.jsx** has full keyboard handling (history, autocomplete, cursor) but is disconnected
- **ToolOutput.jsx** has collapsible sections, JSON rendering, copy — ready to use but never called
- **MarkdownRenderer.jsx** has heading/code/list/table parsing — ready but unused
- **Recommendation:** Wire Input → App.jsx → AgentSession → update Chat/ToolOutput in real-time

### 🟢 Build Expert (Buildexpert)
- **esbuild.config.mjs** correctly bundles `cli-ink.js` → `dist/cli-ink.mjs`
- JSX loader configured (`loader: { '.jsx': 'jsx' }`, `jsx: 'automatic'`)
- Plugins handle react-devtools stub, yoga.wasm copy, cfonts copy
- ESM polyfill for `require()` in banner
- **Bundle size:** 1.7MB (reasonable for bundled React+Ink+dependencies)
- **Risk:** Importing AgentSession/OpenRouterClient into UI components may pull in Node-only deps that break in bundled context — need to verify
- **Recommendation:** Keep backend calls in cli-ink.js entry point, pass session as prop

### 🔴 Backend Expert (Backendexpert)
- **AgentSession.runStream()** yields structured chunks: `{type, content, toolCalls, results, usage}`
- **Agent.run()** uses callbacks (`onToolStart`, `onToolEnd`, `onResponse`) — CLI uses this path
- **Agent.runStream()** yields directly — better for UI (no callback spaghetti)
- Chunk types: `iteration`, `content`, `tools_start`, `tools_done`, `done`, `stopped`, `max_iterations`
- **Critical:** UI must handle the async generator properly — consume chunks in a loop, update state per chunk type
- **Recommendation:** Create a `useAgentSession` hook that manages AgentSession lifecycle and exposes `{sendMessage, messages, isProcessing, tools, cost, tokens}`

---

## Unified Fix Plan

### P0 — Critical (Must Fix for UI to Work)

#### P0.1: Create AgentSession Bridge in cli-ink.js
**File:** `src/cli-ink.js`  
**What:** Initialize AgentSession with model/config, pass as prop to App  
**Why:** The UI currently receives only `{config}` — no session object  
**Effort:** Medium  
```
- Create AgentSession in launchUI() 
- Pass session + model to App component
- Handle .env loading for API key
```

#### P0.2: Wire Input Component into Chat View
**File:** `src/ui/Layout.jsx` + `src/ui/ChatArea.jsx`  
**What:** Import and render Input.jsx below messages, connect onSubmit → processMessage  
**Why:** Currently no way to type messages in the UI  
**Effort:** Small  
```
- Import Input.jsx in ChatArea.jsx
- Add input area below message list
- Wire onSubmit to processMessage prop
```

#### P0.3: Replace Fake processMessage with Real AgentSession
**File:** `src/ui/App.jsx`  
**What:** Replace setTimeout fake with actual AgentSession.runStream() consumption  
**Why:** This is the core disconnect  
**Effort:** Large  
```
- Accept session prop from cli-ink.js
- processMessage() calls session.runStream(content)
- Consume async generator chunks:
  - type:'content' → append to last assistant message
  - type:'tools_start' → show tool indicator
  - type:'tools_done' → update tool output
  - type:'done' → finalize message, update cost/tokens
  - type:'stopped'/'max_iterations' → show warning
```

#### P0.4: Replace ChatArea with Chat Component
**File:** `src/ui/Layout.jsx`  
**What:** Swap `import ChatArea` → `import Chat` (or merge best of both)  
**Why:** Chat.jsx has code block detection, timestamps, better formatting  
**Effort:** Small  
```
- Change import in Layout.jsx
- Ensure props match (theme, messages, isProcessing, processMessage)
```

### P1 — High (Core Features)

#### P1.1: Real-time Streaming Display
**File:** `src/ui/App.jsx` or new `src/ui/hooks/useAgentSession.js`  
**What:** As runStream() yields content chunks, update the last message in real-time  
**Why:** Users expect to see text appear as it's generated  
**Effort:** Medium  
```
- Track streaming message index
- On content chunk: messages[last].content += chunk.content
- Trigger re-render (setState)
```

#### P1.2: Tool Execution Visualization
**File:** `src/ui/App.jsx` + `src/ui/ToolOutput.jsx`  
**What:** When tools_start/tools_done chunks arrive, render ToolOutput components  
**Why:** The CLI shows tool calls with timing — UI should match  
**Effort:** Medium  
```
- Add toolCalls state array
- On tools_start: add tool entries with status:'running'
- On tools_done: update status to 'success'/'error' with duration
- Render ToolOutput components in chat stream
```

#### P1.3: Live Cost/Token Tracking
**File:** `src/ui/Status.jsx` + `src/ui/App.jsx`  
**What:** Parse usage from `done` chunk, update cost/tokens in Status bar  
**Why:** Status bar shows $0.0000 — needs real data  
**Effort:** Small  
```
- Add cost/tokens state in App.jsx
- On type:'done' chunk with usage: update state
- Pass to Status component
```

### P2 — Medium (Polish)

#### P2.1: Real Sidebar Stats
**File:** `src/ui/Sidebar.jsx`  
**What:** Replace hardcoded skills:12, memoryEntries:42 with real data from session  
**Effort:** Small

#### P2.2: Session Persistence
**File:** `src/ui/App.jsx`  
**What:** Load/save chat history, support session resume  
**Effort:** Medium

#### P2.3: Model Selector Integration
**File:** `src/ui/` (new or extend Settings)  
**What:** Wire ModelBrowser into UI for model switching  
**Effort:** Medium

#### P2.4: Skills/Memory/Models Views
**File:** `src/ui/Layout.jsx`  
**What:** Replace placeholder text with real SkillManager/MemoryManager data  
**Effort:** Large

### P3 — Low (Nice to Have)

#### P3.1: Command Palette
#### P3.2: Multi-session Support
#### P3.3: Theme Customization UI
#### P3.4: Export/Import Conversations

---

## Implementation Sequence

```
Phase 1 (P0): Make it work
  ├─ P0.1: AgentSession bridge in cli-ink.js
  ├─ P0.2: Wire Input into ChatArea
  ├─ P0.3: Real processMessage with runStream()
  └─ P0.4: Swap ChatArea → Chat

Phase 2 (P1): Make it good
  ├─ P1.1: Real-time streaming display
  ├─ P1.2: Tool visualization
  └─ P1.3: Cost/token tracking

Phase 3 (P2): Make it polished
  ├─ P2.1: Real sidebar stats
  ├─ P2.2: Session persistence
  ├─ P2.3: Model selector
  └─ P2.4: Skills/Memory views
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AgentSession imports break esbuild bundle | Medium | High | Test build after adding imports; keep session creation in cli-ink.js, pass as prop |
| React re-render performance with streaming | Low | Medium | Batch state updates, use flushSync sparingly |
| API key not loaded in UI context | Medium | High | Ensure dotenv loads before AgentSession creation |
| Async generator + React state conflicts | Medium | Medium | Use useRef for generator, setState for UI updates |
| Ink compatibility with streaming updates | Low | High | Ink supports re-renders — test with rapid setState |

---

## Test Results (Current)

- **197/202 tests pass** (97.5%)
- **5 failures** are Windows path issues (not UI-related):
  - `isAbsolutePath('C:\...')` returns false (regex issue)
  - `expandHome('%USERPROFILE%\test')` backslash escape
  - `OPENAGENT_HOME` path normalization
  - Skill registry path separators
  - Skill update check logic
- **All 7 UI tests pass** (App, Chat, Input, Layout, Sidebar, Status, Theme)
- **No integration tests** exist for UI ↔ AgentSession

---

## Recommendation

**Start with P0.1 → P0.3** — these three changes transform the UI from a demo into a working agent interface. The components (Input, Chat, ToolOutput, MarkdownRenderer) are already well-built. The missing piece is the **integration bridge** between the UI layer and the AgentSession backend.

The safest architecture: create the AgentSession in `cli-ink.js`'s `launchUI()`, pass it as a prop to `App`, and let `App` manage the agent lifecycle through state. This avoids importing backend modules directly into JSX components (which could break the esbuild bundle).
