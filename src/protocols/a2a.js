/**
 * 🤖 A2A (Agent-to-Agent) Protocol Implementation
 * Enables agent-to-agent communication with task delegation
 * 
 * Specification: https://a2aprotocol.io
 */

import chalk from 'chalk';
import http from 'http';
// https removed — not used
import { URL } from 'url';
import { EventEmitter } from 'events';

/** @typedef {import('http').Server} Server */
/** @typedef {import('http').IncomingMessage} IncomingMessage */
/** @typedef {import('http').ServerResponse} ServerResponse */

/**
 * Task states as per A2A protocol
 */
export const TaskState = {
  SUBMITTED: 'submitted',
  WORKING: 'working',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

/**
 * Default agent card configuration
 */
const DEFAULT_AGENT_CARD = {
  name: 'OpenAgent',
  description: 'Production-grade AI agent with 400+ models',
  version: '4.1.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
  },
  skills: [
    { id: 'coding', name: 'Code Writing', description: 'Write, edit, and debug code' },
    { id: 'research', name: 'Research', description: 'Web search and information gathering' },
    { id: 'file_ops', name: 'File Operations', description: 'Read, write, and manage files' },
  ],
  authentication: {
    schemes: ['bearer'],
  },
};

/**
 * A2A Agent Card - describes an agent's capabilities
 */
export class AgentCard {
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_AGENT_CARD,
      ...config,
      url: config.url || 'http://localhost:3001',
      capabilities: {
        ...DEFAULT_AGENT_CARD.capabilities,
        ...config.capabilities,
      },
    };
  }

  toJSON() {
    return this.config;
  }
}

/**
 * A2A Task - represents a task sent to or from an agent
 */
export class Task {
  constructor(id, params = {}) {
    this.id = id;
    this.params = params;
    this.status = {
      state: TaskState.SUBMITTED,
      message: null,
      artifacts: [],
    };
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  setState(state) {
    this.status.state = state;
    this.updatedAt = new Date().toISOString();
  }

  setMessage(message) {
    this.status.message = message;
    this.updatedAt = new Date().toISOString();
  }

  addArtifact(artifact) {
    this.status.artifacts.push(artifact);
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      params: this.params,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * A2A Client - connect to and interact with other A2A agents
 */
export class A2AClient extends EventEmitter {
  /**
   * @param {string} agentUrl - URL of the remote A2A agent
   * @param {object} options - Client options
   */
  constructor(agentUrl, options = {}) {
    super();
    this.agentUrl = new URL(agentUrl);
    this.options = options;
    this.tasks = new Map();
    this.requestId = 1;
  }

  /**
   * Discover agent capabilities by fetching agent card
   * @returns {Promise<object>}
   */
  async discover() {
    const cardUrl = new URL('/.well-known/agent.json', this.agentUrl);
    
    try {
      const response = await fetch(cardUrl.href, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send a task to the remote agent
   * @param {string} taskId - Unique task identifier
   * @param {object} params - Task parameters
   * @returns {Promise<object>}
   */
  async sendTask(taskId, params) {
    const task = new Task(taskId, params);
    this.tasks.set(taskId, task);

    try {
      const response = await fetch(new URL('/tasks/send', this.agentUrl).href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(this.options.token ? { 'Authorization': `Bearer ${this.options.token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tasks/send',
          params: {
            id: taskId,
            params,
          },
          id: this.requestId++,
        }),
      });

      const result = await response.json();

      if (result.error) {
        task.setState(TaskState.FAILED);
        return { success: false, error: result.error.message, task: task.toJSON() };
      }

      task.setState(TaskState.WORKING);
      return { success: true, task: task.toJSON() };
    } catch (error) {
      task.setState(TaskState.FAILED);
      return { success: false, error: error.message, task: task.toJSON() };
    }
  }

  /**
   * Get task status
   * @param {string} taskId - Task identifier
   * @returns {Promise<object>}
   */
  async getTaskStatus(taskId) {
    try {
      const response = await fetch(new URL(`/tasks/${taskId}`, this.agentUrl).href, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      const result = await response.json();
      
      if (result.error) {
        return { success: false, error: result.error.message };
      }

      const taskData = result.result || result;
      return { 
        success: true, 
        task: taskData,
        state: taskData.status?.state,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List tasks
   * @param {object} options - Filter options
   * @returns {Promise<object>}
   */
  async listTasks(options = {}) {
    try {
      const url = new URL('/tasks', this.agentUrl);
      if (options.state) url.searchParams.set('state', options.state);
      if (options.limit) url.searchParams.set('limit', options.limit);

      const response = await fetch(url.href, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      const result = await response.json();
      return { 
        success: true, 
        tasks: result.result || [],
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel a task
   * @param {string} taskId - Task identifier
   * @returns {Promise<object>}
   */
  async cancelTask(taskId) {
    try {
      const response = await fetch(new URL(`/tasks/${taskId}/cancel`, this.agentUrl).href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      
      if (result.error) {
        return { success: false, error: result.error.message };
      }

      const task = this.tasks.get(taskId);
      if (task) task.setState(TaskState.CANCELED);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * A2A Server - serve as an A2A agent
 */
export class A2AAgent extends EventEmitter {
  /**
   * @param {object} options - Agent options
   */
  constructor(options = {}) {
    super();
    this.options = options;
    this.agentCard = new AgentCard(options.agentCard);
    this.tasks = new Map();
    this.server = null;
    this.taskHandler = options.taskHandler || this.defaultTaskHandler.bind(this);
  }

  /**
   * Default task handler - override for custom logic
   */
  async defaultTaskHandler(task) {
    console.log(chalk.blue(`[A2A] Received task: ${task.id}`));
    return {
      state: TaskState.COMPLETED,
      message: {
        role: 'agent',
        parts: [{ type: 'text', text: `Task ${task.id} processed successfully` }],
      },
    };
  }

  /**
   * Start the A2A server
   * @param {number} port - Port to listen on
   * @returns {Promise<object>}
   */
  async start(port = 3001) {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.handleRequest.bind(this));
      
      this.server.listen(port, () => {
        console.log(chalk.green(`[A2A] Agent server started on port ${port}`));
        resolve({ success: true, port });
      });

      this.server.on('error', (error) => {
        reject(new Error(error.message));
      });
    });
  }

  /**
   * Stop the server
   * @returns {Promise<void>}
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        // Clear tasks map to free memory
        this.tasks.clear();
        this.server.close(() => {
          console.log(chalk.yellow('[A2A] Agent server stopped'));
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming HTTP requests
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.server.address().port}`);
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    try {
      // Agent Card endpoint
      if (url.pathname === '/.well-known/agent.json' && req.method === 'GET') {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.agentCard.toJSON()));
        return;
      }

      // Tasks endpoints
      if (url.pathname === '/tasks/send' && req.method === 'POST') {
        const body = await this.readBody(req);
        const { params, id } = body;
        
        const task = new Task(params.id, params.params || params);
        this.tasks.set(task.id, task);
        task.setState(TaskState.WORKING);

        // Process task
        const result = await this.taskHandler(task);
        
        task.setState(result.state);
        if (result.message) task.setMessage(result.message);
        if (result.artifacts) {
          result.artifacts.forEach(a => task.addArtifact(a));
        }

        res.writeHead(200, headers);
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          result: task.toJSON(),
          id,
        }));
        return;
      }

      // Get task status
      const taskMatch = url.pathname.match(/^\/tasks\/(.+)$/);
      if (taskMatch && req.method === 'GET') {
        const taskId = taskMatch[1];
        const task = this.tasks.get(taskId);
        
        if (!task) {
          res.writeHead(404, headers);
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32602, message: 'Task not found' },
          }));
          return;
        }

        res.writeHead(200, headers);
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          result: task.toJSON(),
        }));
        return;
      }

      // List tasks
      if (url.pathname === '/tasks' && req.method === 'GET') {
        const tasks = Array.from(this.tasks.values()).map(t => t.toJSON());
        res.writeHead(200, headers);
        res.end(JSON.stringify({ jsonrpc: '2.0', result: tasks }));
        return;
      }

      // SSE streaming endpoint
      if (url.pathname === '/tasks/stream' && req.method === 'GET') {
        const taskId = url.searchParams.get('taskId');
        
        res.writeHead(200, {
          ...headers,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const task = this.tasks.get(taskId);
        if (task) {
          res.write(`data: ${JSON.stringify({ task: task.toJSON() })}\n\n`);
        }
        return;
      }

      // 404 for unknown endpoints
      res.writeHead(404, headers);
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Method not found' },
      }));
    } catch (error) {
      res.writeHead(500, headers);
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: error.message },
      }));
    }
  }

  /**
   * Read request body as JSON
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

  /**
   * Get all tasks
   * @returns {Task[]}
   */
  listTasks() {
    return Array.from(this.tasks.values());
  }

  /**
   * Get a task by ID
   * @param {string} taskId
   * @returns {Task|null}
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }
}

export default { A2AAgent, A2AClient, Task, TaskState, AgentCard };
