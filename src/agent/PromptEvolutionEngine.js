/**
 * 🧬 Prompt Evolution Engine — Auto-refines agent prompts from execution outcomes
 * 
 * Analyzes OutcomeTracker data to identify failure patterns and automatically
 * injects corrective guidance into skill/specialization prompts.
 * 
 * This is the core of Hermes-style self-improvement: the agent learns from
 * its own mistakes and gets better over time.
 */

import fs from '../utils/fs-compat.js';
import path from 'path';

export class PromptEvolutionEngine {
  /**
   * @param {import('./OutcomeTracker.js').OutcomeTracker} outcomeTracker
   * @param {object} options
   * @param {string} options.evolutionsDir - Directory to store evolved prompts
   */
  constructor(outcomeTracker, options = {}) {
    this.tracker = outcomeTracker;
    this.evolutionsDir = options.evolutionsDir || path.join(
      process.env.OPENAGENT_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.openagent'),
      'evolutions'
    );
    this.evolutionsFile = path.join(this.evolutionsDir, 'evolutions.json');

    /** @type {Map<string, Evolution>} */
    this.evolutions = new Map();
    this._loaded = false;
  }

  /**
   * Load existing evolutions from disk
   */
  async load() {
    if (this._loaded) return;

    try {
      if (await fs.pathExists(this.evolutionsFile)) {
        const data = await fs.readJson(this.evolutionsFile);
        if (Array.isArray(data)) {
          for (const e of data) {
            this.evolutions.set(e.key, e);
          }
        }
      }
    } catch {
      // Start fresh
    }

    this._loaded = true;
  }

  /**
   * Analyze outcomes and generate prompt augmentations for a specific context
   * @param {object} context
   * @param {string} context.skill - Active skill name
   * @param {string} context.specialization - Active specialization
   * @param {string} context.taskType - Current task type
   * @returns {string} - Prompt augmentation text to inject
   */
  analyze(context = {}) {
    const parts = [];

    // 1. Check for recurring failure patterns
    const failurePatterns = this.tracker.getTopFailurePatterns(5);
    if (failurePatterns.length > 0) {
      const relevant = failurePatterns.filter(p => p.count >= 3);
      if (relevant.length > 0) {
        parts.push('## ⚠️ Known Failure Patterns (from past experience)');
        for (const p of relevant) {
          parts.push(`- **${p.category}** (${p.count} occurrences): Be extra careful with this error type.`);
          if (p.examples.length > 0) {
            parts.push(`  Example: "${p.examples[0].slice(0, 100)}"`);
          }
        }
        parts.push('');
      }
    }

    // 2. Skill-specific evolution
    if (context.skill && context.skill !== 'none') {
      const skillEvolution = this._getEvolution('skill', context.skill);
      if (skillEvolution) {
        parts.push(`## 🧬 Evolved Guidance for ${context.skill}`);
        parts.push(skillEvolution.augmentation);
        parts.push('');
      }

      // Check if this skill is underperforming
      const stats = this.tracker.getSkillStats(context.skill, 30);
      if (stats.total >= 5 && stats.rate < 0.6) {
        parts.push(`## 🔧 Skill Improvement Note`);
        parts.push(`The "${context.skill}" skill has a ${Math.round(stats.rate * 100)}% success rate over the last ${stats.total} tasks.`);
        parts.push('Consider a more careful approach: verify before acting, double-check file paths, and confirm changes.');
        parts.push('');
      }
    }

    // 3. Specialization-specific evolution
    if (context.specialization) {
      const specEvolution = this._getEvolution('spec', context.specialization);
      if (specEvolution) {
        parts.push(`## 🧬 Evolved Guidance for ${context.specialization} role`);
        parts.push(specEvolution.augmentation);
        parts.push('');
      }
    }

    // 4. Task-type recommendations
    if (context.taskType) {
      const bestSpec = this.tracker.getBestSpecialization(context.taskType);
      if (bestSpec && bestSpec !== context.specialization) {
        parts.push(`## 💡 Recommendation`);
        parts.push(`For "${context.taskType}" tasks, the "${bestSpec}" specialization has the best historical success rate.`);
        parts.push('');
      }
    }

    return parts.join('\n');
  }

  /**
   * Record a learning from a completed task and potentially evolve prompts
   * @param {object} context
   * @param {string} context.skill
   * @param {string} context.specialization
   * @param {string} context.taskType
   * @param {boolean} context.success
   * @param {string} [context.failureReason]
   * @param {string} [context.lesson] - What was learned
   */
  async learn(context) {
    // Only evolve on failures or explicit lessons
    if (context.success && !context.lesson) return;

    const key = context.skill && context.skill !== 'none'
      ? `skill:${context.skill}`
      : `spec:${context.specialization || 'general'}`;

    let evolution = this.evolutions.get(key);
    if (!evolution) {
      evolution = {
        key,
        type: context.skill && context.skill !== 'none' ? 'skill' : 'spec',
        name: context.skill || context.specialization || 'general',
        augmentation: '',
        learnings: [],
        version: 0,
        lastUpdated: new Date().toISOString(),
      };
    }

    // Add the new learning
    const learning = {
      text: context.lesson || `Avoid: ${context.failureReason || 'unknown failure'}`,
      timestamp: new Date().toISOString(),
      taskType: context.taskType,
    };

    evolution.learnings.push(learning);

    // Keep last 20 learnings
    if (evolution.learnings.length > 20) {
      evolution.learnings = evolution.learnings.slice(-20);
    }

    // Regenerate augmentation from learnings
    evolution.augmentation = this._buildAugmentation(evolution.learnings);
    evolution.version++;
    evolution.lastUpdated = new Date().toISOString();

    this.evolutions.set(key, evolution);

    // Persist
    await this._save();
  }

  /**
   * Get all evolutions as a summary
   */
  getSummary() {
    const entries = [];
    for (const [key, e] of this.evolutions) {
      entries.push({
        key,
        type: e.type,
        name: e.name,
        version: e.version,
        learningsCount: e.learnings.length,
        lastUpdated: e.lastUpdated,
      });
    }
    return entries;
  }

  // ── Private ──────────────────────────────────────────────────

  _getEvolution(type, name) {
    return this.evolutions.get(`${type}:${name}`);
  }

  _buildAugmentation(learnings) {
    if (learnings.length === 0) return '';

    const lines = ['Lessons from past tasks:'];
    for (const l of learnings.slice(-10)) {
      lines.push(`- ${l.text}`);
    }
    return lines.join('\n');
  }

  async _save() {
    try {
      await fs.ensureDir(this.evolutionsDir);
      const data = [...this.evolutions.values()];
      await fs.writeJson(this.evolutionsFile, data, { spaces: 2 });
    } catch (error) {
      console.warn(`[PromptEvolution] Failed to save: ${error.message}`);
    }
  }
}

/**
 * @typedef {object} Evolution
 * @property {string} key
 * @property {string} type - 'skill' or 'spec'
 * @property {string} name
 * @property {string} augmentation
 * @property {Array<{text: string, timestamp: string, taskType: string}>} learnings
 * @property {number} version
 * @property {string} lastUpdated
 */

export default PromptEvolutionEngine;
