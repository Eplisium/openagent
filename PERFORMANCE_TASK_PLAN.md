# 🚀 OpenAgent Performance Task Plan

## Industry Standards Benchmark

| Metric | Industry Leaders (Claude Code, Cursor) | OpenAgent Current | Gap |
|--------|---------------------------------------|-------------------|-----|
| **CLI Startup** | < 500ms | ~2-3s (25 deps, eager imports) | 🔴 5-6x slower |
| **Time to First Token** | < 1s (streaming) | ~2-4s (full payload build) | 🟡 2-4x slower |
| **Tool Definition Payload** | Lazy/partial load | ~18,800 tokens (106 tools, every request) | 🔴 Huge |
| **Iteration Latency** | < 5s avg | 6-11s avg (from logs) | 🟡 1.5-2x slower |
| **Memory per Session** | ~50-80MB | ~150-200MB+ (25 deps, tool history, caches) | 🟡 2x+ |
| **Context Utilization** | ~85% effective | ~65% (token estimation is heuristic) | 🟡 20% waste |
| **Tool Execution** | Parallel by default | Partially parallel (read-only yes, write sequential) | 🟢 Good |
| **Streaming** | E2E streaming with early tool dispatch | ✅ Already implemented | 🟢 Good |

---

## Phase 1: Startup & Import Performance (High Impact)

### 1.1 — Lazy-Load Heavy Dependencies in cli.js
**File**: `src/cli.js` (lines 1-40)
**Problem**: All 25 top-level imports execute at startup, even features not used in most sessions.
**Fix**:
- Convert static imports to dynamic `import()` inside the methods that need them:
  - `boxen` — only used for banner/panels
  - `gradient-string` — only used in banner
  - `figlet` — only used in banner
  - `marked` / `marked-terminal` — only used for markdown rendering mode
  - `listr2` — only used in templates
  - `cli-table3` — only used in display
  - `inquirer` / `@inquirer/prompts` / `@clack/prompts` — only used in model selection/onboarding
  - `ora` / `nanospinner` / `cli-spinners` — only used in spinners
- Keep only essential imports at top: `chalk`, `fs`, `path`, `url`
- **Expected**: 40-60% startup time reduction (~1.2s → ~0.5s)

### 1.2 — Lazy-Load AgentSession Dependencies
**File**: `src/agent/AgentSession.js` (lines 1-36)
**Problem**: 18 eager module imports for subsystems that may not be needed immediately.
**Fix**:
- Lazy-load protocol tools (MCP, A2A, AG-UI) — only import when first used
- Lazy-load `AutoGenBridge`, `WorkflowGraph`, `FileCheckpointer` — only import when graph tools are invoked
- Lazy-load `OutcomeTracker`, `PromptEvolutionEngine` — only import when skills are used
- **Expected**: 200-400ms startup improvement

### 1.3 — Model Cache Optimization
**File**: `src/ModelBrowser.js` (lines 59-96)
**Problem**: `loadModels()` reads JSON cache synchronously via `fs.readJson()`, then conditionally refreshes in background. The stale-cache path is good but could be faster.
**Fix**:
- Use `fs.readFileSync` for cache on startup (synchronous is faster than async for small files when blocking anyway)
- Move to incremental cache updates — only fetch model diffs from API, not full list
- Pre-parse and cache model metadata (context length, pricing) as a Map for O(1) lookups
- **Expected**: 100-200ms improvement

---

## Phase 2: Token & Payload Optimization (Highest Impact on Per-Iteration Cost)

### 2.1 — Tool Definition Diet
**Files**: `src/OpenRouterClient.js` (buildPayload), `src/tools/ToolRegistry.js`
**Problem**: All 106 tools are serialized to JSON and sent with EVERY LLM request. At ~18,800 tokens, this is ~5% of a 400K context window wasted on tool definitions the model won't use in most iterations.
**Fix**:
- **Tool subset selection**: Analyze the user's task and recent tool usage to send only relevant tool categories. If the last 3 tool calls were `read_file`, `edit_file`, `exec` — send file + shell tools, not the full 106.
- **Progressive tool loading**: Start with core tools (file, shell, git, web = ~35 tools). If the model requests a tool not in scope, resend with that category added.
- **Tool description compression**: Shorten descriptions for non-primary tools. Keep verbose descriptions only for file/edit/exec/git tools.
- **Expected**: 50-70% reduction in per-request tokens → faster TTFT, lower cost

### 2.2 — Token Estimation Accuracy
**File**: `src/agent/Agent.js` (estimateMessageTokens, lines 744-784), `src/utils.js` (estimateTokens)
**Problem**: Heuristic-based estimation (code ~3.5 chars/token, prose ~4 chars/token) can be off by 15-25%. This leads to either premature compaction or context overflow.
**Fix**:
- Use actual token counts from API response `usage.prompt_tokens` to calibrate the estimator. Track a running `actual/estimated` ratio and apply a correction factor.
- Cache per-message token estimates (already partially done with `_tokenEstimate` on message objects — but invalidated on `setMessages`).
- For streaming: use `usage` from the final chunk to update calibration after each iteration.
- **Expected**: 15-20% better context utilization → more content in window, fewer compactions

### 2.3 — Redundant normalizeMessages Calls
**File**: `src/OpenRouterClient.js` (lines 1018, 1062-1075)
**Problem**: `buildPayload()` calls `normalizeMessages(messages)` even when messages are already normalized (they come from `this.messages` which is always an array of objects). This is O(n) string checking on every request.
**Fix**:
- Add a `_normalized: true` flag to skip re-normalization when messages come from internal state
- Or: normalize once on `pushMessage()` and store the normalized form
- **Expected**: Minor per-request improvement, compounds over many iterations

---

## Phase 3: Agent Loop Optimization (Impact on Iteration Speed)

### 3.1 — Eliminate Planning LLM Call for Simple Tasks
**File**: `src/agent/Agent.js` (plan(), lines 1334-1370)
**Problem**: `isComplexTask()` triggers a separate planning LLM call for any input > 50 chars with keywords like "fix", "add", "create". This adds 2-4s latency before the first real iteration.
**Fix**:
- Remove the pre-planning call entirely. The system prompt already instructs the model to explore → plan → code → verify. The model is better at planning than a constrained JSON-only planning call.
- OR: make planning optional (`--plan` flag) and disabled by default
- OR: use a much smaller/faster model for planning (Haiku-class)
- **Expected**: 2-4s faster first response

### 3.2 — Context Compaction: Single-Pass Algorithm
**File**: `src/agent/Agent.js` (buildCompactionSummary, lines 943-1050+, maybeCompactContext)
**Problem**: Compaction does multiple passes over the message array: `filter`, `findIndex`, `split`, regex scans. For 100+ messages this is noticeable.
**Fix**:
- Combine file path extraction, decision detection, error extraction, and tool tracking into a single forward pass
- Use the existing `Agent._filePathRegex`, `Agent._decisionRegex` etc. (already pre-compiled — good) but in one loop
- Pre-compute exchange boundaries once and reuse across allocator and compaction
- **Expected**: 30-50% faster compaction for long sessions

### 3.3 — Parallel Tool Execution Enhancement
**File**: `src/agent/Agent.js` (executeToolCallsEnhanced, lines 2432-2616)
**Problem**: Write tools on different files CAN run in parallel (already implemented), but the grouping logic does Map → Array → Promise.allSettled. The read-only / dependent tool split is good but incomplete.
**Fix**:
- Add `git_add`, `git_commit`, `git_push` to the "can parallelize if different targets" category
- Add `web_search` + `fetch_url` to the "always parallel" category (already in readOnlyTools ✓)
- Add `exec` with different `cwd` values to the "parallel" category (partially done — look at shell tools with different cwd)
- **Expected**: 10-30% faster tool execution rounds

### 3.4 — Stream-Dispatch Overlap Optimization
**File**: `src/agent/Agent.js` (runWithStreaming, lines 1660-1900), `src/OpenRouterClient.js` (chatStream, lines 454-634)
**Problem**: The streaming path dispatches tool calls via `onToolCallReady` as soon as the tool call JSON is complete. This is already excellent. However:
- `executeSingleToolCall` has its own retry loop (up to 3 retries × tool timeout) that can block the tool result collection
- The `await Promise.allSettled([...dispatchedPromises.values()])` on fallback waits for ALL dispatched tools before retrying
**Fix**:
- Add a `toolExecutionTimeout` per dispatched tool (default: 30s) that's shorter than the tool registry's 120s default
- On stream error fallback: use already-completed results immediately, only wait for in-progress ones with a short timeout (5s)
- **Expected**: 5-15% faster recovery from stream errors

---

## Phase 4: Memory & Resource Management (Scalability)

### 4.1 — Tool Execution History Bounded Growth
**File**: `src/tools/ToolRegistry.js` (lines 345-383)
**Problem**: `executionHistory` grows to `maxHistorySize` (500) and is then sliced to 250. Each entry stores args, result, duration, timestamp. For long sessions this is significant memory.
**Fix**:
- Reduce `maxHistorySize` to 200 (from 500)
- Don't store full `args` — store only `args.path || args.command?.substring(0, 40)` (already partially done in sanitizeArgs but still stores the full sanitized object)
- Add `destroy()` method to ToolRegistry to clear all state
- **Expected**: 30-50% memory reduction in tool registry

### 4.2 — OpenRouterClient Cache Size
**File**: `src/OpenRouterClient.js` (cache management, lines 97-260)
**Problem**: Cache can hold up to 500 entries. Each entry stores the full response object (potentially large for tool-calling responses).
**Fix**:
- Reduce `CLIENT_CACHE_MAX_SIZE` from 500 to 200 (agent sessions rarely repeat identical requests)
- Store only the response content + usage in cache (not the full payload echo)
- Add `maxCacheEntrySize` — skip caching responses > 50KB (tool-heavy responses)
- **Expected**: 30-40% cache memory reduction

### 4.3 — Subagent Message Bus Bounded Queues
**File**: `src/agent/SubagentManager.js` (lines 948-960 from analysis)
**Problem**: Inter-subagent message queues grow unbounded.
**Fix**:
- Add max queue size (100 messages per subagent)
- Add TTL (messages older than 10 minutes are evicted)
- **Expected**: Prevents memory leak in long-running sessions with many subagents

### 4.4 — Agent History Array Trimming
**File**: `src/agent/Agent.js` (this.history, line 53)
**Problem**: `this.history` (iteration records) grows unbounded during a session.
**Fix**:
- Keep only last 50 history entries (trim oldest on push)
- Summarize dropped entries into a compact stats object
- **Expected**: Linear memory growth → bounded memory

---

## Phase 5: Streaming & Network Optimization (Latency)

### 5.1 — Content Chunk Join Optimization
**File**: `src/OpenRouterClient.js` (chatStream, lines 500-565)
**Problem**: Content chunks are accumulated in an array and joined periodically (~every 200 chars). The `contentChunks.join('')` call creates a new string each time. For a 10K token response with ~400 chunks, this is O(n²) string concatenation.
**Fix**:
- Use a `Buffer` or track cumulative length with periodic joins (already partially done with `contentLength % 200`)
- Better: use a custom `StringBuilder` class that buffers into chunks and joins once at the end
- OR: since Node.js 18+ optimizes string concatenation internally, this may be a micro-optimization. Profile first.
- **Expected**: 5-10% faster for very long streaming responses

### 5.2 — HTTP Connection Pool Tuning
**File**: `src/OpenRouterClient.js` (line 26)
**Problem**: `httpAgent` is configured with `keepAliveTimeout: 60000, connections: 20`. For single-user CLI this is fine, but the connection pool is module-level shared.
**Fix**:
- Reduce connections to 6 (single user rarely needs 20 concurrent connections)
- Add `pipelining: 1` for HTTP/1.1 keep-alive
- Add `connectTimeout: 5000` to fail fast on network issues
- **Expected**: Faster connection reuse, less memory

### 5.3 — Request Deduplication for Streaming
**File**: `src/OpenRouterClient.js` (lines 103-104, 383-401)
**Problem**: Request deduplication (`inFlightRequests`) only works for non-streaming `chat()` calls. Streaming calls bypass this.
**Fix**:
- Add deduplication for streaming requests too (if identical request is already streaming, subscribe to the same stream)
- **Expected**: Edge case improvement for parallel subagent scenarios

---

## Phase 6: Dependency & Build Optimization

### 6.1 — Audit and Remove Redundant Dependencies
**File**: `package.json`
**Problem**: 25 runtime dependencies. Several overlap:
- `chalk` AND `picocolors` — both are color libraries (picocolors is smaller/faster)
- `inquirer` AND `@inquirer/prompts` AND `@clack/prompts` — THREE prompt libraries
- `ora` AND `nanospinner` AND `cli-spinners` — THREE spinner libraries
- `boxen` — can be replaced with simple string formatting
**Fix**:
- Consolidate to ONE color library: `picocolors` (fastest, smallest)
- Consolidate to ONE prompt library: `@clack/prompts` (modern, feature-rich)
- Consolidate to ONE spinner: `nanospinner` (smallest)
- Remove `figlet` — use pre-rendered ASCII art stored as a string constant
- Remove `gradient-string` — use ANSI escape codes directly
- Remove `listr2` — heavy dependency, used only in templates
- Remove `inquirer` — keep only `@inquirer/prompts` or `@clack/prompts`
- **Expected**: 50-70% fewer dependencies → faster install, smaller node_modules, faster startup

### 6.2 — Bundle Analysis
**Fix**:
- Run `npx depcheck` to find unused dependencies
- Run `npx bundlephobia` or `node --max-old-space-size=512 src/cli.js --help` to measure memory footprint
- Consider using `node --experimental-loader` for ESM optimization
- **Expected**: Identify and remove dead weight

---

## Phase 7: Observability & Continuous Optimization

### 7.1 — Performance Telemetry
**Fix**:
- Add `--perf` flag that logs per-iteration timing breakdown:
  - Token estimation time
  - Context allocation time
  - LLM request time (TTFT + total)
  - Tool execution time (per tool)
  - Post-processing time
- Write to `.openagent/perf-log.jsonl` for analysis
- **Expected**: Data-driven future optimization

### 7.2 — Adaptive Timeouts
**File**: `src/OpenRouterClient.js` (createController, line 272)
**Problem**: Fixed 120s timeout for all requests. Some models respond in 2s, others in 30s.
**Fix**:
- Use the existing `_recentResponseTimes` array (line 126) to compute p95 response time
- Set adaptive timeout = max(30s, p95 * 2)
- Different timeouts for streaming vs non-streaming
- **Expected**: Faster failure detection for slow models

---

## Implementation Priority

| Priority | Phase | Est. Impact | Effort | Dependencies |
|----------|-------|-------------|--------|-------------|
| 🔴 P0 | 2.1 Tool Definition Diet | -50% per-request tokens | 2-3 days | None |
| 🔴 P0 | 3.1 Remove Planning Call | -2-4s first response | 1 hour | None |
| 🔴 P0 | 1.1 Lazy CLI Imports | -50% startup | 1-2 days | None |
| 🟡 P1 | 1.2 Lazy AgentSession Imports | -200ms startup | 1 day | 1.1 |
| 🟡 P1 | 6.1 Dependency Consolidation | -50% deps, faster startup | 2-3 days | None |
| 🟡 P1 | 4.1 Tool History Bounds | -30% tool memory | 2 hours | None |
| 🟡 P1 | 4.2 Cache Size Reduction | -30% cache memory | 1 hour | None |
| 🟢 P2 | 2.2 Token Estimation Calibration | +15% context utilization | 1 day | None |
| 🟢 P2 | 3.2 Single-Pass Compaction | -30% compaction time | 1 day | None |
| 🟢 P2 | 3.3 Parallel Tool Enhancement | -15% tool round time | 1 day | None |
| 🟢 P2 | 5.2 HTTP Pool Tuning | Better connection reuse | 1 hour | None |
| ⚪ P3 | 4.3 Subagent Queue Bounds | Prevent memory leaks | 2 hours | None |
| ⚪ P3 | 4.4 History Trimming | Bounded memory | 1 hour | None |
| ⚪ P3 | 5.1 Content Chunk Join | -5% streaming time | 2 hours | None |
| ⚪ P3 | 7.1 Performance Telemetry | Data collection | 1 day | None |
| ⚪ P3 | 7.2 Adaptive Timeouts | Faster failure detection | 2 hours | None |

---

## Quick Wins (Do First — < 1 hour each)

1. **Remove planning LLM call** — Comment out `this.plan()` in `run()`. Instant 2-4s save.
2. **Reduce cache max size** — Change `CLIENT_CACHE_MAX_SIZE: 500` → `200` in config.js
3. **Reduce tool history** — Change `maxHistorySize: 500` → `200` in ToolRegistry
4. **Tune HTTP pool** — Change connections from 20 → 6 in OpenRouterClient
5. **Add history trimming** — Add `.slice(-50)` to `this.history.push()`

---

## Measurement Strategy

Before and after each phase, measure:
1. **Startup time**: `time openagent --help` (cold start)
2. **Time to first prompt**: `time openagent` → until session info box appears
3. **First iteration latency**: From user input to first tool call start
4. **Average iteration time**: From `/stats` output
5. **Memory**: `process.memoryUsage().heapUsed` at steady state
6. **Per-request token count**: Log `usage.prompt_tokens` for tool definition overhead

---

*Plan generated: May 12, 2026*
*Based on: Deep analysis of OpenAgent v0.1.20 codebase + industry research on Claude Code, Cursor, and LLM agent performance benchmarks*
