/**
 * 🛠️ Tool Registry
 * Central registry for all available tools with execution and validation
 */

import chalk from 'chalk';

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.executionHistory = [];
    this.permissions = {
      allowShell: true,
      allowFileWrite: true,
      allowFileDelete: false,
      allowNetwork: true,
      allowGit: true,
      confirmDestructive: true,
    };
  }

  /**
   * Register a tool
   */
  register(tool) {
    if (!tool.name || !tool.execute) {
      throw new Error('Tool must have a name and execute function');
    }
    this.tools.set(tool.name, tool);
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
   * Get all tools as OpenRouter function definitions
   */
  getFunctionDefinitions() {
    const defs = [];
    for (const [name, tool] of this.tools) {
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
    return defs;
  }

  /**
   * Get tool definitions in simplified format
   */
  getToolDefinitions() {
    const defs = [];
    for (const [name, tool] of this.tools) {
      if (tool.enabled !== false) {
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
   * Execute a tool with permission checks
   */
  async execute(toolName, args = {}) {
    const tool = this.tools.get(toolName);
    
    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolName}" not found`,
        availableTools: Array.from(this.tools.keys()),
      };
    }

    // Permission checks
    if (tool.category === 'shell' && !this.permissions.allowShell) {
      return { success: false, error: 'Shell execution is disabled' };
    }
    if (tool.category === 'file' && tool.destructive && !this.permissions.allowFileDelete) {
      return { success: false, error: 'File deletion is disabled' };
    }
    if (tool.category === 'network' && !this.permissions.allowNetwork) {
      return { success: false, error: 'Network access is disabled' };
    }

    // Confirm destructive operations
    if (tool.destructive && this.permissions.confirmDestructive) {
      // In interactive mode, this would prompt the user
      // For now, we log it
      console.log(chalk.yellow(`⚠️  Destructive operation: ${toolName}`));
    }

    const startTime = Date.now();
    
    try {
      const result = await tool.execute(args);
      const duration = Date.now() - startTime;
      
      const entry = {
        tool: toolName,
        args,
        result: result.success !== false ? 'success' : 'failure',
        duration,
        timestamp: new Date().toISOString(),
      };
      
      this.executionHistory.push(entry);
      
      // Keep history manageable
      if (this.executionHistory.length > 500) {
        this.executionHistory = this.executionHistory.slice(-250);
      }
      
      return {
        ...result,
        _meta: { tool: toolName, duration },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.executionHistory.push({
        tool: toolName,
        args,
        result: 'error',
        error: error.message,
        duration,
        timestamp: new Date().toISOString(),
      });
      
      return {
        success: false,
        error: error.message,
        _meta: { tool: toolName, duration },
      };
    }
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
   * Get stats
   */
  getStats() {
    const total = this.executionHistory.length;
    const successful = this.executionHistory.filter(e => e.result === 'success').length;
    const failed = total - successful;
    const avgDuration = total > 0
      ? this.executionHistory.reduce((sum, e) => sum + e.duration, 0) / total
      : 0;

    return {
      totalExecutions: total,
      successful,
      failed,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) + '%' : 'N/A',
      avgDuration: Math.round(avgDuration) + 'ms',
      registeredTools: this.tools.size,
    };
  }

  /**
   * List all registered tools
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
      });
    }
    return list;
  }
}

export default ToolRegistry;
