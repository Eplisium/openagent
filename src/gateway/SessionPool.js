/**
 * 🏊 Session Pool — Manages concurrent AgentSession instances
 * 
 * Provides LRU eviction, timeout-based cleanup, and max session limits
 * for the gateway daemon mode.
 */

import { AgentSession } from '../agent/AgentSession.js';

export class SessionPool {
  /**
   * @param {object} options
   * @param {number} options.maxSessions - Maximum concurrent sessions (default: 10)
   * @param {number} options.sessionTimeoutMs - Session idle timeout in ms (default: 30 min)
   * @param {number} options.cleanupIntervalMs - How often to check for stale sessions (default: 60s)
   * @param {object} options.sessionDefaults - Default options for new AgentSession instances
   */
  constructor(options = {}) {
    this.maxSessions = options.maxSessions || 10;
    this.sessionTimeoutMs = options.sessionTimeoutMs || 30 * 60 * 1000;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60 * 1000;
    this.sessionDefaults = options.sessionDefaults || {};

    /** @type {Map<string, {session: AgentSession, lastUsed: number, created: number}>} */
    this.sessions = new Map();
    this._cleanupTimer = null;
    this._stats = { created: 0, evicted: 0, hits: 0, misses: 0 };
  }

  /**
   * Start the cleanup timer
   */
  start() {
    if (this._cleanupTimer) return;
    this._cleanupTimer = setInterval(() => this._cleanup(), this.cleanupIntervalMs);
    // Don't prevent process exit
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  /**
   * Stop the cleanup timer and close all sessions
   */
  async stop() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    for (const [, entry] of this.sessions) {
      try {
        if (entry.session.agent) entry.session.agent.abort();
        if (entry.session.subagentManager) entry.session.subagentManager.abort();
      } catch { /* ignore */ }
    }
    this.sessions.clear();
  }

  /**
   * Get or create a session for the given key
   * @param {string} sessionKey - Unique key (e.g., "discord:channel123" or "http:req-abc")
   * @param {object} sessionOptions - Options passed to AgentSession constructor if creating
   * @returns {Promise<{session: AgentSession, created: boolean}>}
   */
  async getOrCreate(sessionKey, sessionOptions = {}) {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      existing.lastUsed = Date.now();
      this._stats.hits++;
      return { session: existing.session, created: false };
    }

    this._stats.misses++;

    // Evict LRU if at capacity
    if (this.sessions.size >= this.maxSessions) {
      this._evictLRU();
    }

    // Create new session
    const session = new AgentSession({
      ...this.sessionDefaults,
      ...sessionOptions,
    });

    this.sessions.set(sessionKey, {
      session,
      lastUsed: Date.now(),
      created: Date.now(),
    });
    this._stats.created++;

    return { session, created: true };
  }

  /**
   * Get an existing session by key
   * @param {string} sessionKey
   * @returns {AgentSession|null}
   */
  get(sessionKey) {
    const entry = this.sessions.get(sessionKey);
    if (entry) {
      entry.lastUsed = Date.now();
      this._stats.hits++;
      return entry.session;
    }
    this._stats.misses++;
    return null;
  }

  /**
   * Remove a specific session
   * @param {string} sessionKey
   */
  async remove(sessionKey) {
    const entry = this.sessions.get(sessionKey);
    if (entry) {
      try {
        if (entry.session.agent) entry.session.agent.abort();
        if (entry.session.subagentManager) entry.session.subagentManager.abort();
      } catch { /* ignore */ }
      this.sessions.delete(sessionKey);
    }
  }

  /**
   * List all active session keys
   * @returns {string[]}
   */
  keys() {
    return [...this.sessions.keys()];
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      ...this._stats,
      activeSessions: this.sessions.size,
      maxSessions: this.maxSessions,
    };
  }

  /**
   * Evict the least recently used session
   */
  _evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.sessions) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.sessions.get(oldestKey);
      try {
        if (entry?.session.agent) entry.session.agent.abort();
        if (entry?.session.subagentManager) entry.session.subagentManager.abort();
      } catch { /* ignore */ }
      this.sessions.delete(oldestKey);
      this._stats.evicted++;
    }
  }

  /**
   * Clean up stale sessions that have exceeded the timeout
   */
  _cleanup() {
    const now = Date.now();
    const toRemove = [];

    for (const [key, entry] of this.sessions) {
      if (now - entry.lastUsed > this.sessionTimeoutMs) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const entry = this.sessions.get(key);
      try {
        if (entry?.session.agent) entry.session.agent.abort();
        if (entry?.session.subagentManager) entry.session.subagentManager.abort();
      } catch { /* ignore */ }
      this.sessions.delete(key);
      this._stats.evicted++;
    }
  }
}

export default SessionPool;
