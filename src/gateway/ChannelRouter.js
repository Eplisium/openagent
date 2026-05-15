/**
 * 🔀 Channel Router — Maps incoming messages to AgentSession instances
 * 
 * Accepts messages from multiple ChannelAdapters, routes them to the appropriate
 * session (creating one if needed via SessionPool), and sends responses back
 * through the originating channel.
 */

import { EventEmitter } from 'events';
import { SessionPool } from './SessionPool.js';
import { GATEWAY_EVENT_TYPES, previewValue, summarizeToolResult } from './events.js';

export class ChannelRouter extends EventEmitter {
  /**
   * @param {object} options
   * @param {SessionPool} options.sessionPool - Session pool for managing AgentSession instances
   * @param {object} options.sessionDefaults - Default options for new sessions
   * @param {function} options.onTaskStart - Called when a task starts (for logging/UI)
   * @param {function} options.onTaskEnd - Called when a task ends
   */
  constructor(options = {}) {
    super();
    this.sessionPool = options.sessionPool || new SessionPool(options.poolOptions || {});
    this.sessionDefaults = options.sessionDefaults || {};
    this.onTaskStart = options.onTaskStart || null;
    this.onTaskEnd = options.onTaskEnd || null;

    /** @type {Map<string, import('./ChannelAdapter.js').ChannelAdapter>} */
    this.channels = new Map();

    /** @type {Map<string, {channelName: string, targetId: string}>} */
    this.sessionRoutes = new Map(); // sessionKey → origin info for response routing

    this._running = false;
  }

  /**
   * Register a channel adapter
   * @param {import('./ChannelAdapter.js').ChannelAdapter} adapter
   */
  registerChannel(adapter) {
    this.channels.set(adapter.name, adapter);

    // Listen for incoming messages from this channel
    adapter.onMessage(async (message) => {
      await this._handleIncoming(adapter.name, message);
    });
  }

  /**
   * Remove a channel adapter
   * @param {string} channelName
   */
  async removeChannel(channelName) {
    const adapter = this.channels.get(channelName);
    if (adapter) {
      await adapter.stop();
      this.channels.delete(channelName);
    }
  }

  /**
   * Start all registered channels and the session pool
   */
  async start() {
    this.sessionPool.start();
    this._running = true;

    for (const [name, adapter] of this.channels) {
      try {
        await adapter.start();
        this.emit('channel_started', name);
      } catch (error) {
        this.emit('channel_error', { name, error: error.message });
      }
    }
  }

  /**
   * Stop all channels and the session pool
   */
  async stop() {
    this._running = false;

    for (const [, adapter] of this.channels) {
      try {
        await adapter.stop();
      } catch { /* ignore */ }
    }

    await this.sessionPool.stop();
  }

  /**
   * Handle an incoming message from any channel
   * @private
   */
  async _handleIncoming(channelName, message) {
    const { targetId, content, metadata } = message;

    // Build a session key from channel + target
    const sessionKey = `${channelName}:${targetId}`;

    // Store the route so we know where to send responses
    this.sessionRoutes.set(sessionKey, { channelName, targetId });

    // Get or create a session for this conversation
    const { session, created } = await this.sessionPool.getOrCreate(sessionKey, {
      ...this.sessionDefaults,
      channelContext: { type: channelName, id: targetId },
    });

    if (created) {
      this.emit('session_created', { sessionKey, channelName, targetId });
    }

    // Notify task start
    if (this.onTaskStart) {
      this.onTaskStart({ sessionKey, channelName, targetId, content });
    }
    this.emit('task_start', { sessionKey, channelName, targetId });

    let restoreCallbacks = () => {};

    try {
      const adapter = this.channels.get(channelName);
      restoreCallbacks = this._wireAgentEvents(session, adapter, targetId, {
        sessionKey,
        channelName,
        internalSessionId: session.sessionId,
      });

      // Run the agent task
      const result = await session.run(content);

      // Extract the response text
      const responseText = result?.response || result?.content || 'Task completed.';

      await this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.DONE, {
        sessionId: targetId,
        internalSessionId: session.sessionId,
        iteration: session.agent?.iterationCount ?? null,
        iterations: result?.iterations ?? session.agent?.iterationCount ?? null,
        content: responseText,
        stopReason: result?.stopReason,
        completed: result?.completed,
        stats: result?.stats,
        performance: result?.performance,
        model: session.agent?.model,
        contextPercent: session.agent?.getContextStats?.()?.percent ?? session.agent?.getContextUsagePercent?.() ?? null,
        durationMs: result?.durationMs ?? result?.performance?.duration ?? null,
      });

      // Route response back through the originating channel
      if (adapter) {
        await adapter.sendMessage(targetId, responseText, {
          sessionId: targetId,
          internalSessionId: session.sessionId,
          ...metadata,
        });
      }
      // Notify task end
      if (this.onTaskEnd) {
        this.onTaskEnd({ sessionKey, channelName, targetId, success: true, result });
      }
      this.emit('task_end', { sessionKey, channelName, targetId, success: true });

    } catch (error) {
      // Send error back through the channel
      const adapter = this.channels.get(channelName);
      await this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.ERROR, {
        sessionId: targetId,
        internalSessionId: session.sessionId,
        iteration: session.agent?.iterationCount ?? null,
        error: error.message,
      });
      if (adapter) {
        await adapter.sendMessage(targetId, `Error: ${error.message}`, {
          type: 'error',
          sessionId: targetId,
          internalSessionId: session.sessionId,
        });
      }

      if (this.onTaskEnd) {
        this.onTaskEnd({ sessionKey, channelName, targetId, success: false, error: error.message });
      }
      this.emit('task_end', { sessionKey, channelName, targetId, success: false, error: error.message });
    } finally {
      restoreCallbacks();
    }
  }

  _wireAgentEvents(session, adapter, targetId, base = {}) {
    const agent = session.agent;
    if (!agent || !adapter?.sendEvent) {
      return () => {};
    }

    const previous = {
      onToolStart: agent.onToolStart,
      onToolEnd: agent.onToolEnd,
      onResponse: agent.onResponse,
      onIntermediateContent: agent.onIntermediateContent,
      onIterationStart: agent.onIterationStart,
      onIterationEnd: agent.onIterationEnd,
      onStatus: agent.onStatus,
      onContentDelta: agent.onContentDelta,
      onCheckpoint: agent.onCheckpoint,
    };
    const toolStarts = new Map();
    const eventBase = () => ({
      sessionId: targetId,
      internalSessionId: base.internalSessionId,
      channelName: base.channelName,
      sessionKey: base.sessionKey,
      iteration: agent.iterationCount || null,
    });

    agent.onIterationStart = (iteration) => {
      previous.onIterationStart?.(iteration);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.ITERATION_START, {
        ...eventBase(),
        iteration,
      });
    };

    agent.onIterationEnd = (iteration, elapsedMs) => {
      previous.onIterationEnd?.(iteration, elapsedMs);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.ITERATION_END, {
        ...eventBase(),
        iteration,
        elapsedMs,
      });
    };

    agent.onContentDelta = (content) => {
      previous.onContentDelta?.(content);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.CONTENT_DELTA, {
        ...eventBase(),
        content,
      });
    };

    agent.onIntermediateContent = (content) => {
      previous.onIntermediateContent?.(content);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.THINKING, {
        ...eventBase(),
        content,
      });
    };

    agent.onToolStart = (toolName, args) => {
      previous.onToolStart?.(toolName, args);
      const stack = toolStarts.get(toolName) || [];
      stack.push(Date.now());
      toolStarts.set(toolName, stack);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.TOOL_CALL_START, {
        ...eventBase(),
        toolName,
        args,
        argsPreview: previewValue(args),
      });
    };

    agent.onToolEnd = (toolName, result) => {
      previous.onToolEnd?.(toolName, result);
      const stack = toolStarts.get(toolName) || [];
      const startedAt = stack.pop() || Date.now();
      if (stack.length > 0) toolStarts.set(toolName, stack);
      else toolStarts.delete(toolName);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.TOOL_CALL_END, {
        ...eventBase(),
        toolName,
        durationMs: Date.now() - startedAt,
        result,
        ...summarizeToolResult(result),
      });
    };

    agent.onStatus = (status) => {
      previous.onStatus?.(status);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.STATUS, {
        ...eventBase(),
        statusType: status?.type || 'status',
        message: status?.message || String(status || ''),
        ...status,
      });
    };

    agent.onResponse = (response) => {
      previous.onResponse?.(response);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.RESPONSE, {
        ...eventBase(),
        content: response,
      });
    };

    agent.onCheckpoint = (checkpoint) => {
      previous.onCheckpoint?.(checkpoint);
      this._sendEvent(adapter, targetId, GATEWAY_EVENT_TYPES.CHECKPOINT, {
        ...eventBase(),
        ...checkpoint,
      });
    };

    return () => {
      Object.assign(agent, previous);
    };
  }

  async _sendEvent(adapter, targetId, eventType, data) {
    if (!adapter?.sendEvent) return;
    try {
      await adapter.sendEvent(targetId, eventType, data);
    } catch (error) {
      this.emit('channel_error', { name: adapter.name, error: error.message });
    }
  }

  /**
   * Get router status
   */
  getStatus() {
    const channelStatus = {};
    for (const [name, adapter] of this.channels) {
      channelStatus[name] = adapter.getInfo();
    }

    return {
      running: this._running,
      channels: channelStatus,
      sessions: this.sessionPool.getStats(),
      activeRoutes: this.sessionRoutes.size,
    };
  }

  /**
   * List all registered channel names
   * @returns {string[]}
   */
  getChannelNames() {
    return [...this.channels.keys()];
  }
}

export default ChannelRouter;
