/**
 * 📊 ContextManager - Handles token estimation, context compaction, and message management
 * Extracted from Agent.js to follow single responsibility principle
 */

import { CONFIG } from '../config.js';
// normalizeOptionalLimit removed — not used

export class ContextManager {
  constructor(options = {}) {
    // Context management settings
    this.maxContextTokens = options.maxContextTokens || CONFIG.MAX_CONTEXT_TOKENS;
    this.maxToolResultChars = options.maxToolResultChars || CONFIG.MAX_TOOL_RESULT_CHARS;
    this.compactThreshold = options.compactThreshold || CONFIG.COMPACT_THRESHOLD;
    
    // Token tracking
    this.messages = [];
    this.cachedEstimatedTokens = 0;
    this.contextStats = {
      estimatedTokens: 0,
      compactions: 0,
      lastPromptTokens: 0,
      lastCompletionTokens: 0,
      lastTotalTokens: 0,
    };
    
    // History for compaction summary
    this.history = [];
  }

  /**
   * Estimate tokens for a single message
   * @param {object} message - Message object
   * @returns {number} Estimated token count
   */
  estimateMessageTokens(message = {}) {
    let total = 0;

    if (message.content) {
      if (typeof message.content === 'string') {
        // String content: estimate based on character patterns
        const content = message.content;
        const isCode = /[{}[\\]()=><;]/.test(content); // eslint-disable-line no-useless-escape
        // Code is ~3 chars/token, prose is ~4 chars/token
        total += isCode ? Math.ceil(content.length / 3) : Math.ceil(content.length / 4);
      } else if (Array.isArray(message.content)) {
        // Multimodal content (text + images)
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            total += Math.ceil(part.text.length / 4);
          } else if (part.type === 'image_url') {
            // Images cost ~85 tokens for low-res, ~765 for high-res
            // Estimate ~85 tokens per image as baseline
            total += 85;
          }
        }
      } else {
        total += Math.ceil(JSON.stringify(message.content).length / 4);
      }
    }

    if (message.tool_calls) {
      total += Math.ceil(JSON.stringify(message.tool_calls).length / 3);
    }

    // Add overhead per message (~4 tokens for role/metadata)
    total += 4;

    return total;
  }

  /**
   * Recalculate estimated tokens for all messages
   * @returns {number} Total estimated tokens
   */
  recalculateEstimatedTokens() {
    this.cachedEstimatedTokens = this.messages.reduce(
      (sum, message) => sum + this.estimateMessageTokens(message),
      0
    );
    this.contextStats.estimatedTokens = this.cachedEstimatedTokens;
    return this.cachedEstimatedTokens;
  }

  /**
   * Set messages array
   * @param {Array} messages - Array of messages
   */
  setMessages(messages = []) {
    this.messages = Array.isArray(messages) ? messages : [];
    this.recalculateEstimatedTokens();
  }

  /**
   * Get current messages
   * @returns {Array} Messages array
   */
  getMessages() {
    return this.messages;
  }

  /**
   * Add a message to the conversation
   * @param {object} message - Message to add
   * @returns {object} The added message
   */
  pushMessage(message) {
    this.messages.push(message);
    this.cachedEstimatedTokens += this.estimateMessageTokens(message);
    this.contextStats.estimatedTokens = this.cachedEstimatedTokens;
    return message;
  }

  /**
   * Set the system prompt (updates or adds system message)
   * @param {string} systemPrompt - System prompt text
   */
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
   * Update max context tokens
   * @param {number} maxContextTokens - New max tokens
   * @returns {number} The resolved max tokens
   */
  setMaxContextTokens(maxContextTokens) {
    if (Number.isFinite(maxContextTokens) && maxContextTokens > 0) {
      this.maxContextTokens = maxContextTokens;
    }

    return this.maxContextTokens;
  }

  /**
   * Get context statistics
   * @param {number} maxTokens - Optional override for max tokens
   * @returns {object} Context stats object
   */
  getContextStats(maxTokens = this.maxContextTokens) {
    const usedTokens = this.estimateTokens();
    const safeMax = Number.isFinite(maxTokens) && maxTokens > 0
      ? maxTokens
      : CONFIG.MAX_CONTEXT_TOKENS;
    const percent = safeMax > 0
      ? Math.min(100, Math.round((usedTokens / safeMax) * 100))
      : 0;

    return {
      usedTokens,
      maxTokens: safeMax,
      percent,
      compactThreshold: this.compactThreshold,
      compactions: this.contextStats.compactions,
      lastPromptTokens: this.contextStats.lastPromptTokens,
      lastCompletionTokens: this.contextStats.lastCompletionTokens,
      lastTotalTokens: this.contextStats.lastTotalTokens,
    };
  }

  /**
   * Format a number in compact form (e.g., 1.5K, 2.3M)
   * @param {number} value - Number to format
   * @returns {string} Formatted string
   */
  formatCompactNumber(value) {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return Math.round(value).toString();
  }

  /**
   * Truncate text to a maximum length
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  truncateText(text, maxLength = 160) {
    if (!text || text.length <= maxLength) {
      return text;
    }

    return `${text.substring(0, maxLength - 3).trimEnd()}...`;
  }

  /**
   * Build a summary of older messages for context compaction
   * @param {Array} olderMessages - Messages to summarize
   * @returns {string} Summary text
   */
  buildCompactionSummary(olderMessages = []) {
    const priorUserMessages = olderMessages
      .filter(message => message.role === 'user' && message.content)
      .slice(-3);
    const recentHistory = this.history.slice(-6);
    const lines = ['[Context compacted to preserve headroom.]'];

    if (priorUserMessages.length > 0) {
      lines.push('Recent user intents:');
      for (const message of priorUserMessages) {
        const normalized = String(message.content).replace(/\s+/g, ' ').trim();
        lines.push(`- ${this.truncateText(normalized, 160)}`);
      }
    }

    if (recentHistory.length > 0) {
      lines.push('Recent tool work:');
      for (const entry of recentHistory) {
        const tools = entry.toolCalls.join(', ') || 'no tools';
        lines.push(`- Iteration ${entry.iteration}: ${tools}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Update usage stats from API response
   * @param {object} usage - Usage object from API
   */
  updateUsageStats(usage) {
    if (!usage) {
      return;
    }

    this.contextStats.lastPromptTokens = usage.prompt_tokens || 0;
    this.contextStats.lastCompletionTokens = usage.completion_tokens || 0;
    this.contextStats.lastTotalTokens = usage.total_tokens || 0;
  }

  /**
   * Get total tokens used (accumulates over time)
   * @returns {number} Total tokens used
   */
  getTotalTokensUsed() {
    return this.totalTokensUsed || 0;
  }

  /**
   * Set total tokens used
   * @param {number} total - Total tokens
   */
  setTotalTokensUsed(total) {
    this.totalTokensUsed = total;
  }

  /**
   * Add to total tokens used
   * @param {number} tokens - Tokens to add
   */
  addTokensUsed(tokens) {
    if (!this.totalTokensUsed) this.totalTokensUsed = 0;
    this.totalTokensUsed += tokens;
  }

  /**
   * Estimate current token count
   * @returns {number} Estimated tokens
   */
  estimateTokens() {
    if (!Number.isFinite(this.cachedEstimatedTokens)) {
      this.recalculateEstimatedTokens();
    }

    return Math.ceil(this.cachedEstimatedTokens);
  }

  /**
   * Compact context when approaching limit
   * @param {Function} emitStatus - Optional callback for status updates
   * @param {Function} shouldEmitVerbose - Optional callback to check if verbose logs should emit
   * @returns {boolean} Whether compaction occurred
   */
  async maybeCompactContext(emitStatus, shouldEmitVerbose) {
    const { usedTokens: estimatedTokens, maxTokens } = this.getContextStats();
    
    if (estimatedTokens < maxTokens * this.compactThreshold) {
      return false; // Still have room
    }
    
    const triggerMessage = `Context compaction triggered (~${estimatedTokens} tokens)`;
    if (emitStatus && !emitStatus('compaction', triggerMessage)) {
      // Status not handled
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
    if (firstUserMsg && !recentMessages.includes(firstUserMsg)) {
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
    if (emitStatus && !emitStatus('compaction', compactedMessage)) {
      // Status not handled
    }
    
    return true;
  }

  /**
   * Set history for compaction summary
   * @param {Array} history - History array
   */
  setHistory(history) {
    this.history = history || [];
  }

  /**
   * Get history
   * @returns {Array} History array
   */
  getHistory() {
    return this.history;
  }

  /**
   * Clear the context
   */
  clear() {
    this.messages = [];
    this.cachedEstimatedTokens = 0;
    this.contextStats = {
      estimatedTokens: 0,
      compactions: 0,
      lastPromptTokens: 0,
      lastCompletionTokens: 0,
      lastTotalTokens: 0,
    };
    this.history = [];
  }

  /**
   * Export state for serialization
   * @returns {object} Exported state
   */
  export() {
    return {
      messages: this.messages,
      contextStats: this.contextStats,
      totalTokensUsed: this.totalTokensUsed,
    };
  }

  /**
   * Import state from serialization
   * @param {object} data - Data to import
   */
  import(data) {
    if (data.messages) {
      this.setMessages(data.messages);
    }
    if (data.contextStats) {
      this.contextStats.compactions = data.contextStats.compactions || 0;
      this.contextStats.lastPromptTokens = data.contextStats.lastPromptTokens || 0;
      this.contextStats.lastCompletionTokens = data.contextStats.lastCompletionTokens || 0;
      this.contextStats.lastTotalTokens = data.contextStats.lastTotalTokens || 0;
    }
    if (data.totalTokensUsed !== undefined) {
      this.totalTokensUsed = data.totalTokensUsed;
    }
  }
}

export default ContextManager;