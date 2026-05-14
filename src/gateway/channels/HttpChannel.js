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
import { createGatewayEvent, GATEWAY_EVENT_TYPES } from '../events.js';

const DEFAULT_HEARTBEAT_MS = 20000;
const DEFAULT_SOFT_BUFFER_BYTES = 256 * 1024;
const DEFAULT_HARD_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_EVENT_HISTORY_LIMIT = 500;

export class HttpChannel extends ChannelAdapter {
  constructor(config = {}) {
    super('http', config);
    this.port = config.port || 3000;
    this.host = config.host || '0.0.0.0';
    this.authToken = config.authToken || null;
    this.server = null;
    this.heartbeatMs = config.heartbeatMs || DEFAULT_HEARTBEAT_MS;
    this.softBufferBytes = config.softBufferBytes || DEFAULT_SOFT_BUFFER_BYTES;
    this.hardBufferBytes = config.hardBufferBytes || DEFAULT_HARD_BUFFER_BYTES;
    this.eventHistoryLimit = config.eventHistoryLimit || DEFAULT_EVENT_HISTORY_LIMIT;
    this._eventIdCounter = 0;
    this.eventHistory = [];

    /** @type {Map<string, object>} */
    this.sseClients = new Map(); // clientId -> { stream, format, pendingBytes, ... }
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
      allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Last-Event-ID'],
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
        const format = this._negotiateFormat(c);
        const targetId = c.req.query('sessionId') || null;
        const lastEventId = c.req.header('last-event-id') || c.req.query('lastEventId') || null;
        const client = {
          id: clientId,
          stream,
          format,
          targetId,
          pendingBytes: 0,
          droppedContentDeltas: 0,
          writeChain: Promise.resolve(),
          heartbeatTimer: null,
        };

        this.sseClients.set(clientId, client);

        // Send initial connection event
        await this._writeEventToClient(client, createGatewayEvent(GATEWAY_EVENT_TYPES.CONNECTED, {
          clientId,
          sessionId: targetId,
          format,
        }), { remember: false });

        if (format === 'structured' && lastEventId) {
          await this._sendStateRecovery(client, lastEventId);
        }

        client.heartbeatTimer = setInterval(() => {
          this._writeCommentToClient(client, 'heartbeat').catch(() => {
            this._removeClient(clientId);
          });
        }, this.heartbeatMs);
        if (client.heartbeatTimer.unref) client.heartbeatTimer.unref();

        // Keep the stream open until client disconnects
        try {
          await new Promise((resolve, reject) => {
            stream.onAbort(() => {
              this._removeClient(clientId);
              resolve();
            });
            // Also handle errors
            if (typeof stream.on === 'function') {
              stream.on('error', () => {
                this._removeClient(clientId);
                reject(new Error('SSE stream error'));
              });
            }
          });
        } catch {
          this._removeClient(clientId);
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
      try {
        if (stream.heartbeatTimer) clearInterval(stream.heartbeatTimer);
        await stream.stream.close();
      } catch { /* ignore */ }
    }
    this.sseClients.clear();

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => resolve());
      });
    }
  }

  async sendMessage(targetId, content, metadata = {}) {
    const event = this._rememberEvent(createGatewayEvent(metadata.type || GATEWAY_EVENT_TYPES.RESPONSE, {
      content,
      ...metadata,
      sessionId: metadata.sessionId || targetId,
    }));

    await this._broadcastEvent(targetId, event, { legacy: true });
  }

  async sendEvent(targetId, eventType, data = {}) {
    const event = this._rememberEvent(createGatewayEvent(eventType, {
      ...data,
      sessionId: data.sessionId || targetId,
    }));

    await this._broadcastEvent(targetId, event, { structuredOnly: true });
  }

  getInfo() {
    return {
      ...super.getInfo(),
      port: this.port,
      sseClients: this.sseClients.size,
      eventHistory: this.eventHistory.length,
    };
  }

  _negotiateFormat(c) {
    const queryFormat = (c.req.query('format') || '').toLowerCase();
    if (queryFormat === 'structured' || queryFormat === 'json') {
      return 'structured';
    }

    const accept = (c.req.header('accept') || '').toLowerCase();
    if (accept.includes('application/json')) {
      return 'structured';
    }

    return 'legacy';
  }

  _rememberEvent(event) {
    const id = String(++this._eventIdCounter);
    const remembered = { id, ...event };
    this.eventHistory.push(remembered);
    if (this.eventHistory.length > this.eventHistoryLimit) {
      this.eventHistory = this.eventHistory.slice(-this.eventHistoryLimit);
    }
    return remembered;
  }

  async _broadcastEvent(targetId, event, options = {}) {
    const writes = [];
    for (const [, client] of this.sseClients) {
      if (!this._clientMatchesTarget(client, targetId)) continue;
      if (options.structuredOnly && client.format !== 'structured') continue;
      writes.push(this._writeEventToClient(client, event, {
        legacy: options.legacy,
        structuredOnly: options.structuredOnly,
        remember: false,
      }));
    }

    const settled = await Promise.allSettled(writes);
    for (const result of settled) {
      if (result.status === 'rejected' && result.reason?.clientId) {
        this._removeClient(result.reason.clientId);
      }
    }
  }

  _clientMatchesTarget(client, targetId) {
    if (!targetId) return true;
    return client.id === targetId || client.targetId === targetId || !client.targetId;
  }

  async _writeEventToClient(client, event, _options = {}) {
    if (!client || !this.sseClients.has(client.id)) return;

    if (client.format !== 'structured') {
      const legacyTypes = new Set([
        GATEWAY_EVENT_TYPES.CONNECTED,
        GATEWAY_EVENT_TYPES.RESPONSE,
        GATEWAY_EVENT_TYPES.ERROR,
        GATEWAY_EVENT_TYPES.DONE,
      ]);
      if (!legacyTypes.has(event.type)) return;
    }

    if (event.type === GATEWAY_EVENT_TYPES.CONTENT_DELTA && client.pendingBytes > this.softBufferBytes) {
      client.droppedContentDeltas++;
      return;
    }

    const data = client.format === 'structured'
      ? JSON.stringify(event)
      : JSON.stringify(this._toLegacyEvent(event));
    const size = Buffer.byteLength(data, 'utf8') + 128;

    if (client.pendingBytes + size > this.hardBufferBytes) {
      await this._writeRawToClient(client, `event: error\ndata: ${JSON.stringify({
        type: 'error',
        error: 'SSE client is too far behind; reconnect with Last-Event-ID to recover.',
        timestamp: new Date().toISOString(),
      })}\n\n`, size).catch(() => {});
      this._removeClient(client.id);
      return;
    }

    if (client.droppedContentDeltas > 0 && event.type !== GATEWAY_EVENT_TYPES.CONTENT_DELTA) {
      const dropped = client.droppedContentDeltas;
      client.droppedContentDeltas = 0;
      await this._writeSSEObject(client, {
        event: GATEWAY_EVENT_TYPES.STATUS,
        id: event.id,
        data: JSON.stringify(createGatewayEvent(GATEWAY_EVENT_TYPES.STATUS, {
          sessionId: event.sessionId,
          iteration: event.iteration,
          message: `Dropped ${dropped} content_delta events because this SSE client was behind.`,
          reason: 'backpressure',
        })),
      });
    }

    await this._writeSSEObject(client, {
      id: event.id,
      event: event.type,
      data,
    });
  }

  _toLegacyEvent(event) {
    if (event.type === GATEWAY_EVENT_TYPES.DONE) {
      return {
        type: GATEWAY_EVENT_TYPES.RESPONSE,
        content: event.content || event.response || '',
        sessionId: event.sessionId,
        timestamp: event.timestamp,
      };
    }
    return event;
  }

  async _writeSSEObject(client, payload) {
    const data = payload.data || '';
    const size = Buffer.byteLength(data, 'utf8') + 128;
    client.pendingBytes += size;
    client.writeChain = client.writeChain
      .then(() => client.stream.writeSSE(payload))
      .catch((error) => {
        error.clientId = client.id;
        throw error;
      })
      .finally(() => {
        client.pendingBytes = Math.max(0, client.pendingBytes - size);
      });
    return client.writeChain;
  }

  async _writeCommentToClient(client, comment) {
    const payload = `: ${comment}\n\n`;
    const size = Buffer.byteLength(payload, 'utf8');
    return this._writeRawToClient(client, payload, size);
  }

  async _writeRawToClient(client, payload, size = Buffer.byteLength(payload, 'utf8')) {
    client.pendingBytes += size;
    client.writeChain = client.writeChain
      .then(() => client.stream.write(payload))
      .catch((error) => {
        error.clientId = client.id;
        throw error;
      })
      .finally(() => {
        client.pendingBytes = Math.max(0, client.pendingBytes - size);
      });
    return client.writeChain;
  }

  async _sendStateRecovery(client, lastEventId) {
    const lastId = Number.parseInt(lastEventId, 10);
    const recoverable = Number.isFinite(lastId)
      ? this.eventHistory.filter(event => Number.parseInt(event.id, 10) > lastId)
      : [];
    const filtered = client.targetId
      ? recoverable.filter(event => event.sessionId === client.targetId)
      : recoverable;

    await this._writeEventToClient(client, createGatewayEvent(GATEWAY_EVENT_TYPES.STATE_RECOVERY, {
      sessionId: client.targetId,
      lastEventId,
      replayedEvents: filtered.length,
      summary: filtered.length > 0
        ? `Replaying ${filtered.length} events since ${lastEventId}.`
        : `No buffered events found after ${lastEventId}.`,
    }), { remember: false });

    for (const event of filtered) {
      await this._writeEventToClient(client, event, { remember: false });
    }
  }

  _removeClient(clientId) {
    const client = this.sseClients.get(clientId);
    if (!client) return;
    if (client.heartbeatTimer) clearInterval(client.heartbeatTimer);
    this.sseClients.delete(clientId);
  }
}

export default HttpChannel;
