/**
 * 🌐 HTTP/SSE Output Adapter — Routes output to connected SSE clients
 * 
 * Wraps the existing AG-UI server to push events to HTTP subscribers.
 * Each write() call emits an AG-UI event to all subscribers on the configured channel.
 */

import { OutputAdapter } from './OutputAdapter.js';

export class HttpSink extends OutputAdapter {
  /**
   * @param {import('../protocols/agui.js').AGUIServer} aguiServer - The AG-UI server instance
   * @param {object} options
   * @param {string} options.channel - AG-UI channel name (default: 'default')
   */
  constructor(aguiServer, options = {}) {
    super();
    this.aguiServer = aguiServer;
    this.channel = options.channel || 'default';
    this._buffer = [];
    this._flushInterval = null;

    // Auto-flush every 100ms for batching
    if (options.autoFlush !== false) {
      this._flushInterval = setInterval(() => this.flush(), 100);
    }
  }

  write(content, metadata = {}) {
    const type = metadata.type || 'text';

    switch (type) {
      case 'text':
      case 'response':
        this.aguiServer.emit({
          type: 'text_message_content',
          data: { content, role: 'assistant' },
        }, this.channel);
        break;

      case 'tool_start':
        this.aguiServer.emit({
          type: 'tool_call_start',
          data: { tool: metadata.tool, args: metadata.args },
        }, this.channel);
        break;

      case 'tool_end':
        this.aguiServer.emit({
          type: 'tool_call_end',
          data: { tool: metadata.tool, result: metadata.result, success: metadata.success },
        }, this.channel);
        break;

      case 'error':
        this.aguiServer.emit({
          type: 'run_error',
          data: { error: content },
        }, this.channel);
        break;

      case 'status':
        this.aguiServer.emit({
          type: 'state_delta',
          data: { status: content, ...metadata },
        }, this.channel);
        break;

      default:
        this.aguiServer.emit({
          type: 'text_message_content',
          data: { content, role: 'system' },
        }, this.channel);
    }
  }

  writeEvent(eventType, data = {}) {
    this.aguiServer.emit({ type: eventType, data }, this.channel);
  }

  async flush() {
    // AG-UI emits immediately, no buffering needed
  }

  async close() {
    if (this._flushInterval) {
      clearInterval(this._flushInterval);
      this._flushInterval = null;
    }
  }

  get channelType() {
    return 'http';
  }
}

export default HttpSink;
