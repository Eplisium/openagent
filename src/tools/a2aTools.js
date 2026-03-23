/**
 * 🤖 A2A (Agent-to-Agent) Tools
 * Enable OpenAgent to interact with other A2A agents
 */

import chalk from 'chalk';
import { A2AAgent, A2AClient } from '../protocols/a2a.js';

// Store active A2A server instance
let a2aServer = null;

/**
 * Create A2A tools for OpenAgent
 * @param {object} options
 * @returns {object[]}
 */
export function createA2ATools(options = {}) {
  /**
   * Start A2A agent server
   */
  const a2aStartServer = {
    name: 'a2a_start_server',
    description: 'Start the A2A (Agent-to-Agent) protocol server to allow other agents to connect and send tasks',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Port to listen on (default: 3001)',
        },
        url: {
          type: 'string',
          description: 'Public URL for this agent (default: http://localhost:port)',
        },
        name: {
          type: 'string',
          description: 'Agent name (default: OpenAgent)',
        },
        description: {
          type: 'string',
          description: 'Agent description',
        },
      },
    },
    async execute({ port = 3001, url, name, description }) {
      try {
        if (a2aServer) {
          return { 
            success: false, 
            error: 'A2A server already running',
            port: a2aServer.server?.address()?.port,
          };
        }

        a2aServer = new A2AAgent({
          agentCard: {
            url: url || `http://localhost:${port}`,
            name,
            description,
          },
        });

        const result = await a2aServer.start(port);
        
        console.log(chalk.green(`[A2A] Server started on port ${port}`));
        
        return {
          success: true,
          port,
          url: url || `http://localhost:${port}`,
          message: `A2A server started on port ${port}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Stop A2A server
   */
  const a2aStopServer = {
    name: 'a2a_stop_server',
    description: 'Stop the A2A server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        if (!a2aServer) {
          return { success: false, error: 'No A2A server running' };
        }

        await a2aServer.stop();
        a2aServer = null;
        
        console.log(chalk.yellow('[A2A] Server stopped'));
        
        return {
          success: true,
          message: 'A2A server stopped',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Discover A2A agent
   */
  const a2aDiscover = {
    name: 'a2a_discover',
    description: 'Discover A2A agent capabilities by fetching their agent card',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the remote A2A agent (e.g., http://localhost:3001)',
        },
      },
      required: ['url'],
    },
    async execute({ url }) {
      try {
        const client = new A2AClient(url);
        const agentCard = await client.discover();
        
        if (!agentCard.success) {
          return { 
            success: false, 
            error: agentCard.error || 'Failed to discover agent',
          };
        }

        return {
          success: true,
          url,
          agentCard,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Send task to A2A agent
   */
  const a2aSendTask = {
    name: 'a2a_send_task',
    description: 'Send a task to another A2A agent and wait for completion',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the remote A2A agent',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier',
        },
        message: {
          type: 'string',
          description: 'Task message/instruction',
        },
        token: {
          type: 'string',
          description: 'Optional bearer token for authentication',
        },
      },
      required: ['url', 'taskId', 'message'],
    },
    async execute({ url, taskId, message, token }) {
      try {
        const client = new A2AClient(url, { token });
        const result = await client.sendTask(taskId, {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: message }],
          },
        });

        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Get task status from A2A agent
   */
  const a2aGetTaskStatus = {
    name: 'a2a_get_task_status',
    description: 'Check the status of a task sent to an A2A agent',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the remote A2A agent',
        },
        taskId: {
          type: 'string',
          description: 'Task identifier',
        },
      },
      required: ['url', 'taskId'],
    },
    async execute({ url, taskId }) {
      try {
        const client = new A2AClient(url);
        const result = await client.getTaskStatus(taskId);

        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * List tasks
   */
  const a2aListTasks = {
    name: 'a2a_list_tasks',
    description: 'List all tasks (local) or from a remote A2A agent',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the remote A2A agent (omit for local tasks)',
        },
        state: {
          type: 'string',
          description: 'Filter by task state (submitted, working, completed, failed, canceled)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return',
        },
      },
    },
    async execute({ url, state, limit }) {
      try {
        if (url) {
          // Remote tasks
          const client = new A2AClient(url);
          const result = await client.listTasks({ state, limit });
          return result;
        } else {
          // Local tasks
          if (!a2aServer) {
            return { success: false, error: 'No A2A server running' };
          }

          const tasks = a2aServer.listTasks().map(t => t.toJSON());
          
          return {
            success: true,
            tasks,
          };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Cancel a task
   */
  const a2aCancelTask = {
    name: 'a2a_cancel_task',
    description: 'Cancel a task on a remote A2A agent',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the remote A2A agent',
        },
        taskId: {
          type: 'string',
          description: 'Task identifier',
        },
      },
      required: ['url', 'taskId'],
    },
    async execute({ url, taskId }) {
      try {
        const client = new A2AClient(url);
        const result = await client.cancelTask(taskId);

        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Get server status
   */
  const a2aGetStatus = {
    name: 'a2a_get_status',
    description: 'Get status of the local A2A server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      if (!a2aServer) {
        return {
          success: true,
          running: false,
          message: 'A2A server not running',
        };
      }

      const port = a2aServer.server?.address()?.port;
      const tasks = a2aServer.listTasks().length;

      return {
        success: true,
        running: true,
        port,
        tasks,
        agentCard: a2aServer.agentCard.toJSON(),
      };
    },
  };

  return [
    a2aStartServer,
    a2aStopServer,
    a2aDiscover,
    a2aSendTask,
    a2aGetTaskStatus,
    a2aListTasks,
    a2aCancelTask,
    a2aGetStatus,
  ];
}

// Export the tool creators
export default { createA2ATools };
