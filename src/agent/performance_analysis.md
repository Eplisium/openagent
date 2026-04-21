# Core Agent Architecture Performance Analysis

## Overview
Analysis of the core agent architecture in `src/agent/` focusing on performance characteristics, bottlenecks, memory management, and scalability. The system implements a ReAct (Reason-Act) pattern with tool execution, context compaction, and subagent delegation.

---

## 1. Agent.js - Main Agent Loop & ReAct Pattern

### Architecture Patterns
- **ReAct Pattern**: Implements think-act-observe loop via `run()` method (lines 405-659)
- **Circuit Breaker**: Tracks consecutive failures by error category (lines 82-85, 781-834)
- **Stall Detection**: Detects repeated identical tool calls (lines 87-91, 515-536)
- **Parallel Tool Execution**: Independent read-only tools execute in parallel (lines 726-773)
- **Retry with Exponential Backoff**: For both LLM calls and tool execution (lines 664-718, 859-909)

### Exit Strategies (lines 425-447)
1. **Abort**: External cancellation via `checkAborted()`
2. **Iteration Limit**: `hasReachedIterationLimit()` - configurable max iterations
3. **Runtime Limit**: `hasReachedRuntimeLimit()` - time-based cutoff
4. **Tool Call Limit**: `hasReachedToolCallLimit()` - limits total tool executions
5. **Stall Detection**: `hasStalled()` - same tool workflow repeated
6. **Completion**: Empty `toolCalls` array from LLM indicates final response

### Performance Bottlenecks

#### 1. Token Estimation Overhead
```javascript
// Lines 213-256: estimateMessageTokens() called for each message
// O(n) complexity when recalculating all messages
recalculateEstimatedTokens() {
  this.cachedEstimatedTokens = this.messages.reduce(
    (sum, message) => sum + this.estimateMessageTokens(message), 0
  );
}
```
**Issue**: While incremental updates exist (`pushMessage` line 265), full recalculation occurs on `setMessages` and `setSystemPrompt`. For long conversations (100+ messages), this becomes noticeable.

#### 2. Context Compaction Algorithm
```javascript
// Lines 1163-1229: maybeCompactContext()
// Multiple iterations over messages array
const systemMsg = this.messages.find(m => m.role === 'system');
const nonSystemMessages = this.messages.filter(m => m.role !== 'system');
// ... additional loops for exchange boundary detection
```
**Issue**: O(n) operations with multiple passes. Could be optimized with single-pass algorithm.

#### 3. Tool Result Truncation
```javascript
// Lines 556-572: Truncation at line boundaries
let cutPoint = this.maxToolResultChars;
const newlineBefore = content.lastIndexOf('\n', this.maxToolResultChars);
```
**Issue**: `lastIndexOf` scans backward from cut point. Acceptable for typical tool outputs.

### Memory Management
- **Tool Result Truncation**: Limits tool output to `maxToolResultChars` (default from CONFIG)
- **Context Compaction**: Preserves system message, first user message, last 4 exchanges (lines 1175-1219)
- **Message History**: Stores full message array in memory; no disk swapping
- **History Tracking**: Maintains separate `history` array for iteration records (line 609)

### Scalability Considerations
- **Single-threaded Loop**: LLM calls are sequential; parallelism only in tool execution
- **Context Window Limit**: Hard limit at `maxContextTokens` (default from CONFIG)
- **Tool Execution Concurrency**: Independent tools run in parallel via `Promise.allSettled` (line 751)
- **No Horizontal Scaling**: Agent state is in-memory; cannot distribute across processes

### Code Complexity Observations
- **Large Class**: 1359 lines with multiple responsibilities
- **Duplicate Logic**: Token estimation methods duplicated from ContextManager
- **Deep Nesting**: Tool execution retry logic has 4+ levels of nesting
- **Magic Numbers**: Hardcoded thresholds like `singleToolStallThreshold = 3` (line 90)

---

## 2. AgentSession.js - Session Management

### Architecture Patterns
- **Facade Pattern**: Session orchestrates Agent, SubagentManager, TaskManager, etc.
- **Diff-based Checkpointing**: Stores only message deltas between checkpoints (lines 437-494)
- **Lazy Loading**: System prompt template loaded once at module level (lines 38-45)
- **Workspace Isolation**: Each session can have its own workspace directory

### State Handling Efficiency
```javascript
// Lines 437-476: _compressMessage() - truncates large content for checkpoints
// Lines 485-494: _computeMessageDiff() - stores only new messages since last checkpoint
```
**Efficiency**: Checkpoint storage is optimized with compression and diffing. However, in-memory message array still grows unbounded during session.

### Performance Bottlenecks

#### 1. Tool Registry Initialization
```javascript
// Lines 82-121: Creates multiple tool instances in constructor
this.toolRegistry = new ToolRegistry();
this.toolRegistry.registerAll([...createFileTools(...), ...createShellTools(...), ...]);
```
**Issue**: Each session creates its own tool instances. SubagentManager creates another set (line 66). Could share tool definitions.

#### 2. System Prompt Building
```javascript
// Lines 316-333: buildSystemPrompt() does string replacement
return template
  .replace(/\{\{WORKING_DIR\}\}/g, this.workingDir)
  .replace(/\{\{WORKSPACE_DIR\}\}/g, workspaceDir)
  // ... 6 more replacements
```
**Issue**: Multiple regex replacements on potentially large template. Acceptable as it's infrequent.

#### 3. Workflow Registry
```javascript
// Lines 168-175: Map of workflow graphs
this.workflowRegistry = new Map();
this.activeGraphs = new Map();
```
**Issue**: Graph workflows may hold significant state; unclear cleanup on session end.

### Memory Management
- **Checkpoint Compression**: Messages truncated to 1000 chars for storage (line 444)
- **Diff Storage**: Only new messages stored per checkpoint (line 493)
- **Workspace Cleanup**: WorkspaceManager likely handles temp files (not analyzed)
- **No Explicit Cleanup**: Session doesn't have `destroy()` method to release resources

### Scalability Considerations
- **Session Isolation**: Each session independent; can run multiple concurrently
- **File System Contention**: Multiple sessions may conflict on same workspace
- **Resource Holding**: Each session holds full tool registry, managers, agent instance
- **No Connection Pooling**: Each session creates its own OpenRouterClient

### Code Complexity Observations
- **God Object**: Session knows about too many subsystems (899 lines)
- **Mixed Concerns**: Combines workflow engine, subagent management, memory, skills, hooks
- **Constructor Heavy**: 180-line constructor with deep initialization
- **Async/Sync Mix**: Both sync and async system prompt building (lines 316, 338)

---

## 3. ContextManager.js - Context Window Management

### Architecture Patterns
- **Single Responsibility**: Dedicated to token estimation and compaction
- **Cached Token Count**: Maintains `cachedEstimatedTokens` with incremental updates
- **Smart Compaction**: Preserves conversation structure during truncation

### Token Estimation Algorithm
```javascript
// Lines 36-70: estimateMessageTokens()
// Heuristic: code ~3 chars/token, prose ~4 chars/token
const isCode = /[{}[\]()=><;]/.test(content);
total += isCode ? Math.ceil(content.length / 3) : Math.ceil(content.length / 4);
```
**Accuracy**: Reasonable heuristic but may over/underestimate for mixed content.

### Performance Bottlenecks

#### 1. Full Recalculation
```javascript
// Lines 76-83: recalculateEstimatedTokens()
this.cachedEstimatedTokens = this.messages.reduce(
  (sum, message) => sum + this.estimateMessageTokens(message), 0
);
```
**Issue**: O(n) operation. Could be optimized by caching per-message estimates.

#### 2. Compaction Algorithm
```javascript
// Lines 286-354: maybeCompactContext()
// Multiple iterations: filter, findIndex, slice, etc.
const exchangeStarts = [];
for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
  // ... boundary detection
}
```
**Issue**: O(n) with backward iteration. Could be combined with single forward pass.

### Memory Management
- **Message Storage**: Holds reference to messages array (not owned)
- **History Array**: Separate history for compaction summaries (line 28)
- **No Size Limits**: Doesn't enforce max message count, only token estimate

### Scalability Considerations
- **Per-Agent Instance**: Each agent has its own ContextManager
- **No Shared Context**: Cannot share context between agents
- **In-Memory Only**: No persistence; lost on process restart

### Code Complexity Observations
- **Well-Focused**: 420 lines with clear purpose
- **Good API**: Clean methods for message management
- **Duplicate Logic**: Same compaction logic exists in Agent.js (lines 1163-1229)
- **Missing Integration**: Agent.js doesn't use ContextManager; has its own implementation

---

## 4. SubagentManager.js - Delegation & Concurrency

### Architecture Patterns
- **Worker Pool Pattern**: Limits concurrent subagents via `maxConcurrent` (line 56)
- **Task Queue**: Manages tasks in Map with state tracking (lines 60-63)
- **Shared Tool Registry**: Tools created once, shared across subagents (lines 66-87)
- **Message Bus**: Inter-subagent communication via message queues (lines 111-113)
- **Periodic Cleanup**: Stale subagent cleanup every 60 seconds (lines 116-126)

### Delegation Patterns
1. **Single Task**: `delegate()` - one task with retry logic (lines 231-285)
2. **Parallel**: `delegateParallel()` - batch processing with concurrency limit (lines 446-510)
3. **Pipeline**: `delegatePipeline()` - sequential stages with data passing (lines 596-644)
4. **Synthesis**: `delegateWithSynthesis()` - parallel + result aggregation (lines 514-592)

### Concurrency Handling
```javascript
// Lines 467-499: Batch processing in delegateParallel()
for (let i = 0; i < tasks.length; i += maxConcurrent) {
  const batch = tasks.slice(i, i + maxConcurrent);
  const batchPromises = batch.map(...);
  const batchResults = await Promise.allSettled(batchPromises);
}
```
**Efficiency**: Good control over concurrency; prevents resource exhaustion.

### Performance Bottlenecks

#### 1. Subagent Creation Overhead
```javascript
// Lines 175-227: createSubagent() creates new Agent instance
const agent = new Agent({
  tools: this.sharedTools,  // Shared, good
  model: model,
  // ... new instance with own state
});
```
**Issue**: Each subagent is a full Agent instance with its own message array, history, etc. Heavy for short tasks.

#### 2. Task State Tracking
```javascript
// Lines 60-63: Multiple data structures
this.tasks = new Map();           // All tasks
this.runningTasks = new Set();    // Running task IDs
this.completedTasks = [];         // Completed task objects
```
**Issue**: Redundant tracking; could use single source of truth.

#### 3. Message Bus Growth
```javascript
// Lines 948-960: Messages stored indefinitely
queue.push(entry);  // No size limit or expiration
```
**Issue**: Message queues can grow unbounded if not consumed.

### Memory Management
- **Shared Tools**: Tool registry shared across subagents (line 66) - good
- **Task Cleanup**: `clearCompleted()` removes finished tasks (lines 691-698)
- **Stale Cleanup**: Periodic cleanup of long-running subagents (lines 725-762)
- **Timer Management**: Timeout timers cleared on completion (lines 768-786)

### Scalability Considerations
- **Concurrency Limit**: Default 3 concurrent subagents (line 56)
- **Batch Processing**: Prevents overwhelming system resources
- **No Distributed Execution**: All subagents run in same process
- **Shared Tool Registry**: Memory efficient but may have contention

### Code Complexity Observations
- **Large Class**: 1012 lines with multiple delegation patterns
- **State Machine**: Task states (QUEUED, RUNNING, COMPLETED, etc.) well-defined
- **Error Handling**: Comprehensive retry logic with backoff
- **Callback Heavy**: Many optional callbacks (onTaskStart, onTaskComplete, etc.)

---

## Cross-Cutting Concerns

### 1. Duplicate Code
- **Token Estimation**: Agent.js (lines 213-256) duplicates ContextManager.js (lines 36-70)
- **Compaction Logic**: Agent.js (lines 1163-1229) duplicates ContextManager.js (lines 286-354)
- **Tool Registration**: AgentSession and SubagentManager both create tool instances

### 2. Memory Leaks Potential
- **Message Arrays**: Grow unbounded during long sessions
- **History Arrays**: Iteration history never trimmed
- **Message Bus**: Unbounded queue growth
- **Workflow Graphs**: Active graphs map may retain references

### 3. Performance Anti-Patterns
- **Regex in Hot Path**: Token estimation uses regex on every message (line 43)
- **Multiple Array Iterations**: Compaction does 4+ passes over messages
- **String Concatenation**: Large strings built via concatenation (line 565)
- **JSON.stringify in Loops**: Tool call serialization (line 174)

### 4. Scalability Limits
- **Single Process**: No horizontal scaling capability
- **In-Memory State**: All state lost on restart
- **Context Window**: Hard limit on conversation length
- **Tool Execution**: Limited by LLM API rate limits

---

## Recommendations

### High Priority
1. **Integrate ContextManager into Agent**: Remove duplicate token estimation/compaction logic
2. **Add Message Limits**: Implement max message count or total token limit
3. **Message Bus Cleanup**: Add TTL or size limits to inter-subagent messages
4. **Tool Registry Sharing**: Share tool definitions across sessions (not instances)

### Medium Priority
1. **Optimize Compaction**: Single-pass algorithm for exchange boundary detection
2. **Cache Token Estimates**: Per-message token cache with invalidation
3. **Lazy Tool Loading**: Defer tool creation until first use
4. **Session Cleanup**: Add explicit `destroy()` method for resource release

### Low Priority
1. **Streaming Compaction**: Incremental context compaction during LLM response
2. **Persistent Checkpoints**: Database storage for long-running sessions
3. **Metrics Collection**: Detailed performance metrics for optimization
4. **Connection Pooling**: Reuse HTTP connections across sessions

---

## Conclusion

The architecture demonstrates thoughtful design with ReAct pattern, circuit breakers, and smart context management. Primary performance concerns are:
1. **Duplicate logic** between Agent and ContextManager
2. **Unbounded memory growth** in long sessions
3. **Heavy subagent creation** overhead
4. **Multiple array iterations** in compaction

The system is well-suited for moderate workloads but may face memory and performance issues in long-running or high-concurrency scenarios. Immediate gains can be achieved by integrating ContextManager and adding memory limits.
