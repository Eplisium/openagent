/**
 * 🔌 WebSocket Output Adapter — Routes output to connected WebSocket clients
 * 
 * Used by companion apps (desktop/mobile) for real-time bidirectional communication.
 * Supports the CompanionProtocol message format.
 */

import { OutputAdapter } from './OutputAdapter.js';

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
  addClient(ws) {
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
    let wsType;

    switch (type) {
      case 'text':
      case 'response':
        wsType = 'response';
        break;
      case 'tool_start':
        wsType = 'tool_start';
        break;
      case 'tool_end':
        wsType = 'tool_end';
        break;
      case 'error':
        wsType = 'error';
        break;
      case 'status':
        wsType = 'state';
        break;
      case 'file_change':
        wsType = 'file_change';
        break;
      default:
        wsType = 'event';
    }

    this._broadcast({
      type: wsType,
      data: { content, ...metadata },
      timestamp: new Date().toISOString(),
    });
  }

  writeEvent(eventType, data = {}) {
    this._broadcast({
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
    });
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
