/**
 * 🔌 MCP (Model Context Protocol) Client Tools
 * Connect to and interact with MCP servers
 * 
 * Supports:
 * - HTTP/SSE transport (streamable HTTP)
 * - Stdio transport
 * - OAuth 2.0 with PKCE for protected servers
 * - Dynamic client registration
 * - Token persistence and auto-refresh
 * 
 * Specification: https://modelcontextprotocol.io
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import chalk from '../utils/chalk-compat.js';

// ─── Token Storage ───────────────────────────────────────────────────────────

const TOKEN_DIR = join(homedir(), '.openagent', 'mcp-tokens');

async function ensureTokenDir() {
  await mkdir(TOKEN_DIR, { recursive: true });
}

async function saveToken(serverUrl, tokenData) {
  await ensureTokenDir();
  const filename = Buffer.from(serverUrl).toString('base64url');
  const filepath = join(TOKEN_DIR, `${filename}.json`);
  await writeFile(filepath, JSON.stringify({
    ...tokenData,
    saved_at: Date.now(),
    server_url: serverUrl,
  }, null, 2));
}

async function loadToken(serverUrl) {
  try {
    const filename = Buffer.from(serverUrl).toString('base64url');
    const filepath = join(TOKEN_DIR, `${filename}.json`);
    const data = JSON.parse(await readFile(filepath, 'utf-8'));
    return data;
  } catch {
    return null;
  }
}

// ─── Server Config Storage ────────────────────────────────────────────────────

const SERVERS_FILE = join(homedir(), '.openagent', 'mcp-servers.json');

async function loadServers() {
  try {
    const data = await readFile(SERVERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveServers(servers) {
  const dir = join(homedir(), '.openagent');
  await mkdir(dir, { recursive: true });
  await writeFile(SERVERS_FILE, JSON.stringify(servers, null, 2));
}

// ─── PKCE Helpers

function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return randomBytes(16).toString('base64url');
}

// ─── OAuth Discovery ─────────────────────────────────────────────────────────

/**
 * Discover OAuth metadata from an MCP server
 * @param {string} mcpUrl - The MCP server URL
 * @returns {Promise<object|null>} OAuth metadata or null
 */
async function discoverOAuth(mcpUrl) {
  try {
    // Try a POST to trigger 401 with www-authenticate
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });

    if (response.status !== 401) {
      return null; // Not OAuth-protected
    }

    const wwwAuth = response.headers.get('www-authenticate');
    if (!wwwAuth || !wwwAuth.includes('Bearer')) {
      return null;
    }

    // Extract resource_metadata URL
    const metadataMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
    const metadataUrl = metadataMatch
      ? metadataMatch[1]
      : new URL('/.well-known/oauth-protected-resource', mcpUrl).href;

    // Fetch resource metadata
    const metaRes = await fetch(metadataUrl);
    if (!metaRes.ok) return null;
    const resourceMeta = await metaRes.json();

    // Fetch authorization server metadata
    const authServerUrl = resourceMeta.authorization_servers?.[0];
    if (!authServerUrl) return null;

    const wellKnownUrl = `${authServerUrl}/.well-known/oauth-authorization-server`;
    const authRes = await fetch(wellKnownUrl);
    if (!authRes.ok) return null;
    const authMeta = await authRes.json();

    return {
      resource_metadata: resourceMeta,
      authorization_server: authMeta,
      scopes: resourceMeta.scopes_supported || ['mcp:tools'],
    };
  } catch {
    return null;
  }
}

/**
 * Register a dynamic OAuth client
 * @param {object} authServer - Authorization server metadata
 * @returns {Promise<object>} Client registration response
 */
async function registerClient(authServer) {
  const regEndpoint = authServer.registration_endpoint;
  if (!regEndpoint) {
    throw new Error('Authorization server does not support dynamic registration');
  }

  // Register with a range of localhost ports for flexibility
  // Many MCP auth servers accept dynamic port redirect URIs
  const redirectUris = [];
  for (let port = 17760; port <= 17770; port++) {
    redirectUris.push(`http://localhost:${port}/callback`);
  }
  // Also include the loopback IP variant
  for (let port = 17760; port <= 17770; port++) {
    redirectUris.push(`http://127.0.0.1:${port}/callback`);
  }

  const response = await fetch(regEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'OpenAgent',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Client registration failed: ${err}`);
  }

  return response.json();
}

// ─── OAuth Token Exchange ────────────────────────────────────────────────────

/**
 * Perform the full OAuth PKCE flow with local callback server
 * @param {object} authServer - Authorization server metadata
 * @param {object} clientInfo - Registered client info
 * @param {string[]} scopes - Requested scopes
 * @returns {Promise<object>} Token response
 */
async function performPKCEFlow(authServer, clientInfo, scopes) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Start local callback server — try registered ports in order
  let actualRedirectUri = null;
  const authCode = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h2>Auth Failed</h2><p>${error}</p><p>You can close this window.</p></body></html>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>State mismatch</h2><p>Security error. Please try again.</p></body></html>');
          server.close();
          reject(new Error('OAuth state mismatch'));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>✅ Authenticated!</h2><p>You can close this window and return to OpenAgent.</p></body></html>');
          server.close();
          resolve(code);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Extract registered ports from redirect_uris
    const registeredPorts = clientInfo.redirect_uris
      .map(uri => { try { return new URL(uri).port; } catch { return null; } })
      .filter(Boolean);
    const portsToTry = registeredPorts.length > 0
      ? [...new Set(registeredPorts)]
      : ['17760', '17761', '17762', '17763', '17764', '17765'];

    let portIndex = 0;

    function tryListen() {
      const port = parseInt(portsToTry[portIndex], 10);
      server.listen(port, 'localhost', () => {
        const boundPort = server.address().port;
        const redirectUri = `http://localhost:${boundPort}/callback`;
        console.log(chalk.cyan('[MCP OAuth]') + ` Callback server listening on ${redirectUri}`);

        // Build authorize URL AFTER we know which port we bound
        actualRedirectUri = redirectUri;
        const authorizeUrl = new URL(authServer.authorization_endpoint);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', clientInfo.client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('scope', scopes.join(' '));
        authorizeUrl.searchParams.set('state', state);
        authorizeUrl.searchParams.set('code_challenge', codeChallenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');

        // Open browser for auth
        import('child_process').then(({ exec }) => {
          const cmd = process.platform === 'win32' ? 'start ""' :
                      process.platform === 'darwin' ? 'open' : 'xdg-open';
          exec(`${cmd} "${authorizeUrl.href}"`);
        }).catch(() => {
          console.log(chalk.yellow('[MCP OAuth]') + ` Please open this URL in your browser:\n${authorizeUrl.href}`);
        });
      });
    }

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        portIndex++;
        if (portIndex < portsToTry.length) {
          console.log(chalk.yellow('[MCP OAuth]') + ` Port ${portsToTry[portIndex - 1]} in use, trying port ${portsToTry[portIndex]}...`);
          tryListen();
        } else {
          reject(new Error('All callback ports are in use. Please close other OAuth sessions and retry.'));
        }
      } else {
        reject(new Error(`Failed to start callback server: ${err.message}`));
      }
    });

    tryListen();

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out (5 minutes)'));
    }, 300000);

    // Clean up timeout if resolved/rejected early
    server.on('close', () => clearTimeout(timeout));
  });

  // Exchange code for token
  const tokenResponse = await fetch(authServer.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: actualRedirectUri || clientInfo.redirect_uris[0],
      client_id: clientInfo.client_id,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  return tokenResponse.json();
}

/**
 * Refresh an expired OAuth token
 * @param {object} authServer - Authorization server metadata
 * @param {object} clientInfo - Client info
 * @param {string} refreshToken - The refresh token
 * @returns {Promise<object>} New token response
 */
async function refreshAccessToken(authServer, clientInfo, refreshToken) {
  const tokenResponse = await fetch(authServer.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientInfo.client_id,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const tokens = await tokenResponse.json();
  return tokens;
}

// ─── MCP Clients ─────────────────────────────────────────────────────────────

/**
 * MCP HTTP Client for HTTP/SSE transport (streamable HTTP)
 * Supports OAuth 2.0 Bearer tokens
 */
class MCPHttpClient extends EventEmitter {
  constructor(url, options = {}) {
    super();
    this.url = url;
    this.options = options;
    this.requestId = 1;
    this.connected = false;
    this.accessToken = options.accessToken || null;
    this.refreshToken = options.refreshToken || null;
    this.tokenExpiresAt = options.tokenExpiresAt || null;
    this.oauthMeta = options.oauthMeta || null;
    this.clientInfo = options.clientInfo || null;
  }

  /**
   * Get headers for requests, including auth if available
   */
  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /**
   * Check if token needs refresh and refresh if needed
   */
  async ensureValidToken() {
    if (!this.accessToken || !this.tokenExpiresAt) return;
    
    // Refresh 60 seconds before expiry
    if (Date.now() > (this.tokenExpiresAt - 60000)) {
      if (!this.refreshToken || !this.oauthMeta || !this.clientInfo) {
        throw new Error('Token expired and no refresh capability');
      }

      console.log(chalk.cyan('[MCP OAuth]') + ' Refreshing expired token...');
      const newTokens = await refreshAccessToken(
        this.oauthMeta.authorization_server,
        this.clientInfo,
        this.refreshToken
      );

      this.accessToken = newTokens.access_token;
      if (newTokens.refresh_token) {
        this.refreshToken = newTokens.refresh_token;
      }
      this.tokenExpiresAt = Date.now() + (newTokens.expires_in || 3600) * 1000;

      // Persist updated tokens
      await saveToken(this.url, {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        expires_in: newTokens.expires_in || 3600,
        token_type: newTokens.token_type || 'Bearer',
        client_info: this.clientInfo,
        oauth_meta: this.oauthMeta,
      });
    }
  }

  /**
   * Parse MCP response — handles both plain JSON and SSE (text/event-stream)
   * @param {Response} response - Fetch response object
   * @returns {Promise<object>} Parsed JSON-RPC result
   */
  async parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    // SSE format: "event: message\ndata: {...}\n\n"
    if (contentType.includes('text/event-stream') || text.startsWith('event:')) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          return JSON.parse(line.slice(6));
        }
      }
      throw new Error('No data line found in SSE response');
    }

    // Plain JSON
    return JSON.parse(text);
  }

  /**
   * Send a JSON-RPC request
   * @param {string} method - Method name
   * @param {object} params - Parameters
   * @returns {Promise<object>}
   */
  async request(method, params = {}) {
    await this.ensureValidToken();

    const id = this.requestId++;
    const body = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    // Handle 401 — token may have been revoked
    if (response.status === 401 && this.refreshToken) {
      console.log(chalk.yellow('[MCP OAuth]') + ' Got 401, attempting token refresh...');
      this.tokenExpiresAt = 0; // Force refresh
      await this.ensureValidToken();

      // Retry with new token
      const retryResponse = await fetch(this.url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });
      const result = await this.parseResponse(retryResponse);
      if (result.error) {
        throw new Error(result.error.message || result.error.code);
      }
      return result.result;
    }

    const result = await this.parseResponse(response);

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
      headers: this.getHeaders(),
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
      this.emit('method', message);
    } else if (message.id) {
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

// ─── Store active MCP connections ────────────────────────────────────────────

const mcpConnections = new Map();

// ─── Tool Definitions ────────────────────────────────────────────────────────

/**
 * Create MCP tools for OpenAgent
 * @param {object} options
 * @returns {object[]}
 */
export function createMcpTools(options = {}) {
  /**
   * Connect to an MCP server (with automatic OAuth support)
   */
  const mcpConnect = {
    name: 'mcp_connect',
    description: 'Connect to an MCP server. If only name is provided, auto-connects from saved config. Supports HTTP (with automatic OAuth 2.0 PKCE auth) and stdio transport. For OAuth-protected servers, opens a browser for login.',
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
          description: 'URL for HTTP transport (e.g., https://mcp.myworklayer.com)',
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
        token: {
          type: 'string',
          description: 'Optional: Bearer token for pre-authenticated servers (skips OAuth flow)',
        },
      },
      required: ['name'],
    },
    async execute({ name, type, url, command, args = [], env = {}, token }) {
      try {
        if (mcpConnections.has(name)) {
          return { success: false, error: `Connection "${name}" already exists` };
        }

        // Auto-connect from saved config if no type/url/command provided
        if (!type && !url && !command) {
          const servers = await loadServers();
          const saved = servers[name];
          if (saved) {
            type = saved.type;
            url = saved.url || url;
            command = saved.command || command;
            args = saved.args || args;
            env = saved.env || env;
            console.log(chalk.cyan('[MCP]') + ` Using saved config for "${name}"`);
          } else {
            return { success: false, error: `No saved config for "${name}". Provide type, url/command, or use mcp_save_server first.` };
          }
        }



        let client;

        if (type === 'http') {
          if (!url) {
            return { success: false, error: 'URL required for HTTP transport' };
          }

          let accessToken = token || null;
          let refreshToken = null;
          let tokenExpiresAt = null;
          let oauthMeta = null;
          let clientInfo = null;

          // If no token provided, check for saved token or do OAuth
          if (!accessToken) {
            // Try loading saved token
            const saved = await loadToken(url);
            if (saved) {
              accessToken = saved.access_token;
              refreshToken = saved.refresh_token;
              tokenExpiresAt = saved.expires_at || (saved.saved_at + (saved.expires_in || 3600) * 1000);
              clientInfo = saved.client_info;
              oauthMeta = saved.oauth_meta;
              console.log(chalk.cyan('[MCP]') + ' Using saved token');
            }
          }

          // If still no token, try OAuth discovery
          if (!accessToken) {
            console.log(chalk.cyan('[MCP]') + ' Checking for OAuth requirements...');
            oauthMeta = await discoverOAuth(url);

            if (oauthMeta) {
              console.log(chalk.cyan('[MCP OAuth]') + ' Server requires authentication');
              console.log(chalk.cyan('[MCP OAuth]') + ` Auth server: ${oauthMeta.authorization_server.issuer}`);

              // Register client
              console.log(chalk.cyan('[MCP OAuth]') + ' Registering client...');
              clientInfo = await registerClient(oauthMeta.authorization_server);
              console.log(chalk.cyan('[MCP OAuth]') + ` Client registered: ${clientInfo.client_id}`);

              // Perform PKCE flow
              console.log(chalk.cyan('[MCP OAuth]') + ' Opening browser for authentication...');
              const tokenResult = await performPKCEFlow(
                oauthMeta.authorization_server,
                clientInfo,
                oauthMeta.scopes
              );

              accessToken = tokenResult.access_token;
              refreshToken = tokenResult.refresh_token;
              tokenExpiresAt = Date.now() + (tokenResult.expires_in || 3600) * 1000;

              console.log(chalk.green('[MCP OAuth]') + ' Authentication successful!');

              // Persist tokens
              await saveToken(url, {
                access_token: accessToken,
                refresh_token: refreshToken,
                expires_in: tokenResult.expires_in || 3600,
                token_type: tokenResult.token_type || 'Bearer',
                expires_at: tokenExpiresAt,
                client_info: clientInfo,
                oauth_meta: oauthMeta,
              });
            }
          }

          client = new MCPHttpClient(url, {
            accessToken,
            refreshToken,
            tokenExpiresAt,
            oauthMeta,
            clientInfo,
          });
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

        // Auto-save server config for future reconnection
        try {
          const servers = await loadServers();
          if (!servers[name]) {
            servers[name] = { type, url, command, args, env, auto_connect: false, saved_at: Date.now() };
            await saveServers(servers);
            console.log(chalk.cyan('[MCP]') + ` Auto-saved server "${name}" for future sessions`);
          }
        } catch { /* non-critical */ }

        return {
          success: true,
          name,
          type,
          serverInfo: client.serverInfo,
          authenticated: !!client.accessToken,
          message: `Connected to MCP server "${name}"`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Authenticate with an OAuth-protected MCP server (without connecting)
   */
  const mcpAuth = {
    name: 'mcp_auth',
    description: 'Authenticate with an OAuth-protected MCP server. Opens browser for login, saves token for future connections. Use this to pre-authenticate before connecting.',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'MCP server URL (e.g., https://mcp.myworklayer.com)',
        },
      },
      required: ['url'],
    },
    async execute({ url }) {
      try {
        console.log(chalk.cyan('[MCP OAuth]') + ` Discovering OAuth metadata for ${url}...`);
        const oauthMeta = await discoverOAuth(url);

        if (!oauthMeta) {
          return {
            success: false,
            error: 'Server does not require OAuth authentication (or is not an MCP server)',
          };
        }

        console.log(chalk.cyan('[MCP OAuth]') + ` Auth server: ${oauthMeta.authorization_server.issuer}`);

        // Register client
        console.log(chalk.cyan('[MCP OAuth]') + ' Registering client...');
        const clientInfo = await registerClient(oauthMeta.authorization_server);
        console.log(chalk.cyan('[MCP OAuth]') + ` Client registered: ${clientInfo.client_id}`);

        // Perform PKCE flow
        console.log(chalk.cyan('[MCP OAuth]') + ' Opening browser for authentication...');
        const tokenResult = await performPKCEFlow(
          oauthMeta.authorization_server,
          clientInfo,
          oauthMeta.scopes
        );

        const tokenExpiresAt = Date.now() + (tokenResult.expires_in || 3600) * 1000;

        console.log(chalk.green('[MCP OAuth]') + ' Authentication successful!');

        // Persist tokens
        await saveToken(url, {
          access_token: tokenResult.access_token,
          refresh_token: tokenResult.refresh_token,
          expires_in: tokenResult.expires_in || 3600,
          token_type: tokenResult.token_type || 'Bearer',
          expires_at: tokenExpiresAt,
          client_info: clientInfo,
          oauth_meta: oauthMeta,
        });

        return {
          success: true,
          url,
          message: 'Authenticated and token saved. You can now connect with mcp_connect.',
          expires_in: tokenResult.expires_in || 3600,
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
          authenticated: !!client.accessToken,
        });
      }

      return {
        success: true,
        connections,
      };
    },
  };

  /**
   * Save an MCP server config for easy reconnection
   */
  const mcpSaveServer = {
    name: 'mcp_save_server',
    description: 'Save an MCP server configuration for easy reconnection later. Use mcp_connect with just the name to reconnect.',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name to identify this server',
        },
        type: {
          type: 'string',
          enum: ['http', 'stdio'],
          description: 'Transport type: http or stdio',
        },
        url: {
          type: 'string',
          description: 'URL for HTTP transport',
        },
        command: {
          type: 'string',
          description: 'Command for stdio transport',
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
        auto_connect: {
          type: 'boolean',
          description: 'Auto-connect this server on startup (default: false)',
        },
      },
      required: ['name'],
    },
    async execute({ name, type, url, command, args = [], env = {}, auto_connect = false }) {
      try {
        if (type === 'http' && !url) {
          return { success: false, error: 'URL required for HTTP servers' };
        }
        if (type === 'stdio' && !command) {
          return { success: false, error: 'Command required for stdio servers' };
        }

        const servers = await loadServers();
        servers[name] = { type, url, command, args, env, auto_connect, saved_at: Date.now() };
        await saveServers(servers);

        console.log(chalk.green(`[MCP] Saved server "${name}"`));

        return {
          success: true,
          name,
          message: `Saved MCP server "${name}". Use mcp_connect with just the name to reconnect.`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Remove a saved MCP server config
   */
  const mcpRemoveServer = {
    name: 'mcp_remove_server',
    description: 'Remove a saved MCP server configuration',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the saved server to remove',
        },
      },
      required: ['name'],
    },
    async execute({ name }) {
      try {
        const servers = await loadServers();
        if (!servers[name]) {
          return { success: false, error: `No saved server named "${name}"` };
        }
        delete servers[name];
        await saveServers(servers);

        console.log(chalk.yellow(`[MCP] Removed saved server "${name}"`));

        return {
          success: true,
          name,
          message: `Removed saved MCP server "${name}"`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * List saved MCP server configs
   */
  const mcpListServers = {
    name: 'mcp_list_servers',
    description: 'List all saved MCP server configurations',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        const servers = await loadServers();
        const list = Object.entries(servers).map(([name, config]) => ({
          name,
          type: config.type,
          url: config.url || null,
          command: config.command || null,
          auto_connect: config.auto_connect || false,
          saved_at: config.saved_at,
        }));

        return {
          success: true,
          servers: list,
          count: list.length,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  /**
   * Connect to all saved servers (or just auto-connect ones)
   */
  const mcpConnectAll = {
    name: 'mcp_connect_all',
    description: 'Connect to all saved MCP servers. Use auto_connect=true to only connect servers marked for auto-connect.',
    category: 'network',
    parameters: {
      type: 'object',
      properties: {
        auto_connect_only: {
          type: 'boolean',
          description: 'Only connect servers with auto_connect flag (default: false)',
        },
      },
    },
    async execute({ auto_connect_only = false }) {
      try {
        const servers = await loadServers();
        const results = [];

        for (const [name, config] of Object.entries(servers)) {
          if (auto_connect_only && !config.auto_connect) continue;
          if (mcpConnections.has(name)) {
            results.push({ name, status: 'already_connected' });
            continue;
          }

          try {
            let client;
            if (config.type === 'http') {
              let accessToken = null;
              let refreshToken = null;
              let tokenExpiresAt = null;
              let oauthMeta = null;
              let clientInfo = null;

              const saved = await loadToken(config.url);
              if (saved) {
                accessToken = saved.access_token;
                refreshToken = saved.refresh_token;
                tokenExpiresAt = saved.expires_at || (saved.saved_at + (saved.expires_in || 3600) * 1000);
                clientInfo = saved.client_info;
                oauthMeta = saved.oauth_meta;
              }

              client = new MCPHttpClient(config.url, {
                accessToken, refreshToken, tokenExpiresAt, oauthMeta, clientInfo,
              });
              await client.initialize();
            } else if (config.type === 'stdio') {
              client = new MCPStdioClient(config.command, config.args || [], config.env || {});
              await client.start();
              await client.initialize();
            }

            mcpConnections.set(name, client);
            console.log(chalk.green(`[MCP] Connected to ${name}`));
            results.push({ name, status: 'connected', type: config.type });
          } catch (err) {
            console.log(chalk.red(`[MCP] Failed to connect to ${name}: ${err.message}`));
            results.push({ name, status: 'failed', error: err.message });
          }
        }

        return {
          success: true,
          results,
          connected: results.filter(r => r.status === 'connected').length,
          total: results.length,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [
    mcpConnect,
    mcpAuth,
    mcpListTools,
    mcpCallTool,
    mcpDisconnect,
    mcpListConnections,
    mcpSaveServer,
    mcpRemoveServer,
    mcpListServers,
    mcpConnectAll,
  ];
}

// Export the tool creators
export default { createMcpTools };

/**
 * Auto-connect to saved servers marked with auto_connect flag
 * Call this after session initialization
 */
export async function autoConnectServers() {
  try {
    const servers = await loadServers();
    let connected = 0;

    for (const [name, config] of Object.entries(servers)) {
      if (!config.auto_connect) continue;
      if (mcpConnections.has(name)) continue;

      try {
        let client;
        if (config.type === 'http') {
          let accessToken = null;
          let refreshToken = null;
          let tokenExpiresAt = null;
          let oauthMeta = null;
          let clientInfo = null;

          const saved = await loadToken(config.url);
          if (saved) {
            accessToken = saved.access_token;
            refreshToken = saved.refresh_token;
            tokenExpiresAt = saved.expires_at || (saved.saved_at + (saved.expires_in || 3600) * 1000);
            clientInfo = saved.client_info;
            oauthMeta = saved.oauth_meta;
          }

          client = new MCPHttpClient(config.url, {
            accessToken, refreshToken, tokenExpiresAt, oauthMeta, clientInfo,
          });
          await client.initialize();
        } else if (config.type === 'stdio') {
          client = new MCPStdioClient(config.command, config.args || [], config.env || {});
          await client.start();
          await client.initialize();
        }

        mcpConnections.set(name, client);
        console.log(chalk.green(`[MCP] Auto-connected to ${name}`));
        connected++;
      } catch (err) {
        console.log(chalk.yellow(`[MCP] Auto-connect failed for ${name}: ${err.message}`));
      }
    }

    return { connected, total: Object.values(servers).filter(s => s.auto_connect).length };
  } catch {
    return { connected: 0, total: 0 };
  }
}
