/**
 * 📡 Channel Adapter — Abstract base for pluggable input/output channels
 * 
 * Each channel (Discord, Slack, Telegram, HTTP, CLI) implements this interface.
 * The ChannelRouter uses adapters to accept messages from multiple sources
 * and route responses back to the originating channel.
 */

import { EventEmitter } from 'events';

export class ChannelAdapter extends EventEmitter {
  /**
   * @param {string} name - Channel name (e.g., 'discord', 'slack', 'http')
   * @param {object} config - Channel-specific configuration
   */
  constructor(name, config = {}) {
    super();
    this.name = name;
    this.config = config;
    this._running = false;
  }

  /**
   * Start the channel (connect to service, bind port, etc.)
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error(`ChannelAdapter[${this.name}].start() must be implemented by subclass`);
  }

  /**
   * Stop the channel (disconnect, unbind, cleanup)
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error(`ChannelAdapter[${this.name}].stop() must be implemented by subclass`);
  }

  /**
   * Send a message back through this channel
   * @param {string} targetId - Channel-specific target (user ID, channel ID, conversation ID)
   * @param {string} content - Message content
   * @param {object} metadata - Optional metadata
   * @returns {Promise<void>}
   */
  async sendMessage(targetId, content, _metadata = {}) {
    throw new Error(`ChannelAdapter[${this.name}].sendMessage() must be implemented by subclass`);
  }

  /**
   * Register a handler for incoming messages
   * The handler receives: { channelName, targetId, content, metadata }
   * @param {function} handler
   */
  onMessage(handler) {
    this.on('message', handler);
  }

  /**
   * Emit an incoming message (called by subclass implementations)
   * @param {object} message - { targetId, content, metadata }
   */
  _emitMessage(message) {
    this.emit('message', {
      channelName: this.name,
      targetId: message.targetId,
      content: message.content,
      metadata: message.metadata || {},
    });
  }

  /**
   * Check if the channel is running
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Get channel info for status display
   * @returns {object}
   */
  getInfo() {
    return {
      name: this.name,
      running: this._running,
      type: this.constructor.name,
    };
  }
}

export default ChannelAdapter;
