/**
 * 🔌 MCP (Model Context Protocol) Client Tools
 * Connect to and interact with MCP servers
 * 
 * Specification: https://modelcontextprotocol.io
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import chalk from 'chalk';

/**
 * @typedef {import('events').EventEmitter} EventEmitter
 * @typedef {import('child_process').ChildProcess} ChildProcess
 */

// Store active MCP connections
const mcpConnections = new Map();

/**
 * MCP HTTP Client for HTTP/SSE transport
 */
class MCPHttpClient extends EventEmitter {
  constructor(url, options = {}) {
    super();
    this.url = url;
    this.options = options;
    this.requestId = 1;
    this.connected = false;
  }

  /**
   * Send a JSON-RPC request
   * @param {string} method - Method name
   * @param {object} params - Parameters
   * @returns {Promise<object>}
   */
  async request(method, params = {}) {
    const id = this.requestId++;
    const body = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error.message || result.error.code);
    }

    return result.result;
  }

  /**
   * Initialize the connection
   * @returns {Promise<object>}
   */
  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'OpenAgent',
        version: '4.1.0',
      },
    });

    this.connected = true;
    this.serverInfo = result;

    // Send initialized notification
    await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }),
    });

    return result;
  }

  /**
   * List available tools
   * @returns {Promise<object>}
   */
  async listTools() {
    const result = await this.request('tools/list', {});
    return result.tools || [];
  }

  /**
   * Call a tool
   * @param {string} name - Tool name
   * @param {object} arguments_ - Tool arguments
   * @returns {Promise<object>}
   */
  async callTool(name, arguments_ = {}) {
    return this.request('tools/call', {
      name,
      arguments: arguments_,
    });
  }
}

/**
 * MCP Stdio Client for stdio transport
 */
class MCPStdioClient extends EventEmitter {
  constructor(command, args = [], env = {}) {
    super();
    this.command = command;
    this.args = args;
    this.env = env;
    this.process = null;
    this.requestId = 1;
    this.buffer = '';
    this.connected = false;
  }

  /**
   * Start the stdio process
   */
  start() {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.env },
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        console.error(chalk.red('[MCP Stdio]'), data.toString());
      });

      this.process.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      this.process.on('close', (code) => {
        this.connected = false;
        this.emit('close', code);
      });

      // Give process time to start
      setTimeout(() => resolve(), 500);
    });
  }

  /**
   * Process JSON-RPC messages from stdout
   */
  processBuffer() {
    // Split on newlines and process JSON-RPC messages
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (_e) {
          // Not JSON, ignore
        }
      }
    }
  }

  /**
   * Handle incoming JSON-RPC message
   * @param {object} message
   */
  handleMessage(message) {
    if (message.method) {
      // Server-initiated method
      this.emit('method', message);
    } else if (message.id) {
      // Response to a request - handled via pending requests
      this.emit('response', message);
    }
  }

  /**
   * Send a JSON-RPC request
   * @param {string} method
   * @param {object} params
   * @returns {Promise<object>}
   */
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const message = {
        jsonrpc: '2.0',
        method,
        params,
        id,
      };

      const _pending = { resolve, reject };
      
      // Set up one-time listener for this response
      const onResponse = (response) => {
        if (response.id === id) {
          this.removeListener('response', onResponse);
          if (response.error) {
            reject(new Error(response.error.message || response.error.code));
          } else {
            resolve(response.result);
          }
        }
      };
      
      this.on('response', onResponse);
      this.process.stdin.write(JSON.stringify(message) + '\n');

      // Timeout
      setTimeout(() => {
        this.removeListener('response', onResponse);
        reject(new Error('Request timeout'));
      }, 30000);
    });
  }

  /**
   * Initialize the connection
   * @returns {Promise<object>}
   */
  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'OpenAgent',
        version: '4.1.0',
      },
    });

    this.connected = true;
    this.serverInfo = result;

    // Send initialized notification
    this.process.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }) + '\n');

    return result;
  }

  /**
   * List available tools
   * @returns {Promise<object>}
   */
  async listTools() {
    const result = await this.request('tools/list', {});
    return result.tools || [];
  }

  /**
   * Call a tool
   * @param {string} name
   * @param {object} arguments_
   * @returns {Promise<object>}
   */
  async callTool(name, arguments_ = {}) {
    return this.request('tools/call', {
      name,
      arguments: arguments_,
    });
  }

  /**
   * Close the connection
   */
  close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
  }
}

/**
 * Create MCP tools for OpenAgent
 * @param {object} options
 * @returns {object[]}
 */
export function createMcpTools(options = {}) {
  const {
    _baseDir = '.',
  } = options;

  /**
   * Connect to an MCP server
   */
  const mcpConnect = {
    name: 'mcp_connect',
    description: 'Connect to an MCP (Model Context Protocol) server. Supports HTTP/SSE or stdio transport.',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name to identify this connection',
        },
        type: {
          type: 'string',
          enum: ['http', 'stdio'],
          description: 'Transport type: http (HTTP/SSE) or stdio',
        },
        url: {
          type: 'string',
          description: 'URL for HTTP transport (e.g., http://localhost:3000/mcp)',
        },
        command: {
          type: 'string',
          description: 'Command to run for stdio transport (e.g., npx, python)',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for stdio command',
        },
        env: {
          type: 'object',
          description: 'Environment variables for stdio transport',
        },
      },
      required: ['name', 'type'],
    },
    async execute({ name, type, url, command, args = [], env = {} }) {
      try {
        if (mcpConnections.has(name)) {
          return { success: false, error: `Connection "${name}" already exists` };
        }

        let client;
        
        if (type === 'http') {
          if (!url) {
            return { success: false, error: 'URL required for HTTP transport' };
          }
          client = new MCPHttpClient(url);
          await client.initialize();
        } else if (type === 'stdio') {
          if (!command) {
            return { success: false, error: 'Command required for stdio transport' };
          }
          client = new MCPStdioClient(command, args, env);
          await client.start();
          await client.initialize();
        } else {
          return { success: false, error: `Unknown transport type: ${type}` };
        }

        mcpConnections.set(name, client);
        
        console.log(chalk.green(`[MCP] Connected to ${name}`));
        
        return {
          success: true,
          name,
          type,
          serverInfo: client.serverInfo,
          message: `Connected to MCP server "${name}"`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * List tools from an MCP server
   */
  const mcpListTools = {
    name: 'mcp_list_tools',
    description: 'List available tools from a connected MCP server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP connection',
        },
      },
      required: ['name'],
    },
    async execute({ name }) {
      try {
        const client = mcpConnections.get(name);
        
        if (!client) {
          return { success: false, error: `No MCP connection named "${name}"` };
        }

        const tools = await client.listTools();

        return {
          success: true,
          name,
          tools: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Call a tool on an MCP server
   */
  const mcpCallTool = {
    name: 'mcp_call_tool',
    description: 'Call a tool on a connected MCP server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP connection',
        },
        tool: {
          type: 'string',
          description: 'Name of the tool to call',
        },
        arguments: {
          type: 'object',
          description: 'Tool arguments as JSON object',
        },
      },
      required: ['name', 'tool'],
    },
    async execute({ name, tool, arguments: args = {} }) {
      try {
        const client = mcpConnections.get(name);
        
        if (!client) {
          return { success: false, error: `No MCP connection named "${name}"` };
        }

        const result = await client.callTool(tool, args);

        return {
          success: true,
          name,
          tool,
          result,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Disconnect from an MCP server
   */
  const mcpDisconnect = {
    name: 'mcp_disconnect',
    description: 'Disconnect from an MCP server',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP connection to close',
        },
      },
      required: ['name'],
    },
    async execute({ name }) {
      try {
        const client = mcpConnections.get(name);
        
        if (!client) {
          return { success: false, error: `No MCP connection named "${name}"` };
        }

        if (client.close) {
          client.close();
        }

        mcpConnections.delete(name);
        
        console.log(chalk.yellow(`[MCP] Disconnected from ${name}`));
        
        return {
          success: true,
          name,
          message: `Disconnected from MCP server "${name}"`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * List active MCP connections
   */
  const mcpListConnections = {
    name: 'mcp_list_connections',
    description: 'List all active MCP server connections',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      const connections = [];
      
      for (const [name, client] of mcpConnections) {
        connections.push({
          name,
          type: client instanceof MCPHttpClient ? 'http' : 'stdio',
          connected: client.connected,
          url: client.url || null,
        });
      }

      return {
        success: true,
        connections,
      };
    },
  };

  return [
    mcpConnect,
    mcpListTools,
    mcpCallTool,
    mcpDisconnect,
    mcpListConnections,
  ];
}

// Export the tool creators
export default { createMcpTools };
