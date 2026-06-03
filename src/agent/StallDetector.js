/**
 * StallDetector — stall/dead-end/monotony detection for the Agent loop.
 *
 * Extracted from Agent.js to keep the main agent class focused on orchestration.
 * All methods read/write state on the owning Agent instance via `this.agent`.
 */

export class StallDetector {
  /**
   * @param {import('./Agent.js').Agent} agent – the owning Agent instance
   */
  constructor(agent) {
    this.agent = agent;
  }

  // ── Stall Detection ────────────────────────────────────────────────

  /**
   * Generic stall: the same tool workflow (name + target file) has been
   * repeated for `maxStallIterations` rounds without change.
   */
  hasStalled() {
    const a = this.agent;
    const limit = a._resolveBudgetValue('maxStallIterations', a.maxStallIterations);
    return a.repeatedToolRoundCount >= limit;
  }

  /**
   * File-level stall: the agent is cycling read → edit → read → edit
   * on the same file(s) without making meaningful progress.  Catches the
   * common pattern where the model keeps re-reading a file it just edited
   * with slightly different line ranges.
   *
   * @returns {string|false} The stalled file path, or false.
   */
  hasFileStalled() {
    const a = this.agent;
    if (a.fileOperationHistory.length < 4) return false;

    const recentOps = a.fileOperationHistory.slice(-a.maxFileStall * 2);
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

    for (const file of Object.keys(fileEditCounts)) {
      const edits = fileEditCounts[file] || 0;
      const reads = fileReadCounts[file] || 0;
      if (edits >= a.maxFileStall / 2 && reads >= a.maxFileStall / 2) {
        return file;
      }
    }
    return false;
  }

  /**
   * Detect tool-name pattern stall: the agent is repeating the same
   * sequence of tool names (e.g., read_file → edit_file) across rounds,
   * even though the exact arguments differ.
   *
   * @returns {string|false} The repeating pattern description, or false.
   */
  hasPatternStalled() {
    const a = this.agent;
    const history = a.roundToolNameHistory;
    if (history.length < 4) return false;

    const recent = history.slice(-a.maxPatternStall);
    if (recent.length < 4) return false;

    for (const patternLen of [1, 2]) {
      if (recent.length < patternLen * 3) continue;
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
   * No-progress: consecutive iterations where every tool call failed.
   *
   * @returns {boolean}
   */
  hasNoProgress() {
    const a = this.agent;
    return a.iterationsWithoutProgress >= a.maxNoProgressIterations;
  }

  /**
   * Dead-end: the agent has tried multiple different approaches but keeps
   * hitting the same error category (>60% of recent errors).
   *
   * @returns {string|null} The dominant error category, or null.
   */
  hasDeadEnded() {
    const a = this.agent;
    if (a.recentErrorCategories.length < 5) return null;

    const window = a.recentErrorCategories.slice(-a.maxDeadEndWindow);
    const counts = {};
    for (const cat of window) {
      counts[cat] = (counts[cat] || 0) + 1;
    }

    const dominant = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
    if (!dominant || dominant[1] < Math.ceil(window.length * 0.6)) {
      return null;
    }

    // Guard: if overall success rate is high, don't dead-end
    const totalTools = a.successfulToolCalls + a.failedToolCalls;
    if (totalTools > 0) {
      const successRate = a.successfulToolCalls / totalTools;
      if (successRate > 0.70) {
        return null;
      }
    }

    // Guard: non-dead-end categories — these are fixable, not systemic
    const nonDeadEndCategories = [
      'VALIDATION_ERROR',
      'NOT_GIT_REPO',
      'NETWORK',
      'RATE_LIMIT',
      'PARSE_ERROR',
      'AUTH',
      'SANITIZED',
    ];
    if (nonDeadEndCategories.includes(dominant[0])) {
      return null;
    }

    return dominant[0];
  }

  /**
   * Tool-type monotony: the agent is only reading, only editing, or only
   * executing without mixing.
   *
   * @returns {string|null} A description of the monotony, or null.
   */
  hasToolTypeMonotony() {
    const a = this.agent;
    if (a.toolTypeHistory.length < 3) return null;

    const recent = a.toolTypeHistory.slice(-a.maxDiversityWindow);
    const totals = { read: 0, write: 0, exec: 0, other: 0 };
    for (const entry of recent) {
      totals.read += entry.readCount;
      totals.write += entry.writeCount;
      totals.exec += entry.execCount;
      totals.other += entry.otherCount;
    }

    const total = totals.read + totals.write + totals.exec + totals.other;
    if (total === 0) return null;

    if (totals.read > 0 && totals.write === 0 && totals.exec === 0 && recent.length >= 4) {
      return 'read-only loop — agent is only reading files without making changes';
    }

    if (totals.write > 0 && totals.read === 0 && totals.exec === 0 && recent.length >= 4) {
      return 'write-only loop — agent is only editing files without reading them first';
    }

    if (totals.exec > 0 && totals.read === 0 && totals.write === 0 && recent.length >= 5) {
      return 'exec-only loop — agent is only running shell commands without other actions';
    }

    return null;
  }

  // ── Recording Helpers ──────────────────────────────────────────────

  /**
   * Record a file operation for stall tracking.
   * Called from postToolIteration after tool calls are processed.
   */
  recordFileOperations(toolCalls) {
    const a = this.agent;
    for (const tc of toolCalls) {
      const name = tc.name;
      if (name !== 'read_file' && name !== 'edit_file' && name !== 'write_file') continue;
      const args = tc.arguments || {};
      const filePath = args.path || args.filePath || args.file || null;
      if (filePath) {
        a.fileOperationHistory.push({
          toolName: name,
          filePath: String(filePath).replace(/\\/g, '/'),
          iteration: a.iterationCount,
        });
        if (a.fileOperationHistory.length > 100) {
          a.fileOperationHistory = a.fileOperationHistory.slice(-50);
        }
      }
    }
  }

  /**
   * Classify a round of tool calls by type for diversity tracking.
   * Called from postToolIteration.
   */
  recordToolTypeRound(toolCalls) {
    const a = this.agent;
    const counts = { readCount: 0, writeCount: 0, execCount: 0, otherCount: 0 };
    const readTools = new Set(['read_file', 'read_files', 'list_directory', 'file_tree', 'search_files', 'search_in_files', 'get_file_info']);
    const writeTools = new Set(['write_file', 'edit_file', 'search_and_replace', 'create_file']);
    const execTools = new Set(['exec', 'process', 'process_action']);

    for (const tc of toolCalls) {
      if (readTools.has(tc.name)) counts.readCount++;
      else if (writeTools.has(tc.name)) counts.writeCount++;
      else if (execTools.has(tc.name)) counts.execCount++;
      else counts.otherCount++;
    }

    a.toolTypeHistory.push({ iteration: a.iterationCount, ...counts });
    if (a.toolTypeHistory.length > 50) {
      a.toolTypeHistory = a.toolTypeHistory.slice(-25);
    }
  }

  /**
   * Assess overall progress for a richer stop message.
   */
  assessProgress(runHistory) {
    const a = this.agent;
    const totalTools = a.successfulToolCalls + a.failedToolCalls;
    const successRate = totalTools > 0 ? Math.round((a.successfulToolCalls / totalTools) * 100) : 0;
    const uniqueTools = new Set();
    for (const entry of runHistory) {
      for (const t of entry.toolCalls || []) uniqueTools.add(t);
    }

    return {
      totalIterations: a.iterationCount,
      totalToolCalls: totalTools,
      successfulToolCalls: a.successfulToolCalls,
      failedToolCalls: a.failedToolCalls,
      successRate,
      uniqueToolsUsed: [...uniqueTools],
      stallDetected: this.hasStalled(),
      fileStall: this.hasFileStalled(),
      patternStall: this.hasPatternStalled(),
      noProgress: this.hasNoProgress(),
      deadEnd: this.hasDeadEnded(),
      monotony: this.hasToolTypeMonotony(),
    };
  }
}

export default StallDetector;
