/**
 * 📊 Outcome Tracker — Records per-invocation success/failure metrics
 * 
 * Tracks outcomes for skills, specializations, and task types to enable
 * self-improvement (Hermes-style learning loop).
 * 
 * Persists to .openagent/outcomes.json for cross-session learning.
 */

import fs from 'fs-extra';
import path from 'path';
import { CONFIG } from '../config.js';

export class OutcomeTracker {
  /**
   * @param {object} options
   * @param {string} options.outcomesDir - Directory to store outcomes (default: OPENAGENT_HOME)
   */
  constructor(options = {}) {
    this.outcomesDir = options.outcomesDir || CONFIG.OPENAGENT_HOME || path.join(
      process.env.HOME || process.env.USERPROFILE || '/tmp', '.openagent'
    );
    this.outcomesFile = path.join(this.outcomesDir, 'outcomes.json');
    this.lessonsFile = path.join(this.outcomesDir, 'lessons.json');

    /** @type {OutcomeRecord[]} */
    this._buffer = [];
    this._flushThreshold = 5; // Flush after N records
    this._loaded = false;

    /** @type {OutcomeRecord[]} */
    this.records = [];

    /** @type {Lesson[]} */
    this.lessons = [];
  }

  /**
   * Load existing outcomes from disk
   */
  async load() {
    if (this._loaded) return;

    try {
      if (await fs.pathExists(this.outcomesFile)) {
        const data = await fs.readJson(this.outcomesFile);
        this.records = Array.isArray(data.records) ? data.records : [];
      }
    } catch {
      this.records = [];
    }

    try {
      if (await fs.pathExists(this.lessonsFile)) {
        this.lessons = await fs.readJson(this.lessonsFile);
      }
    } catch {
      this.lessons = [];
    }

    this._loaded = true;
  }

  /**
   * Record a task outcome
   * @param {object} outcome
   * @param {string} outcome.skill - Skill name (e.g., 'code-review', 'debug')
   * @param {string} outcome.specialization - Subagent specialization (e.g., 'coder', 'researcher')
   * @param {string} outcome.taskType - Task category (e.g., 'file-edit', 'web-search', 'git-commit')
   * @param {boolean} outcome.success - Whether the task succeeded
   * @param {number} outcome.durationMs - Task duration in milliseconds
   * @param {string} [outcome.errorCategory] - Error category if failed
   * @param {string} [outcome.errorMessage] - Error message if failed
   * @param {string} [outcome.taskSummary] - Brief description of the task
   * @param {object} [outcome.metadata] - Additional metadata
   */
  async record(outcome) {
    const record = {
      timestamp: new Date().toISOString(),
      skill: outcome.skill || 'none',
      specialization: outcome.specialization || 'general',
      taskType: outcome.taskType || 'unknown',
      success: outcome.success,
      durationMs: outcome.durationMs || 0,
      errorCategory: outcome.errorCategory || null,
      errorMessage: outcome.errorMessage || null,
      taskSummary: (outcome.taskSummary || '').slice(0, 200),
      metadata: outcome.metadata || {},
    };

    this._buffer.push(record);
    this.records.push(record);

    // Auto-flush when buffer is full
    if (this._buffer.length >= this._flushThreshold) {
      await this.flush();
    }
  }

  /**
   * Flush buffered records to disk
   */
  async flush() {
    if (this._buffer.length === 0) return;

    try {
      await fs.ensureDir(this.outcomesDir);

      // Keep last 10000 records to prevent unbounded growth
      const allRecords = this.records.slice(-10000);
      await fs.writeJson(this.outcomesFile, {
        records: allRecords,
        lastUpdated: new Date().toISOString(),
      }, { spaces: 2 });

      this._buffer = [];
    } catch (error) {
      // Non-critical — don't crash the agent
      console.warn(`[OutcomeTracker] Failed to flush: ${error.message}`);
    }
  }

  /**
   * Get success rate for a specific skill
   * @param {string} skillName
   * @param {number} [lastN] - Only consider last N records (default: all)
   * @returns {{ total: number, success: number, failure: number, rate: number, avgDurationMs: number }}
   */
  getSkillStats(skillName, lastN) {
    const records = this._filterRecords({ skill: skillName }, lastN);
    return this._computeStats(records);
  }

  /**
   * Get success rate for a specific specialization
   * @param {string} specialization
   * @param {number} [lastN]
   */
  getSpecializationStats(specialization, lastN) {
    const records = this._filterRecords({ specialization }, lastN);
    return this._computeStats(records);
  }

  /**
   * Get success rate for a specific task type
   * @param {string} taskType
   * @param {number} [lastN]
   */
  getTaskTypeStats(taskType, lastN) {
    const records = this._filterRecords({ taskType }, lastN);
    return this._computeStats(records);
  }

  /**
   * Get the top failure patterns (error categories that recur)
   * @param {number} limit - Max patterns to return
   * @returns {Array<{category: string, count: number, examples: string[]}>}
   */
  getTopFailurePatterns(limit = 5) {
    const failures = this.records.filter(r => !r.success && r.errorCategory);
    const byCategory = {};

    for (const f of failures) {
      if (!byCategory[f.errorCategory]) {
        byCategory[f.errorCategory] = { category: f.errorCategory, count: 0, examples: [] };
      }
      byCategory[f.errorCategory].count++;
      if (byCategory[f.errorCategory].examples.length < 3) {
        byCategory[f.errorCategory].examples.push(f.errorMessage || f.taskSummary);
      }
    }

    return Object.values(byCategory)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get recommended specialization for a task type based on historical performance
   * @param {string} taskType
   * @returns {string|null} - Best specialization or null if no data
   */
  getBestSpecialization(taskType) {
    const records = this._filterRecords({ taskType });
    const bySpec = {};

    for (const r of records) {
      if (!bySpec[r.specialization]) {
        bySpec[r.specialization] = { total: 0, success: 0 };
      }
      bySpec[r.specialization].total++;
      if (r.success) bySpec[r.specialization].success++;
    }

    let best = null;
    let bestRate = 0;

    for (const [spec, stats] of Object.entries(bySpec)) {
      if (stats.total < 3) continue; // Need minimum data
      const rate = stats.success / stats.total;
      if (rate > bestRate) {
        bestRate = rate;
        best = spec;
      }
    }

    return best;
  }

  /**
   * Generate a lessons summary for injection into system prompts
   * @param {object} context - Current task context
   * @param {string} [context.skill] - Active skill
   * @param {string} [context.specialization] - Active specialization
   * @returns {string} - Formatted lessons text
   */
  getLessonsForPrompt(context = {}) {
    const lines = [];

    // Skill-specific lessons
    if (context.skill && context.skill !== 'none') {
      const stats = this.getSkillStats(context.skill, 50);
      if (stats.total >= 5) {
        const rate = Math.round(stats.rate * 100);
        lines.push(`## Skill History: ${context.skill}`);
        lines.push(`- Success rate: ${rate}% (${stats.success}/${stats.total} tasks)`);
        lines.push(`- Avg duration: ${Math.round(stats.avgDurationMs / 1000)}s`);

        if (stats.rate < 0.7) {
          const patterns = this.getTopFailurePatterns(3);
          if (patterns.length > 0) {
            lines.push('- Common failures:');
            for (const p of patterns) {
              lines.push(`  - ${p.category}: ${p.count} occurrences`);
            }
          }
        }
      }
    }

    // Specialization-specific lessons
    if (context.specialization) {
      const stats = this.getSpecializationStats(context.specialization, 50);
      if (stats.total >= 5) {
        const rate = Math.round(stats.rate * 100);
        lines.push(`## Specialization History: ${context.specialization}`);
        lines.push(`- Success rate: ${rate}% (${stats.success}/${stats.total} tasks)`);
      }
    }

    // General lessons from persistent store
    if (this.lessons.length > 0) {
      lines.push('## Learned Lessons');
      for (const lesson of this.lessons.slice(-5)) {
        lines.push(`- ${lesson.text}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Add a persistent lesson (survives across sessions)
   * @param {string} text - Lesson text
   * @param {object} [metadata] - Optional metadata
   */
  async addLesson(text, metadata = {}) {
    const lesson = {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text,
      timestamp: new Date().toISOString(),
      ...metadata,
    };

    this.lessons.push(lesson);

    // Keep last 100 lessons
    if (this.lessons.length > 100) {
      this.lessons = this.lessons.slice(-100);
    }

    try {
      await fs.ensureDir(this.outcomesDir);
      await fs.writeJson(this.lessonsFile, this.lessons, { spaces: 2 });
    } catch (error) {
      console.warn(`[OutcomeTracker] Failed to save lesson: ${error.message}`);
    }
  }

  /**
   * Get overall stats summary
   */
  getSummary() {
    const stats = this._computeStats(this.records);
    const topFailures = this.getTopFailurePatterns(3);

    return {
      ...stats,
      topFailures,
      lessonsCount: this.lessons.length,
      recordsFile: this.outcomesFile,
    };
  }

  // ── Private helpers ──────────────────────────────────────────

  _filterRecords(filters, lastN) {
    let records = this.records;

    if (filters.skill) records = records.filter(r => r.skill === filters.skill);
    if (filters.specialization) records = records.filter(r => r.specialization === filters.specialization);
    if (filters.taskType) records = records.filter(r => r.taskType === filters.taskType);

    if (lastN && lastN > 0) {
      records = records.slice(-lastN);
    }

    return records;
  }

  _computeStats(records) {
    const total = records.length;
    const success = records.filter(r => r.success).length;
    const failure = total - success;
    const rate = total > 0 ? success / total : 0;
    const totalDuration = records.reduce((sum, r) => sum + (r.durationMs || 0), 0);
    const avgDurationMs = total > 0 ? totalDuration / total : 0;

    return { total, success, failure, rate, avgDurationMs };
  }
}

/**
 * @typedef {object} OutcomeRecord
 * @property {string} timestamp
 * @property {string} skill
 * @property {string} specialization
 * @property {string} taskType
 * @property {boolean} success
 * @property {number} durationMs
 * @property {string|null} errorCategory
 * @property {string|null} errorMessage
 * @property {string} taskSummary
 * @property {object} metadata
 */

/**
 * @typedef {object} Lesson
 * @property {string} id
 * @property {string} text
 * @property {string} timestamp
 */

export default OutcomeTracker;
