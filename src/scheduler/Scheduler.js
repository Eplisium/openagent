/**
 * ⏰ Scheduler — Cron-based task scheduling for OpenAgent
 * 
 * Supports cron expressions, one-shot delays, and recurring intervals.
 * Scheduled tasks are persisted to disk and survive restarts.
 * 
 * Usage:
 *   scheduler.cron('0 9 * * *', 'Generate daily report');
 *   scheduler.every('6h', 'Check CI status');
 *   scheduler.at('2026-04-14T10:00:00Z', 'Deploy staging');
 */

import fs from '../utils/fs-compat.js';
import path from 'path';
import { EventEmitter } from 'events';

export class Scheduler extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.scheduleFile - Path to persist schedules
   * @param {function} options.executeTask - Function to call when a task fires: (task) => Promise<void>
   */
  constructor(options = {}) {
    super();
    this.scheduleFile = options.scheduleFile || path.join(
      process.env.OPENAGENT_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.openagent'),
      'schedules.json'
    );
    this.executeTask = options.executeTask || (() => Promise.resolve());

    /** @type {Map<string, ScheduledTask>} */
    this.tasks = new Map();
    this._timer = null;
    this._running = false;
  }

  /**
   * Load persisted schedules and start the tick loop
   */
  async start() {
    await this._load();
    this._running = true;
    this._tick();
    // Tick every 30 seconds
    this._timer = setInterval(() => this._tick(), 30000);
    if (this._timer.unref) this._timer.unref();
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Schedule a task with a cron expression
   * @param {string} expression - Cron expression (e.g., '0 9 * * *')
   * @param {string} description - Task description / prompt
   * @param {object} [options] - Additional options
   * @returns {string} Task ID
   */
  cron(expression, description, options = {}) {
    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id,
      type: 'cron',
      expression,
      description,
      channel: options.channel || null,
      model: options.model || null,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: this._nextCronRun(expression),
    };
    this.tasks.set(id, task);
    this._save();
    return id;
  }

  /**
   * Schedule a recurring task at a fixed interval
   * @param {string} interval - Interval string: '30s', '5m', '1h', '2d'
   * @param {string} description - Task description
   * @param {object} [options]
   * @returns {string} Task ID
   */
  every(interval, description, options = {}) {
    const ms = this._parseInterval(interval);
    const id = `every_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id,
      type: 'every',
      intervalMs: ms,
      interval,
      description,
      channel: options.channel || null,
      model: options.model || null,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: Date.now() + ms,
    };
    this.tasks.set(id, task);
    this._save();
    return id;
  }

  /**
   * Schedule a one-shot task at a specific time
   * @param {string|number|Date} when - ISO date string, timestamp, or Date object
   * @param {string} description - Task description
   * @param {object} [options]
   * @returns {string} Task ID
   */
  at(when, description, options = {}) {
    const timestamp = when instanceof Date ? when.getTime() : new Date(when).getTime();
    const id = `at_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id,
      type: 'at',
      timestamp,
      description,
      channel: options.channel || null,
      model: options.model || null,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: timestamp,
    };
    this.tasks.set(id, task);
    this._save();
    return id;
  }

  /**
   * Cancel a scheduled task
   * @param {string} taskId
   */
  cancel(taskId) {
    this.tasks.delete(taskId);
    this._save();
  }

  /**
   * Enable/disable a task
   * @param {string} taskId
   * @param {boolean} enabled
   */
  setEnabled(taskId, enabled) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = enabled;
      this._save();
    }
  }

  /**
   * List all scheduled tasks
   * @returns {ScheduledTask[]}
   */
  list() {
    return [...this.tasks.values()].map(t => ({
      ...t,
      nextRunIn: t.nextRun ? Math.max(0, t.nextRun - Date.now()) : null,
    }));
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: this._running,
      taskCount: this.tasks.size,
      enabledCount: [...this.tasks.values()].filter(t => t.enabled).length,
    };
  }

  // ── Private ──────────────────────────────────────────────────

  _tick() {
    if (!this._running) return;
    const now = Date.now();

    for (const [id, task] of this.tasks) {
      if (!task.enabled) continue;
      if (!task.nextRun || task.nextRun > now) continue;

      // Fire the task
      this._fireTask(task).catch(err => {
        this.emit('error', { taskId: id, error: err.message });
      });

      // Schedule next run
      task.lastRun = now;
      if (task.type === 'at') {
        // One-shot — remove after firing
        this.tasks.delete(id);
      } else if (task.type === 'every') {
        task.nextRun = now + task.intervalMs;
      } else if (task.type === 'cron') {
        task.nextRun = this._nextCronRun(task.expression, now);
      }
    }

    this._save();
  }

  async _fireTask(task) {
    this.emit('task_fired', { id: task.id, description: task.description });
    try {
      await this.executeTask(task);
      this.emit('task_completed', { id: task.id });
    } catch (error) {
      this.emit('task_failed', { id: task.id, error: error.message });
    }
  }

  _parseInterval(str) {
    const match = str.match(/^(\d+)(s|m|h|d)$/);
    if (!match) throw new Error(`Invalid interval: "${str}". Use format: 30s, 5m, 1h, 2d`);
    const val = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return val * multipliers[unit];
  }

  _nextCronRun(expression, from = Date.now()) {
    // Simple cron parser — supports: minute hour dom month dow
    // For production, use a library like 'cron-parser'
    const parts = expression.split(' ');
    if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expression}"`);

    const [min, hour, , , ] = parts;
    const date = new Date(from + 60000); // Start from next minute
    date.setSeconds(0, 0);

    // Simple case: daily at specific time (e.g., "0 9 * * *")
    if (min !== '*' && hour !== '*') {
      const targetMin = parseInt(min, 10);
      const targetHour = parseInt(hour, 10);
      date.setMinutes(targetMin);
      date.setHours(targetHour);

      if (date.getTime() <= from) {
        date.setDate(date.getDate() + 1);
      }

      return date.getTime();
    }

    // Hourly: "0 * * * *"
    if (min !== '*' && hour === '*') {
      date.setMinutes(parseInt(min, 10));
      if (date.getTime() <= from) {
        date.setHours(date.getHours() + 1);
      }
      return date.getTime();
    }

    // Fallback: run in 1 hour
    return from + 3600000;
  }

  async _load() {
    try {
      if (await fs.pathExists(this.scheduleFile)) {
        const data = await fs.readJson(this.scheduleFile);
        if (Array.isArray(data)) {
          for (const t of data) {
            this.tasks.set(t.id, t);
          }
        }
      }
    } catch { /* start fresh */ }
  }

  async _save() {
    try {
      const dir = path.dirname(this.scheduleFile);
      await fs.ensureDir(dir);
      await fs.writeJson(this.scheduleFile, [...this.tasks.values()], { spaces: 2 });
    } catch (error) {
      console.warn(`[Scheduler] Failed to save: ${error.message}`);
    }
  }
}

/**
 * @typedef {object} ScheduledTask
 * @property {string} id
 * @property {string} type - 'cron' | 'every' | 'at'
 * @property {string} description
 * @property {boolean} enabled
 * @property {number|null} nextRun
 * @property {number|null} lastRun
 */

export default Scheduler;
