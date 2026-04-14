/**
 * 📱 Companion Server — WebSocket server for companion apps
 * 
 * Provides real-time bidirectional communication between OpenAgent and
 * companion apps (desktop menu bar, mobile apps, browser extensions).
 * 
 * Protocol: CompanionProtocol (state sync, control plane, file watching)
 */

import http from 'http';
import { EventEmitter } from 'events';
import { WsSink } from './WsSink.js';

// Try to import ws — it's an optional dependency
let WebSocketServer = null;
try {
  const ws = await import('ws');
  WebSocketServer = ws.WebSocketServer;
} catch {
  // ws not installed — companion server won't work
}

export class CompanionServer extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} options.port - WebSocket port (default: 3200)
   * @param {import('../agent/AgentSession.js').AgentSession} options.session - Session to attach
   */
  constructor(options = {}) {
    super();
    this.port = options.port || 3200;
    this.session = options.session || null;
    this.server = null;
    this.wss = null;
    this.wsSink = new WsSink();
    this._running = false;
    this._stateInterval = null;
  }

  /**
   * Start the companion server
   */
  async start() {
    if (!WebSocketServer) {
      throw new Error('Companion server requires the "ws" package. Install with: npm install ws');
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer();
      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws, req) => {
        this._handleConnection(ws, req);
      });

      this.server.listen(this.port, () => {
        this._running = true;
        console.log(`[Companion] Server started on port ${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the companion server
   */
  async stop() {
    this._running = false;

    if (this._stateInterval) {
      clearInterval(this._stateInterval);
      this._stateInterval = null;
    }

    await this.wsSink.close();

    if (this.wss) {
      this.wss.close();
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => resolve());
      });
    }
  }

  /**
   * Attach a session to the companion server
   * @param {import('../agent/AgentSession.js').AgentSession} session
   */
  attachSession(session) {
    this.session = session;

    // Wire agent callbacks to companion
    if (session.agent) {
      const agent = session.agent;

      // Override callbacks to also emit to companion
      const origOnToolStart = agent.onToolStart;
      agent.onToolStart = (tool, args) => {
        if (origOnToolStart) origOnToolStart(tool, args);
        this.wsSink.writeEvent('tool_start', { tool, args });
      };

      const origOnToolEnd = agent.onToolEnd;
      agent.onToolEnd = (tool, result) => {
        if (origOnToolEnd) origOnToolEnd(tool, result);
        this.wsSink.writeEvent('tool_end', { tool, result, success: !result?.error });
      };

      const origOnResponse = agent.onResponse;
      agent.onResponse = (response) => {
        if (origOnResponse) origOnResponse(response);
        this.wsSink.write('response', { type: 'response', content: response });
      };
    }

    // Start periodic state sync
    this._stateInterval = setInterval(() => {
      this._broadcastState();
    }, 5000);
    if (this._stateInterval.unref) this._stateInterval.unref();
  }

  /**
   * Handle a new WebSocket connection
   * @private
   */
  _handleConnection(ws, req) {
    this.wsSink.addClient(ws);

    const clientIp = req.socket.remoteAddress;
    console.log(`[Companion] Client connected: ${clientIp}`);

    // Send initial state
    this._sendState(ws);

    // Handle incoming control messages
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleControlMessage(msg, ws);
      } catch {
        // Invalid JSON — ignore
      }
    });

    ws.on('close', () => {
      console.log(`[Companion] Client disconnected: ${clientIp}`);
    });

    this.emit('client_connected', { ip: clientIp });
  }

  /**
   * Handle a control message from a companion client
   * @private
   */
  _handleControlMessage(msg, ws) {
    if (!this.session) return;

    switch (msg.type) {
      case 'pause':
        if (this.session.agent) this.session.agent.abort();
        this.wsSink.writeEvent('state', { status: 'paused' });
        break;

      case 'inject':
        if (msg.data?.message && this.session.agent) {
          // Queue a message for the agent
          this.emit('inject_message', { message: msg.data.message });
        }
        break;

      case 'change_model':
        if (msg.data?.model) {
          this.emit('change_model', { model: msg.data.model });
        }
        break;

      case 'watch_file':
        if (msg.data?.path) {
          this.emit('watch_file', { path: msg.data.path });
        }
        break;

      case 'unwatch_file':
        if (msg.data?.path) {
          this.emit('unwatch_file', { path: msg.data.path });
        }
        break;

      case 'get_state':
        this._sendState(ws);
        break;

      default:
        this.emit('control', msg);
    }
  }

  /**
   * Send current state to a specific client
   * @private
   */
  _sendState(ws) {
    const state = this._getState();
    try {
      ws.send(JSON.stringify({ type: 'state', data: state, timestamp: new Date().toISOString() }));
    } catch { /* ignore */ }
  }

  /**
   * Broadcast state to all clients
   * @private
   */
  _broadcastState() {
    const state = this._getState();
    this.wsSink.writeEvent('state', state);
  }

  /**
   * Get current session state
   * @private
   */
  _getState() {
    if (!this.session) {
      return { status: 'no_session' };
    }

    const agent = this.session.agent;
    return {
      sessionId: this.session.sessionId,
      status: agent?.state || 'unknown',
      model: agent?.model || 'unknown',
      workingDir: this.session.workingDir,
      contextPercent: agent?.getContextUsagePercent?.() || 0,
      stats: agent?.stats || {},
      connectedClients: this.wsSink.clientCount,
    };
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      running: this._running,
      port: this.port,
      clients: this.wsSink.clientCount,
      sessionAttached: Boolean(this.session),
    };
  }
}

export default CompanionServer;
