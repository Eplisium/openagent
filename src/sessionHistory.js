/**
 * 📋 Session History — lightweight conversation history with full-text search
 * Uses append-only JSON-lines format for zero-corruption durability.
 * No external dependencies — uses fs-compat for all I/O.
 */

import fs from './utils/fs-compat.js';
import path from 'path';
import os from 'os';

const MAX_HISTORY_FILES = 50;
const MAX_RESULTS = 20;

function getHistoryDir() {
  return path.join(os.homedir(), '.openagent', 'history');
}

export class SessionHistory {
  constructor(options = {}) {
    this.historyDir = options.historyDir || getHistoryDir();
    this.currentSessionId = options.sessionId || new Date().toISOString().replace(/[:.]/g, '-');
    this.buffer = [];
    this._flushed = false;
  }

  async ensureDir() {
    await fs.ensureDir(this.historyDir);
  }

  /**
   * Record a conversation turn
   */
  async recordTurn({ userMessage, assistantResponse, model, toolCalls = [], metadata = {} }) {
    const entry = {
      timestamp: new Date().toISOString(),
      sessionId: this.currentSessionId,
      userMessage: typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage),
      assistantResponse: typeof assistantResponse === 'string' ? assistantResponse : '',
      model: model || 'unknown',
      toolCalls: (toolCalls || []).map(t => ({ name: t.name || t.toolName, args: t.arguments })),
      metadata,
    };
    this.buffer.push(entry);
    return entry;
  }

  /**
   * Flush buffered entries to disk (append to JSON-lines file)
   */
  async flush() {
    if (this.buffer.length === 0) return;
    await this.ensureDir();
    const filePath = path.join(this.historyDir, `${this.currentSessionId}.jsonl`);
    const lines = this.buffer.map(e => JSON.stringify(e)).join('\n') + '\n';
    try {
      await fs.appendFile(filePath, lines, 'utf-8');
    } catch {
      try {
        await fs.writeFile(filePath, lines, 'utf-8');
      } catch { /* silent */ }
    }
    this.buffer = [];
    this._flushed = true;
  }

  /**
   * Search past sessions for matching text
   */
  async search(query, options = {}) {
    const maxResults = options.maxResults || MAX_RESULTS;
    await this.ensureDir();

    if (this.buffer.length > 0) {
      await this.flush();
    }

    const results = [];
    let files;
    try {
      files = await fs.readdir(this.historyDir);
    } catch {
      return { success: true, results: [], totalMatches: 0 };
    }

    files = files.filter(f => f.endsWith('.jsonl')).sort().reverse();
    const scanFiles = files.slice(0, MAX_HISTORY_FILES);
    const lowerQuery = query.toLowerCase();

    for (const file of scanFiles) {
      let content;
      try {
        content = await fs.readFile(path.join(this.historyDir, file), 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n').filter(Boolean);
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          const searchable = [
            entry.userMessage || '',
            entry.assistantResponse || '',
            (entry.toolCalls || []).map(t => t.name).join(' '),
          ].join(' ').toLowerCase();

          if (searchable.includes(lowerQuery)) {
            results.push({
              sessionId: entry.sessionId,
              timestamp: entry.timestamp,
              userMessage: (entry.userMessage || '').slice(0, 200),
              assistantResponse: (entry.assistantResponse || '').slice(0, 300),
              model: entry.model,
              toolCalls: (entry.toolCalls || []).map(t => t.name),
            });
          }
        } catch {
          continue;
        }
      }
    }

    return {
      success: true,
      query,
      results,
      totalMatches: results.length,
      truncated: results.length >= maxResults,
    };
  }

  /**
   * List recent sessions with summary info
   */
  async listSessions(options = {}) {
    const limit = options.limit || 20;
    await this.ensureDir();
    let files;
    try {
      files = await fs.readdir(this.historyDir);
    } catch {
      return { success: true, sessions: [] };
    }

    files = files.filter(f => f.endsWith('.jsonl')).sort().reverse().slice(0, limit);
    const sessions = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(this.historyDir, file), 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const firstEntry = lines[0] ? JSON.parse(lines[0]) : null;
        const lastEntry = lines[lines.length - 1] ? JSON.parse(lines[lines.length - 1]) : null;

        sessions.push({
          sessionId: file.replace('.jsonl', ''),
          date: (firstEntry?.timestamp || '').split('T')[0],
          turnCount: lines.length,
          firstMessage: (firstEntry?.userMessage || '').slice(0, 100),
          lastMessage: (lastEntry?.userMessage || '').slice(0, 100),
          model: firstEntry?.model || 'unknown',
        });
      } catch {
        continue;
      }
    }

    return { success: true, sessions };
  }

  /**
   * Clean up old sessions beyond maxSessions
   */
  async cleanup(maxSessions = 100) {
    await this.ensureDir();
    let files;
    try {
      files = await fs.readdir(this.historyDir);
    } catch {
      return { deleted: 0 };
    }

    files = files.filter(f => f.endsWith('.jsonl')).sort();
    let deleted = 0;
    while (files.length > maxSessions) {
      const oldFile = files.shift();
      try {
        await fs.unlink(path.join(this.historyDir, oldFile));
        deleted++;
      } catch { /* silent */ }
    }
    return { deleted };
  }
}

export default SessionHistory;