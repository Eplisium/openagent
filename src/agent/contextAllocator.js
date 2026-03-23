/**
 * ContextAllocator - Hierarchical Context Window Allocation
 *
 * Manages how messages are allocated within the context window using
 * a priority-based budgeting system. When messages exceed the budget,
 * lower-priority messages are compressed or dropped.
 *
 * Budget tiers:
 *   system   (15%) - System prompt + memory (priority 1, always kept)
 *   recent   (40%) - Last 4-6 turns full detail (priority 0, highest)
 *   workingSet (25%) - Active files being edited (priority 0, highest)
 *   older    (15%) - Compressed summaries (priority 2, first to compress)
 *   buffer   (5%)  - Reserved for incoming tool results (priority 3, first to drop)
 */

export class ContextAllocator {
  constructor(maxTokens = 800000) {
    this.maxTokens = maxTokens;
    this.budgets = {
      system:     { fraction: 0.15, priority: 1 },
      recent:     { fraction: 0.40, priority: 0 },
      workingSet: { fraction: 0.25, priority: 0 },
      older:      { fraction: 0.15, priority: 2 },
      buffer:     { fraction: 0.05, priority: 3 },
    };
  }

  /**
   * Compute token budget for each tier
   */
  getBudget() {
    const budget = {};
    for (const [tier, config] of Object.entries(this.budgets)) {
      budget[tier] = Math.floor(this.maxTokens * config.fraction);
    }
    return budget;
  }

  /**
   * Allocate messages within the context budget.
   *
   * @param {Array} messages - Full message list
   * @param {Function} estimateTokens - Token estimation function
   * @param {Set<string>} [workingSetFiles] - Set of file paths being actively worked on
   * @returns {{ messages: Array, compressed: boolean, stats: Object }}
   */
  allocate(messages, estimateTokens, workingSetFiles = new Set()) {
    const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);

    // If under budget, return everything as-is
    if (totalTokens <= this.maxTokens) {
      return {
        messages,
        compressed: false,
        stats: {
          totalTokens,
          maxTokens: this.maxTokens,
          usedPercent: Math.round((totalTokens / this.maxTokens) * 100),
        },
      };
    }

    // Categorize messages
    const categorized = this.categorizeMessages(messages);
    const workingSet = this.identifyWorkingSet(messages, workingSetFiles);
    const budget = this.getBudget();

    // Build optimized message list using priority tiers
    const result = [];
    let usedTokens = 0;

    // Tier 1: System messages (always kept)
    for (const msg of categorized.system) {
      const tokens = estimateTokens(msg);
      result.push(msg);
      usedTokens += tokens;
    }

    // Tier 0 (highest): Recent messages (last 6 exchanges)
    for (const msg of categorized.recent) {
      const tokens = estimateTokens(msg);
      result.push(msg);
      usedTokens += tokens;
    }

    // Tier 0: Working set messages (messages referencing active files)
    for (const msg of workingSet) {
      if (!result.includes(msg)) {
        const tokens = estimateTokens(msg);
        result.push(msg);
        usedTokens += tokens;
      }
    }

    // Tier 2: Older messages — try to fit as many as budget allows
    const remainingBudget = this.maxTokens - usedTokens;
    let olderUsed = 0;
    for (const msg of categorized.older) {
      if (!result.includes(msg)) {
        const tokens = estimateTokens(msg);
        if (olderUsed + tokens <= budget.older) {
          result.push(msg);
          olderUsed += tokens;
          usedTokens += tokens;
        }
        // Messages that don't fit are dropped (they should be in the compaction summary)
      }
    }

    // Sort result to maintain message order (original index order)
    result.sort((a, b) => {
      const aIdx = messages.indexOf(a);
      const bIdx = messages.indexOf(b);
      return aIdx - bIdx;
    });

    return {
      messages: result,
      compressed: true,
      stats: {
        totalTokens,
        maxTokens: this.maxTokens,
        usedPercent: Math.round((usedTokens / this.maxTokens) * 100),
        dropped: messages.length - result.length,
        categories: {
          system: categorized.system.length,
          recent: categorized.recent.length,
          workingSet: workingSet.length,
          older: categorized.older.length,
        },
      },
    };
  }

  /**
   * Find messages that reference files being actively edited.
   * These get higher priority because they're immediately relevant.
   *
   * @param {Array} messages - All messages
   * @param {Set<string>} recentFiles - Set of file paths in the working set
   * @returns {Array} Messages that reference working set files
   */
  identifyWorkingSet(messages, recentFiles) {
    if (!recentFiles || recentFiles.size === 0) return [];

    const workingMessages = [];
    const filePatterns = [...recentFiles].map(f => {
      // Normalize and escape for regex — match the basename and full path
      const basename = f.replace(/\\/g, '/').split('/').pop();
      return { path: f, basename, regex: new RegExp(this.escapeRegex(basename), 'i') };
    });

    for (const msg of messages) {
      const text = this.messageToText(msg);
      if (!text) continue;

      for (const { path, regex } of filePatterns) {
        if (text.includes(path) || regex.test(text)) {
          workingMessages.push(msg);
          break;
        }
      }
    }

    return workingMessages;
  }

  /**
   * Split messages into categories: system, recent, older.
   *
   * "Recent" = the last 6 user/assistant exchange groups from the end.
   * "Older" = everything else (non-system, non-recent).
   *
   * @param {Array} messages
   * @returns {{ system: Array, recent: Array, older: Array }}
   */
  categorizeMessages(messages) {
    const system = [];
    const nonSystem = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system.push(msg);
      } else {
        nonSystem.push(msg);
      }
    }

    // Identify exchange boundaries going backward
    const exchangeStarts = [];
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i];
      if (msg.role === 'user' || (msg.role === 'assistant' && msg.tool_calls)) {
        exchangeStarts.unshift(i);
      }
    }

    // Take the last 6 exchange starts
    const recentStarts = exchangeStarts.slice(-6);
    const keepFromIndex = recentStarts.length > 0 ? recentStarts[0] : nonSystem.length;

    const recent = nonSystem.slice(keepFromIndex);
    const older = nonSystem.slice(0, keepFromIndex);

    return { system, recent, older };
  }

  /**
   * Convert a message to searchable text
   */
  messageToText(msg) {
    if (!msg) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.map(p => p.text || '').join(' ');
    }
    return JSON.stringify(msg.content || '');
  }

  /**
   * Escape special regex characters
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export default ContextAllocator;
