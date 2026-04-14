/**
 * 🔀 Channel Router — Maps incoming messages to AgentSession instances
 * 
 * Accepts messages from multiple ChannelAdapters, routes them to the appropriate
 * session (creating one if needed via SessionPool), and sends responses back
 * through the originating channel.
 */

import { EventEmitter } from 'events';
import { SessionPool } from './SessionPool.js';

export class ChannelRouter extends EventEmitter {
  /**
   * @param {object} options
   * @param {SessionPool} options.sessionPool - Session pool for managing AgentSession instances
   * @param {object} options.sessionDefaults - Default options for new sessions
   * @param {function} options.onTaskStart - Called when a task starts (for logging/UI)
   * @param {function} options.onTaskEnd - Called when a task ends
   */
  constructor(options = {}) {
    super();
    this.sessionPool = options.sessionPool || new SessionPool(options.poolOptions || {});
    this.sessionDefaults = options.sessionDefaults || {};
    this.onTaskStart = options.onTaskStart || null;
    this.onTaskEnd = options.onTaskEnd || null;

    /** @type {Map<string, import('./ChannelAdapter.js').ChannelAdapter>} */
    this.channels = new Map();

    /** @type {Map<string, {channelName: string, targetId: string}>} */
    this.sessionRoutes = new Map(); // sessionKey → origin info for response routing

    this._running = false;
  }

  /**
   * Register a channel adapter
   * @param {import('./ChannelAdapter.js').ChannelAdapter} adapter
   */
  registerChannel(adapter) {
    this.channels.set(adapter.name, adapter);

    // Listen for incoming messages from this channel
    adapter.onMessage(async (message) => {
      await this._handleIncoming(adapter.name, message);
    });
  }

  /**
   * Remove a channel adapter
   * @param {string} channelName
   */
  async removeChannel(channelName) {
    const adapter = this.channels.get(channelName);
    if (adapter) {
      await adapter.stop();
      this.channels.delete(channelName);
    }
  }

  /**
   * Start all registered channels and the session pool
   */
  async start() {
    this.sessionPool.start();
    this._running = true;

    for (const [name, adapter] of this.channels) {
      try {
        await adapter.start();
        this.emit('channel_started', name);
      } catch (error) {
        this.emit('channel_error', { name, error: error.message });
      }
    }
  }

  /**
   * Stop all channels and the session pool
   */
  async stop() {
    this._running = false;

    for (const [, adapter] of this.channels) {
      try {
        await adapter.stop();
      } catch { /* ignore */ }
    }

    await this.sessionPool.stop();
  }

  /**
   * Handle an incoming message from any channel
   * @private
   */
  async _handleIncoming(channelName, message) {
    const { targetId, content, metadata } = message;

    // Build a session key from channel + target
    const sessionKey = `${channelName}:${targetId}`;

    // Store the route so we know where to send responses
    this.sessionRoutes.set(sessionKey, { channelName, targetId });

    // Get or create a session for this conversation
    const { session, created } = await this.sessionPool.getOrCreate(sessionKey, {
      ...this.sessionDefaults,
      channelContext: { type: channelName, id: targetId },
    });

    if (created) {
      this.emit('session_created', { sessionKey, channelName, targetId });
    }

    // Notify task start
    if (this.onTaskStart) {
      this.onTaskStart({ sessionKey, channelName, targetId, content });
    }
    this.emit('task_start', { sessionKey, channelName, targetId });

    try {
      // Run the agent task
      const result = await session.run(content);

      // Extract the response text
      const responseText = result?.response || result?.content || 'Task completed.';

      // Route response back through the originating channel
      const adapter = this.channels.get(channelName);
      if (adapter) {
        await adapter.sendMessage(targetId, responseText, {
          sessionId: session.sessionId,
          ...metadata,
        });
      }

      // Notify task end
      if (this.onTaskEnd) {
        this.onTaskEnd({ sessionKey, channelName, targetId, success: true, result });
      }
      this.emit('task_end', { sessionKey, channelName, targetId, success: true });

    } catch (error) {
      // Send error back through the channel
      const adapter = this.channels.get(channelName);
      if (adapter) {
        await adapter.sendMessage(targetId, `Error: ${error.message}`, {
          type: 'error',
          sessionId: session.sessionId,
        });
      }

      if (this.onTaskEnd) {
        this.onTaskEnd({ sessionKey, channelName, targetId, success: false, error: error.message });
      }
      this.emit('task_end', { sessionKey, channelName, targetId, success: false, error: error.message });
    }
  }

  /**
   * Get router status
   */
  getStatus() {
    const channelStatus = {};
    for (const [name, adapter] of this.channels) {
      channelStatus[name] = adapter.getInfo();
    }

    return {
      running: this._running,
      channels: channelStatus,
      sessions: this.sessionPool.getStats(),
      activeRoutes: this.sessionRoutes.size,
    };
  }

  /**
   * List all registered channel names
   * @returns {string[]}
   */
  getChannelNames() {
    return [...this.channels.keys()];
  }
}

export default ChannelRouter;
