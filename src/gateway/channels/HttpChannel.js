/**
 * 🌐 HTTP Channel Adapter — REST API + SSE for web-based clients (Hono)
 * 
 * Provides:
 * - POST /api/task — Submit a task (JSON: { message, model?, sessionId? })
 * - GET /api/events — SSE stream for real-time events
 * - GET /api/health — Health check
 * - GET /api/status — Router + session status
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { ChannelAdapter } from '../ChannelAdapter.js';

export class HttpChannel extends ChannelAdapter {
  constructor(config = {}) {
    super('http', config);
    this.port = config.port || 3000;
    this.host = config.host || '0.0.0.0';
    this.authToken = config.authToken || null;
    this.server = null;

    /** @type {Map<string, import('hono').Context>} */
    this.sseClients = new Map(); // clientId → stream context
    this._clientIdCounter = 0;

    this._buildApp();
  }

  /**
   * Build the Hono app with all routes and middleware
   * @private
   */
  _buildApp() {
    const app = new Hono();

    // CORS middleware
    app.use('*', cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }));

    // Auth middleware (if token configured)
    if (this.authToken) {
      app.use('*', async (c, next) => {
        const authHeader = c.req.header('authorization');
        if (!authHeader || authHeader !== `Bearer ${this.authToken}`) {
          return c.json({ error: 'Unauthorized' }, 401);
        }
        await next();
      });
    }

    // POST /api/task
    app.post('/api/task', async (c) => {
      let data;
      try {
        data = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }

      const { message, sessionId, model } = data;

      if (!message) {
        return c.json({ error: 'Missing "message" field' }, 400);
      }

      // Generate a target ID for this request
      const targetId = sessionId || `http-${++this._clientIdCounter}`;

      // Emit the message to the channel router
      this._emitMessage({
        targetId,
        content: message,
        metadata: { model, source: 'http-api' },
      });

      return c.json({
        accepted: true,
        sessionId: targetId,
        message: 'Task submitted. Connect to /api/events for streaming results.',
      });
    });

    // GET /api/events (SSE)
    app.get('/api/events', (c) => {
      return streamSSE(c, async (stream) => {
        const clientId = `sse-${++this._clientIdCounter}`;

        // Send initial connection event
        await stream.writeSSE({
          data: JSON.stringify({ type: 'connected', clientId }),
        });

        this.sseClients.set(clientId, stream);

        // Keep the stream open until client disconnects
        try {
          await new Promise((resolve, reject) => {
            stream.onAbort(() => {
              this.sseClients.delete(clientId);
              resolve();
            });
            // Also handle errors
            stream.on('error', () => {
              this.sseClients.delete(clientId);
              reject(new Error('SSE stream error'));
            });
          });
        } catch {
          this.sseClients.delete(clientId);
        }
      });
    });

    // GET /api/health
    app.get('/api/health', (c) => {
      return c.json({ status: 'ok', uptime: process.uptime() });
    });

    // GET /api/status
    app.get('/api/status', (c) => {
      return c.json({
        sseClients: this.sseClients.size,
        running: this._running,
      });
    });

    // 404 fallback
    app.notFound((c) => {
      return c.json({ error: 'Not found' }, 404);
    });

    this.app = app;
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = serve({
          fetch: this.app.fetch,
          port: this.port,
          hostname: this.host,
        }, (_info) => {
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
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop() {
    this._running = false;

    // Close all SSE connections
    for (const [, stream] of this.sseClients) {
      try { await stream.close(); } catch { /* ignore */ }
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

    const ssePayload = `data: ${JSON.stringify(event)}\n\n`;

    if (targetId && this.sseClients.has(targetId)) {
      // Send to specific client
      const stream = this.sseClients.get(targetId);
      try {
        await stream.write(ssePayload);
      } catch {
        this.sseClients.delete(targetId);
      }
    } else {
      // Broadcast to all SSE clients
      const dead = [];
      for (const [id, stream] of this.sseClients) {
        try {
          await stream.write(ssePayload);
        } catch {
          dead.push(id);
        }
      }
      for (const id of dead) this.sseClients.delete(id);
    }
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
