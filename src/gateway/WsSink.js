/**
 * 🔌 WebSocket Output Adapter — Routes output to connected WebSocket clients
 * 
 * Used by companion apps (desktop/mobile) for real-time bidirectional communication.
 * Supports the CompanionProtocol message format.
 */

import { OutputAdapter } from './OutputAdapter.js';
import { marked } from 'marked';
import { renderMarkdown } from '../cli/markdown.js';

export class WsSink extends OutputAdapter {
  /**
   * @param {object} options
   * @param {Set<import('ws').WebSocket>} options.clients - Connected WebSocket clients
   */
  constructor(options = {}) {
    super();
    this.clients = options.clients || new Set();
  }

  /**
   * Add a WebSocket client
   * @param {import('ws').WebSocket} ws
   */
  addClient(ws, metadata = {}) {
    ws.openAgentFormat = metadata.format || ws.openAgentFormat || 'ansi';
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  /**
   * Remove a WebSocket client
   * @param {import('ws').WebSocket} ws
   */
  removeClient(ws) {
    this.clients.delete(ws);
  }

  write(content, metadata = {}) {
    const type = metadata.type || 'text';
    const wsType = this._mapType(type);
    const renderContent = metadata.content || content;
    this.writeEvent(wsType, { content, ...metadata }, { renderContent });
  }

  writeEvent(eventType, data = {}, options = {}) {
    this._broadcast({
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
    });
    const renderContent = options.renderContent ?? data.content ?? data.delta;
    if ((eventType === 'content_delta' || eventType === 'response') && renderContent) {
      this.writeRender(renderContent, data);
    }
  }

  _mapType(type) {
    switch (type) {
      case 'text':
      case 'response':
        return 'response';
      case 'tool_start':
      case 'tool_end':
      case 'error':
      case 'file_change':
      case 'tool_progress':
        return type;
      case 'status':
        return 'state';
      default:
        return 'event';
    }
  }

  writeRender(content, metadata = {}) {
    const timestamp = new Date().toISOString();
    for (const client of this.clients) {
      try {
        if (client.readyState !== 1) continue;
        const format = client.openAgentFormat || 'ansi';
        const rendered = format === 'html'
          ? marked.parse(String(content || ''))
          : renderMarkdown(String(content || ''));
        client.send(JSON.stringify({
          type: 'render',
          data: {
            content,
            rendered,
            format,
            role: metadata.message_role || metadata.role || 'assistant',
          },
          timestamp,
        }));
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Broadcast a message to all connected clients
   * @param {object} message
   */
  _broadcast(message) {
    const payload = JSON.stringify(message);
    const dead = [];

    for (const client of this.clients) {
      try {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(payload);
        } else {
          dead.push(client);
        }
      } catch {
        dead.push(client);
      }
    }

    // Clean up dead connections
    for (const client of dead) {
      this.clients.delete(client);
    }
  }

  get clientCount() {
    return this.clients.size;
  }

  async close() {
    for (const client of this.clients) {
      try { client.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  get channelType() {
    return 'websocket';
  }
}

export default WsSink;
