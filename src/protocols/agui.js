/**
 * 📺 AG-UI (Agent-to-User Interface) Protocol Implementation
 * Enables streaming events from agents to frontends
 * 
 * Specification: https://github.com/agentprotocol/ag-ui
 */

import chalk from 'chalk';
import http from 'http';

/** @typedef {import('http').Server} Server */
/** @typedef {import('http').IncomingMessage} IncomingMessage */
/** @typedef {import('http').ServerResponse} ServerResponse */

/**
 * AG-UI Event Types
 */
export const EventType = {
  // State events
  STATE_SNAPSHOT: 'state_snapshot',
  STATE_DELTA: 'state_delta',
  
  // Tool events
  TOOL_CALL_START: 'tool_call_start',
  TOOL_CALL_END: 'tool_call_end',
  
  // Text/message events
  TEXT_MESSAGE_START: 'text_message_start',
  TEXT_MESSAGE_CONTENT: 'text_message_content',
  TEXT_MESSAGE_END: 'text_message_end',
  
  // Run events
  RUN_STARTED: 'run_started',
  RUN_ENDED: 'run_ended',
  RUN_ERROR: 'run_error',
};

/**
 * AG-UI Event structure
 */
export class AGUIEvent {
  /**
   * @param {string} type - Event type
   * @param {object} data - Event data
   */
  constructor(type, data = {}) {
    this.type = type;
    this.data = data;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
    };
  }

  toSSE() {
    return `data: ${JSON.stringify(this.toJSON())}\n\n`;
  }
}

/**
 * AG-UI Server - streams events to connected frontends
 */
export class AGUIServer {
  /**
   * @param {object} options - Server options
   */
  constructor(options = {}) {
    this.options = options;
    this.server = null;
    this.subscribers = new Map(); // response -> subscription info
    this.eventBuffer = []; // Buffer recent events
    this.maxBufferSize = options.maxBufferSize || 100;
    this.subscribersByChannel = new Map(); // channel -> Set of subscribers
  }

  /**
   * Start the AG-UI server
   * @param {number} port - Port to listen on
   * @returns {Promise<object>}
   */
  async start(port = 3100) {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.handleRequest.bind(this));
      
      this.server.listen(port, () => {
        console.log(chalk.green(`[AG-UI] Server started on port ${port}`));
        resolve({ success: true, port });
      });

      this.server.on('error', (error) => {
        reject({ success: false, error: error.message });
      });
    });
  }

  /**
   * Stop the server
   * @returns {Promise<void>}
   */
  async stop() {
    return new Promise((resolve) => {
      // Close all subscriptions
      for (const [res] of this.subscribers) {
        try {
          res.end();
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
      this.subscribers.clear();
      this.subscribersByChannel.clear();
      this.eventBuffer = [];

      if (this.server) {
        this.server.close(() => {
          console.log(chalk.yellow('[AG-UI] Server stopped'));
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming requests
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.server?.address()?.port || 3100}`);

    // SSE endpoint for subscribing to events
    if (url.pathname === '/events' && req.method === 'GET') {
      this.handleSSEConnection(req, res, url);
      return;
    }

    // Emit event endpoint
    if (url.pathname === '/events' && req.method === 'POST') {
      await this.handleEmitEvent(req, res);
      return;
    }

    // Get subscribers
    if (url.pathname === '/subscribers' && req.method === 'GET') {
      const subscribers = this.getSubscribers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, subscribers }));
      return;
    }

    // Get buffered events
    if (url.pathname === '/events/buffer' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, events: this.eventBuffer }));
      return;
    }

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', subscribers: this.subscribers.size }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Handle SSE connection
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   * @param {URL} url
   */
  handleSSEConnection(req, res, url) {
    const channel = url.searchParams.get('channel') || 'default';
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Track subscriber
    const id = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.subscribers.set(res, { id, channel, connectedAt: new Date().toISOString() });
    
    // Track by channel
    if (!this.subscribersByChannel.has(channel)) {
      this.subscribersByChannel.set(channel, new Set());
    }
    this.subscribersByChannel.get(channel).add(res);

    // Send initial connection event
    res.write(`data: ${JSON.stringify({
      type: 'connection_established',
      data: { id, channel },
      timestamp: new Date().toISOString(),
    })}\n\n`);

    // Send buffered events
    for (const event of this.eventBuffer) {
      res.write(event.toSSE());
    }

    // Handle disconnect
    req.on('close', () => {
      this.subscribers.delete(res);
      const channelSubs = this.subscribersByChannel.get(channel);
      if (channelSubs) {
        channelSubs.delete(res);
        if (channelSubs.size === 0) {
          this.subscribersByChannel.delete(channel);
        }
      }
      console.log(chalk.gray(`[AG-UI] Subscriber ${id} disconnected`));
    });

    console.log(chalk.cyan(`[AG-UI] New subscriber ${id} on channel "${channel}"`));
  }

  /**
   * Handle event emission
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  async handleEmitEvent(req, res) {
    try {
      const body = await this.readBody(req);
      const { type, data, channel = 'default' } = body;

      if (!type) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Event type required' }));
        return;
      }

      const event = new AGUIEvent(type, data);
      this.emit(event, channel);

      // Buffer event
      this.eventBuffer.push(event);
      if (this.eventBuffer.length > this.maxBufferSize) {
        this.eventBuffer = this.eventBuffer.slice(-this.maxBufferSize);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, event: event.toJSON() }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  }

  /**
   * Emit an event to all subscribers
   * @param {AGUIEvent} event
   * @param {string} channel
   */
  emit(event, channel = 'default') {
    const sseData = event.toSSE();
    
    // Send to all subscribers on the channel
    const channelSubs = this.subscribersByChannel.get(channel) || this.subscribersByChannel.get('default');
    
    if (channelSubs) {
      for (const res of channelSubs) {
        try {
          res.write(sseData);
        } catch (error) {
          // Subscriber might be disconnected
          console.log(chalk.yellow(`[AG-UI] Failed to write to subscriber: ${error.message}`));
        }
      }
    }

    // Also send to 'all' channel
    if (channel !== 'all') {
      const allSubs = this.subscribersByChannel.get('all');
      if (allSubs) {
        for (const res of allSubs) {
          try {
            res.write(sseData);
          } catch (error) {
            // Ignore
          }
        }
      }
    }
  }

  /**
   * Emit a text message event
   * @param {string} content - Message content
   * @param {object} options - Additional options
   */
  emitTextMessage(content, options = {}) {
    const { channel = 'default', messageType = 'text' } = options;
    
    // Start message
    this.emit(new AGUIEvent(EventType.TEXT_MESSAGE_START, {
      messageType,
    }), channel);

    // Content (chunk if too long)
    const chunkSize = options.chunkSize || 1000;
    for (let i = 0; i < content.length; i += chunkSize) {
      this.emit(new AGUIEvent(EventType.TEXT_MESSAGE_CONTENT, {
        content: content.substring(i, i + chunkSize),
        delta: true,
      }), channel);
    }

    // End message
    this.emit(new AGUIEvent(EventType.TEXT_MESSAGE_END, {
      content,
    }), channel);
  }

  /**
   * Emit a tool call event
   * @param {string} toolName - Tool name
   * @param {object} args - Tool arguments
   * @param {object} options - Additional options
   */
  emitToolCall(toolName, args, options = {}) {
    const { channel = 'default', result = null, error = null } = options;

    // Tool call start
    this.emit(new AGUIEvent(EventType.TOOL_CALL_START, {
      tool: toolName,
      arguments: args,
    }), channel);

    if (result !== null) {
      // Tool call end with result
      this.emit(new AGUIEvent(EventType.TOOL_CALL_END, {
        tool: toolName,
        result,
      }), channel);
    } else if (error) {
      // Tool call end with error
      this.emit(new AGUIEvent(EventType.TOOL_CALL_END, {
        tool: toolName,
        error,
      }), channel);
    }
  }

  /**
   * Emit run started event
   * @param {object} options - Run options
   */
  emitRunStarted(options = {}) {
    this.emit(new AGUIEvent(EventType.RUN_STARTED, {
      ...options,
    }));
  }

  /**
   * Emit run ended event
   * @param {object} options - Run result
   */
  emitRunEnded(options = {}) {
    this.emit(new AGUIEvent(EventType.RUN_ENDED, {
      ...options,
    }));
  }

  /**
   * Emit run error event
   * @param {string} error - Error message
   * @param {object} options - Additional options
   */
  emitRunError(error, options = {}) {
    this.emit(new AGUIEvent(EventType.RUN_ERROR, {
      error,
      ...options,
    }));
  }

  /**
   * Get list of active subscribers
   * @returns {Array}
   */
  getSubscribers() {
    const subs = [];
    for (const [res, info] of this.subscribers) {
      subs.push({
        id: info.id,
        channel: info.channel,
        connectedAt: info.connectedAt,
      });
    }
    return subs;
  }

  /**
   * Read request body
   * @param {IncomingMessage} req
   * @returns {Promise<object>}
   */
  readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }
}

export default { AGUIServer, AGUIEvent, EventType };
