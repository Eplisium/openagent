/**
 * 📤 Output Adapter — Abstract base for routing agent output to different channels
 * 
 * All output from the agent (responses, tool calls, status events) flows through
 * an OutputAdapter. This decouples the agent from the terminal, enabling
 * multi-channel delivery (console, HTTP SSE, WebSocket, Discord, etc.)
 */

export class OutputAdapter {
  /**
   * Write content to the output channel
   * @param {string} content - The text content to output
   * @param {object} metadata - Optional metadata (type, channel, tool info, etc.)
   */
  write(content, _metadata = {}) {
    throw new Error('OutputAdapter.write() must be implemented by subclass');
  }

  /**
   * Write a structured event (tool call start/end, status change, etc.)
   * @param {string} eventType - Event type identifier
   * @param {object} data - Event data payload
   */
  writeEvent(eventType, _data = {}) {
    throw new Error('OutputAdapter.writeEvent() must be implemented by subclass');
  }

  /**
   * Write an error message
   * @param {string} message - Error message
   * @param {object} metadata - Optional error metadata
   */
  writeError(message, metadata = {}) {
    this.write(message, { ...metadata, type: 'error' });
  }

  /**
   * Flush any buffered output
   */
  async flush() {
    // Optional — subclasses can override
  }

  /**
   * Close/cleanup the output adapter
   */
  async close() {
    // Optional — subclasses can override
  }

  /**
   * Get the channel type identifier
   * @returns {string}
   */
  get channelType() {
    return 'abstract';
  }
}

export default OutputAdapter;
