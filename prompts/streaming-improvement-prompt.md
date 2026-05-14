# OpenAgent Streaming & Long-Session Improvement Prompt

## Who You Are

You are the co-founder and solo developer of **OpenAgent** — a production-grade AI agent platform (v0.1.20) built on Node.js (ESM, `node>=18`) that routes through OpenRouter's API to 400+ models. You know every file, every module, every design decision. You built this. Now make the streaming and long-session capability significantly better.

## What OpenAgent Is (Architecture Overview)

OpenAgent is a **multi-layer agentic system** with these core components:

### Core Modules (you know these intimately)
| Module | Path | Purpose |
|--------|------|---------|
| **OpenRouterClient** | `src/OpenRouterClient.js` | HTTP client to OpenRouter API — SSE streaming, tool call accumulation, request dedup, content-hashed caching, AbortController cancellation, undici connection pool |
| **Agent** | `src/agent/Agent.js` (~3420 lines) | The agentic loop — `run()` (non-streaming) and `runWithStreaming()` (streaming with early tool dispatch), context compaction, stall/dead-end/no-action-trap detection, circuit breaker, token calibration |
| **AgentSession** | `src/agent/AgentSession.js` | Session manager — wires Agent + ToolRegistry + SubagentManager + TaskManager + MemoryManager + SkillManager + HookManager together, manages workspace, checkpoints, session save/load |
| **SubagentManager** | `src/agent/SubagentManager.js` | Delegates tasks to specialized subagents (coder, researcher, reviewer, tester, architect) — auto-injects project file tree, platform-aware, retry logic, message bus, shared context |
| **ContextAllocator** | `src/agent/contextAllocator.js` | Hierarchical context budgeting — system(12%) / recent(38%) / workingSet(30%) / older(15%) / buffer(5%), working-set-aware priority allocation |
| **CLI** | `src/cli.js` | Interactive terminal — deferred heavy imports, streaming display, tool visualization, markdown rendering, diff viewer, themes |
| **GatewayDaemon** | `src/gateway/GatewayDaemon.js` | Headless server mode — Hono HTTP + SSE, SessionPool with LRU eviction, ChannelRouter for multi-channel routing |
| **HttpChannel** | `src/gateway/channels/HttpChannel.js` | REST API + SSE adapter — POST /api/task, GET /api/events, broadcasts to SSE clients |
| **Config** | `src/config.js` | Centralized config — MAX_CONTEXT_TOKENS=800000, AGENT_MAX_ITERATIONS=50, AGENT_MAX_RUNTIME_MS=30min, TOOL_TIMEOUT_MS=90s, STREAM_KEEP_ALIVE=true |

### Current Streaming Architecture (what you need to improve)

**OpenRouterClient.chatStream()** (line 477):
- Uses native `fetch` with `response.body.getReader()` for SSE parsing
- Accumulates tool call fragments via `accumulateToolCalls()` with brace-depth JSON completion detection
- Fires `onToolCallReady(toolCall)` callback as soon as a single tool call's arguments JSON is complete — enabling early dispatch
- Yields `{type:'content'|'tool_calls'|'done'|'error'}` chunks
- Pre-allocates `contentChunks[]` array instead of string concatenation
- Periodic `fullContent` join every ~200 chars to amortize cost
- Shared undici `httpAgent` with keepAliveTimeout=60s, connections=6

**Agent.runWithStreaming()** (line 1716):
- The main agentic loop — iterates until completion, stall, dead-end, or limit
- Per iteration: `prepareMessagesForLLM()` → `chatStream()` → accumulate content + dispatch tools via `onToolCallReady` → wait for dispatched promises → `postToolIteration()`
- **Early tool dispatch**: tool calls fire immediately via `onToolCallReady`, don't wait for full response
- Falls back to `run()` (non-streaming) if streaming fails mid-iteration
- Has stall detection, dead-end detection, tool-type monotony nudges, no-action trap detection
- `onIntermediateContent` callback for showing model thinking alongside tool calls

**Gateway SSE** (HttpChannel):
- Hono `streamSSE()` for `/api/events`
- Simple broadcast to all SSE clients — no structured event types for tool calls, iterations, or progress
- `ChannelRouter._handleIncoming()` runs `session.run(content)` — **blocks until complete**, then sends the full response text back. No streaming of intermediate steps to SSE clients.

### Current Long-Session Architecture (what you need to improve)

**Context Management**:
- `ContextAllocator` with 5-tier priority budget (system/recent/workingSet/older/buffer)
- `Agent.maybeCompactContext()` triggers when context usage exceeds `compactThreshold` (default 0.7 = 70%)
- Token estimation with calibration factor from actual API usage data
- Working set tracking for files being actively edited

**Known Pain Points** (you know these because you built it):
1. **Gateway SSE is fire-and-forget** — `ChannelRouter` waits for the full `session.run()` result before sending anything back. SSE clients get zero intermediate feedback during long agent tasks.
2. **No structured streaming events** — the SSE channel sends plain text responses. Tool calls, iteration progress, intermediate thinking, and status updates are all lost. A web client has no way to show a progress UI.
3. **Context rot in long sessions** — after 20-30+ tool calls, the model's attention degrades. The ContextAllocator drops older messages but doesn't summarize them — it just discards. Critical constraints from early iterations get lost.
4. **No streaming backpressure** — if a client is slow, SSE writes can buffer unboundedly. No flow control or backpressure signaling.
5. **Tool result truncation is lossy** — `MAX_TOOL_RESULT_CHARS=80000` truncates with no summary. Important output tail gets cut off silently.
6. **No checkpoint/resume mid-task** — sessions can be saved/loaded, but if a long streaming task is interrupted (network drop, client disconnect), there's no way to resume from the last completed iteration.
7. **ContentChunks join strategy is naive** — periodic join every ~200 chars, but no consideration for token boundaries or semantic boundaries (e.g., don't split mid-JSON or mid-XML-tag).
8. **SSE keep-alive is missing** — OpenRouter sends `: OPENROUTER PROCESSING` comments. The client correctly skips these, but the gateway SSE doesn't send keep-alive heartbeats to its own clients. Long tool executions (builds, test runs) can cause 30-90s gaps where the SSE connection looks dead.
9. **No concurrent iteration streaming** — each iteration is sequential (stream → dispatch tools → wait → next iteration). When a model returns multiple independent tool calls, they execute in parallel (good), but the next iteration doesn't start until ALL complete. No pipelining of the next LLM call while tools are still running.
10. **Subagent streaming is opaque** — `SubagentManager` runs subagents but their intermediate output doesn't flow back to the parent's SSE stream. Web clients see nothing during subagent work.

## What "Better" Means — Your Improvement Targets

### Tier 1: Streaming UX (highest impact, do these first)

1. **Structured SSE event protocol** — Define a proper event taxonomy for the gateway SSE stream:
   - `iteration_start` / `iteration_end` — with iteration number, elapsed time
   - `content_delta` — streaming text tokens as they arrive
   - `tool_call_start` / `tool_call_end` — with tool name, args preview, result summary, duration
   - `thinking` — intermediate model reasoning (the `onIntermediateContent` output)
   - `status` — progress indicators ("compacting context...", "retrying after error...", etc.)
   - `checkpoint` — when a checkpoint is saved
   - `done` / `error` — terminal events
   - Each event must include: `sessionId`, `iteration`, `timestamp`, and relevant payload.

2. **Gateway streaming pipeline** — Wire the Agent's callbacks (`onToolStart`, `onToolEnd`, `onIntermediateContent`, `onResponse`, `onStatus`, `onIterationStart`, `onIterationEnd`) through `ChannelRouter` → `OutputAdapter` → SSE channel as structured events. The current `ChannelRouter._handleIncoming()` must be refactored from "await full result then send" to "subscribe to agent events and stream them in real-time."

3. **SSE keep-alive heartbeats** — The gateway must send `: heartbeat` comments every 15-30 seconds during long tool executions. This prevents proxy/CDN timeouts and client-side connection drops.

4. **Backpressure-aware SSE** — Track write buffer size per SSE client. If a client falls behind (buffer > N bytes), either: (a) drop intermediate `content_delta` events and only send summaries, or (b) disconnect the slow client with a meaningful error. Don't let memory grow unbounded.

### Tier 2: Long-Session Reliability (critical for tasks that run 10+ minutes)

5. **Context summarization instead of truncation** — When `ContextAllocator` drops "older" messages, it should replace them with a compressed summary (not just discard). Implement a `summarizeOlderMessages()` method that:
   - Extracts key decisions, constraints, and file states from the conversation
   - Produces a compact summary (target: <500 tokens) that preserves critical context
   - Injects the summary as a system-reminder message at the boundary
   - This is the #1 thing Anthropic, Google, and Manus all converged on: **context must be a compiled view, not an append-only log**

6. **Tool result summarization** — When a tool result exceeds `MAX_TOOL_RESULT_CHARS`, don't just truncate. Generate a structured summary:
   - For `read_file`: keep the first N lines + last N lines + line count
   - For `exec`: keep the first N lines + exit code + signal
   - For `search_in_files`: keep match count + first 3 matches
   - For `web_search`: keep result count + top 3 titles/URLs
   - Include a `[truncated: X chars omitted, use read_file to see full output]` marker

7. **Iteration checkpoint streaming** — After each completed iteration in `runWithStreaming()`, emit a checkpoint event with: iteration number, messages snapshot (or delta), tool results so far, current state. If the SSE connection drops, a client can reconnect and resume from the last checkpoint by sending `Last-Event-ID`.

8. **SSE reconnection with state recovery** — Implement `Last-Event-ID` support in the gateway. When a client reconnects after a drop:
   - Look up the last event they saw (by ID)
   - Send a `state_recovery` event with a summary of what happened since the disconnect
   - Then resume live streaming

### Tier 3: Streaming Performance (optimization, not new features)

9. **Smarter content chunk joining** — In `chatStream()`, join `contentChunks` at semantic boundaries instead of fixed 200-char intervals. Specifically:
   - Don't split mid-XML-tag (look for `<` without matching `>`)
   - Don't split mid-JSON (track brace depth like `_isArgumentsComplete` does)
   - Prefer joining at newline boundaries

10. **Pipelined iteration** — When the model returns tool calls in `runWithStreaming()`, start preparing the next iteration's context while tools are still executing. Specifically:
    - After dispatching tool calls via `onToolCallReady`, begin `prepareMessagesForLLM()` with a placeholder for the pending tool results
    - When tool results arrive, patch them into the prepared messages
    - This overlaps context preparation (compaction, allocation) with tool execution time
    - **Constraint**: Don't actually send the next LLM request until all tool results are ready — we're overlapping preparation, not execution

11. **Streaming-aware subagent output** — When `SubagentManager` runs a subagent, pipe its `onIntermediateContent` and `onToolStart`/`onToolEnd` callbacks back to the parent session's event stream. Tag them with `subagentId` so the SSE client can show them in a nested/collapsed UI.

## Constraints (non-negotiable)

- **No breaking changes to the CLI experience** — The terminal CLI must work exactly as before. All streaming improvements must be additive. The CLI uses the same Agent callbacks but renders to stdout; the gateway uses them for SSE.
- **No new runtime dependencies** — OpenAgent's dependency list is intentional. Use what's already there (undici, hono, chalk, etc.). If you absolutely must add something, justify it and keep it minimal.
- **Windows-first** — OpenAgent runs on Windows (PowerShell/CMD). All shell commands, paths, and process handling must be Windows-compatible.
- **800K context token budget** — The `MAX_CONTEXT_TOKENS=800000` is the ceiling. Your summarization and allocation improvements must work within this.
- **OpenRouter SSE spec** — The streaming must comply with OpenRouter's SSE format: `data:` lines, `[DONE]` terminator, mid-stream error handling with `finish_reason: "error"`, keep-alive comments starting with `:`.
- **Backward-compatible SSE** — Existing SSE clients that only understand plain text responses must still work. The new structured events should be opt-in (e.g., via `Accept: application/json` header or a query param like `?format=structured`).

## Implementation Order

1. **Start with the SSE event protocol** (Tier 1, item 1) — define the event types and payload schemas. This is the foundation everything else builds on.
2. **Wire the gateway streaming pipeline** (Tier 1, item 2) — refactor `ChannelRouter._handleIncoming()` and `HttpChannel` to support real-time event streaming.
3. **Add SSE heartbeats and backpressure** (Tier 1, items 3-4) — these are small, self-contained changes.
4. **Implement context summarization** (Tier 2, item 5) — this is the highest-impact long-session improvement.
5. **Tool result summarization** (Tier 2, item 6) — straightforward, high impact.
6. **Iteration checkpoints + reconnection** (Tier 2, items 7-8) — builds on the event protocol.
7. **Streaming performance** (Tier 3) — optimizations after the foundation is solid.

## Verification

After each change:
- Run `npm run lint` — zero errors
- Run `npm test` — all existing tests pass
- Test the CLI interactively — `node src/cli.js` — streaming must look identical to before
- Test the gateway — `node src/cli.js --daemon --port 3000` — submit a task via `POST /api/task` and verify SSE events on `GET /api/events`
- Test a long session — give the agent a task that requires 10+ iterations and verify context compaction + summarization works
- Test SSE reconnection — connect, receive some events, disconnect, reconnect with `Last-Event-ID`, verify state recovery

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/gateway/channels/HttpChannel.js` | Structured SSE events, heartbeats, backpressure, Last-Event-ID, format negotiation |
| `src/gateway/ChannelRouter.js` | Refactor `_handleIncoming()` for real-time event streaming instead of blocking on full result |
| `src/gateway/OutputAdapter.js` | Add structured event methods (writeToolCallStart, writeIterationStart, etc.) |
| `src/gateway/ConsoleSink.js` | Implement structured event rendering for terminal output (same as CLI but via adapter) |
| `src/gateway/HttpSink.js` | Implement structured event → SSE translation |
| `src/OpenRouterClient.js` | Smarter contentChunks joining, SSE comment passthrough |
| `src/agent/Agent.js` | Context summarization in `maybeCompactContext()`, pipelined iteration prep, iteration checkpoint events |
| `src/agent/contextAllocator.js` | Add summarization layer — replace dropped messages with compressed summaries instead of silent discard |
| `src/agent/AgentSession.js` | Wire agent callbacks to OutputAdapter for gateway streaming |
| `src/agent/SubagentManager.js` | Pipe subagent events back to parent session's event stream |

## Research-Backed Principles (why these changes work)

From Anthropic's "Effective Context Engineering" paper:
> "Context must be treated as a finite resource with diminishing marginal returns. Every new token introduced depletes the attention budget. The optimal approach is finding the smallest possible set of high-signal tokens that maximize the likelihood of the desired outcome."

From Google/Manus/Stanford convergence on long-running agents:
> "The problem isn't that agents can't hold enough information. The problem is that every token you add to the context window competes for the model's attention. Stuff a hundred thousand tokens of history into the window and the model's ability to reason about what actually matters degrades. The agent doesn't forget because it ran out of space — it forgets because signal got drowned by accumulation."

From SSE production scaling research:
> "Since SSE is just HTTP, horizontal scaling with multiple stateless API servers is straightforward. No need for sticky sessions or socket brokers." — The key is making events self-describing and idempotent so any server instance can resume a stream.

From OpenRouter's streaming spec:
> "OpenRouter occasionally sends comments to prevent connection timeouts. These comments look like `: OPENROUTER PROCESSING` and can be safely ignored per the SSE specs, or leveraged to improve UX." — We should do the same for our gateway clients.

Now go make OpenAgent's streaming something that makes people say "how is this running in a terminal?"
