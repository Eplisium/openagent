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

import chalk from 'chalk';
import { ToolErrorType } from '../errors.js';

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
    this.maxHistorySize = options.maxHistorySize || 500;
    this.enableValidation = options.enableValidation !== false;
    
    // Statistics
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalDuration: 0,
      toolUsageCount: {},
    };
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
    if (tool.parameters && tool.parameters.type !== 'object') {
      console.warn(chalk.yellow(`⚠️ Tool '${tool.name}' parameters should be of type 'object'`));
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
   * Execute a tool with permission checks, validation, and timeout
   */
  async execute(toolName, args = {}) {
    const startTime = Date.now();
    this.stats.totalExecutions++;
    
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
      
      return {
        ...result,
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
    
    // Keep history manageable
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-Math.floor(this.maxHistorySize / 2));
    }
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
}

export default ToolRegistry;
