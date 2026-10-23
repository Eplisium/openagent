/**
 * 🛠️ Tool Registry v3.0
 * Central registry for all available tools with execution and validation
 * 
 * Features:
 * - Tool registration and validation
 * - Permission-based execution
 * - Execution history and statistics
 * - Input validation
 * - Timeout handling
 * - Error categorization
 */

import chalk from '../utils/chalk-compat.js';
import { ToolErrorType } from '../errors.js';
import { ToolFormatAdapter } from './ToolFormatAdapter.js';

export { ToolErrorType } from '../errors.js';

export class ToolRegistry {
  constructor(options = {}) {
    this.tools = new Map();
    this.executionHistory = [];
    this.permissions = {
      allowShell: true,
      allowFileWrite: true,
      allowFileDelete: true,
      allowNetwork: true,
      allowGit: true,
      confirmDestructive: true,
      ...options.permissions,
    };
    
    // Execution settings
    this.defaultTimeout = options.defaultTimeout || 120000; // 2 minutes (as per changelog)
    this.maxHistorySize = options.maxHistorySize || 200; // Reduced from 500 — bounded memory for long sessions
    this.enableValidation = options.enableValidation !== false;
    
    // Statistics
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalDuration: 0,
      toolUsageCount: {},
    };
    
    // Per-tool execution metrics
    this.toolMetrics = {}; // { toolName: { calls, successes, failures, totalDuration, avgDuration, lastError } }

    // Session-stable tool exposure (prompt-cache friendly).
    // Non-core tools are "deferred" until activated via tool_search (or direct use).
    // The activated list only ever grows, in activation order, so the serialized
    // tool prefix sent to the LLM stays byte-identical between iterations.
    this.activatedTools = [];
    this._activatedSet = new Set();
    this._cachedSessionDefs = null;
    this._cachedSessionKey = null;
  }

  /**
   * Register a tool with validation
   */
  register(tool) {
    if (!tool.name) {
      throw new Error('Tool must have a name');
    }
    if (!tool.execute || typeof tool.execute !== 'function') {
      throw new Error(`Tool '${tool.name}' must have an execute function`);
    }
    if (!tool.description) {
      console.warn(chalk.yellow(`⚠️ Tool '${tool.name}' has no description`));
    }
    
    // Validate parameters schema if provided
    if (tool.parameters) {
      if (tool.parameters.type !== 'object') {
        console.warn(chalk.yellow(`⚠️ Tool '${tool.name}' parameters should be of type 'object'`));
      }
      if (tool.parameters.properties && typeof tool.parameters.properties !== 'object') {
        console.warn(chalk.yellow(`⚠️ Tool '${tool.name}' parameters.properties should be an object`));
      }
    }
    
    this.tools.set(tool.name, {
      ...tool,
      enabled: tool.enabled !== false,
      category: tool.category || 'general',
      destructive: tool.destructive || false,
      permission: tool.permission || null,
      timeout: tool.timeout || this.defaultTimeout,
    });
    
    // Invalidate cached definitions
    this._cachedFunctionDefs = null;
    this._cachedToolDefs = null;
    this._cachedSessionDefs = null;
    
    // Initialize usage count
    if (!this.stats.toolUsageCount[tool.name]) {
      this.stats.toolUsageCount[tool.name] = 0;
    }
    
    return this;
  }

  /**
   * Register multiple tools
   */
  registerAll(tools) {
    tools.forEach(tool => this.register(tool));
    return this;
  }

  /**
   * Get a tool by name
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * Get all tools as OpenRouter function definitions — cached until tools change
   */
  getFunctionDefinitions() {
    if (this._cachedFunctionDefs) return this._cachedFunctionDefs;
    const defs = [];
    for (const [_name, tool] of this.tools) {
      if (tool.enabled !== false) {
        defs.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || { type: 'object', properties: {} },
          },
        });
      }
    }
    this._cachedFunctionDefs = defs;
    return defs;
  }

  /**
   * Get tool definitions in simplified format — cached until tools change
   */
  getToolDefinitions() {
    if (this._cachedToolDefs) return this._cachedToolDefs;
    const defs = [];
    for (const [_name, tool] of this.tools) {
      if (tool.enabled !== false) {
        defs.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || { type: 'object', properties: {} },
        });
      }
    }
    this._cachedToolDefs = defs;
    return defs;
  }

  /**
   * Get tool definitions formatted for a specific provider.
   * Uses ToolFormatAdapter to convert from internal format to provider-specific format.
   * 
   * @param {string} provider - Target provider ('openai', 'anthropic', 'google', 'mistral', etc.)
   * @returns {Array<Object>|Object} Tool definitions in provider-specific format
   */
  getFunctionDefinitionsForProvider(provider) {
    const internalDefs = this.getToolDefinitions();
    return ToolFormatAdapter.formatToolDefinitions(internalDefs, provider);
  }

  /**
   * Core tool categories always sent to the LLM.
   * These are needed for basic agent operation (read, write, execute, search, git, web).
   */
  static CORE_CATEGORIES = new Set(['file', 'shell', 'git', 'web', 'network']);

  /**
   * Get tool definitions filtered to only the specified categories.
   * Used by the agent to send only relevant tool definitions per request,
   * reducing prompt token usage by 50-70%.
   *
   * @param {Set<string>} categories - Categories to include (always includes CORE_CATEGORIES)
   * @returns {Array<Object>} Filtered tool definitions
   */
  getToolDefinitionsForCategories(categories) {
    // Always include core categories
    const activeCategories = new Set([...ToolRegistry.CORE_CATEGORIES, ...categories]);
    
    const defs = [];
    for (const [_name, tool] of this.tools) {
      if (tool.enabled !== false && activeCategories.has(tool.category || 'general')) {
        defs.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || { type: 'object', properties: {} },
        });
      }
    }
    return defs;
  }

  /**
   * Get category for a tool name.
   * @param {string} toolName
   * @returns {string} Category name
   */
  getToolCategory(toolName) {
    const tool = this.tools.get(toolName);
    return tool?.category || 'general';
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔍 Session-stable tool set + tool_search meta-tool
  // ═══════════════════════════════════════════════════════════════

  /** Name of the meta-tool used to discover/activate deferred tools. */
  static TOOL_SEARCH_NAME = 'tool_search';

  /** Below this many enabled tools, every tool is sent and nothing is deferred. */
  static FULL_TOOLSET_THRESHOLD = 40;

  /**
   * Convert a registered tool into the simplified definition format.
   * @private
   */
  _toDefinition(tool) {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} },
    };
  }

  /**
   * Enabled tools, excluding the tool_search meta-tool, sorted by name.
   * @private
   */
  _enabledToolsSorted() {
    const list = [];
    for (const tool of this.tools.values()) {
      if (tool.enabled !== false && tool.name !== ToolRegistry.TOOL_SEARCH_NAME) list.push(tool);
    }
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /**
   * Whether a tool is core (always sent to the LLM).
   * @param {string} toolName
   * @returns {boolean}
   */
  isCoreTool(toolName) {
    const tool = this.tools.get(toolName);
    if (!tool) return false;
    return tool.core === true || ToolRegistry.CORE_CATEGORIES.has(tool.category || 'general');
  }

  /**
   * Enabled non-core tools that are only exposed after activation, sorted by name.
   * @returns {Array<Object>} Registered tool objects
   */
  getDeferredTools() {
    return this._enabledToolsSorted().filter(t => !this.isCoreTool(t.name));
  }

  /**
   * Whether deferral is in effect for the current registry contents.
   * @param {number} [threshold]
   * @returns {boolean}
   */
  isDeferralActive(threshold = ToolRegistry.FULL_TOOLSET_THRESHOLD) {
    const enabled = this._enabledToolsSorted();
    if (enabled.length < threshold) return false;
    return enabled.some(t => !this.isCoreTool(t.name));
  }

  /**
   * Whether a tool has been activated for this session.
   * @param {string} toolName
   * @returns {boolean}
   */
  isToolActivated(toolName) {
    return this._activatedSet.has(toolName);
  }

  /**
   * Activate deferred tools for the rest of the session.
   * Newly activated names are appended in sorted order within each call, so the
   * resulting list is a deterministic function of the activation history.
   *
   * @param {Array<string>|string} names
   * @returns {Array<string>} Names that were newly activated by this call
   */
  activateTools(names) {
    const list = Array.isArray(names) ? names : [names];
    const fresh = [...new Set(list)]
      .filter(name => typeof name === 'string' && this.tools.has(name))
      .filter(name => name !== ToolRegistry.TOOL_SEARCH_NAME)
      .filter(name => !this.isCoreTool(name) && !this._activatedSet.has(name))
      .sort();
    for (const name of fresh) {
      this._activatedSet.add(name);
      this.activatedTools.push(name);
    }
    if (fresh.length > 0) this._cachedSessionDefs = null;
    return fresh;
  }

  /**
   * Reset session activation state (e.g. when the conversation is cleared).
   */
  resetActivatedTools() {
    this.activatedTools = [];
    this._activatedSet.clear();
    this._cachedSessionDefs = null;
  }

  /**
   * Keyword/category search over deferred (non-core) tools.
   *
   * @param {string} [query] - Space-separated keywords matched against name/description/category
   * @param {Object} [options]
   * @param {string} [options.category] - Restrict to one category
   * @param {number} [options.limit=8] - Max results
   * @returns {Array<{name: string, category: string, description: string, score: number}>}
   */
  searchTools(query = '', options = {}) {
    const { category, limit = 8 } = options;
    const terms = String(query || '')
      .toLowerCase()
      .split(/[\s,]+/)
      .map(t => t.trim())
      .filter(Boolean);
    const wantedCategory = category ? String(category).toLowerCase() : null;

    const results = [];
    for (const tool of this.getDeferredTools()) {
      const toolCategory = (tool.category || 'general').toLowerCase();
      if (wantedCategory && toolCategory !== wantedCategory) continue;

      const name = tool.name.toLowerCase();
      const nameWords = name.replace(/[_-]+/g, ' ');
      const description = String(tool.description || '').toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name === term) score += 10;
        else if (name.includes(term) || nameWords.includes(term)) score += 5;
        if (toolCategory === term) score += 4;
        if (description.includes(term)) score += 2;
      }
      // With no terms, a category filter alone lists that category
      if (terms.length === 0 && wantedCategory) score = 1;
      if (score > 0) {
        results.push({ name: tool.name, category: tool.category || 'general', description: tool.description || '', score });
      }
    }

    results.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
    return results.slice(0, max);
  }

  /**
   * Build the tool_search meta-tool definition. Its description lists every
   * deferred tool by category so the model knows what can be activated.
   * @private
   */
  _buildToolSearchTool() {
    const byCategory = new Map();
    for (const tool of this.getDeferredTools()) {
      const cat = tool.category || 'general';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(tool.name);
    }
    const catalog = [...byCategory.keys()].sort()
      .map(cat => `${cat}: ${byCategory.get(cat).join(', ')}`)
      .join('\n');

    return {
      name: ToolRegistry.TOOL_SEARCH_NAME,
      category: 'meta',
      description: 'Search additional (non-core) tools by keyword and/or category and activate the matches. ' +
        'Activated tools become callable with full schemas from the next step on and stay available for the rest of the session. ' +
        'Use this before calling any tool not already in your tool list. Deferred tools by category:\n' + catalog,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to match against tool names and descriptions (e.g. "browser screenshot")' },
          category: { type: 'string', description: 'Optional category filter (one of the categories listed above)' },
          names: { type: 'array', items: { type: 'string' }, description: 'Exact tool names to activate directly' },
          limit: { type: 'number', description: 'Max tools to activate from the search (default 8)' },
        },
      },
      execute: async (args = {}) => this._executeToolSearch(args),
    };
  }

  /**
   * (Re)install the auto-generated tool_search tool so its catalog reflects the
   * current deferred tool set. Set directly (not via register) to avoid
   * recursive cache invalidation. A user-registered tool_search is left alone.
   * @private
   * @returns {Object} The tool_search tool entry
   */
  _ensureToolSearch() {
    const existing = this.tools.get(ToolRegistry.TOOL_SEARCH_NAME);
    if (existing && !existing._autoToolSearch) return existing;
    const entry = {
      ...this._buildToolSearchTool(),
      enabled: true,
      destructive: false,
      permission: null,
      timeout: this.defaultTimeout,
      _autoToolSearch: true,
    };
    this.tools.set(ToolRegistry.TOOL_SEARCH_NAME, entry);
    this._cachedFunctionDefs = null;
    this._cachedToolDefs = null;
    return entry;
  }

  /**
   * tool_search implementation.
   * @private
   */
  _executeToolSearch(args = {}) {
    const { query = '', category, names, limit } = args;
    const exactNames = Array.isArray(names) ? names.filter(n => typeof n === 'string') : [];
    if (!query && !category && exactNames.length === 0) {
      return { success: false, error: 'Provide a query, a category, or names to activate.' };
    }

    const matches = (query || category) ? this.searchTools(query, { category, limit }) : [];
    const unknown = exactNames.filter(n => !this.tools.has(n));
    const candidates = [...exactNames.filter(n => this.tools.has(n)), ...matches.map(m => m.name)];
    const newlyActivated = this.activateTools(candidates);

    const tools = [...new Set(candidates)].map(name => {
      const tool = this.tools.get(name);
      return {
        name,
        category: tool?.category || 'general',
        description: tool?.description || '',
        status: this.isCoreTool(name) ? 'core (already available)' : 'active',
      };
    });

    return {
      success: true,
      activated: newlyActivated,
      tools,
      ...(unknown.length > 0 ? { unknown } : {}),
      message: tools.length > 0
        ? `Activated ${newlyActivated.length} new tool(s); ${tools.length} match(es) are now callable.`
        : 'No matching tools found. Try different keywords or a category from the tool_search description.',
    };
  }

  /**
   * Get the cache-stable tool definitions for an LLM session.
   *
   * - Fewer than `threshold` enabled tools: every tool, sorted by name.
   * - Otherwise: core tools (sorted by name) + tool_search + activated tools
   *   in activation order. The list only grows within a session, so the
   *   serialized prefix stays stable for provider prompt caching.
   *
   * @param {Object} [options]
   * @param {number} [options.threshold]
   * @returns {Array<Object>} Simplified tool definitions
   */
  getSessionToolDefinitions(options = {}) {
    const threshold = Number.isFinite(options.threshold) && options.threshold > 0
      ? options.threshold
      : ToolRegistry.FULL_TOOLSET_THRESHOLD;
    const key = `${threshold}:${this.activatedTools.length}`;
    if (this._cachedSessionDefs && this._cachedSessionKey === key) return this._cachedSessionDefs;

    const enabled = this._enabledToolsSorted();
    let defs;
    if (!this.isDeferralActive(threshold)) {
      defs = enabled.map(t => this._toDefinition(t));
    } else {
      const searchTool = this._ensureToolSearch();
      defs = enabled.filter(t => this.isCoreTool(t.name)).map(t => this._toDefinition(t));
      defs.push(this._toDefinition(searchTool));
      for (const name of this.activatedTools) {
        const tool = this.tools.get(name);
        if (tool && tool.enabled !== false) defs.push(this._toDefinition(tool));
      }
    }

    this._cachedSessionDefs = defs;
    this._cachedSessionKey = key;
    return defs;
  }

  /**
   * Execute a tool with permission checks, validation, and timeout
   */
  async execute(toolName, args = {}) {
    const startTime = Date.now();
    this.stats.totalExecutions++;
    
    if (toolName === ToolRegistry.TOOL_SEARCH_NAME && !this.tools.has(toolName) && this.isDeferralActive()) {
      this._ensureToolSearch();
    }
    const tool = this.tools.get(toolName);
    
    if (!tool) {
      this.recordExecution(toolName, args, false, Date.now() - startTime, 'Tool not found');
      return {
        success: false,
        error: `Tool "${toolName}" not found`,
        errorType: ToolErrorType.NOT_FOUND,
        availableTools: Array.from(this.tools.keys()),
      };
    }
    
    // Direct use of a deferred tool activates it so its schema is sent from now on
    if (toolName !== ToolRegistry.TOOL_SEARCH_NAME && tool.enabled && !this.isCoreTool(toolName) && !this._activatedSet.has(toolName)) {
      this.activateTools([toolName]);
    }

    if (!tool.enabled) {
      this.recordExecution(toolName, args, false, Date.now() - startTime, 'Tool disabled');
      return {
        success: false,
        error: `Tool "${toolName}" is disabled`,
        errorType: ToolErrorType.PERMISSION_DENIED,
      };
    }

    // Permission checks
    if (tool.category === 'shell' && !this.permissions.allowShell) {
      this.recordExecution(toolName, args, false, Date.now() - startTime, 'Shell execution disabled');
      return { 
        success: false, 
        error: 'Shell execution is disabled',
        errorType: ToolErrorType.PERMISSION_DENIED,
      };
    }
    if (tool.category === 'file') {
      const filePermission = tool.permission || (tool.destructive ? 'delete' : 'read');

      if (filePermission === 'write' && !this.permissions.allowFileWrite) {
        this.recordExecution(toolName, args, false, Date.now() - startTime, 'File write access disabled');
        return {
          success: false,
          error: 'File write access is disabled',
          errorType: ToolErrorType.PERMISSION_DENIED,
        };
      }

      if (filePermission === 'delete' && !this.permissions.allowFileDelete) {
        this.recordExecution(toolName, args, false, Date.now() - startTime, 'File deletion disabled');
        return {
          success: false,
          error: 'File deletion is disabled',
          errorType: ToolErrorType.PERMISSION_DENIED,
        };
      }
    }
    if (tool.category === 'network' && !this.permissions.allowNetwork) {
      this.recordExecution(toolName, args, false, Date.now() - startTime, 'Network access disabled');
      return { 
        success: false, 
        error: 'Network access is disabled',
        errorType: ToolErrorType.PERMISSION_DENIED,
      };
    }
    if (tool.category === 'git' && !this.permissions.allowGit) {
      this.recordExecution(toolName, args, false, Date.now() - startTime, 'Git access disabled');
      return {
        success: false,
        error: 'Git access is disabled',
        errorType: ToolErrorType.PERMISSION_DENIED,
      };
    }

    // Input validation
    if (this.enableValidation && tool.parameters) {
      const validationError = this.validateArgs(tool, args);
      if (validationError) {
        this.recordExecution(toolName, args, false, Date.now() - startTime, validationError);
        return {
          success: false,
          error: validationError,
          errorType: ToolErrorType.VALIDATION_ERROR,
        };
      }
    }

    // Confirm destructive operations
    if (tool.destructive && this.permissions.confirmDestructive) {
      console.log(chalk.yellow(`⚠️  Destructive operation: ${toolName}`));
    }

    // Execute with timeout
    try {
      const result = await this.executeWithTimeout(tool, args, tool.timeout || this.defaultTimeout);
      const duration = Date.now() - startTime;
      
      this.recordExecution(toolName, args, result.success !== false, duration);
      this.stats.toolUsageCount[toolName] = (this.stats.toolUsageCount[toolName] || 0) + 1;
      
      if (result.success !== false) {
        this.stats.successfulExecutions++;
      } else {
        this.stats.failedExecutions++;
      }
      this.stats.totalDuration += duration;
      
      // Safely serialize result to catch circular references
      let safeResult;
      try {
        JSON.stringify(result);
        safeResult = result;
      } catch (_serializationError) {
        safeResult = {
          success: result.success !== false,
          data: this.safeSerialize(result),
          _serializationWarning: 'Result contained non-serializable data (possible circular references)',
        };
      }
      
      return {
        ...safeResult,
        _meta: { tool: toolName, duration },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const isTimeout = error.message.includes('timeout');
      
      this.recordExecution(toolName, args, false, duration, error.message);
      this.stats.failedExecutions++;
      this.stats.totalDuration += duration;
      
      return {
        success: false,
        error: error.message,
        errorType: isTimeout ? ToolErrorType.TIMEOUT : ToolErrorType.EXECUTION_ERROR,
        _meta: { tool: toolName, duration },
      };
    }
  }
  
  /**
   * Execute tool with timeout — uses AbortController when tool supports it
   */
  async executeWithTimeout(tool, args, timeout) {
    let timer = null;
    try {
      const result = await Promise.race([
        tool.execute(args),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Tool execution timeout (${timeout}ms)`)), timeout);
        }),
      ]);
      return result;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
  
  /**
   * Validate tool arguments against schema
   */
  validateArgs(tool, args) {
    if (!tool.parameters || !tool.parameters.required) {
      return null;
    }

    // If args failed JSON parsing upstream, give a clear explanation instead of
    // per-parameter "missing" errors that send the LLM into a retry loop.
    if (args && args._error && args._raw) {
      const preview = args._preview || (args._raw.length > 200 ? args._raw.substring(0, 200) + '...' : args._raw);
      return (
        `Tool call arguments could not be parsed as valid JSON. ` +
        `The model produced malformed argument text instead of a proper JSON object. ` +
        `Required parameters: ${tool.parameters.required.join(', ')}. ` +
        `Raw argument preview: ${preview}. ` +
        (args._hint ? args._hint + ' ' : '') +
        `Please retry with a valid JSON object containing all required fields.`
      );
    }

    for (const required of tool.parameters.required) {
      if (args[required] === undefined || args[required] === null) {
        return `Missing required parameter: ${required}`;
      }
    }
    
    return null;
  }
  
  /**
   * Record execution in history
   */
  recordExecution(toolName, args, success, duration, error = null) {
    const entry = {
      tool: toolName,
      args: this.sanitizeArgs(args),
      result: success ? 'success' : 'failure',
      error,
      duration,
      timestamp: new Date().toISOString(),
    };
    
    this.executionHistory.push(entry);
    
    // Keep history manageable — trim to half when limit reached
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-Math.floor(this.maxHistorySize / 2));
    }
    
    // Update per-tool metrics
    if (!this.toolMetrics[toolName]) {
      this.toolMetrics[toolName] = {
        calls: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0,
        avgDuration: 0,
        lastError: null,
      };
    }
    const m = this.toolMetrics[toolName];
    m.calls++;
    if (success) {
      m.successes++;
    } else {
      m.failures++;
      m.lastError = error;
    }
    m.totalDuration += duration;
    m.avgDuration = Math.round(m.totalDuration / m.calls);
  }
  
  /**
   * Sanitize args for logging (remove sensitive data)
   */
  sanitizeArgs(args) {
    const sanitized = { ...args };
    // Remove potentially sensitive fields
    delete sanitized.apiKey;
    delete sanitized.token;
    delete sanitized.password;
    delete sanitized.secret;
    
    // Truncate long strings
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = value.substring(0, 200) + '...';
      }
    }
    
    return sanitized;
  }

  /**
   * Set permissions
   */
  setPermissions(permissions) {
    this.permissions = { ...this.permissions, ...permissions };
  }

  /**
   * Get execution history
   */
  getHistory(limit = 20) {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Get comprehensive stats
   */
  getStats() {
    const total = this.stats.totalExecutions;
    const successful = this.stats.successfulExecutions;
    const failed = this.stats.failedExecutions;
    const avgDuration = total > 0
      ? Math.round(this.stats.totalDuration / total)
      : 0;
    
    // Get most used tools
    const sortedTools = Object.entries(this.stats.toolUsageCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    return {
      totalExecutions: total,
      successful,
      failed,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) + '%' : 'N/A',
      avgDuration: avgDuration + 'ms',
      registeredTools: this.tools.size,
      enabledTools: Array.from(this.tools.values()).filter(t => t.enabled).length,
      mostUsedTools: sortedTools.map(([name, count]) => `${name} (${count})`).join(', ') || 'None',
      historySize: this.executionHistory.length,
    };
  }

  /**
   * List all registered tools with details
   */
  list() {
    const list = [];
    for (const [name, tool] of this.tools) {
      list.push({
        name,
        description: tool.description,
        category: tool.category || 'general',
        enabled: tool.enabled !== false,
        destructive: tool.destructive || false,
        usageCount: this.stats.toolUsageCount[name] || 0,
      });
    }
    // Sort by usage count
    return list.sort((a, b) => b.usageCount - a.usageCount);
  }
  
  /**
   * Enable/disable a tool
   */
  setToolEnabled(toolName, enabled) {
    const tool = this.tools.get(toolName);
    if (tool) {
      tool.enabled = enabled;
      this._cachedFunctionDefs = null;
      this._cachedToolDefs = null;
      this._cachedSessionDefs = null;
      return true;
    }
    return false;
  }
  
  /**
   * Get tools by category
   */
  getByCategory(category) {
    return Array.from(this.tools.values()).filter(t => t.category === category);
  }
  
  /**
   * Alias for list() - backward compatibility
   */
  getAvailableTools() {
    return this.list();
  }

  /**
   * Execute a tool safely — never throws. Always returns { success, result/error, _meta }.
   * @param {string} toolName - Tool to execute
   * @param {Object} args - Tool arguments
   * @returns {Promise<{success: boolean, result?: any, error?: string, _meta: Object}>}
   */
  async executeSafe(toolName, args = {}) {
    try {
      const result = await this.execute(toolName, args);
      return result;
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Unknown execution error',
        _meta: { tool: toolName, duration: 0, safe: true },
      };
    }
  }

  /**
   * Get execution metrics for a specific tool or all tools
   * @param {string} [toolName] - Tool name (omit for all)
   * @returns {Object} Metrics object
   */
  getToolMetrics(toolName) {
    if (toolName) {
      return this.toolMetrics[toolName] || null;
    }
    return { ...this.toolMetrics };
  }

  /**
   * Get success rate for a specific tool or across all tools
   * @param {string} [toolName] - Tool name (omit for global rate)
   * @returns {number} Success rate between 0 and 1
   */
  getSuccessRate(toolName) {
    if (toolName) {
      const m = this.toolMetrics[toolName];
      if (!m || m.calls === 0) return 0;
      return m.successes / m.calls;
    }
    const total = this.stats.totalExecutions;
    if (total === 0) return 0;
    return this.stats.successfulExecutions / total;
  }

  /**
   * Disable a tool by name
   * @param {string} name - Tool name
   * @returns {boolean} True if tool was found and disabled
   */
  disableTool(name) {
    return this.setToolEnabled(name, false);
  }

  /**
   * Enable a tool by name
   * @param {string} name - Tool name
   * @returns {boolean} True if tool was found and enabled
   */
  enableTool(name) {
    return this.setToolEnabled(name, true);
  }

  /**
   * Safely serialize an object, handling circular references
   * @param {any} obj - Object to serialize
   * @returns {any} Safe serializable representation
   */
  safeSerialize(obj) {
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      if (typeof value === 'function') return '[Function]';
      if (typeof value === 'symbol') return value.toString();
      return value;
    }));
  }

  /**
   * Destroy the registry — release all resources
   */
  destroy() {
    this.tools.clear();
    this.executionHistory = [];
    this.toolMetrics = {};
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalDuration: 0,
      toolUsageCount: {},
    };
    this._cachedFunctionDefs = null;
    this._cachedToolDefs = null;
    this.resetActivatedTools();
  }
}

export default ToolRegistry;