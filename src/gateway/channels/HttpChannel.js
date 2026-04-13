/**
 * 🌐 HTTP Channel Adapter — REST API + SSE for web-based clients
 * 
 * Provides:
 * - POST /api/task — Submit a task (JSON: { message, model?, sessionId? })
 * - GET /api/events — SSE stream for real-time events
 * - GET /api/health — Health check
 * - GET /api/status — Router + session status
 */

import http from 'http';
import { ChannelAdapter } from '../ChannelAdapter.js';

export class HttpChannel extends ChannelAdapter {
  constructor(config = {}) {
    super('http', config);
    this.port = config.port || 3000;
    this.host = config.host || '0.0.0.0';
    this.authToken = config.authToken || null;
    this.server = null;

    /** @type {Map<string, import('http').ServerResponse>} */
    this.sseClients = new Map(); // clientId → response stream
    this._clientIdCounter = 0;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this._handleRequest.bind(this));

      this.server.listen(this.port, this.host, () => {
        this._running = true;
        console.log(`[HTTP] Channel started on ${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          reject(error);
        }
      });
    });
  }

  async stop() {
    this._running = false;

    // Close all SSE connections
    for (const [, res] of this.sseClients) {
      try { res.end(); } catch { /* ignore */ }
    }
    this.sseClients.clear();

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => resolve());
      });
    }
  }

  async sendMessage(targetId, content, metadata = {}) {
    // For HTTP, targetId is the SSE client ID
    // Send via SSE to the specific client, or broadcast to all
    const event = {
      type: metadata.type || 'response',
      content,
      ...metadata,
      timestamp: new Date().toISOString(),
    };

    const sseData = `data: ${JSON.stringify(event)}\n\n`;

    if (targetId && this.sseClients.has(targetId)) {
      // Send to specific client
      const res = this.sseClients.get(targetId);
      try { res.write(sseData); } catch { this.sseClients.delete(targetId); }
    } else {
      // Broadcast to all SSE clients
      const dead = [];
      for (const [id, res] of this.sseClients) {
        try { res.write(sseData); } catch { dead.push(id); }
      }
      for (const id of dead) this.sseClients.delete(id);
    }
  }

  /**
   * @private
   */
  _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check (if configured)
    if (this.authToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${this.authToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    // Route
    if (url.pathname === '/api/task' && req.method === 'POST') {
      this._handleTask(req, res);
    } else if (url.pathname === '/api/events' && req.method === 'GET') {
      this._handleSSE(req, res);
    } else if (url.pathname === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sseClients: this.sseClients.size,
        running: this._running,
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  /**
   * Handle POST /api/task
   * @private
   */
  _handleTask(req, res) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { message, sessionId, model } = data;

        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "message" field' }));
          return;
        }

        // Generate a target ID for this request
        const targetId = sessionId || `http-${++this._clientIdCounter}`;

        // Emit the message to the channel router
        this._emitMessage({
          targetId,
          content: message,
          metadata: { model, source: 'http-api' },
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          accepted: true,
          sessionId: targetId,
          message: 'Task submitted. Connect to /api/events for streaming results.',
        }));

      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
  }

  /**
   * Handle GET /api/events (SSE)
   * @private
   */
  _handleSSE(req, res) {
    const clientId = `sse-${++this._clientIdCounter}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

    this.sseClients.set(clientId, res);

    // Clean up on disconnect
    req.on('close', () => {
      this.sseClients.delete(clientId);
    });

    res.on('close', () => {
      this.sseClients.delete(clientId);
    });
  }

  getInfo() {
    return {
      ...super.getInfo(),
      port: this.port,
      sseClients: this.sseClients.size,
    };
  }
}

export default HttpChannel;
