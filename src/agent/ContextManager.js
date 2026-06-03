/**
 * ContextManager — token estimation, context compaction, and message preparation.
 *
 * Extracted from Agent.js to keep the main agent class focused on orchestration.
 * All methods read/write state on the owning Agent instance via `this.agent`.
 */

import { logger } from '../logger.js';
import { estimateTokens } from '../utils.js';
import { CONFIG } from '../config.js';

export class ContextManager {
  /**
   * @param {import('./Agent.js').Agent} agent – the owning Agent instance
   */
  constructor(agent) {
    this.agent = agent;
  }

  // ── Pre-compiled regexes for compaction (avoid recompilation) ─────
  static _filePathRegex = /(?:^|\s)([A-Za-z]:\\[^\s"]+|\/[^\s"]+|\.\/[^\s"]+|[a-zA-Z_][\w./\\-]*\.[a-zA-Z]{2,})/g;
  static _decisionRegex = /(?:decided|chose|going with|will use|switching to|changed to|fixed by|resolved by|solution:|approach:)/i;
  static _decisionSentenceRegex = /(?:decided|chose|going with|will use|switching to|changed to|fixed by|resolved by|solution|approach)/i;
  static _errorExtractRegex = /"error"\s*:\s*"([^"]{3,100})/;
  static _writeTools = new Set(['write_file', 'edit_file', 'search_and_replace']);

  // ── Token Estimation ───────────────────────────────────────────────

  /**
   * Estimate total token count across all messages.
   * Uses cached value when the message array hasn't changed.
   */
  estimateTokens() {
    const a = this.agent;
    if (!Number.isFinite(a.cachedEstimatedTokens)) {
      this.recalculateEstimatedTokens();
    }
    return Math.ceil(a.cachedEstimatedTokens);
  }

  /**
   * Estimate tokens for a single message, with per-message caching.
   */
  estimateMessageTokens(message = {}) {
    // Check cache first — messages are immutable once pushed
    if (message._tokenEstimate !== undefined) {
      return message._tokenEstimate;
    }

    let total = 0;

    if (message.content) {
      if (typeof message.content === 'string') {
        if (message.content.length < 50) {
          total += Math.ceil(message.content.length / 3.5);
        } else {
          total += estimateTokens(message.content);
        }
      } else if (Array.isArray(message.content)) {
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

    total += CONFIG.MESSAGE_OVERHEAD_TOKENS || 4;

    // Cache on the message object itself
    message._tokenEstimate = total;
    return total;
  }

  /**
   * Recalculate the estimated token count across all messages.
   */
  recalculateEstimatedTokens() {
    const a = this.agent;
    let sum = 0;
    for (let i = 0; i < a.messages.length; i++) {
      sum += this.estimateMessageTokens(a.messages[i]);
    }
    a.cachedEstimatedTokens = sum;
    a.contextStats.estimatedTokens = sum;
    return sum;
  }

  // ── Context Stats ─────────────────────────────────────────────────

  /**
   * Get context usage statistics.
   */
  getContextStats(maxTokens) {
    const a = this.agent;
    const safeMaxTokens = maxTokens || a.maxContextTokens;
    const usedTokens = this.estimateTokens();
    const safeMax = Number.isFinite(safeMaxTokens) && safeMaxTokens > 0
      ? safeMaxTokens
      : CONFIG.MAX_CONTEXT_TOKENS;
    const percent = safeMax > 0
      ? Math.min(100, Math.round((usedTokens / safeMax) * 100))
      : 0;

    // Reuse a single stats object to reduce GC pressure
    a._ctxStatsCache = a._ctxStatsCache || {};
    const stats = a._ctxStatsCache;
    stats.usedTokens = usedTokens;
    stats.maxTokens = safeMax;
    stats.percent = percent;
    stats.compactThreshold = a.compactThreshold;
    stats.compactions = a.contextStats.compactions;
    stats.lastPromptTokens = a.contextStats.lastPromptTokens;
    stats.lastCompletionTokens = a.contextStats.lastCompletionTokens;
    stats.lastTotalTokens = a.contextStats.lastTotalTokens;
    return stats;
  }

  // ── Message Preparation ───────────────────────────────────────────

  /**
   * Prepare messages for LLM: compact if needed, allocate context budget,
   * emit warnings.  Returns the optimized message array.
   * Shared by both streaming and non-streaming paths to eliminate duplication.
   */
  async prepareMessagesForLLM() {
    const a = this.agent;
    await this.maybeCompactContext();

    if (a.runLimits?.progressDirective && a.runLimits.progressDirective.trim()) {
      const directive = a.runLimits.progressDirective.trim();
      const lastMessage = a.messages[a.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== directive) {
        a.pushMessage({ role: 'user', content: directive });
      }
    }

    const allocResult = a.contextAllocator.allocate(
      a.messages,
      (msg) => this.estimateMessageTokens(msg),
      a.workingSet
    );
    if (allocResult.compressed) {
      if (a.shouldEmitVerboseLogs()) {
        logger.debug('Context allocator active', allocResult.stats);
      }
      a.emitStatus('context_allocate',
        `Context optimized: ${allocResult.stats.dropped} messages deferred (budget ${allocResult.stats.usedPercent}%)`);
    }

    // Proactive context warning at 60% usage
    const ctxStats = this.getContextStats();
    if (ctxStats.percent > 60 && ctxStats.percent <= 70) {
      const warnMsg = `Context usage at ${ctxStats.percent}% (~${a.formatCompactNumber(ctxStats.usedTokens)} tokens). Consider wrapping up soon.`;
      if (!a.emitStatus('context_warning', warnMsg) && a.shouldEmitVerboseLogs()) {
        logger.warn(warnMsg);
      }
    }

    return allocResult.messages;
  }

  // ── Context Compaction ────────────────────────────────────────────

  /**
   * Compact context when approaching limit — enhanced with TrajectoryCompressor.
   *
   * Uses the enhanced compressor which:
   * - Protects first N turns (system + original request)
   * - Protects last N turns (recent working context)
   * - Extracts structured knowledge (files, commands, decisions, errors)
   * - Preserves tool call patterns for the model
   */
  async maybeCompactContext() {
    const a = this.agent;
    const { usedTokens: estimatedTokens, maxTokens } = this.getContextStats();

    // Also trigger compaction if message count exceeds hard limit
    const MESSAGE_HARD_LIMIT = 150;
    const shouldCompact = estimatedTokens >= maxTokens * a.compactThreshold ||
                          a.messages.length > MESSAGE_HARD_LIMIT;

    if (!shouldCompact) {
      return; // Still have room
    }

    const triggerMessage = `Context compaction triggered (~${estimatedTokens} tokens, ${a.messages.length} messages)`;
    if (!a.emitStatus('compaction', triggerMessage) && a.shouldEmitVerboseLogs()) {
      logger.warn(triggerMessage, { estimatedTokens, messageCount: a.messages.length });
    }

    // ── Enhanced compression via TrajectoryCompressor ──
    const estimateFn = (msg) => {
      if (!msg) return 0;
      const content = msg.content || '';
      const toolCalls = msg.tool_calls || [];
      let tokens = Math.ceil(content.length / 4);
      for (const tc of toolCalls) {
        tokens += Math.ceil(JSON.stringify(tc).length / 4);
      }
      return tokens;
    };

    const result = a.trajectoryCompressor.compress(a.messages, estimateFn);

    if (result.compressed) {
      a.setMessages(result.messages);
      a.contextStats.compactions++;

      const compactedMessage = `Context compacted: ~${result.stats.beforeTokens} -> ~${result.stats.afterTokens} tokens (${result.stats.messagesCompressed} messages compressed, ${result.stats.tokensSaved} tokens saved)`;
      if (!a.emitStatus('compaction', compactedMessage) && a.shouldEmitVerboseLogs()) {
        logger.info(compactedMessage, result.stats);
      }
    } else {
      // Fallback to original logic
      this._fallbackCompactContext(estimatedTokens);
    }
  }

  /**
   * Fallback compaction (original logic) — used when TrajectoryCompressor
   * determines the message set is too small or doesn't need compression.
   * @private
   */
  _fallbackCompactContext(estimatedTokens) {
    const a = this.agent;
    let systemMsg = null;
    let firstUserMsg = null;
    let firstUserMsgIndex = -1;
    const exchangeStarts = [];
    let nonSystemIdx = 0;

    for (let i = 0; i < a.messages.length; i++) {
      const msg = a.messages[i];
      if (msg.role === 'system') {
        if (!systemMsg) systemMsg = msg;
        continue;
      }
      if (!firstUserMsg && msg.role === 'user') {
        firstUserMsg = msg;
        firstUserMsgIndex = nonSystemIdx;
      }
      if (msg.role === 'user' || (msg.role === 'assistant' && msg.tool_calls)) {
        exchangeStarts.push(nonSystemIdx);
      }
      nonSystemIdx++;
    }

    const last4StartIndices = exchangeStarts.slice(-4);
    const keepFromIndex = last4StartIndices.length > 0 ? last4StartIndices[0] : nonSystemIdx;

    const recentMessages = [];
    const olderMessages = [];
    nonSystemIdx = 0;
    for (let i = 0; i < a.messages.length; i++) {
      if (a.messages[i].role === 'system') continue;
      if (nonSystemIdx >= keepFromIndex) {
        recentMessages.push(a.messages[i]);
      } else if (nonSystemIdx > (firstUserMsgIndex >= 0 ? firstUserMsgIndex : -1)) {
        olderMessages.push(a.messages[i]);
      }
      nonSystemIdx++;
    }

    const newMessages = [];
    if (systemMsg) newMessages.push(systemMsg);
    if (firstUserMsg && !recentMessages.includes(firstUserMsg)) {
      newMessages.push(firstUserMsg);
    }
    if (olderMessages.length > 0) {
      newMessages.push({
        role: 'system',
        content: this.summarizeOlderMessages(olderMessages),
      });
    }
    newMessages.push(...recentMessages);

    a.setMessages(newMessages);
    a.contextStats.compactions++;

    const newTokens = this.estimateTokens();
    const compactedMessage = `Context compacted (fallback): ~${estimatedTokens} -> ~${newTokens} tokens`;
    if (!a.emitStatus('compaction', compactedMessage) && a.shouldEmitVerboseLogs()) {
      logger.info(compactedMessage, { beforeTokens: estimatedTokens, afterTokens: newTokens });
    }
  }

  // ── Summarization ─────────────────────────────────────────────────

  /**
   * Summarize older messages via the context allocator.
   */
  summarizeOlderMessages(olderMessages = []) {
    const a = this.agent;
    return a.contextAllocator.summarizeOlderMessages(olderMessages, {
      droppedCount: olderMessages.length,
    });
  }

  /**
   * Extract structured knowledge from conversation messages for context compaction.
   * Produces a structured summary preserving ~80% of useful information in ~20% of tokens.
   * Format: TASKS, FILES, DECISIONS, ERRORS, CODE_CHANGES, CURRENT_STATE
   */
  buildCompactionSummary(olderMessages = []) {
    const a = this.agent;
    const priorUserMessages = [];
    const filesMentioned = new Set();
    const decisions = [];
    const errors = [];
    const codeChanges = [];
    const toolsUsed = {};
    const recentHistory = a.history.slice(-8);

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
      ContextManager._filePathRegex.lastIndex = 0;
      let match;
      while ((match = ContextManager._filePathRegex.exec(text)) !== null) {
        const p = match[1];
        if (p.length > 3 && p.length < 200 && !p.startsWith('http')) {
          filesMentioned.add(p);
        }
      }

      // Scan tool results for errors
      if (msg.role === 'tool' && content) {
        if (text.includes('"success":false') || text.includes('"error"')) {
          const errorMatch = text.match(ContextManager._errorExtractRegex);
          if (errorMatch) errors.push(errorMatch[1]);
        }
        // Scan for code changes (write_file, edit_file success)
        if (text.includes('"success":true') && i > 0) {
          const prevAssistant = olderMessages[i - 1];
          if (prevAssistant?.role === 'assistant' && prevAssistant.tool_calls) {
            for (const tc of prevAssistant.tool_calls) {
              const name = tc.function?.name || '';
              if (ContextManager._writeTools.has(name)) {
                let args = {};
                try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; logger.warn(`Failed to parse tool call arguments for ${name}`); }
                codeChanges.push(args.path ? `${name}: ${args.path}` : `${name} (no path in args)`);
              }
            }
          }
        }
      }

      // Extract decisions from assistant messages
      if (msg.role === 'assistant' && typeof content === 'string' && ContextManager._decisionRegex.test(content)) {
        const sentences = content.split(/[.!?\n]/).filter(s => s.trim().length > 10 && s.trim().length < 200);
        for (const s of sentences) {
          if (ContextManager._decisionSentenceRegex.test(s)) {
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

    // Determine current state from last assistant message (backward scan)
    let currentState = 'Conversation in progress.';
    for (let j = olderMessages.length - 1; j >= 0; j--) {
      const m = olderMessages[j];
      if (m.role === 'assistant' && m.content && typeof m.content === 'string') {
        const lastSentence = m.content.split(/[.!?\n]/).filter(s => s.trim().length > 10).pop();
        if (lastSentence) {
          currentState = lastSentence.trim().substring(0, 200);
        }
        break;
      }
    }

    // Build compact knowledge block using structured format
    const lines = ['[CONTEXT KNOWLEDGE — structured summary of prior work]'];

    if (priorUserMessages.length > 0) {
      lines.push('TASKS:');
      for (const message of priorUserMessages) {
        const normalized = String(message.content).replace(/\s+/g, ' ').trim();
        lines.push(`- ${a.truncateText(normalized, 120)}`);
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
}

export default ContextManager;
