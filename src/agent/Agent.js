

import { OpenRouterClient } from '../OpenRouterClient.js';
import { AgentError, AgentAbortError, AbortError, ToolErrorType } from '../errors.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { parseXmlToolCalls, hasXmlToolCalls } from '../tools/xmlToolParser.js';
import { CONFIG } from '../config.js';
import { logger } from '../logger.js';
import { ContextAllocator } from './contextAllocator.js';
import { normalizeOptionalLimit, normalizePositiveInt, estimateTokens } from '../utils.js';
// chalk removed — not used in this file
import fs from '../utils/fs-compat.js';
import path from 'path';

export { AgentError, ToolExecutionError, ContextOverflowError, AgentAbortError } from '../errors.js';

export class Agent {
  constructor(options = {}) {
    this.client = options.client || new OpenRouterClient(options);
    this.tools = options.tools || new ToolRegistry();
    this.model = options.model; // Must be provided - no hardcoded default
    this.systemPrompt = options.systemPrompt || this.defaultSystemPrompt();
    
    if (!this.model) {
      throw new Error('Model must be specified when creating an Agent. Use the ModelBrowser to select a model.');
    }
    this.messages = [];
    this.cachedEstimatedTokens = 0;
    this.contextStats = {
      estimatedTokens: 0,
      compactions: 0,
      lastPromptTokens: 0,
      lastCompletionTokens: 0,
      lastTotalTokens: 0,
    };
    this.maxIterations = normalizeOptionalLimit(options.maxIterations, CONFIG.AGENT_MAX_ITERATIONS);
    this.maxRuntimeMs = normalizeOptionalLimit(options.maxRuntimeMs, CONFIG.AGENT_MAX_RUNTIME_MS);
    this.maxToolCalls = normalizeOptionalLimit(options.maxToolCalls, CONFIG.AGENT_MAX_TOOL_CALLS);
    this.maxStallIterations = normalizePositiveInt(options.maxStallIterations, CONFIG.AGENT_MAX_STALL_ITERATIONS);
    this.verbose = options.verbose !== false;
    this.streaming = options.streaming !== false;
    this.onToolStart = options.onToolStart || null;
    this.onToolEnd = options.onToolEnd || null;
    this.onResponse = options.onResponse || null;
    this.onIterationStart = options.onIterationStart || null;
    this.onIterationEnd = options.onIterationEnd || null;
    this.onError = options.onError || null;
    this.onStatus = options.onStatus || null;
    this.iterationCount = 0;
    this.totalTokensUsed = 0;
    this.totalCost = 0;
    this.history = [];
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.repeatedToolRoundCount = 0;
    
    // Context management settings
    this.maxContextTokens = options.maxContextTokens || CONFIG.MAX_CONTEXT_TOKENS;
    this.maxOutputTokens = options.maxOutputTokens || CONFIG.DEFAULT_PARAMS.max_tokens;
    this.maxToolResultChars = options.maxToolResultChars || CONFIG.MAX_TOOL_RESULT_CHARS;
    this.compactThreshold = options.compactThreshold || CONFIG.COMPACT_THRESHOLD;
    this.workspaceDir = options.workspaceDir || null;

    // Hierarchical context allocation
    this.contextAllocator = new ContextAllocator(this.maxContextTokens);

    // Working set: tracks files being actively edited for priority context allocation
    this.workingSet = new Set();
    
    // Token estimation cache: avoid re-estimating unchanged messages
    this._tokenCache = new WeakMap();
    this._tokenCacheVersion = 0;
    
    // Retry configuration
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.retryBackoff = options.retryBackoff || 2;
    
    // Performance tracking
    this.performanceMetrics = {
      totalIterations: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      totalRetries: 0,
      avgIterationTime: 0,
      totalExecutionTime: 0,
    };
    
    // State management
    this.state = 'idle'; // idle, running, paused, error, completed
    this.lastError = null;
    this.checkpoints = [];
    
    // AbortController for cancelling execution
    this.abortController = null;
    this.aborted = false;

    // Circuit breaker: track consecutive failures by error type
    this.consecutiveFailures = {}; // { errorCategory: count }
    this.circuitBreakerThreshold = options.circuitBreakerThreshold || CONFIG.CIRCUIT_BREAKER_THRESHOLD;
    this.circuitBreakerTripped = false;

    // Stall detection: track last tool call for repeated identical calls
    this.lastSingleToolSignature = null;
    this.repeatedSingleToolCount = 0;
    this.singleToolStallThreshold = 3;

    // No-action trap detection: limit how many times we nudge before giving up
    this.noActionTrapCount = 0;
    this.maxNoActionTraps = 3;

    // File-level stall detection: track read/edit cycles on the same file
    this.fileOperationHistory = []; // [{toolName, filePath, iteration}]
    this.maxFileStall = options.maxFileStall || CONFIG.AGENT_MAX_FILE_STALL;

    // Tool-name pattern stall: track the sequence of tool names per round
    // to detect alternating patterns like read→edit→read→edit
    this.roundToolNameHistory = []; // ["read_file", "edit_file", ...]
    this.maxPatternStall = options.maxPatternStall || 8; // Same pattern repeating N times

    // Tool failure tracking for self-reflection (used in reflectOnToolResults)
    this.toolFailureCounts = {};

    // Initialize with system prompt
    if (this.systemPrompt) {
      this.pushMessage({ role: 'system', content: this.systemPrompt });
    }
  }

  /**
   * Coding-focused system prompt following Explore-Plan-Code-Verify workflow.
   * Designed for maximum agentic coding quality based on research-backed best practices.
   */
  defaultSystemPrompt() {
    return `You are an elite AI coding assistant — a senior+ engineer with deep expertise across languages, frameworks, and system design. You write production-quality code that is correct, performant, and maintainable.

## Core Workflow: Explore → Plan → Code → Verify

NEVER skip steps. Each phase prevents entire classes of bugs.

### Phase 1: EXPLORE (mandatory before any code change)
- list_directory on the project root to understand structure
- Read ALL files you'll be modifying — never edit from memory
- search_in_files to find patterns, imports, usages, and related code
- Check git_status and git_log for recent context and active branches
- Understand: tech stack, coding conventions, error handling patterns, test patterns
- For large codebases: use search_in_files to find ALL references before renaming/moving

### Phase 2: PLAN (for anything beyond a one-line fix)
- State your plan in 2-5 numbered steps
- List every file that will be modified
- Consider: backward compatibility, error paths, edge cases, performance
- For multi-file changes: identify dependency order (utilities before consumers)
- For refactoring: plan the migration path — what changes first, what changes last

### Phase 3: CODE (precise, minimal, correct)
- Make the SMALLEST change that solves the problem completely
- Match existing code style EXACTLY: indentation, naming, import patterns, error handling
- Use the BEST editing tool for the job (see Editing Toolkit below)
- Write COMPLETE code — no placeholders, no TODOs, no "implement this later"
- Handle ALL error paths — no bare try/catch with empty catch blocks

### Phase 4: VERIFY (non-negotiable, after every change)
- Run the project's test suite: exec { command: "npm test" }
- Type-check: exec { command: "npx tsc --noEmit" } for TypeScript
- Lint: exec { command: "npx eslint src/" } or equivalent
- Verify the dev server compiles cleanly if applicable
- For new code: write tests that cover happy path, edge cases, and error cases
- If tests fail: fix immediately, don't declare done with broken tests

## 🔧 Editing Toolkit (choose the right tool for the job)

### Tier 1: Simple single-file edits
- **edit_file** (find/replace): Best for small, precise changes. Has FUZZY MATCHING — if exact match fails, it auto-corrects whitespace/indentation differences. Supports batch edits with edits:[] array.
- **edit_file** (line-based): Use startLine/endLine for guaranteed success when you know line numbers. Never fails with "text not found".
- **write_file**: For new files or when >30% of a file changes. Read the file first, modify in memory, write complete new content.

### Tier 2: Complex multi-line edits
- **write_file_blocks** (SEARCH/REPLACE): The MOST RELIABLE format for complex edits. Uses Aider-style blocks:
  \`\`\`
  path/to/file
  <<<<<<< SEARCH
  exact text to find
  =======
  replacement text
  >>>>>>> REPLACE
  \`\`\`
  Has multi-strategy matching (exact → whitespace → fuzzy), indentation preservation, and detailed error diagnostics.

- **apply_patch** (Codex-style patches): Best for multi-hunk changes to a single file or changes across files:
  \`\`\`
  *** Begin Patch
  *** Update File: path/to/file
  @@ function name (anchor text)
    context line
  - line to remove
  + line to add
  *** End Patch
  \`\`\`

### Tier 3: Multi-file operations
- **multi_edit**: Atomic multi-file find/replace. All succeed or ALL ROLL BACK. Best for renames, API migrations, cross-file refactoring.
- **apply_patch**: Can target multiple files in one patch.

### Tier 4: Analysis
- **generate_diff**: Preview what would change before applying.
- **detect_indent**: Check a file's indentation style to match your edits.
- **preview_edit**: Dry-run an edit_file operation.

## Editing Rules (CRITICAL)

1. ALWAYS read_file before editing — zero exceptions
2. For simple changes: edit_file with exact text from read_file output
3. For complex multi-line changes: use write_file_blocks or apply_patch
4. For cross-file refactoring: use multi_edit (atomic with rollback)
5. If an edit fails: DON'T retry with same text — try write_file_blocks or apply_patch instead
6. Use write_file for large rewrites (>30% of file)
7. After critical edits: read_file to verify the change landed correctly

## Large Codebase Strategies

- **Search before touching**: search_in_files for ALL references to renamed/moved items
- **Dependency order**: edit utilities/low-level files first, consumers second
- **Verify after each batch**: don't make 10 edits then check — check after every 2-3
- **Use git diff**: git_diff to review your changes before committing
- **Incremental refactoring**: one logical change → verify → next change
- **Parallel reads**: batch independent read_file calls in one turn for speed
- **Delegate with subagents**: for large refactors, use delegate_fanout to parallelize across files

## Anti-Patterns (DO NOT — these waste iterations)

- Do NOT retry the same failed approach — switch to a different editing tool
- Do NOT generate code from memory — always read_file first
- Do NOT assume file contents — verify with read_file
- Do NOT ignore error messages — they contain the exact solution
- Do NOT skip verification — always check your work compiles and runs
- Do NOT make many small edits when you can read+rewrite the file
- Do NOT use Unix-only commands on Windows (grep, sed, awk, ls -la, wc, head)
- Do NOT leave placeholder comments like "// TODO: implement this"

## Performance Rules

- Batch independent tool calls — read multiple files in one turn
- Use search_in_files instead of reading every file individually
- Use exec_background for long-running processes (servers, watchers)
- For builds/tests: use exec with appropriate timeout (60s+ for large projects)
- Minimize round-trips: combine exploration steps when possible
- For massive refactors: use delegate_fanout to parallelize across files

## Git Workflow

- git_status before committing — always know what you're about to commit
- git_diff to review changes before committing
- Descriptive commit messages: "feat: add user auth" not "update files"
- git_log to understand recent history and conventions

## Subagent Delegation

For complex multi-step tasks, use subagents:
- **delegate_task**: One focused task to a specialist (coder, reviewer, tester)
- **delegate_parallel**: Multiple independent tasks at once
- **delegate_fanout**: Split a large refactor across files, each file gets its own coder
- **delegate_pipeline**: Plan → Code → Test → Review sequential workflow

## Skills
If available skills match this task, use the use_skill tool to load specialized instructions.
Skills provide domain-specific workflows for: code-review, debug, refactor, testing.

## Completion
When done, provide a clear summary: what changed, why, what was verified, and any remaining work.`;
  }
  /**
   * Abort the current execution
   */
  abort() {
    this.aborted = true;
    if (this.abortController) {
      this.abortController.abort();
    }
    this.state = 'aborted';
  }
  
  /**
   * Check if execution was aborted
   */
  checkAborted() {
    if (this.aborted) {
      throw new AgentAbortError('Agent execution was aborted');
    }
  }

  hasReachedIterationLimit() {
    return this.maxIterations !== null && this.iterationCount >= this.maxIterations;
  }

  hasReachedRuntimeLimit(startTime) {
    return this.maxRuntimeMs !== null && (Date.now() - startTime) >= this.maxRuntimeMs;
  }

  hasReachedToolCallLimit() {
    return this.maxToolCalls !== null && this.performanceMetrics.totalToolCalls >= this.maxToolCalls;
  }

  hasStalled() {
    return this.repeatedToolRoundCount >= this.maxStallIterations;
  }

  /**
   * Detect file-level stall: the agent is cycling read → edit → read → edit
   * on the same file(s) without making meaningful progress. This catches the
   * common pattern where the model keeps re-reading a file it just edited
   * with slightly different line ranges, so the exact-argument stall detector
   * never fires.
   */
  hasFileStalled() {
    if (this.fileOperationHistory.length < 4) return false;

    // Look at the last N operations and check if we're in a read/edit cycle
    // on the same file(s)
    const recentOps = this.fileOperationHistory.slice(-this.maxFileStall * 2);
    const fileEditCounts = {};
    const fileReadCounts = {};

    for (const op of recentOps) {
      if (!op.filePath) continue;
      const file = op.filePath.toLowerCase();
      if (op.toolName === 'edit_file' || op.toolName === 'write_file') {
        fileEditCounts[file] = (fileEditCounts[file] || 0) + 1;
      } else if (op.toolName === 'read_file') {
        fileReadCounts[file] = (fileReadCounts[file] || 0) + 1;
      }
    }

    // If any single file has been both read and edited multiple times in recent ops,
    // we're in a file stall
    for (const file of Object.keys(fileEditCounts)) {
      const edits = fileEditCounts[file] || 0;
      const reads = fileReadCounts[file] || 0;
      if (edits >= this.maxFileStall / 2 && reads >= this.maxFileStall / 2) {
        return file;
      }
    }
    return false;
  }

  /**
   * Record a file operation for stall tracking.
   * Called from postToolIteration after tool calls are processed.
   */
  recordFileOperations(toolCalls) {
    for (const tc of toolCalls) {
      const name = tc.name;
      if (name !== 'read_file' && name !== 'edit_file' && name !== 'write_file') continue;
      const args = tc.arguments || {};
      const filePath = args.path || args.filePath || args.file || null;
      if (filePath) {
        this.fileOperationHistory.push({
          toolName: name,
          filePath: String(filePath).replace(/\\/g, '/'),
          iteration: this.iterationCount,
        });
        // Keep only the last 100 operations to avoid unbounded growth
        if (this.fileOperationHistory.length > 100) {
          this.fileOperationHistory = this.fileOperationHistory.slice(-50);
        }
      }
    }
  }

  /**
   * Detect tool-name pattern stall: the agent is repeating the same
   * sequence of tool names (e.g., read_file → edit_file) across rounds,
   * even though the exact arguments differ. This catches alternating
   * patterns that the exact-signature stall detector misses.
   */
  hasPatternStalled() {
    const history = this.roundToolNameHistory;
    if (history.length < 4) return false;

    // Check for repeating 2-round patterns in the recent history
    // A 2-round pattern like ["read_file", "edit_file"] repeating means
    // the history looks like: [r, e, r, e, r, e, ...]
    const recent = history.slice(-this.maxPatternStall);
    if (recent.length < 4) return false;

    // Try pattern lengths 1 and 2
    for (const patternLen of [1, 2]) {
      if (recent.length < patternLen * 3) continue; // Need at least 3 repetitions
      const pattern = recent.slice(0, patternLen);
      let repetitions = 0;
      for (let i = 0; i <= recent.length - patternLen; i += patternLen) {
        const chunk = recent.slice(i, i + patternLen);
        const match = pattern.every((name, idx) => chunk[idx] === name);
        if (match) {
          repetitions++;
        } else {
          break;
        }
      }
      if (repetitions >= 3) {
        return pattern.join(' → ');
      }
    }
    return false;
  }

  /**
   * Detect "hallucinated action" — the model describes doing something
   * but produces zero tool calls. This happens when a model doesn't
   * support native function calling and falls into a "I'll do X" loop.
   *
   * Returns a nudge message to inject, or null if content looks like
   * a genuine final answer.
   */
  detectNoActionTrap(content) {
    if (!content || typeof content !== 'string') return null;
    const text = content.trim();
    if (text.length < 20) return null;

    // Action-oriented phrases that indicate the model INTENDS to use tools
    const actionPatterns = [
      /\blet me\b/i,
      /\bi'll\b/i,
      /\bi will\b/i,
      /\bnow i\b/i,
      /\bfirst i\b/i,
      /\bnext i\b/i,
      /\bgoing to\b/i,
      /\bhere'?s what i'?ll\b/i,
      /\blet'?s\b/i,
      /\bi need to\b/i,
      /\bi should\b/i,
      /\bi can\b.*\b(read|edit|write|create|modify|update|change|fix|refactor|add|remove|delete|open|check)\b/i,
      /\b(step \d|phase \d)\b.*\b(read|edit|write|create|modify|update|change|fix)\b/i,
      /\b(read|edit|write|create|modify|update|change|fix|refactor|add|remove)\b.*\b(the|this|these|those|that)\b.*\b(file|code|component|function|class|page|style|css|html|js|tsx)\b/i,
    ];

    const hasActionLanguage = actionPatterns.some(p => p.test(text));

    // Tool-call indicators that suggest the model IS trying to use tools
    const toolIndicators = [
      /<tool_call>/i,
      /<invoke/i,
      /<function_calls>/i,
      /<tool_use>/i,
      /\bedit_file\b/i,
      /\bwrite_file\b/i,
      /\bread_file\b/i,
      /\bexec\b/i,
      /\bsearch_and_replace\b/i,
      /\blist_directory\b/i,
      /\bgit_\w+\b/i,
    ];

    const hasToolIndicator = toolIndicators.some(p => p.test(text));

    // Also check if this looks like a genuine summary/completion
    const completionPatterns = [
      /^(done|complete|finished|here'?s? (the |a )?summary|summary of|what (i|we) (changed|did|modified))[:.]/i,
      /^(the )?(changes?|modifications?|updates?) (have been|are|include)/i,
      /^(here|this) (is|are) (the |your )?(updated|modified|new|result)/i,
      /^i'?ve (already )?(made|completed|finished|done|applied|implemented)/i,
    ];

    const looksLikeCompletion = completionPatterns.some(p => p.test(text));

    // If action language is present but no tool indicators and doesn't look like completion
    if (hasActionLanguage && !hasToolIndicator && !looksLikeCompletion) {
      this.noActionTrapCount++;

      if (this.noActionTrapCount > this.maxNoActionTraps) {
        // We've nudged enough times — accept whatever the model says as final
        // to avoid infinite loops. The model clearly can't/won't use tools.
        return null;
      }

      if (this.noActionTrapCount === 1) {
        return `[System] Your response described actions but contained no tool calls. You MUST use tools to make changes — describing what you want to do is not enough. Use edit_file, write_file, or other tools to actually perform the work. If you need to read files first, use read_file. Then use edit_file with the exact text from the file. Do NOT describe your plan — execute it with tool calls.`;
      }

      // Escalating nudge for repeated failures
      return `[System] You are still not making any tool calls. Your previous response described actions but contained NO tool calls. This is attempt ${this.noActionTrapCount}/${this.maxNoActionTraps}. You MUST call at least one tool right now. Example: edit_file { path: "file.js", find: "old text", replace: "new text" }. If you truly have nothing to do, provide a final summary with NO action language.`;
    }

    return null;
  }

  formatIterationLabel() {
    return this.maxIterations !== null
      ? `iteration ${this.iterationCount}/${this.maxIterations}`
      : `iteration ${this.iterationCount}`;
  }

  /**
   * Prepare messages for LLM: compact if needed, allocate context budget,
   * emit warnings. Returns the optimized message array.
   * Shared by both streaming and non-streaming paths to eliminate duplication.
   */
  async prepareMessagesForLLM() {
    await this.maybeCompactContext();

    const allocResult = this.contextAllocator.allocate(
      this.messages,
      (msg) => this.estimateMessageTokens(msg),
      this.workingSet
    );
    if (allocResult.compressed) {
      if (this.shouldEmitVerboseLogs()) {
        logger.debug('Context allocator active', allocResult.stats);
      }
      this.emitStatus('context_allocate',
        `Context optimized: ${allocResult.stats.dropped} messages deferred (budget ${allocResult.stats.usedPercent}%)`);
    }

    // Proactive context warning at 60% usage
    const ctxStats = this.getContextStats();
    if (ctxStats.percent > 60 && ctxStats.percent <= 70) {
      const warnMsg = `Context usage at ${ctxStats.percent}% (~${this.formatCompactNumber(ctxStats.usedTokens)} tokens). Consider wrapping up soon.`;
      if (!this.emitStatus('context_warning', warnMsg) && this.shouldEmitVerboseLogs()) {
        logger.warn(warnMsg);
      }
    }

    return allocResult.messages;
  }

  recordToolRound(toolCalls) {
    // Fuzzy signature: tool name + target file only (not full args).
    // This catches read→edit→read→edit cycles on the same file where
    // the exact arguments (line numbers, edit content) differ each time.
    const signature = JSON.stringify(
      toolCalls.map(toolCall => {
        const args = toolCall.arguments || {};
        const filePath = args.path || args.filePath || args.file || null;
        return {
          name: toolCall.name,
          file: filePath ? String(filePath).replace(/\\/g, '/') : null,
        };
      })
    );

    if (signature === this.lastToolCallSignature) {
      this.repeatedToolRoundCount++;
    } else {
      this.lastToolCallSignature = signature;
      this.repeatedToolRoundCount = 1;
    }
  }

  hasExternalRenderer() {
    return Boolean(
      this.onToolStart ||
      this.onToolEnd ||
      this.onResponse ||
      this.onIterationStart ||
      this.onIterationEnd ||
      this.onStatus
    );
  }

  shouldEmitVerboseLogs() {
    return this.verbose && !this.hasExternalRenderer();
  }

  emitStatus(type, message) {
    if (!this.onStatus) {
      return false;
    }

    this.onStatus({ type, message });
    return true;
  }

  estimateMessageTokens(message = {}) {
    // Check cache first — messages are immutable once pushed
    if (message._tokenEstimate !== undefined) {
      return message._tokenEstimate;
    }

    let total = 0;

    if (message.content) {
      if (typeof message.content === 'string') {
        // Fast path: use content length as proxy for very short strings (avoids regex)
        if (message.content.length < 50) {
          total += Math.ceil(message.content.length / 3.5);
        } else {
          total += estimateTokens(message.content);
        }
      } else if (Array.isArray(message.content)) {
        // Multimodal content (text + images)
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            total += estimateTokens(part.text);
          } else if (part.type === 'image_url') {
            total += CONFIG.IMAGE_TOKEN_COST || 85;
          }
        }
      } else {
        total += estimateTokens(JSON.stringify(message.content));
      }
    }

    if (message.tool_calls) {
      total += estimateTokens(JSON.stringify(message.tool_calls));
    }

    // Add overhead per message (~4 tokens for role/metadata)
    total += CONFIG.MESSAGE_OVERHEAD_TOKENS || 4;

    // Cache on the message object itself
    message._tokenEstimate = total;
    return total;
  }

  recalculateEstimatedTokens() {
    // Use for-loop instead of reduce — avoids function call overhead per message
    let sum = 0;
    for (let i = 0; i < this.messages.length; i++) {
      sum += this.estimateMessageTokens(this.messages[i]);
    }
    this.cachedEstimatedTokens = sum;
    this.contextStats.estimatedTokens = sum;
    return sum;
  }

  setMessages(messages = []) {
    this.messages = Array.isArray(messages) ? messages : [];
    this.recalculateEstimatedTokens();
  }

  pushMessage(message) {
    this.messages.push(message);
    this.cachedEstimatedTokens += this.estimateMessageTokens(message);
    this.contextStats.estimatedTokens = this.cachedEstimatedTokens;
    return message;
  }

  setSystemPrompt(systemPrompt) {
    this.systemPrompt = systemPrompt || '';
    const systemMessageIndex = this.messages.findIndex(message => message.role === 'system');

    if (systemMessageIndex >= 0) {
      this.messages[systemMessageIndex].content = this.systemPrompt;
      this.recalculateEstimatedTokens();
      return;
    }

    if (this.systemPrompt) {
      this.setMessages([{ role: 'system', content: this.systemPrompt }, ...this.messages]);
    }
  }

  /**
   * Inject additional text into the system prompt without replacing it.
   * Appends the text to the existing system message (or creates one).
   * @param {string} text - Text to append to the system prompt
   */
  injectSystemMessage(text) {
    if (!text) return;
    const systemMessageIndex = this.messages.findIndex(m => m.role === 'system');
    if (systemMessageIndex >= 0) {
      this.messages[systemMessageIndex].content += '\n\n' + text;
      this.systemPrompt = this.messages[systemMessageIndex].content;
      this.recalculateEstimatedTokens();
    } else if (this.systemPrompt) {
      this.systemPrompt += '\n\n' + text;
      this.setMessages([{ role: 'system', content: this.systemPrompt }, ...this.messages]);
    }
  }

  setMaxContextTokens(maxContextTokens) {
    if (Number.isFinite(maxContextTokens) && maxContextTokens > 0) {
      this.maxContextTokens = maxContextTokens;
      this.contextAllocator = new ContextAllocator(maxContextTokens);
    }

    return this.maxContextTokens;
  }

  /**
   * Set max output tokens based on model capability
   */
  setMaxOutputTokens(maxOutputTokens) {
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      this.maxOutputTokens = maxOutputTokens;
    }
    return this.maxOutputTokens;
  }

  updateUsageStats(usage) {
    if (!usage) {
      return;
    }

    this.totalTokensUsed += usage.total_tokens || 0;
    this.contextStats.lastPromptTokens = usage.prompt_tokens || 0;
    this.contextStats.lastCompletionTokens = usage.completion_tokens || 0;
    this.contextStats.lastTotalTokens = usage.total_tokens || 0;
  }

  getContextStats(maxTokens = this.maxContextTokens) {
    const usedTokens = this.estimateTokens();
    const safeMax = Number.isFinite(maxTokens) && maxTokens > 0
      ? maxTokens
      : CONFIG.MAX_CONTEXT_TOKENS;
    const percent = safeMax > 0
      ? Math.min(100, Math.round((usedTokens / safeMax) * 100))
      : 0;

    // Reuse a single stats object to reduce GC pressure
    this._ctxStatsCache = this._ctxStatsCache || {};
    const stats = this._ctxStatsCache;
    stats.usedTokens = usedTokens;
    stats.maxTokens = safeMax;
    stats.percent = percent;
    stats.compactThreshold = this.compactThreshold;
    stats.compactions = this.contextStats.compactions;
    stats.lastPromptTokens = this.contextStats.lastPromptTokens;
    stats.lastCompletionTokens = this.contextStats.lastCompletionTokens;
    stats.lastTotalTokens = this.contextStats.lastTotalTokens;
    return stats;
  }

  formatCompactNumber(value) {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return Math.round(value).toString();
  }

  truncateText(text, maxLength = 160) {
    if (!text || text.length <= maxLength) {
      return text;
    }

    return `${text.substring(0, maxLength - 3).trimEnd()}...`;
  }

  /**
   * Extract structured knowledge from conversation messages for context compaction.
   * Produces a structured summary preserving ~80% of useful information in ~20% of tokens.
   * Format: TASKS, FILES, DECISIONS, ERRORS, CODE_CHANGES, CURRENT_STATE
   */
  // Pre-compiled regexes for compaction (avoid recompilation)
  static _filePathRegex = /(?:^|\s)([A-Za-z]:\\[^\s"]+|\/[^\s"]+|\.\/[^\s"]+|[a-zA-Z_][\w./\\-]*\.[a-zA-Z]{2,})/g;
  static _decisionRegex = /(?:decided|chose|going with|will use|switching to|changed to|fixed by|resolved by|solution:|approach:)/i;
  static _decisionSentenceRegex = /(?:decided|chose|going with|will use|switching to|changed to|fixed by|resolved by|solution|approach)/i;
  static _errorExtractRegex = /"error"\s*:\s*"([^"]{3,100})/;
  static _writeTools = new Set(['write_file', 'edit_file', 'search_and_replace']);

  buildCompactionSummary(olderMessages = []) {
    const priorUserMessages = [];
    const filesMentioned = new Set();
    const decisions = [];
    const errors = [];
    const codeChanges = [];
    const toolsUsed = {};
    const recentHistory = this.history.slice(-8);

    // ── Single-pass extraction from messages ──
    for (let i = 0; i < olderMessages.length; i++) {
      const msg = olderMessages[i];
      const content = msg.content || '';
      const text = typeof content === 'string' ? content : JSON.stringify(content || '');

      // Collect user messages (keep last 5)
      if (msg.role === 'user' && content) {
        priorUserMessages.push(msg);
        if (priorUserMessages.length > 5) priorUserMessages.shift();
      }

      // Scan for file paths
      Agent._filePathRegex.lastIndex = 0;
      let match;
      while ((match = Agent._filePathRegex.exec(text)) !== null) {
        const p = match[1];
        if (p.length > 3 && p.length < 200 && !p.startsWith('http')) {
          filesMentioned.add(p);
        }
      }

      // Scan tool results for errors
      if (msg.role === 'tool' && content) {
        if (text.includes('"success":false') || text.includes('"error"')) {
          const errorMatch = text.match(Agent._errorExtractRegex);
          if (errorMatch) errors.push(errorMatch[1]);
        }
        // Scan for code changes (write_file, edit_file success)
        if (text.includes('"success":true') && i > 0) {
          const prevAssistant = olderMessages[i - 1];
          if (prevAssistant?.role === 'assistant' && prevAssistant.tool_calls) {
            for (const tc of prevAssistant.tool_calls) {
              const name = tc.function?.name || '';
              if (Agent._writeTools.has(name)) {
                let args = {};
                try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; logger.warn(`Failed to parse tool call arguments for ${name}`); }
                codeChanges.push(args.path ? `${name}: ${args.path}` : `${name} (no path in args)`);
              }
            }
          }
        }
      }

      // Extract decisions from assistant messages
      if (msg.role === 'assistant' && typeof content === 'string' && Agent._decisionRegex.test(content)) {
        const sentences = content.split(/[.!?\n]/).filter(s => s.trim().length > 10 && s.trim().length < 200);
        for (const s of sentences) {
          if (Agent._decisionSentenceRegex.test(s)) {
            decisions.push(s.trim().substring(0, 150));
          }
        }
      }
    }

    // Track tool usage from history
    for (const entry of recentHistory) {
      for (const tool of entry.toolCalls) {
        toolsUsed[tool] = (toolsUsed[tool] || 0) + 1;
      }
    }

    // Determine current state from last few messages
    let currentState = 'Conversation in progress.';
    const lastAssistantMsgs = olderMessages
      .filter(m => m.role === 'assistant' && m.content && typeof m.content === 'string')
      .slice(-2);
    if (lastAssistantMsgs.length > 0) {
      const lastMsg = lastAssistantMsgs[lastAssistantMsgs.length - 1].content;
      const lastSentence = lastMsg.split(/[.!?\n]/).filter(s => s.trim().length > 10).pop();
      if (lastSentence) {
        currentState = lastSentence.trim().substring(0, 200);
      }
    }

    // Build compact knowledge block using structured format
    const lines = ['[CONTEXT KNOWLEDGE — structured summary of prior work]'];

    if (priorUserMessages.length > 0) {
      lines.push('TASKS:');
      for (const message of priorUserMessages) {
        const normalized = String(message.content).replace(/\s+/g, ' ').trim();
        lines.push(`- ${this.truncateText(normalized, 120)}`);
      }
    }

    if (filesMentioned.size > 0) {
      lines.push('FILES:');
      const fileList = [...filesMentioned].slice(-10);
      for (const f of fileList) {
        lines.push(`- ${f}`);
      }
    }

    if (decisions.length > 0) {
      lines.push('DECISIONS:');
      for (const d of decisions.slice(-5)) {
        lines.push(`- ${d}`);
      }
    }

    if (errors.length > 0) {
      lines.push('ERRORS:');
      const uniqueErrors = [...new Set(errors)].slice(-5);
      for (const e of uniqueErrors) {
        lines.push(`- ${e}`);
      }
    }

    if (codeChanges.length > 0) {
      lines.push('CODE_CHANGES:');
      const uniqueChanges = [...new Set(codeChanges)].slice(-8);
      for (const c of uniqueChanges) {
        lines.push(`- ${c}`);
      }
    }

    lines.push(`CURRENT_STATE: ${currentState}`);

    if (Object.keys(toolsUsed).length > 0) {
      const toolSummary = Object.entries(toolsUsed).map(([t, c]) => `${t}(${c})`).join(', ');
      lines.push(`TOOLS USED: ${toolSummary}`);
    }

    if (recentHistory.length > 0) {
      lines.push('PROGRESS:');
      for (const entry of recentHistory.slice(-5)) {
        const tools = entry.toolCalls.join(', ') || 'no tools';
        const results = entry.toolResults?.map(r => r.success ? '✓' : '✗').join('') || '';
        lines.push(`- Iter ${entry.iteration}: ${tools} ${results}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Track which files are being actively worked on.
   * Called when read_file, edit_file, or write_file are used.
   * Working set files get priority in context allocation.
   *
   * @param {string} filePath - The file path to add to the working set
   */
  trackWorkingSet(filePath) {
    if (!filePath || typeof filePath !== 'string') return;
    // Normalize path separators
    const normalized = filePath.replace(/\\/g, '/');
    this.workingSet.add(normalized);
    // Also add basename for cross-reference matching
    const basename = normalized.split('/').pop();
    if (basename && basename !== normalized) {
      this.workingSet.add(basename);
    }
  }

  /**
   * Clear the working set when the user changes topic.
   * Called when a new user message arrives that doesn't reference current working set files.
   *
   * @param {string} userInput - The new user message
   */
  maybeResetWorkingSet(userInput) {
    if (!userInput || this.workingSet.size === 0) return;

    const inputLower = userInput.toLowerCase();
    let referencesCurrentSet = false;

    for (const file of this.workingSet) {
      if (inputLower.includes(file.toLowerCase())) {
        referencesCurrentSet = true;
        break;
      }
    }

    // If the user message doesn't reference any working set files, clear it
    if (!referencesCurrentSet) {
      this.workingSet.clear();
    }
  }

  formatRecentHistory(history, limit = 10) {
    if (!history || history.length === 0) {
      return '- No tool work was recorded.';
    }

    return history
      .slice(-limit)
      .map(entry => `- Iteration ${entry.iteration}: Used tools: ${entry.toolCalls.join(', ') || 'none'}`)
      .join('\n');
  }

  buildStopMessage(reason, history, startTime) {
    switch (reason) {
      case 'max_iterations':
        return `I stopped after reaching the configured iteration limit (${this.maxIterations}).\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'max_runtime':
        return `I stopped after reaching the configured runtime limit (${Math.round((Date.now() - startTime) / 1000)}s).\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'max_tool_calls':
        return `I stopped after reaching the configured tool-call limit (${this.maxToolCalls}).\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'stalled':
      case 'stalled':
        return `I stopped because I appeared to be repeating the same tool workflow without making progress.\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'consecutive_api_errors':
        return `I stopped after 3 consecutive API errors. The model API may be experiencing issues.\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'aborted':
        return 'Agent execution was aborted.';
      default:
        return `I stopped before producing a final answer.\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
    }
  }
  
  /**
   * Discover project structure and inject it as a system message.
   * Called once at the start of run() to give the agent immediate codebase context.
   * This saves 2-3 tool call iterations the agent would spend discovering the tree.
   */
  async discoverProjectStructure() {
    if (!this.workspaceDir) return;

    try {
      const entries = await fs.readdir(this.workspaceDir, { withFileTypes: true });
      const lines = [];
      const skipDirs = new Set(['node_modules', '.git', '.openagent', 'dist', 'build', '__pycache__', '.next', '.turbo', 'coverage']);
      const skipFiles = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store']);

      // Top-level entries
      const dirs = entries.filter(e => e.isDirectory() && !skipDirs.has(e.name) && !e.name.startsWith('.'));
      const files = entries.filter(e => e.isFile() && !skipFiles.has(e.name) && !e.name.startsWith('.'));

      // Show top-level structure
      for (const d of dirs.sort()) {
        lines.push(`  ${d.name}/`);
        // Show one level deep for key directories
        try {
          const sub = await fs.readdir(path.join(this.workspaceDir, d.name), { withFileTypes: true });
          const subFiles = sub.filter(e => e.isFile() && !e.name.startsWith('.')).slice(0, 12);
          const subDirs = sub.filter(e => e.isDirectory() && !skipDirs.has(e.name) && !e.name.startsWith('.')).slice(0, 5);
          for (const sd of subDirs.sort()) lines.push(`    ${sd.name}/`);
          for (const sf of subFiles.sort()) lines.push(`    ${sf.name}`);
          if (sub.length > 17) lines.push(`    ... (${sub.length} total entries)`);
        } catch { /* skip unreadable dirs */ }
      }
      for (const f of files.sort()) {
        lines.push(`  ${f.name}`);
      }

      if (lines.length > 0) {
        const treeMsg = `[System] Project structure of ${this.workspaceDir}:
${lines.join('\n')}

Use list_directory for deeper exploration of specific directories.`;
        this.pushMessage({ role: 'system', content: treeMsg });
        if (this.shouldEmitVerboseLogs()) {
          logger.debug('Injected project structure context', { entries: lines.length });
        }
      }
    } catch (err) {
      // Non-fatal — agent can discover structure with tools
      if (this.shouldEmitVerboseLogs()) {
        logger.debug('Project structure discovery skipped', { error: err.message });
      }
    }
  }

  /**
   * Determine if a task is complex enough to warrant planning
   */
  isComplexTask(userInput) {
    if (!userInput || typeof userInput !== 'string') return false;
    const input = userInput.toLowerCase();
    if (input.length <= 50) return false;
    const complexityWords = ['implement', 'create', 'fix', 'build', 'refactor', 'add', 'design', 'migrate', 'integrate', 'optimize', 'rewrite', 'setup', 'configure', 'debug', 'resolve', 'develop', 'construct', 'modify', 'overhaul', 'restructure'];
    return complexityWords.some(word => input.includes(word));
  }

  /**
   * Plan the execution for complex tasks using a planning LLM call
   */
  async plan(userInput, messages) {
    const planningPrompt = `Analyze this task and create an execution plan. Return ONLY valid JSON array.
Each element: {"step": 1, "action": "description", "tool": "tool_name", "confidence": 0.9}
Do not include any text outside the JSON. Keep the plan concise (3-7 steps).
Task: ${userInput}`;

    try {
      const result = await this.client.chat(
        [...messages, { role: 'user', content: planningPrompt }],
        {
          model: this.model,
          temperature: 0.2,
          max_tokens: 2048,
        }
      );

      this.updateUsageStats(result.usage);

      if (!result.content) return null;

      // Parse JSON from response - handle markdown code blocks
      let jsonStr = result.content.trim();
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      // Ensure it looks like a JSON array
      if (!jsonStr.startsWith('[')) {
        const arrayStart = jsonStr.indexOf('[');
        const arrayEnd = jsonStr.lastIndexOf(']');
        if (arrayStart >= 0 && arrayEnd > arrayStart) {
          jsonStr = jsonStr.substring(arrayStart, arrayEnd + 1);
        } else {
          return null;
        }
      }

      let plan;
      try {
        plan = JSON.parse(jsonStr);
      } catch (e) {
        logger.warn('Failed to parse plan JSON:', e.message);
        return null;
      }

      if (!Array.isArray(plan) || plan.length === 0) return null;

      const planSummary = plan
        .map(p => `  ${p.step}. [${p.tool || 'general'}] ${p.action} (confidence: ${p.confidence || 'N/A'})`)
        .join('\n');

      const planMessage = `[System] Execution plan generated:\n${planSummary}\n\nExecute this plan step by step. Adapt if steps don't apply.`;

      if (this.shouldEmitVerboseLogs()) {
        logger.debug('Plan generated', { steps: plan.length });
      }

      return planMessage;
    } catch (error) {
      // Planning failure is non-fatal - proceed without plan
      if (this.shouldEmitVerboseLogs()) {
        logger.debug('Planning failed, proceeding without plan', { error: error.message });
      }
      return null;
    }
  }

  /**
   * Reflect on failed tool executions and inject guidance messages
   */
  reflectOnToolResults(toolResults, _toolCalls) {
    const errors = toolResults.filter(r => r.result && r.result.success === false);
    const empties = toolResults.filter(r => {
      if (r.result && r.result.success === false) return false;
      const content = JSON.stringify(r.result);
      return content.length < 10 || content === '{}' || content === 'null' || content === 'undefined';
    });

    if (errors.length === 0 && empties.length === 0) return;

    // Track failures per tool name
    const failedTools = [...errors, ...empties].map(r => r.toolName);

    for (const toolName of failedTools) {
      if (!this.toolFailureCounts) this.toolFailureCounts = {};
      this.toolFailureCounts[toolName] = (this.toolFailureCounts[toolName] || 0) + 1;
    }

    // Build reflection message
    const reflectionParts = [];

    for (const errResult of errors) {
      const errorPreview = String(errResult.result?.error || 'unknown error').substring(0, 120);
      reflectionParts.push(`The tool "${errResult.toolName}" returned an error: "${errorPreview}". Reflect: was this expected? Should you try a different approach?`);
    }

    for (const emptyResult of empties) {
      reflectionParts.push(`The tool "${emptyResult.toolName}" returned an empty or minimal result. Reflect: was this expected? Should you try a different approach?`);
    }

    // Check for repeated failures
    for (const toolName of failedTools) {
      if (this.toolFailureCounts[toolName] >= 3) {
        reflectionParts.push(`[CRITICAL] The tool "${toolName}" has failed ${this.toolFailureCounts[toolName]} times. You MUST try a completely different approach or tool. Do not retry the same operation.`);
        this.toolFailureCounts[toolName] = 0; // Reset after warning
      }
    }

    if (reflectionParts.length > 0) {
      this.pushMessage({
        role: 'user',
        content: `[System] ${reflectionParts.join('\n')}`,
      });
    }
  }

  /**
   * Post-iteration processing shared between streaming and non-streaming paths.
   * Handles: assistant message creation, tool result injection, edit recovery hints,
   * circuit breaker, stall detection, and history recording.
   */
  async postToolIteration(toolCalls, toolResults, responseContent, iterationStart, runHistory) {
    // Circuit breaker recovery injection
    if (this.circuitBreakerTripped) {
      const failedResults = toolResults.filter(r => r.result && r.result.success === false);
      if (failedResults.length > 0) {
        const lastFailure = failedResults[failedResults.length - 1];
        const suggestion = this.getRecoverySuggestion(lastFailure.result.error, lastFailure.toolName);
        this.pushMessage({
          role: 'user',
          content: `[System] Multiple consecutive tool failures detected (${lastFailure.toolName}). The same error type has occurred ${this.circuitBreakerThreshold}+ times in a row. ${suggestion} Please try a fundamentally different approach rather than retrying the same operation.`,
        });
        this.consecutiveFailures = {};
        this.circuitBreakerTripped = false;
      }
    }

    // Stall detection for repeated single-tool calls
    if (toolCalls.length === 1) {
      const singleSig = JSON.stringify({ name: toolCalls[0].name, args: toolCalls[0].arguments });
      if (singleSig === this.lastSingleToolSignature) {
        this.repeatedSingleToolCount++;
      } else {
        this.lastSingleToolSignature = singleSig;
        this.repeatedSingleToolCount = 1;
      }
      if (this.repeatedSingleToolCount >= this.singleToolStallThreshold) {
        const stallTool = toolCalls[0].name;
        const stallMessage = `[System] You have called the "${stallTool}" tool with the same arguments ${this.repeatedSingleToolCount} times in a row without making progress. This suggests the approach is not working. Please: (1) try a different tool or strategy, (2) re-examine your plan, or (3) provide your best answer with what you have gathered so far.`;
        this.pushMessage({ role: 'user', content: stallMessage });
        this.repeatedSingleToolCount = 0;
        this.lastSingleToolSignature = null;
      }
    } else {
      this.lastSingleToolSignature = null;
      this.repeatedSingleToolCount = 0;
    }

    // Add assistant message with tool calls (use empty string, not null, for API compatibility)
    this.pushMessage({
      role: 'assistant',
      content: responseContent || '',
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    });

    // Add tool results with large-result caching — serialize once, reuse
    for (const result of toolResults) {
      // Reuse pre-serialized content if available (from executeToolCallsEnhanced)
      let content = result._serializedContent || JSON.stringify(result.result);

      if (content.length > this.maxToolResultChars) {
        const original = content;
        let cutPoint = this.maxToolResultChars;
        const newlineBefore = content.lastIndexOf('\n', this.maxToolResultChars);
        if (newlineBefore > this.maxToolResultChars * 0.8) cutPoint = newlineBefore;

        let cacheInfo = '';
        try {
          const cacheDir = this.workspaceDir
            ? path.join(this.workspaceDir, '.tool-cache')
            : path.join(process.cwd(), '.openagent', '.tool-cache');
          await fs.ensureDir(cacheDir);
          const cacheFile = path.join(cacheDir, `${result.toolCallId || Date.now()}.json`);
          await fs.writeFile(cacheFile, original, 'utf-8');
          const relPath = this.workspaceDir
            ? `workspace:.tool-cache/${path.basename(cacheFile)}`
            : cacheFile;
          cacheInfo = `\n\n📁 Full result (${original.length} chars) cached to: ${relPath}\nUse read_file with startLine/endLine to read specific sections.`;
        } catch (_cacheErr) {
          cacheInfo = `\n\n... [truncated - showing ${cutPoint} of ${original.length} chars]`;
        }
        content = original.substring(0, cutPoint) + cacheInfo;

        const truncationMessage = `Tool result cached (${original.length} chars) — showing first ${cutPoint}`;
        if (!this.emitStatus('truncate', truncationMessage) && this.shouldEmitVerboseLogs()) {
          logger.info(truncationMessage, { originalLength: original.length, truncatedTo: cutPoint });
        }
      }

      this.pushMessage({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content,
      });
    }

    // Smart edit recovery hints
    const editFailures = toolResults.filter(r =>
      r.toolName === 'edit_file' &&
      r.result &&
      r.result.success === false &&
      r.result.error &&
      (r.result.error.includes('Text not found') || r.result.error.includes('not found in file'))
    );
    if (editFailures.length > 0) {
      const failure = editFailures[0];
      const failedPath = failure.args?.path || 'unknown file';
      const hint = `[System] edit_file failed: The 'find' text did not match the file content. ` +
        `This usually means the text was generated from memory instead of copied verbatim from read_file output. ` +
        `IMMEDIATE FIX: (1) Use read_file to get the current content of "${failedPath}", ` +
        `(2) Copy the EXACT text from the read_file output as the 'find' parameter, ` +
        `(3) Or use line-based editing with startLine/endLine. ` +
        `Do NOT retry with the same text that just failed.`;
      this.pushMessage({ role: 'user', content: hint });
    }

    // Record in history
    const iterationRecord = {
      iteration: this.iterationCount,
      response: responseContent,
      toolCalls: toolCalls.map(tc => tc.name),
      toolResults: toolResults.map(tr => ({ tool: tr.toolName, success: tr.result?.success !== false })),
      duration: Date.now() - iterationStart,
    };
    this.history.push(iterationRecord);
    runHistory.push(iterationRecord);
    this.recordToolRound(toolCalls);
    this.recordFileOperations(toolCalls);
    // Track tool name pattern for pattern-stall detection
    const roundNames = toolCalls.map(tc => tc.name).join('+');
    this.roundToolNameHistory.push(roundNames);
    if (this.roundToolNameHistory.length > 50) {
      this.roundToolNameHistory = this.roundToolNameHistory.slice(-25);
    }

    // Update performance metrics (guard against division by zero)
    const iterDuration = Date.now() - iterationStart;
    if (this.performanceMetrics.totalIterations > 0) {
      this.performanceMetrics.avgIterationTime =
        (this.performanceMetrics.avgIterationTime * (this.performanceMetrics.totalIterations - 1) +
         iterDuration) / this.performanceMetrics.totalIterations;
    } else {
      this.performanceMetrics.avgIterationTime = iterDuration;
    }

    if (this.onIterationEnd) {
      this.onIterationEnd(this.iterationCount, Date.now() - iterationStart);
    }
  }

  /**
   * Run the agentic loop with streaming tool execution.
   *
   * Instead of waiting for the full LLM response before executing tools,
   * this dispatches each tool call as soon as it's complete in the stream.
   * Falls back to non-streaming if streaming errors mid-iteration.
   */
  async runWithStreaming(userInput, _options = {}) {
    const startTime = Date.now();
    const runHistory = [];
    let finalResponse = null;

    while (true) {
      this.checkAborted();

      if (this.hasReachedIterationLimit()) { this.stopReason = 'max_iterations'; break; }
      if (this.hasReachedRuntimeLimit(startTime)) { this.stopReason = 'max_runtime'; break; }
      if (this.hasReachedToolCallLimit()) { this.stopReason = 'max_tool_calls'; break; }
      if (this.hasStalled()) { this.stopReason = 'stalled'; break; }
      const stalledFile = this.hasFileStalled();
      const stalledPattern = this.hasPatternStalled();
      if (stalledFile || stalledPattern) {
        const parts = [];
        if (stalledFile) parts.push(`reading and editing "${stalledFile}" in a cycle`);
        if (stalledPattern) parts.push(`repeating the tool pattern (${stalledPattern})`);
        this.pushMessage({
          role: 'user',
          content: `[System] You are ${parts.join(' and ')} without making meaningful progress. Stop re-reading files you've already edited. Either: (1) move on to the next file or task, or (2) provide your final answer with the changes you've already made.`,
        });
      }

      this.iterationCount++;
      this.performanceMetrics.totalIterations++;
      const iterationStart = Date.now();

      if (this.shouldEmitVerboseLogs()) logger.debug(this.formatIterationLabel());
      if (this.onIterationStart) this.onIterationStart(this.iterationCount);

      // Prepare messages: compact + allocate + warnings (shared logic)
      const messagesForLLM = await this.prepareMessagesForLLM();

      // ── Streaming iteration ──
      let fullContent = '';
      const allToolCalls = [];
      const dispatchedPromises = new Map(); // index -> Promise
      const completedResults = new Map();   // index -> toolResult
      let streamUsage = null;

      const stream = this.client.chatStream(messagesForLLM, {
        model: this.model,
        temperature: 0.3,
        max_tokens: this.maxOutputTokens,
        // Send tool definitions so the model can use native tool calling via streaming.
        // If a model rejects streaming+tools, we catch the error and fall back to non-streaming.
        tools: this.tools.getToolDefinitions(),
        tool_choice: 'auto',
        // Fire as soon as a single tool call is fully accumulated
        onToolCallReady: (toolCall) => {
          const idx = allToolCalls.length;
          allToolCalls.push(toolCall);

          // Dispatch immediately — don't wait for other tool calls
          // (executeSingleToolCall fires onToolStart/onToolEnd internally)
          const promise = this.executeSingleToolCall(toolCall)
            .then(result => {
              completedResults.set(idx, result);
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
              return errResult;
            });

          dispatchedPromises.set(idx, promise);
        },
      });

      let streamToolCalls = []; // Tool calls from final stream chunk (fallback)

      try {
        for await (const chunk of stream) {
          if (chunk.type === 'error') {
            const err = chunk.error;
            const errMsg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
            throw new AgentError(`API error: ${errMsg}`, 'API_ERROR', { apiError: err });
          } else if (chunk.type === 'content') {
            fullContent += chunk.content;
          } else if (chunk.type === 'tool_calls') {
            // Capture tool calls from final stream chunk
            // These may overlap with onToolCallReady — deduplicate later
            streamToolCalls = chunk.toolCalls || [];
          } else if (chunk.type === 'done') {
            streamUsage = chunk.usage;
            // Detect truncation from token limit
            if (chunk.finishReason === 'length') {
              const warnMsg = `⚠️ Response truncated (hit token limit at ${streamUsage?.completion_tokens || '?'} tokens). Consider breaking your request into smaller parts.`;
              this.emitStatus('truncation_warning', warnMsg);
              if (this.shouldEmitVerboseLogs()) logger.warn(warnMsg);
            }
          }
        }
      } catch (streamError) {
        // Streaming failed — fall back to non-streaming for this iteration
        if (this.shouldEmitVerboseLogs()) {
          logger.warn('Streaming failed, falling back to non-streaming', { error: streamError.message });
        }

        // Collect any tools already dispatched before falling back
        if (dispatchedPromises.size > 0) {
          const dispatchedResults = await Promise.allSettled([...dispatchedPromises.values()]);
          for (let i = 0; i < dispatchedResults.length; i++) {
            if (dispatchedResults[i].status === 'fulfilled') {
              completedResults.set(i, dispatchedResults[i].value);
            }
          }
        }

        // Use non-streaming fallback for this iteration
        let response;
        try {
          response = await this.getLLMResponseWithRetry(0, messagesForLLM);
        } catch (apiError) {
          this.consecutiveApiErrors++;
          if (this.consecutiveApiErrors >= 3) {
            this.stopReason = 'consecutive_api_errors';
            if (this.shouldEmitVerboseLogs()) {
              logger.error('Stopping: 3 consecutive API errors (streaming fallback)', { error: apiError.message });
            }
            finalResponse = this.buildStopMessage('consecutive_api_errors', runHistory, startTime);
            break;
          }
          throw apiError;
        }
        this.consecutiveApiErrors = 0;
        if (!response) throw new AgentError('No response from model', 'NO_RESPONSE');

        const toolCalls = response.toolCalls || [];
        if (toolCalls.length === 0) {
          const fallbackContent = response.content || fullContent;
          // Check for XML tool calls in fallback content
          if (fallbackContent && hasXmlToolCalls(fallbackContent)) {
            const parsed = parseXmlToolCalls(fallbackContent);
            if (parsed.toolCalls.length > 0) {
              const fbToolResults = await this.executeToolCallsEnhanced(parsed.toolCalls);
              this.reflectOnToolResults(fbToolResults, parsed.toolCalls);
              await this.postToolIteration(parsed.toolCalls, fbToolResults, parsed.cleanContent, iterationStart, runHistory);
              continue;
            }
          }
          // No tool calls — check for no-action trap before accepting
          const fbNoActionNudge = this.detectNoActionTrap(fallbackContent);
          if (fbNoActionNudge) {
            this.pushMessage({ role: 'assistant', content: fallbackContent });
            this.pushMessage({ role: 'user', content: fbNoActionNudge });
            if (this.shouldEmitVerboseLogs()) {
              logger.warn('No-action trap detected (streaming fallback): model described actions but produced no tool calls. Injecting nudge.');
            }
            continue;
          }

          finalResponse = fallbackContent;
          this.pushMessage({ role: 'assistant', content: finalResponse });
          this.stopReason = 'completed';
          if (this.onResponse) this.onResponse(finalResponse);
          break;
        }

        // Build tool results: keep already-completed ones, execute the rest
        const fallbackResults = [];
        for (let i = 0; i < toolCalls.length; i++) {
          if (completedResults.has(i)) {
            fallbackResults.push(completedResults.get(i));
          } else {
            fallbackResults.push(await this.executeSingleToolCall(toolCalls[i]));
          }
        }

        this.reflectOnToolResults(fallbackResults, toolCalls);
        const fallbackClean = (response.content || fullContent);
        const cleanedFallback = (fallbackClean && hasXmlToolCalls(fallbackClean))
          ? parseXmlToolCalls(fallbackClean).cleanContent
          : fallbackClean;
        await this.postToolIteration(toolCalls, fallbackResults, cleanedFallback, iterationStart, runHistory);
        continue;
      }

      this.updateUsageStats(streamUsage);

      // Merge tool calls: combine allToolCalls (from onToolCallReady) with streamToolCalls
      // (onToolCallReady may not fire for all models/providers, or may fire for only some)
      const finalToolCalls = [...allToolCalls];
      if (streamToolCalls.length > 0) {
        const existingIds = new Set(finalToolCalls.map(tc => tc.id));
        for (const tc of streamToolCalls) {
          if (!existingIds.has(tc.id)) {
            finalToolCalls.push(tc);
          }
        }
      }
      // Dispatch any tool calls that weren't already handled by onToolCallReady
      for (let i = 0; i < finalToolCalls.length; i++) {
        if (!dispatchedPromises.has(i)) {
          const tc = finalToolCalls[i];
          // executeSingleToolCall fires onToolStart/onToolEnd internally
          const promise = this.executeSingleToolCall(tc)
            .then(result => {
              completedResults.set(i, result);
              return result;
            })
            .catch(err => {
              const errResult = {
                toolCallId: tc.id,
                toolName: tc.name,
                args: tc.arguments,
                result: { success: false, error: err.message },
              };
              completedResults.set(i, errResult);
              return errResult;
            });
          dispatchedPromises.set(i, promise);
        }
      }

      if (finalToolCalls.length === 0) {
        // Check if the model output tool calls as XML in the content
        if (hasXmlToolCalls(fullContent)) {
          const parsed = parseXmlToolCalls(fullContent);
          if (parsed.toolCalls.length > 0) {
            // Execute XML tool calls
            const toolResults = await this.executeToolCallsEnhanced(parsed.toolCalls);
            this.reflectOnToolResults(toolResults, parsed.toolCalls);
            await this.postToolIteration(parsed.toolCalls, toolResults, parsed.cleanContent, iterationStart, runHistory);
            continue;
          }
        }
        // No tool calls detected — but is this a genuine final answer
        // or the model hallucinating actions without actually calling tools?
        const noActionNudge = this.detectNoActionTrap(fullContent);
        if (noActionNudge) {
          this.pushMessage({ role: 'assistant', content: fullContent });
          this.pushMessage({ role: 'user', content: noActionNudge });
          if (this.shouldEmitVerboseLogs()) {
            logger.warn('No-action trap detected: model described actions but produced no tool calls. Injecting nudge.');
          }
          continue;
        }

        // Genuine final response
        finalResponse = fullContent;
        this.pushMessage({ role: 'assistant', content: fullContent });
        this.stopReason = 'completed';
        if (this.onResponse) this.onResponse(fullContent);
        break;
      }

      // Wait for all dispatched tool calls to complete
      const dispatchedResults = await Promise.allSettled([...dispatchedPromises.values()]);
      for (let i = 0; i < dispatchedResults.length; i++) {
        if (dispatchedResults[i].status === 'fulfilled') {
          completedResults.set(i, dispatchedResults[i].value);
        }
      }

      // Build ordered results array
      const toolResults = [];
      for (let i = 0; i < finalToolCalls.length; i++) {
        if (completedResults.has(i)) {
          toolResults.push(completedResults.get(i));
        } else {
          toolResults.push({
            toolCallId: finalToolCalls[i].id,
            toolName: finalToolCalls[i].name,
            args: finalToolCalls[i].arguments,
            result: { success: false, error: 'Tool execution incomplete' },
          });
        }
      }

      this.reflectOnToolResults(toolResults, finalToolCalls);
      // Strip any XML tool call tags from content when native tool calls are present
      const cleanContent = (fullContent && hasXmlToolCalls(fullContent))
        ? parseXmlToolCalls(fullContent).cleanContent
        : fullContent;
      await this.postToolIteration(finalToolCalls, toolResults, cleanContent, iterationStart, runHistory);
    }

    if (!finalResponse) {
      finalResponse = this.buildStopMessage(this.stopReason, runHistory, startTime);
    }

    return {
      response: finalResponse,
      iterations: this.iterationCount,
      history: runHistory,
      messages: this.messages,
      stats: this.getStats(),
      performance: this.performanceMetrics,
      stopReason: this.stopReason,
      completed: this.stopReason === 'completed',
    };
  }

  /**
   * Run the agentic loop with enhanced error handling and performance tracking.
   *
   * Uses streaming tool execution when `this.streaming` is enabled,
   * falling back to non-streaming on error.
   *
   * Break strategy: The loop exits via:
   * - checkAborted(): agent was aborted externally
   * - hasReachedIterationLimit(): iteration count hit maxIterations
   * - hasReachedRuntimeLimit(): runtime exceeded maxRuntimeMs
   * - hasReachedToolCallLimit(): tool call count hit maxToolCalls
   * - hasStalled(): same tool workflow repeated without progress
   * - Empty toolCalls array: final response received (stopReason = 'completed')
   */
  async run(userInput, options = {}) {
    const startTime = Date.now();
    this.state = 'running';
    this.iterationCount = 0;
    this.lastError = null;
    this.aborted = false;
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.noActionTrapCount = 0;
    this.abortController = new AbortController();
    this.consecutiveApiErrors = 0;
    // Add user message (skip if already pushed, e.g. multimodal messages)
    if (userInput !== undefined && userInput !== null) {
      this.maybeResetWorkingSet(userInput);
      this.pushMessage({ role: 'user', content: userInput });
    }

    // Project structure discovery: inject codebase context on first run
    // This saves 2-3 tool call iterations the agent would spend listing directories
    if (this.iterationCount === 0 && this.workspaceDir) {
      await this.discoverProjectStructure();
    }

    // Planning phase: generate execution plan for complex tasks
    if (userInput && this.isComplexTask(userInput)) {
      const planMessage = await this.plan(userInput, this.messages);
      if (planMessage) {
        this.pushMessage({ role: 'system', content: planMessage });
      }
    }

    // ── Streaming path ──
    if (this.streaming) {
      try {
        const result = await this.runWithStreaming(userInput, options);
        this.state = 'completed';
        this.performanceMetrics.totalExecutionTime = Date.now() - startTime;
        return result;
      } catch (error) {
        // Streaming failed completely — fall through to non-streaming
        if (error instanceof AgentAbortError || error instanceof AbortError) {
          this.state = 'aborted';
          this.stopReason = 'aborted';
          throw error;
        }
        if (this.shouldEmitVerboseLogs()) {
          logger.warn('Streaming path failed, falling back to non-streaming', { error: error.message });
        }
        // Reset iteration state for clean retry
        this.iterationCount = 0;
        this.lastToolCallSignature = null;
        this.repeatedToolRoundCount = 0;
        this.noActionTrapCount = 0;
        this.toolFailureCounts = {};
        this.fileOperationHistory = [];
        this.roundToolNameHistory = [];
        // Fall through to non-streaming path below
      }
    }

    // ── Non-streaming path (original logic) ──
    let finalResponse = null;
    const runHistory = [];
    this.toolFailureCounts = {};

    try {
      while (true) {
        this.checkAborted();

        if (this.hasReachedIterationLimit()) {
          this.stopReason = 'max_iterations';
          break;
        }

        if (this.hasReachedRuntimeLimit(startTime)) {
          this.stopReason = 'max_runtime';
          break;
        }

        if (this.hasReachedToolCallLimit()) {
          this.stopReason = 'max_tool_calls';
          break;
        }

        if (this.hasStalled()) {
          this.stopReason = 'stalled';
          break;
        }

        const nonStreamStalledFile = this.hasFileStalled();
        const nonStreamStalledPattern = this.hasPatternStalled();
        if (nonStreamStalledFile || nonStreamStalledPattern) {
          const parts = [];
          if (nonStreamStalledFile) parts.push(`reading and editing "${nonStreamStalledFile}" in a cycle`);
          if (nonStreamStalledPattern) parts.push(`repeating the tool pattern (${nonStreamStalledPattern})`);
          this.pushMessage({
            role: 'user',
            content: `[System] You are ${parts.join(' and ')} without making meaningful progress. Stop re-reading files you've already edited. Either: (1) move on to the next file or task, or (2) provide your final answer with the changes you've already made.`,
          });
        }

        this.iterationCount++;
        this.performanceMetrics.totalIterations++;
        
        const iterationStart = Date.now();
        
        if (this.shouldEmitVerboseLogs()) {
          logger.debug(this.formatIterationLabel());
        }
        
        if (this.onIterationStart) {
          this.onIterationStart(this.iterationCount);
        }
        
        // Prepare messages: compact + allocate + warnings (shared logic)
        const messagesForLLM = await this.prepareMessagesForLLM();

        // Get LLM response with tools (with retry logic)
        let response;
        try {
          response = await this.getLLMResponseWithRetry(0, messagesForLLM);
        } catch (apiError) {
          this.consecutiveApiErrors++;
          if (this.consecutiveApiErrors >= 3) {
            this.stopReason = 'consecutive_api_errors';
            if (this.shouldEmitVerboseLogs()) {
              logger.error('Stopping: 3 consecutive API errors', { error: apiError.message });
            }
            break;
          }
          throw apiError;
        }
        this.consecutiveApiErrors = 0;

        if (!response) {
          throw new AgentError('No response from model', 'NO_RESPONSE');
        }
        
        // Check if there are tool calls
        const toolCalls = response.toolCalls || [];
        
        if (toolCalls.length === 0) {
          // Check if the model output tool calls as XML in the content
          if (response.content && hasXmlToolCalls(response.content)) {
            const parsed = parseXmlToolCalls(response.content);
            if (parsed.toolCalls.length > 0) {
              const xmlToolResults = await this.executeToolCallsEnhanced(parsed.toolCalls);
              this.reflectOnToolResults(xmlToolResults, parsed.toolCalls);
              await this.postToolIteration(parsed.toolCalls, xmlToolResults, parsed.cleanContent, iterationStart, runHistory);
              continue;
            }
          }
          // No tool calls detected — but is this a genuine final answer
          // or the model hallucinating actions without actually calling tools?
          const noActionNudge = this.detectNoActionTrap(response.content);
          if (noActionNudge) {
            this.pushMessage({ role: 'assistant', content: response.content });
            this.pushMessage({ role: 'user', content: noActionNudge });
            if (this.shouldEmitVerboseLogs()) {
              logger.warn('No-action trap detected: model described actions but produced no tool calls. Injecting nudge.');
            }
            continue;
          }

          // Genuine final response
          finalResponse = response.content;
          this.pushMessage({ role: 'assistant', content: response.content });
          this.stopReason = 'completed';
          
          if (this.onResponse) {
            this.onResponse(response.content);
          }
          
          break;
        }
        
        // Execute native tool calls with enhanced error handling
        let toolResults = await this.executeToolCallsEnhanced(toolCalls);
        let allToolCalls = [...toolCalls];

        // Also check for XML tool calls in content — some models output both
        let cleanContent = response.content || '';
        if (cleanContent && hasXmlToolCalls(cleanContent)) {
          const parsed = parseXmlToolCalls(cleanContent);
          cleanContent = parsed.cleanContent;
          if (parsed.toolCalls.length > 0) {
            const xmlToolResults = await this.executeToolCallsEnhanced(parsed.toolCalls);
            toolResults = toolResults.concat(xmlToolResults);
            allToolCalls = allToolCalls.concat(parsed.toolCalls);
          }
        }

        // Self-reflection: check for failed or empty results and inject guidance
        this.reflectOnToolResults(toolResults, allToolCalls);

        // Shared post-iteration processing (circuit breaker, stall, messages, history)
        await this.postToolIteration(allToolCalls, toolResults, cleanContent, iterationStart, runHistory);
      }
      
      if (!finalResponse) {
        finalResponse = this.buildStopMessage(this.stopReason, runHistory, startTime);
      }
      
      this.state = 'completed';
      this.performanceMetrics.totalExecutionTime = Date.now() - startTime;
      
      return {
        response: finalResponse,
        iterations: this.iterationCount,
        history: runHistory,
        messages: this.messages,
        stats: this.getStats(),
        performance: this.performanceMetrics,
        stopReason: this.stopReason,
        completed: this.stopReason === 'completed',
      };
      
    } catch (error) {
      if (error instanceof AgentAbortError || error instanceof AbortError) {
        this.state = 'aborted';
        this.stopReason = 'aborted';
      } else {
        this.state = 'error';
      }
      this.lastError = error;
      this.performanceMetrics.totalErrors++;
      
      if (this.onError) {
        this.onError(error);
      }
      
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Get LLM response with tool calling and retry logic
   */
  async getLLMResponseWithRetry(retryCount = 0, messages = null) {
    const maxRetries = this.maxRetries;
    const messagesToSend = messages || this.messages;
    
    // Use model's actual max output — reducing it makes truncation WORSE, not better
    const maxTokens = this.maxOutputTokens;
    
    try {
      const result = await this.client.chatWithTools(
        messagesToSend,
        this.tools.getToolDefinitions(),
        {
          model: this.model,
          temperature: 0.3,
          max_tokens: maxTokens,
        }
      );
      
      // Validate response has expected structure
      if (!result || (result.choices && result.choices.length === 0)) {
        throw new AgentError('Empty or malformed response from model (no choices)', 'EMPTY_RESPONSE', { response: result });
      }
      
      // Track usage
      this.updateUsageStats(result.usage);
      
      // Detect truncation from token limit
      if (result.finishReason === 'length') {
        const warnMsg = `⚠️ Response truncated (hit token limit at ${result.usage?.completion_tokens || '?'} tokens). Consider breaking your request into smaller parts.`;
        this.emitStatus('truncation_warning', warnMsg);
        if (this.shouldEmitVerboseLogs()) logger.warn(warnMsg);
      }
      
      return result;
    } catch (error) {
      // Handle JSON parse errors by retrying with lower max_tokens
      const isJsonError = error.message.includes('JSON') || 
                          error.message.includes('Unexpected end') ||
                          error.message.includes('context length');
      
      if (isJsonError && retryCount < maxRetries) {
        this.performanceMetrics.totalRetries++;
        const retryMessage = `Retrying with shorter response (attempt ${retryCount + 1}/${maxRetries})`;
        if (!this.emitStatus('retry', retryMessage) && this.shouldEmitVerboseLogs()) {
          logger.warn(retryMessage, { attempt: retryCount + 1, maxRetries });
        }
        
        // Compact context before retry
        await this.maybeCompactContext();
        
        // Exponential backoff
        await this.sleep(this.retryDelay * Math.pow(this.retryBackoff, retryCount));
        
        // Retry — context was already compacted above
        return this.getLLMResponseWithRetry(retryCount + 1, messagesToSend);
      }
      
      if (error.code === 'TIMEOUT') {
        logger.error(`Request timed out after ${Math.round(this.client.timeout / 1000)}s`, { 
          timeout: this.client.timeout,
          suggestion: 'Increase TIMEOUT_MS or use faster model'
        });
      } else {
        logger.error(`LLM Error: ${error.message}`, { code: error.code });
      }
      throw error;
    }
  }
  
  /**
   * Execute tool calls from LLM with enhanced error handling
   */
  async executeToolCallsEnhanced(toolCalls) {
    const results = [];
    
    // Execute tools in parallel when possible (independent tools)
    const independentTools = [];
    const dependentTools = [];
    
    // Expanded heuristic: all read-only tools can run in parallel
    const readOnlyTools = new Set([
      'read_file', 'read_files', 'list_directory', 'file_tree', 'search_files', 'search_in_files', 'get_file_info',
      'find_files', 'diff_files', 'preview_edit', 'read_image',
      'git_status', 'git_log', 'git_diff', 'git_info', 'git_branch',
      'web_search', 'read_webpage', 'fetch_url',
      'system_info', 'process_status',
      'get_memory', 'list_skills', 'list_memories',
      'get_task_status', 'get_progress_report', 'list_tasks',
      'subagent_status', 'get_subagent_messages', 'get_shared_context', 'list_subagents',
      'get_background_result',
      'list_workflows', 'get_workflow_state',
      'list_mcp_tools', 'list_a2a_agents',
    ]);
    for (const toolCall of toolCalls) {
      if (readOnlyTools.has(toolCall.name)) {
        independentTools.push(toolCall);
      } else {
        dependentTools.push(toolCall);
      }
    }
    
    // Execute independent tools in parallel
    if (independentTools.length > 1) {
      const parallelResults = await Promise.allSettled(
        independentTools.map(toolCall => this.executeSingleToolCall(toolCall))
      );
      
      for (let i = 0; i < parallelResults.length; i++) {
        const result = parallelResults[i];
        const toolCall = independentTools[i];
        
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
            result: { success: false, error: result.reason.message },
          });
        }
      }
    } else if (independentTools.length === 1) {
      const result = await this.executeSingleToolCall(independentTools[0]);
      results.push(result);
    }
    
    // Execute dependent tools: write/edit tools on different files can run in parallel
    const writeTools = new Set(['write_file', 'edit_file', 'search_and_replace']);
    const fileWriteGroups = new Map(); // resolvedPath -> [toolCall, ...]
    const sequentialTools = [];

    for (const toolCall of dependentTools) {
      if (writeTools.has(toolCall.name) && toolCall.arguments?.path) {
        const filePath = toolCall.arguments.path;
        if (!fileWriteGroups.has(filePath)) {
          fileWriteGroups.set(filePath, []);
        }
        fileWriteGroups.get(filePath).push(toolCall);
      } else {
        sequentialTools.push(toolCall);
      }
    }

    // Run file write groups in parallel (different files = no conflict)
    if (fileWriteGroups.size > 1) {
      const groupEntries = [...fileWriteGroups.entries()];
      const groupResults = await Promise.allSettled(
        groupEntries.map(async ([, groupToolCalls]) => {
          const groupResults = [];
          for (const tc of groupToolCalls) {
            groupResults.push(await this.executeSingleToolCall(tc));
          }
          return groupResults;
        })
      );
      for (const groupResult of groupResults) {
        if (groupResult.status === 'fulfilled') {
          results.push(...groupResult.value);
        }
      }
    } else if (fileWriteGroups.size === 1) {
      // Single file group — run sequentially within the group
      const [, groupToolCalls] = [...fileWriteGroups.entries()][0];
      for (const tc of groupToolCalls) {
        const result = await this.executeSingleToolCall(tc);
        results.push(result);
      }
    }

    // Execute sequential tools in parallel where safe (different file targets)
    const sequentialFileTools = [];
    const otherSequential = [];
    const fileToolNames = new Set(['exec', 'process', 'process_action']);
    for (const tc of sequentialTools) {
      if (fileToolNames.has(tc.name) && tc.arguments?.cwd) {
        sequentialFileTools.push(tc);
      } else {
        otherSequential.push(tc);
      }
    }
    // Shell tools with different cwd can run in parallel
    if (sequentialFileTools.length > 1) {
      const shellResults = await Promise.allSettled(
        sequentialFileTools.map(tc => this.executeSingleToolCall(tc))
      );
      for (let i = 0; i < shellResults.length; i++) {
        results.push(shellResults[i].status === 'fulfilled' ? shellResults[i].value : {
          toolCallId: sequentialFileTools[i].id, toolName: sequentialFileTools[i].name,
          args: sequentialFileTools[i].arguments, result: { success: false, error: shellResults[i].reason?.message || 'Failed' },
        });
      }
    } else if (sequentialFileTools.length === 1) {
      results.push(await this.executeSingleToolCall(sequentialFileTools[0]));
    }
    // Remaining truly sequential tools
    for (const toolCall of otherSequential) {
      results.push(await this.executeSingleToolCall(toolCall));
    }

    // Track consecutive failures by error category for circuit breaker
    let hadFailures = false;
    const webTools = new Set(['web_search', 'read_webpage', 'fetch_url']);
    for (const result of results) {
      if (result.result && result.result.success === false) {
        hadFailures = true;
        const toolName = result.toolName || '';
        const errorCategory = this.categorizeError({ message: result.result.error || '' });

        // Web tools: skip circuit breaker for expected failures (404s, no search results)
        // These are normal during web exploration and should not stop the agent
        if (webTools.has(toolName)) {
          const errorMsg = (result.result.error || '').toLowerCase();
          // HTTP 404 is expected when exploring docs — don't count it
          if (errorCategory === 'NOT_FOUND' || errorMsg.includes('404') || errorMsg.includes('not found')) {
            continue;
          }
          // Search returning no results is expected for niche queries
          if (toolName === 'web_search' && (errorMsg.includes('no search results') || errorMsg.includes('no results'))) {
            continue;
          }
          // Network errors on web tools use higher threshold (5 instead of 3)
          this.consecutiveFailures[errorCategory] = (this.consecutiveFailures[errorCategory] || 0) + 1;
          const threshold = 5;
          if (this.consecutiveFailures[errorCategory] >= threshold) {
            this.circuitBreakerTripped = true;
            const suggestion = this.getRecoverySuggestion(result.result.error, toolName);
            const circuitMessage = `Circuit breaker tripped: ${errorCategory} errors (${this.consecutiveFailures[errorCategory]} consecutive). ${suggestion}`;
            if (!this.emitStatus('circuit_breaker', circuitMessage) && this.shouldEmitVerboseLogs()) {
              logger.warn(circuitMessage, { errorCategory, consecutiveFailures: this.consecutiveFailures[errorCategory] });
            }
          }
          continue;
        }

        this.consecutiveFailures[errorCategory] = (this.consecutiveFailures[errorCategory] || 0) + 1;

        // EDIT_MISMATCH trips faster (2 instead of default threshold)
        const threshold = errorCategory === 'EDIT_MISMATCH' ? 2 : this.circuitBreakerThreshold;
        if (this.consecutiveFailures[errorCategory] >= threshold) {
          this.circuitBreakerTripped = true;
          const suggestion = this.getRecoverySuggestion(result.result.error, result.toolName);
          const circuitMessage = `Circuit breaker tripped: ${errorCategory} errors (${this.consecutiveFailures[errorCategory]} consecutive). ${suggestion}`;
          if (!this.emitStatus('circuit_breaker', circuitMessage) && this.shouldEmitVerboseLogs()) {
            logger.warn(circuitMessage, { errorCategory, consecutiveFailures: this.consecutiveFailures[errorCategory] });
          }
        }
      }
    }

    if (!hadFailures) {
      this.consecutiveFailures = {};
      this.circuitBreakerTripped = false;
    }

    return results;
  }
  
  /**
   * Execute a single tool call with retry logic
   */
  async executeSingleToolCall(toolCall) {
    const toolName = toolCall.name;
    const args = toolCall.arguments;
    this.performanceMetrics.totalToolCalls++;
    
    if (this.shouldEmitVerboseLogs()) {
      // Compact tool output - avoid clashing with subagent UI
      const argPreview = args?.path || args?.command?.substring(0, 40) || args?.query?.substring(0, 40) || '';
      logger.debug(`Executing tool: ${toolName}`, { tool: toolName, args: argPreview });
    }
    
    if (this.onToolStart) {
      this.onToolStart(toolName, args);
    }
    
    let lastError = null;
    
    // Retry logic for tool execution
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.tools.execute(toolName, args);
        const shouldRetry = result.success === false &&
          attempt < this.maxRetries &&
          this.isRetryableToolFailure(toolName, result);
        
        if (this.shouldEmitVerboseLogs()) {
          if (result.success !== false) {
            logger.debug('Tool succeeded', { tool: toolName });
          } else {
            logger.debug('Tool failed', { tool: toolName, error: result.error?.substring(0, 60) });
          }
        }

        if (shouldRetry) {
          lastError = new Error(result.error || `${toolName} failed`);
          this.performanceMetrics.totalRetries++;
          const retryMessage = `Retry ${attempt + 1}/${this.maxRetries} for ${toolName}`;
          if (!this.emitStatus('retry', retryMessage) && this.shouldEmitVerboseLogs()) {
            logger.warn(retryMessage, { tool: toolName, attempt: attempt + 1, maxRetries: this.maxRetries });
          }
          await this.sleep(this.retryDelay * Math.pow(this.retryBackoff, attempt));
          continue;
        }
        
        if (this.onToolEnd) {
          this.onToolEnd(toolName, result);
        }

        // Working set detection: track files being actively worked on
        if (result.success !== false && args && args.path) {
          const fileTools = ['read_file', 'edit_file', 'write_file', 'search_and_replace'];
          if (fileTools.includes(toolName)) {
            this.trackWorkingSet(args.path);
          }
        }

        // Pre-serialize result for postToolIteration (avoids double JSON.stringify)
        const serialized = JSON.stringify(result);
        return {
          toolCallId: toolCall.id,
          toolName,
          args,
          result,
          _serializedContent: serialized,
        };
        
      } catch (error) {
        lastError = error;
        this.performanceMetrics.totalRetries++;
        
        if (attempt < this.maxRetries) {
          const retryMessage = `Retry ${attempt + 1}/${this.maxRetries} for ${toolName}`;
          if (!this.emitStatus('retry', retryMessage) && this.shouldEmitVerboseLogs()) {
            logger.warn(retryMessage, { tool: toolName, attempt: attempt + 1, maxRetries: this.maxRetries });
          }
          await this.sleep(this.retryDelay * Math.pow(this.retryBackoff, attempt));
        }
      }
    }
    
    // All retries failed
    if (this.shouldEmitVerboseLogs()) {
      logger.error(`Tool failed after ${this.maxRetries} retries`, { tool: toolName, error: lastError.message });
    }
    
    if (this.onToolEnd) {
      this.onToolEnd(toolName, { success: false, error: lastError.message });
    }
    
    const failResult = { success: false, error: lastError.message };
    return {
      toolCallId: toolCall.id,
      toolName,
      args,
      result: failResult,
      _serializedContent: JSON.stringify(failResult),
    };
  }

  /**
   * Categorize an error type for circuit breaker tracking
   * @param {Error} error - The error to categorize
   * @returns {string} Error category identifier
   */
  categorizeError(error) {
    const message = (error?.message || '').toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
      return 'TIMEOUT';
    }
    if (message.includes('permission') || message.includes('access denied') || message.includes('eacces') || message.includes('eperm')) {
      return 'PERMISSION';
    }
    if (message.includes('enoent') || message.includes('not found') || message.includes('no such file')) {
      return 'NOT_FOUND';
    }
    if (message.includes('econnrefused') || message.includes('network') || message.includes('dns') || message.includes('fetch failed')) {
      return 'NETWORK';
    }
    if (message.includes('text not found') || message.includes('not found in file')) {
      return 'EDIT_MISMATCH';
    }
    if (message.includes('json') || message.includes('parse') || message.includes('unexpected token')) {
      return 'PARSE_ERROR';
    }
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      return 'RATE_LIMIT';
    }
    if (message.includes('context length') || message.includes('token') || message.includes('too large')) {
      return 'SIZE_LIMIT';
    }

    return 'UNKNOWN';
  }

  isRetryableToolFailure(toolName, result = {}) {
    if (!result || result.success !== false) {
      return false;
    }

    if (result.errorType === ToolErrorType.VALIDATION_ERROR ||
        result.errorType === ToolErrorType.PERMISSION_DENIED ||
        result.errorType === ToolErrorType.NOT_FOUND) {
      return false;
    }

    if (result.errorType === ToolErrorType.TIMEOUT) {
      return true;
    }

    const message = `${result.error || ''} ${result.status || ''} ${result.statusText || ''}`.toLowerCase();
    const isNetworkTool = ['web_search', 'read_webpage', 'fetch_url'].includes(toolName);

    if (!isNetworkTool && result.errorType !== ToolErrorType.EXECUTION_ERROR) {
      return false;
    }

    if (message.includes('no search results were found') || message.includes('not available in the current environment')) {
      return false;
    }

    return [
      'timeout',
      'timed out',
      'network',
      'fetch failed',
      'temporarily',
      'rate limit',
      'http 429',
      'http 500',
      'http 502',
      'http 503',
      'http 504',
      'all searx instances failed',
      'search failed',
    ].some((fragment) => message.includes(fragment));
  }

  /**
   * Get a recovery suggestion based on error type and tool name
   * @param {Error|string} error - The error that occurred
   * @param {string} toolName - The name of the tool that failed
   * @returns {string} A helpful recovery suggestion
   */
  getRecoverySuggestion(error, toolName) {
    const errorMessage = typeof error === 'string' ? error : (error?.message || '');
    const category = this.categorizeError(typeof error === 'string' ? { message: error } : error);

    const suggestions = {
      TIMEOUT: `The ${toolName} tool timed out. Try: (1) breaking the operation into smaller pieces, (2) using a more specific query or path, or (3) checking if the target resource is available.`,
      PERMISSION: `The ${toolName} tool encountered a permission error. Try: (1) checking file/directory permissions, (2) running with appropriate access rights, or (3) using a different path that you have access to.`,
      NOT_FOUND: `The ${toolName} tool could not find the target. Try: (1) verifying the path exists using list_directory or read_file first, (2) checking for typos in the path, or (3) searching for the file using search_in_files.`,
      NETWORK: `The ${toolName} tool encountered a network error. Try: (1) checking your internet connection, (2) verifying the URL is correct, (3) trying again after a brief wait, or (4) using an alternative data source.`,
      PARSE_ERROR: `The ${toolName} tool returned unparseable data. Try: (1) checking if the input arguments are correctly formatted, (2) verifying the tool is being used with valid parameters, or (3) simplifying the request.`,
      RATE_LIMIT: `The ${toolName} tool hit a rate limit. Try: (1) waiting before retrying, (2) reducing the frequency of calls, or (3) batching multiple operations into fewer calls.`,
      SIZE_LIMIT: `The ${toolName} tool encountered a size limit. Try: (1) reducing the amount of data being processed, (2) using pagination or chunking, or (3) filtering results to be more specific.`,
      EDIT_MISMATCH: `The edit_file tool could not find the exact text in the file. This is the most common error. IMMEDIATE RECOVERY: (1) Re-read the file with read_file to get the CURRENT content, (2) Copy the EXACT text verbatim from the read_file output as the 'find' parameter, (3) Or use line-based editing with startLine/endLine instead. NEVER retry with the same text that just failed.`,
      UNKNOWN: `The ${toolName} tool failed with: "${errorMessage.substring(0, 100)}". Try: (1) reviewing the error details, (2) checking tool documentation, (3) using an alternative approach, or (4) breaking the task into smaller steps.`,
    };

    return suggestions[category] || suggestions.UNKNOWN;
  }

  /**
   * Run a streaming version of the agent
   * 
   * Break strategy: The loop exits via:
   * - hasReachedIterationLimit(): iteration count hit max
   * - hasReachedRuntimeLimit(): runtime exceeded maxRuntimeMs
   * - hasReachedToolCallLimit(): tool call count hit max
   * - hasStalled(): same tool workflow repeated without progress
   * - Empty toolCalls array: final response received
   */
  async *runStream(userInput) {
    this.pushMessage({ role: 'user', content: userInput });
    this.iterationCount = 0;
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.repeatedToolRoundCount = 0;
    this.noActionTrapCount = 0;
    this.fileOperationHistory = [];
    this.roundToolNameHistory = [];
    const startTime = Date.now();
    
    while (true) {
      // Check for abort at the start of each iteration
      this.checkAborted();

      if (this.hasReachedIterationLimit()) {
        this.stopReason = 'max_iterations';
        break;
      }

      if (this.hasReachedRuntimeLimit(startTime)) {
        this.stopReason = 'max_runtime';
        break;
      }

      if (this.hasReachedToolCallLimit()) {
        this.stopReason = 'max_tool_calls';
        break;
      }

      if (this.hasStalled()) {
        this.stopReason = 'stalled';
        break;
      }
      const streamStalledFile = this.hasFileStalled();
      const streamStalledPattern = this.hasPatternStalled();
      if (streamStalledFile || streamStalledPattern) {
        const parts = [];
        if (streamStalledFile) parts.push(`reading and editing "${streamStalledFile}" in a cycle`);
        if (streamStalledPattern) parts.push(`repeating the tool pattern (${streamStalledPattern})`);
        this.pushMessage({
          role: 'user',
          content: `[System] You are ${parts.join(' and ')} without making meaningful progress. Stop re-reading files you've already edited. Either: (1) move on to the next file or task, or (2) provide your final answer with the changes you've already made.`,
        });
      }

      this.iterationCount++;
      
      yield { type: 'iteration', iteration: this.iterationCount };
      
      // Prepare messages: compact + allocate + warnings (shared logic)
      const messagesForLLM = await this.prepareMessagesForLLM();
      
      // Get streaming response (tools omitted — streaming+tools rejected by many models)
      const stream = this.client.chatStream(messagesForLLM, {
        model: this.model,
        temperature: 0.3,
      });
      
      let fullContent = '';
      let toolCalls = [];
      
      for await (const chunk of stream) {
        this.checkAborted();
        if (chunk.type === 'error') {
          const err = chunk.error;
          const errMsg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
          throw new AgentError(`API error: ${errMsg}`, 'API_ERROR', { apiError: err });
        } else if (chunk.type === 'content') {
          fullContent += chunk.content;
          yield { type: 'content', content: chunk.content };
        } else if (chunk.type === 'tool_calls') {
          toolCalls = chunk.toolCalls;
        } else if (chunk.type === 'done') {
          this.updateUsageStats(chunk.usage);
          // Detect truncation from token limit
          if (chunk.finishReason === 'length') {
            const warnMsg = `⚠️ Response truncated (hit token limit at ${chunk.usage?.completion_tokens || '?'} tokens)`;
            this.emitStatus('truncation_warning', warnMsg);
            if (this.shouldEmitVerboseLogs()) logger.warn(warnMsg);
          }
        }
      }
      
      if (toolCalls.length === 0) {
        // Check if the model output tool calls as XML in the content
        if (hasXmlToolCalls(fullContent)) {
          const parsed = parseXmlToolCalls(fullContent);
          if (parsed.toolCalls.length > 0) {
            yield { type: 'tools_start', count: parsed.toolCalls.length };
            const xmlResults = await this.executeToolCallsEnhanced(parsed.toolCalls);
            this.reflectOnToolResults(xmlResults, parsed.toolCalls);
            await this.postToolIteration(parsed.toolCalls, xmlResults, parsed.cleanContent, Date.now(), []);
            continue;
          }
        }
        // No tool calls — check for no-action trap before accepting
        const streamNoActionNudge = this.detectNoActionTrap(fullContent);
        if (streamNoActionNudge) {
          this.pushMessage({ role: 'assistant', content: fullContent });
          this.pushMessage({ role: 'user', content: streamNoActionNudge });
          if (this.shouldEmitVerboseLogs()) {
            logger.warn('No-action trap detected (runStream): model described actions but produced no tool calls. Injecting nudge.');
          }
          continue;
        }

        // Genuine final response
        this.pushMessage({ role: 'assistant', content: fullContent });
        this.stopReason = 'completed';
        yield { type: 'done', content: fullContent };
        return;
      }
      
      // Execute tools
      yield { type: 'tools_start', count: toolCalls.length };
      
      const results = await this.executeToolCallsEnhanced(toolCalls);
      
      // Add messages
      this.pushMessage({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });
      
      for (const result of results) {
        this.pushMessage({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.result),
        });
      }
      
      yield {
        type: 'tools_done',
        results: results.map(r => ({ tool: r.toolName, success: r.result.success })),
      };

      this.recordToolRound(toolCalls);
      this.recordFileOperations(toolCalls);
      // Track tool name pattern for pattern-stall detection
      const rsRoundNames = toolCalls.map(tc => tc.name).join('+');
      this.roundToolNameHistory.push(rsRoundNames);
      if (this.roundToolNameHistory.length > 50) {
        this.roundToolNameHistory = this.roundToolNameHistory.slice(-25);
      }
    }
    
    if (this.stopReason === 'max_iterations') {
      yield { type: 'max_iterations', iterations: this.iterationCount, reason: this.stopReason };
      return;
    }

    yield { type: 'stopped', iterations: this.iterationCount, reason: this.stopReason };
  }

  /**
   * Estimate token count (improved estimation)
   */
  estimateTokens() {
    if (!Number.isFinite(this.cachedEstimatedTokens)) {
      this.recalculateEstimatedTokens();
    }

    return Math.ceil(this.cachedEstimatedTokens);
  }

  /**
   * Compact context when approaching limit
   */
  async maybeCompactContext() {
    const { usedTokens: estimatedTokens, maxTokens } = this.getContextStats();
    
    if (estimatedTokens < maxTokens * this.compactThreshold) {
      return; // Still have room
    }
    
    const triggerMessage = `Context compaction triggered (~${estimatedTokens} tokens)`;
    if (!this.emitStatus('compaction', triggerMessage) && this.shouldEmitVerboseLogs()) {
      logger.warn(triggerMessage, { estimatedTokens });
    }
    
    // Smart compaction: preserve system message, first user message, and last 4 exchanges
    const systemMsg = this.messages.find(m => m.role === 'system');
    const nonSystemMessages = this.messages.filter(m => m.role !== 'system');

    // Find the first user message (original request)
    const firstUserMsgIndex = nonSystemMessages.findIndex(m => m.role === 'user');
    const firstUserMsg = firstUserMsgIndex >= 0 ? nonSystemMessages[firstUserMsgIndex] : null;

    // Identify exchange boundaries: each "exchange" starts with a user message or assistant+tool_calls
    // We want the last 4 exchanges from the end of the conversation
    const exchangeStarts = [];
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i];
      if (msg.role === 'user' || (msg.role === 'assistant' && msg.tool_calls)) {
        exchangeStarts.unshift(i);
      }
    }

    // Take the last 4 exchange start indices
    const last4StartIndices = exchangeStarts.slice(-4);
    const keepFromIndex = last4StartIndices.length > 0 ? last4StartIndices[0] : nonSystemMessages.length;

    // Messages to keep: from keepFromIndex to end
    const recentMessages = nonSystemMessages.slice(keepFromIndex);

    // Older messages (for summary): everything between first user msg and the kept window
    const olderStart = firstUserMsgIndex >= 0 ? firstUserMsgIndex + 1 : 0;
    const olderMessages = nonSystemMessages.slice(olderStart, keepFromIndex);

    // Rebuild messages
    const newMessages = [];
    if (systemMsg) newMessages.push(systemMsg);

    // Always preserve the first user message (the original request)
    // Only add first user message if it's NOT already in recentMessages
  if (firstUserMsg && !recentMessages.some(m => m === firstUserMsg)) {
    newMessages.push(firstUserMsg);
  }

    if (olderMessages.length > 0) {
      newMessages.push({
        role: 'assistant',
        content: this.buildCompactionSummary(olderMessages),
      });
    }
    newMessages.push(...recentMessages);
    
    this.setMessages(newMessages);
    this.contextStats.compactions++;
    
    const newTokens = this.estimateTokens();
    const compactedMessage = `Context compacted: ~${estimatedTokens} -> ~${newTokens} tokens`;
    if (!this.emitStatus('compaction', compactedMessage) && this.shouldEmitVerboseLogs()) {
      logger.info(compactedMessage, { beforeTokens: estimatedTokens, afterTokens: newTokens });
    }
  }

  /**
   * Chat without tools (simple conversation)
   */
  async chat(message, options = {}) {
    this.pushMessage({ role: 'user', content: message });
    
    const result = await this.client.chat(this.messages, {
      model: options.model || this.model,
      temperature: options.temperature || 0.7,
    });

    let finalContent = result.content;
    if (finalContent && hasXmlToolCalls(finalContent)) {
      finalContent = parseXmlToolCalls(finalContent).cleanContent;
    }
    if (typeof finalContent !== 'string') {
      finalContent = finalContent == null ? '' : String(finalContent);
    }

    const sanitizedResult = { ...result, content: finalContent };
    
    this.pushMessage({ role: 'assistant', content: finalContent });
    this.updateUsageStats(result.usage);
    
    return sanitizedResult;
  }

  /**
   * Get comprehensive session statistics
   */
  getStats() {
    const contextStats = this.getContextStats();
    return {
      iterations: this.iterationCount,
      totalMessages: this.messages.length,
      totalTokensUsed: this.totalTokensUsed,
      toolExecutions: this.history.reduce((sum, h) => sum + h.toolCalls.length, 0),
      toolExecutionsByName: this.history.reduce((acc, h) => {
        for (const toolName of h.toolCalls) {
          acc[toolName] = (acc[toolName] || 0) + 1;
        }
        return acc;
      }, {}),
      toolsUsed: [...new Set(this.history.flatMap(h => h.toolCalls))],
      state: this.state,
      stopReason: this.stopReason,
      performance: this.performanceMetrics,
      estimatedTokens: contextStats.usedTokens,
      contextUsage: `${contextStats.percent}%`,
      contextCompactions: contextStats.compactions,
    };
  }

  /**
   * Clear conversation history
   */
  clear() {
    this.setMessages([]);
    if (this.systemPrompt) {
      this.pushMessage({ role: 'system', content: this.systemPrompt });
    }
    this.history = [];
    this.iterationCount = 0;
    this.state = 'idle';
    this.lastError = null;
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.repeatedToolRoundCount = 0;
    this.noActionTrapCount = 0;
    this.consecutiveFailures = {};
    this.circuitBreakerTripped = false;
    this.lastSingleToolSignature = null;
    this.repeatedSingleToolCount = 0;
    this.toolFailureCounts = {};
    this.workingSet.clear();
    this.fileOperationHistory = [];
    this.performanceMetrics = {
      totalIterations: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      totalRetries: 0,
      avgIterationTime: 0,
      totalExecutionTime: 0,
    };
    this.contextStats.compactions = 0;
    this.contextStats.lastPromptTokens = 0;
    this.contextStats.lastCompletionTokens = 0;
    this.contextStats.lastTotalTokens = 0;
  }

  /**
   * Export conversation with full state
   */
  export() {
    const clientStats = this.client?.getStats?.() || {};
    return {
      model: this.model,
      systemPrompt: this.systemPrompt,
      messages: this.messages,
      history: this.history,
      stats: this.getStats(),
      performance: this.performanceMetrics,
      state: this.state,
      stopReason: this.stopReason,
      timestamp: new Date().toISOString(),
      version: '4.0',
      cost: {
        totalCost: clientStats.totalCost || 0,
        budgetUsed: clientStats.budgetUsed || 0,
        budgetLimit: clientStats.budgetLimit || 0,
        requestCount: clientStats.requestCount || 0,
        totalInputTokens: clientStats.totalInputTokens || 0,
        totalOutputTokens: clientStats.totalOutputTokens || 0,
      },
    };
  }

  /**
   * Import conversation with state restoration
   */
  import(data) {
    this.model = data.model || this.model;
    this.systemPrompt = data.systemPrompt || this.systemPrompt;
    this.setMessages(data.messages || []);
    this.history = data.history || [];
    this.performanceMetrics = data.performance || this.performanceMetrics;
    this.state = data.state || 'idle';
    this.stopReason = data.stopReason || null;
    this.contextStats.compactions = data.stats?.contextCompactions || 0;
    this.contextStats.lastPromptTokens = 0;
    this.contextStats.lastCompletionTokens = 0;
    this.contextStats.lastTotalTokens = 0;

    // Restore cost data to the client
    if (data.cost && this.client) {
      this.client.totalCost = data.cost.totalCost || 0;
      this.client.budgetUsed = data.cost.budgetUsed || 0;
      if (data.cost.budgetLimit) this.client.budgetLimit = data.cost.budgetLimit;
      this.client.requestCount = data.cost.requestCount || 0;
      this.client.totalInputTokens = data.cost.totalInputTokens || 0;
      this.client.totalOutputTokens = data.cost.totalOutputTokens || 0;
    }

    return this;
  }
  
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get checkpoint info (AgentSession handles checkpoint storage)
   */
  getCheckpoints() {
    return this.checkpoints;
  }
}

export default Agent;
