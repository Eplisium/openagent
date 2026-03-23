/**
 * 📺 AG-UI Tools
 * Enable OpenAgent to stream events to frontends via AG-UI protocol
 */

import chalk from 'chalk';
import { AGUIServer, EventType } from '../protocols/agui.js';

// Store active AG-UI server
let aguiServer = null;

/**
 * Create AG-UI tools for OpenAgent
 * @param {object} options
 * @returns {object[]}
 */
export function createAGUITools(options = {}) {
  /**
   * Start AG-UI server
   */
  const aguiStart = {
    name: 'agui_start',
    description: 'Start the AG-UI (Agent-to-User Interface) server to stream events to frontends via SSE',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Port to listen on (default: 3100)',
        },
      },
    },
    async execute({ port = 3100 }) {
      try {
        if (aguiServer) {
          return { 
            success: false, 
            error: 'AG-UI server already running',
            port: aguiServer.server?.address()?.port,
          };
        }

        aguiServer = new AGUIServer();
        const result = await aguiServer.start(port);
        
        console.log(chalk.green(`[AG-UI] Server started on port ${port}`));
        
        return {
          success: true,
          port,
          message: `AG-UI server started on port ${port}`,
          sseUrl: `http://localhost:${port}/events`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Stop AG-UI server
   */
  const aguiStop = {
    name: 'agui_stop',
    description: 'Stop the AG-UI server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        if (!aguiServer) {
          return { success: false, error: 'No AG-UI server running' };
        }

        await aguiServer.stop();
        aguiServer = null;
        
        console.log(chalk.yellow('[AG-UI] Server stopped'));
        
        return {
          success: true,
          message: 'AG-UI server stopped',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Emit a custom event
   */
  const aguiEmit = {
    name: 'agui_emit',
    description: 'Emit a custom event to all AG-UI subscribers',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Event type (e.g., state_snapshot, state_delta, tool_call_start, tool_call_end, text_message_start, text_message_content, text_message_end, run_started, run_ended, run_error)',
        },
        data: {
          type: 'object',
          description: 'Event data payload',
        },
        channel: {
          type: 'string',
          description: 'Channel to emit to (default: default)',
        },
      },
      required: ['type'],
    },
    async execute({ type, data = {}, channel = 'default' }) {
      try {
        if (!aguiServer) {
          return { success: false, error: 'AG-UI server not running' };
        }

        aguiServer.emit(new (await import('../protocols/agui.js')).AGUIEvent(type, data), channel);

        return {
          success: true,
          type,
          channel,
          message: `Event "${type}" emitted`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Emit a text message event
   */
  const aguiEmitText = {
    name: 'agui_emit_text',
    description: 'Emit a text message event (convenience wrapper) to all subscribers',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Text content to send',
        },
        channel: {
          type: 'string',
          description: 'Channel to emit to (default: default)',
        },
      },
      required: ['content'],
    },
    async execute({ content, channel = 'default' }) {
      try {
        if (!aguiServer) {
          return { success: false, error: 'AG-UI server not running' };
        }

        aguiServer.emitTextMessage(content, { channel });

        return {
          success: true,
          channel,
          message: `Text message emitted (${content.length} chars)`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Emit tool call events
   */
  const aguiEmitToolCall = {
    name: 'agui_emit_tool_call',
    description: 'Emit tool call start/end events (convenience wrapper)',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description: 'Tool name',
        },
        args: {
          type: 'object',
          description: 'Tool arguments',
        },
        result: {
          type: 'object',
          description: 'Tool result (if provided, sends tool_call_end)',
        },
        error: {
          type: 'string',
          description: 'Error message (if provided, sends tool_call_end with error)',
        },
        channel: {
          type: 'string',
          description: 'Channel to emit to (default: default)',
        },
      },
      required: ['tool'],
    },
    async execute({ tool, args = {}, result = null, error = null, channel = 'default' }) {
      try {
        if (!aguiServer) {
          return { success: false, error: 'AG-UI server not running' };
        }

        aguiServer.emitToolCall(tool, args, { channel, result, error });

        return {
          success: true,
          tool,
          channel,
          message: error 
            ? `Tool call "${tool}" emitted with error`
            : result !== null
              ? `Tool call "${tool}" emitted with result`
              : `Tool call "${tool}" emitted`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Emit run started event
   */
  const aguiEmitRunStarted = {
    name: 'agui_emit_run_started',
    description: 'Emit a run_started event to all subscribers',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'Run identifier',
        },
        input: {
          type: 'object',
          description: 'Run input data',
        },
        channel: {
          type: 'string',
          description: 'Channel to emit to (default: default)',
        },
      },
    },
    async execute({ runId, input = {}, channel = 'default' }) {
      try {
        if (!aguiServer) {
          return { success: false, error: 'AG-UI server not running' };
        }

        aguiServer.emitRunStarted({ runId, input, channel });

        return {
          success: true,
          type: EventType.RUN_STARTED,
          channel,
          message: 'Run started event emitted',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Emit run ended event
   */
  const aguiEmitRunEnded = {
    name: 'agui_emit_run_ended',
    description: 'Emit a run_ended event to all subscribers',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'Run identifier',
        },
        output: {
          type: 'object',
          description: 'Run output data',
        },
        channel: {
          type: 'string',
          description: 'Channel to emit to (default: default)',
        },
      },
    },
    async execute({ runId, output = {}, channel = 'default' }) {
      try {
        if (!aguiServer) {
          return { success: false, error: 'AG-UI server not running' };
        }

        aguiServer.emitRunEnded({ runId, output, channel });

        return {
          success: true,
          type: EventType.RUN_ENDED,
          channel,
          message: 'Run ended event emitted',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Emit run error event
   */
  const aguiEmitRunError = {
    name: 'agui_emit_run_error',
    description: 'Emit a run_error event to all subscribers',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'Run identifier',
        },
        error: {
          type: 'string',
          description: 'Error message',
        },
        channel: {
          type: 'string',
          description: 'Channel to emit to (default: default)',
        },
      },
      required: ['error'],
    },
    async execute({ runId, error, channel = 'default' }) {
      try {
        if (!aguiServer) {
          return { success: false, error: 'AG-UI server not running' };
        }

        aguiServer.emitRunError(error, { runId, channel });

        return {
          success: true,
          type: EventType.RUN_ERROR,
          channel,
          message: 'Run error event emitted',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Get subscribers
   */
  const aguiGetSubscribers = {
    name: 'agui_get_subscribers',
    description: 'List all active SSE subscribers connected to the AG-UI server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        if (!aguiServer) {
          return { success: false, error: 'AG-UI server not running' };
        }

        const subscribers = aguiServer.getSubscribers();

        return {
          success: true,
          count: subscribers.length,
          subscribers,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Get server status
   */
  const aguiGetStatus = {
    name: 'agui_get_status',
    description: 'Get status of the AG-UI server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      if (!aguiServer) {
        return {
          success: true,
          running: false,
          message: 'AG-UI server not running',
        };
      }

      const port = aguiServer.server?.address()?.port;
      const subscribers = aguiServer.getSubscribers();

      return {
        success: true,
        running: true,
        port,
        subscriberCount: subscribers.length,
        sseUrl: `http://localhost:${port}/events`,
      };
    },
  };

  return [
    aguiStart,
    aguiStop,
    aguiEmit,
    aguiEmitText,
    aguiEmitToolCall,
    aguiEmitRunStarted,
    aguiEmitRunEnded,
    aguiEmitRunError,
    aguiGetSubscribers,
    aguiGetStatus,
  ];
}

// Export the tool creators
export default { createAGUITools };
