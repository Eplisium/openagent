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
      system:     { fraction: 0.12, priority: 1 },
      recent:     { fraction: 0.38, priority: 0 },
      workingSet: { fraction: 0.30, priority: 0 },
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
    // Pre-compute token estimates once with index tracking to avoid O(n²) lookups
    const indexed = messages.map((m, i) => ({ msg: m, idx: i, tokens: estimateTokens(m) }));
    const totalTokens = indexed.reduce((sum, e) => sum + e.tokens, 0);

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

    // Categorize messages (returns indices into original array)
    const categorized = this.categorizeMessagesIndexed(indexed);
    const workingSetIndices = this.identifyWorkingSetIndexed(indexed, workingSetFiles);
    const budget = this.getBudget();

    // Build optimized message list using priority tiers — track by index for O(n) sort
    const includedSet = new Set();
    let usedTokens = 0;

    // Tier 1: System messages (always kept)
    for (const entry of categorized.system) {
      includedSet.add(entry.idx);
      usedTokens += entry.tokens;
    }

    // Tier 0 (highest): Recent messages (last 6 exchanges)
    for (const entry of categorized.recent) {
      includedSet.add(entry.idx);
      usedTokens += entry.tokens;
    }

    // Tier 0: Working set messages (messages referencing active files)
    for (const idx of workingSetIndices) {
      if (!includedSet.has(idx)) {
        includedSet.add(idx);
        usedTokens += indexed[idx].tokens;
      }
    }

    // Tier 2: Older messages — try to fit as many as budget allows
    let olderUsed = 0;
    for (const entry of categorized.older) {
      if (!includedSet.has(entry.idx)) {
        if (olderUsed + entry.tokens <= budget.older) {
          includedSet.add(entry.idx);
          olderUsed += entry.tokens;
          usedTokens += entry.tokens;
        }
      }
    }

    // O(n) filter + sort by original index (integers, fast comparison)
    let result = indexed
      .filter(e => includedSet.has(e.idx))
      .sort((a, b) => a.idx - b.idx)
      .map(e => e.msg);

    const droppedOlder = categorized.older
      .filter(entry => !includedSet.has(entry.idx))
      .map(entry => entry.msg);
    if (droppedOlder.length > 0) {
      const summaryMessage = this.buildSummaryMessage(droppedOlder, {
        droppedCount: droppedOlder.length,
        totalOlderCount: categorized.older.length,
      });
      result = this.insertAfterSystemMessages(result, summaryMessage);
      usedTokens += estimateTokens(summaryMessage);
    }

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
          workingSet: workingSetIndices.length,
          older: categorized.older.length,
        },
      },
    };
  }

  buildSummaryMessage(messages, options = {}) {
    return {
      role: 'system',
      content: this.summarizeOlderMessages(messages, options),
    };
  }

  insertAfterSystemMessages(messages, summaryMessage) {
    const result = [...messages];
    let insertAt = 0;
    while (insertAt < result.length && result[insertAt].role === 'system') {
      insertAt++;
    }
    result.splice(insertAt, 0, summaryMessage);
    return result;
  }

  summarizeOlderMessages(messages = [], options = {}) {
    const userRequests = [];
    const files = new Set();
    const toolCalls = {};
    const failures = [];
    const decisions = [];

    for (const msg of messages) {
      const text = this.messageToText(msg);
      if (!text) continue;

      if (msg.role === 'user') {
        userRequests.push(text.replace(/\s+/g, ' ').slice(0, 180));
        if (userRequests.length > 4) userRequests.shift();
      }

      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name || tc.name || 'tool';
          toolCalls[name] = (toolCalls[name] || 0) + 1;
          const argsText = tc.function?.arguments || JSON.stringify(tc.arguments || {});
          this.extractFileLikeTokens(argsText, files);
        }
      }

      if (msg.role === 'tool' && /"success"\s*:\s*false|"error"\s*:/.test(text)) {
        const match = text.match(/"error"\s*:\s*"([^"]{1,180})"/);
        failures.push(match ? match[1] : text.replace(/\s+/g, ' ').slice(0, 180));
        if (failures.length > 5) failures.shift();
      }

      if (msg.role === 'assistant' && /\b(decided|using|approach|implemented|changed|fixed|because)\b/i.test(text)) {
        const sentence = text.split(/[.!?\n]/).find(part =>
          /\b(decided|using|approach|implemented|changed|fixed|because)\b/i.test(part) &&
          part.trim().length > 20
        );
        if (sentence) decisions.push(sentence.trim().slice(0, 180));
        if (decisions.length > 5) decisions.shift();
      }

      this.extractFileLikeTokens(text, files);
    }

    const lines = [
      '[Context compacted to preserve headroom.]',
      '[System reminder] Earlier conversation was compacted into this summary.',
      `Compacted messages: ${options.droppedCount ?? messages.length}${options.totalOlderCount ? ` of ${options.totalOlderCount} older messages` : ''}.`,
    ];
    if (userRequests.length) lines.push(`Prior user constraints/requests: ${userRequests.join(' | ')}`);
    if (decisions.length) lines.push(`Key decisions/progress: ${decisions.join(' | ')}`);
    const fileList = [...files].slice(0, 12);
    if (fileList.length) lines.push(`Files and paths mentioned: ${fileList.join(', ')}`);
    const toolSummary = Object.entries(toolCalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `${name} x${count}`);
    if (toolSummary.length) lines.push(`Tools used: ${toolSummary.join(', ')}`);
    if (failures.length) lines.push(`Recent failures to avoid repeating: ${failures.join(' | ')}`);
    lines.push('Use this summary as preserved context; prefer current file reads over stale details when editing.');

    return lines.join('\n').slice(0, 2200);
  }

  extractFileLikeTokens(text, files) {
    const regex = /(?:[A-Za-z]:\\|\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])[A-Za-z0-9_./\\ -]+\.[A-Za-z0-9]{1,12}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0].trim();
      if (value.length > 2 && value.length < 220 && !value.startsWith('http')) {
        files.add(value);
      }
    }
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
   * Index-based variant: returns Set of original indices instead of message refs.
   * Avoids O(n²) indexOf calls during sort.
   */
  identifyWorkingSetIndexed(indexed, recentFiles) {
    if (!recentFiles || recentFiles.size === 0) return new Set();

    const result = new Set();
    const filePatterns = [...recentFiles].map(f => {
      const basename = f.replace(/\\/g, '/').split('/').pop();
      return { path: f, basename, regex: new RegExp(this.escapeRegex(basename), 'i') };
    });

    for (const { msg, idx } of indexed) {
      const text = this.messageToText(msg);
      if (!text) continue;

      for (const { path, regex } of filePatterns) {
        if (text.includes(path) || regex.test(text)) {
          result.add(idx);
          break;
        }
      }
    }

    return result;
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

    const exchangeStarts = [];
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i];
      if (msg.role === 'user' || (msg.role === 'assistant' && msg.tool_calls)) {
        exchangeStarts.unshift(i);
      }
    }

    const recentStarts = exchangeStarts.slice(-6);
    const keepFromIndex = recentStarts.length > 0 ? recentStarts[0] : nonSystem.length;

    const recent = nonSystem.slice(keepFromIndex);
    const older = nonSystem.slice(0, keepFromIndex);

    return { system, recent, older };
  }

  /**
   * Index-based variant: operates on pre-indexed entries, returns categorized
   * arrays of {idx, tokens} instead of message refs. Avoids indexOf later.
   */
  categorizeMessagesIndexed(indexed) {
    const system = [];
    const nonSystem = [];

    for (const entry of indexed) {
      if (entry.msg.role === 'system') {
        system.push(entry);
      } else {
        nonSystem.push(entry);
      }
    }

    const exchangeStarts = [];
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const entry = nonSystem[i];
      if (entry.msg.role === 'user' || (entry.msg.role === 'assistant' && entry.msg.tool_calls)) {
        exchangeStarts.unshift(i);
      }
    }

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
