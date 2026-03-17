

import { OpenRouterClient } from '../OpenRouterClient.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import chalk from 'chalk';

/**
 * Custom error types for better error handling
 */
export class AgentError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class ToolExecutionError extends AgentError {
  constructor(toolName, originalError) {
    super(`Tool '${toolName}' failed: ${originalError.message}`, 'TOOL_EXECUTION_ERROR', {
      toolName,
      originalError: originalError.message,
    });
    this.name = 'ToolExecutionError';
  }
}

export class ContextOverflowError extends AgentError {
  constructor(currentTokens, maxTokens) {
    super(`Context overflow: ${currentTokens} tokens exceeds limit of ${maxTokens}`, 'CONTEXT_OVERFLOW', {
      currentTokens,
      maxTokens,
    });
    this.name = 'ContextOverflowError';
  }
}

export class Agent {
  constructor(options = {}) {
    this.client = options.client || new OpenRouterClient(options);
    this.tools = options.tools || new ToolRegistry();
    this.model = options.model; // Must be provided - no hardcoded default
    this.systemPrompt = options.systemPrompt || this.defaultSystemPrompt();
    
    if (!this.model) {
      throw new Error('Model must be specified when creating an Agent. Use the ModelBrowser to select a model.');
    }
    this.messages = [];
    this.maxIterations = options.maxIterations || 30;
    this.verbose = options.verbose !== false;
    this.streaming = options.streaming !== false;
    this.onToolStart = options.onToolStart || null;
    this.onToolEnd = options.onToolEnd || null;
    this.onResponse = options.onResponse || null;
    this.onIterationStart = options.onIterationStart || null;
    this.onIterationEnd = options.onIterationEnd || null;
    this.onError = options.onError || null;
    this.iterationCount = 0;
    this.totalTokensUsed = 0;
    this.totalCost = 0;
    this.history = [];
    
    // Context management settings
    this.maxContextTokens = options.maxContextTokens || 800000;
    this.maxToolResultChars = options.maxToolResultChars || 15000;
    this.compactThreshold = options.compactThreshold || 0.7;
    
    // Retry configuration
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.retryBackoff = options.retryBackoff || 2;
    
    // Performance tracking
    this.performanceMetrics = {
      totalIterations: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      totalRetries: 0,
      avgIterationTime: 0,
      totalExecutionTime: 0,
    };
    
    // State management
    this.state = 'idle'; // idle, running, paused, error, completed
    this.lastError = null;
    this.checkpoints = [];
    
    // Initialize with system prompt
    if (this.systemPrompt) {
      this.messages.push({ role: 'system', content: this.systemPrompt });
    }
  }

  /**
   * Enhanced system prompt with better instructions
   */
  defaultSystemPrompt() {
    return `You are an advanced AI assistant with access to powerful tools. You can:
- Read, write, and edit files
- Execute shell commands
- Search the web and fetch URLs
- Work with git repositories
- Search through codebases

## How You Work
1. **Understand** the user's request carefully
2. **Plan** your approach if the task is complex
3. **Act** using available tools to accomplish the task
4. **Verify** your work by checking results
5. **Iterate** until the task is complete

## Guidelines
- Be concise but thorough
- Show your work and explain what you're doing
- If something fails, try alternative approaches
- Ask for clarification when the request is ambiguous
- For code tasks, write clean, well-documented code
- Always verify file operations succeeded
- Use the most appropriate tool for each task

## Tool Usage
- Use tools proactively to gather context before making changes
- Read files before editing them
- Check git status before committing
- Test code after writing it

## Error Handling
- If a tool fails, analyze the error and try alternative approaches
- For file operations, check if paths exist before writing
- For shell commands, verify the command is correct before executing
- If you encounter repeated failures, explain the issue and suggest solutions

## Performance
- Batch related operations when possible
- Use search tools to find relevant code before making changes
- Minimize unnecessary file reads by checking file info first

When you have completed the task, provide a clear summary of what was done.`;
  }

  /**
   * Run the agentic loop with enhanced error handling and performance tracking
   */
  async run(userInput, options = {}) {
    const startTime = Date.now();
    this.state = 'running';
    this.iterationCount = 0;
    this.lastError = null;
    
    // Add user message
    this.messages.push({ role: 'user', content: userInput });
    
    let finalResponse = null;
    
    try {
      while (this.iterationCount < this.maxIterations) {
        this.iterationCount++;
        this.performanceMetrics.totalIterations++;
        
        const iterationStart = Date.now();
        
        if (this.verbose) {
          console.log(chalk.gray(`\n[Iteration ${this.iterationCount}/${this.maxIterations}]`));
        }
        
        if (this.onIterationStart) {
          this.onIterationStart(this.iterationCount);
        }
        
        // Check context size BEFORE calling LLM
        await this.maybeCompactContext();
        
        // Get LLM response with tools (with retry logic)
        const response = await this.getLLMResponseWithRetry();
        
        if (!response) {
          throw new AgentError('No response from model', 'NO_RESPONSE');
        }
        
        // Check if there are tool calls
        const toolCalls = response.toolCalls || [];
        
        if (toolCalls.length === 0) {
          // No tool calls - this is the final response
          finalResponse = response.content;
          this.messages.push({ role: 'assistant', content: response.content });
          
          if (this.onResponse) {
            this.onResponse(response.content);
          }
          
          break;
        }
        
        // Execute tool calls with enhanced error handling
        const toolResults = await this.executeToolCallsEnhanced(toolCalls);
        
        // Add assistant message with tool calls
        this.messages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
        
        // Add tool results (truncated to prevent context overflow)
        for (const result of toolResults) {
          let content = JSON.stringify(result.result);
          
          // Truncate large tool results
          if (content.length > this.maxToolResultChars) {
            const original = content;
            content = content.substring(0, this.maxToolResultChars) + 
              '\n\n... [truncated - original was ' + original.length + ' chars]';
            
            if (this.verbose) {
              console.log(chalk.yellow(`   ⚠️ Tool result truncated (${original.length} → ${content.length} chars)`));
            }
          }
          
          this.messages.push({
            role: 'tool',
            tool_call_id: result.toolCallId,
            content,
          });
        }
        
        // Record in history
        this.history.push({
          iteration: this.iterationCount,
          response: response.content,
          toolCalls: toolCalls.map(tc => tc.name),
          toolResults: toolResults.map(tr => ({ tool: tr.toolName, success: tr.result.success })),
          duration: Date.now() - iterationStart,
        });
        
        // Update performance metrics
        this.performanceMetrics.avgIterationTime = 
          (this.performanceMetrics.avgIterationTime * (this.performanceMetrics.totalIterations - 1) + 
           (Date.now() - iterationStart)) / this.performanceMetrics.totalIterations;
        
        if (this.onIterationEnd) {
          this.onIterationEnd(this.iterationCount, Date.now() - iterationStart);
        }
      }
      
      if (!finalResponse && this.iterationCount >= this.maxIterations) {
        finalResponse = 'I reached the maximum number of iterations. Here\'s what I accomplished so far:\n\n' +
          this.history.map(h => `- Iteration ${h.iteration}: Used tools: ${h.toolCalls.join(', ')}`).join('\n');
      }
      
      this.state = 'completed';
      this.performanceMetrics.totalExecutionTime = Date.now() - startTime;
      
      return {
        response: finalResponse,
        iterations: this.iterationCount,
        history: this.history,
        messages: this.messages,
        stats: this.getStats(),
        performance: this.performanceMetrics,
      };
      
    } catch (error) {
      this.state = 'error';
      this.lastError = error;
      this.performanceMetrics.totalErrors++;
      
      if (this.onError) {
        this.onError(error);
      }
      
      throw error;
    }
  }

  /**
   * Get LLM response with tool calling and retry logic
   */
  async getLLMResponseWithRetry(retryCount = 0) {
    const maxRetries = this.maxRetries;
    
    // Reduce max_tokens on retries to prevent truncation
    const maxTokens = retryCount === 0 ? 8192 : retryCount === 1 ? 4096 : 2048;
    
    try {
      const result = await this.client.chatWithTools(
        this.messages,
        this.tools.getToolDefinitions(),
        {
          model: this.model,
          temperature: 0.3,
          max_tokens: maxTokens,
        }
      );
      
      // Track usage
      if (result.usage) {
        this.totalTokensUsed += result.usage.total_tokens || 0;
      }
      
      return result;
    } catch (error) {
      // Handle JSON parse errors by retrying with lower max_tokens
      const isJsonError = error.message.includes('JSON') || 
                          error.message.includes('Unexpected end') ||
                          error.message.includes('context length');
      
      if (isJsonError && retryCount < maxRetries) {
        this.performanceMetrics.totalRetries++;
        console.log(chalk.yellow(`   ⚠️ Retrying with shorter response (attempt ${retryCount + 1}/${maxRetries})`));
        
        // Compact context before retry
        await this.maybeCompactContext();
        
        // Exponential backoff
        await this.sleep(this.retryDelay * Math.pow(this.retryBackoff, retryCount));
        
        // Retry with lower max_tokens to avoid truncation
        return this.getLLMResponseWithRetry(retryCount + 1);
      }
      
      console.error(chalk.red(`LLM Error: ${error.message}`));
      throw error;
    }
  }
  
  /**
   * Execute tool calls from LLM with enhanced error handling
   */
  async executeToolCallsEnhanced(toolCalls) {
    const results = [];
    
    // Execute tools in parallel when possible (independent tools)
    const independentTools = [];
    const dependentTools = [];
    
    // Simple heuristic: file reads can be parallel, writes should be sequential
    for (const toolCall of toolCalls) {
      const toolName = toolCall.name;
      if (toolName.startsWith('read_') || toolName === 'list_directory' || toolName === 'search_in_files') {
        independentTools.push(toolCall);
      } else {
        dependentTools.push(toolCall);
      }
    }
    
    // Execute independent tools in parallel
    if (independentTools.length > 1) {
      const parallelResults = await Promise.allSettled(
        independentTools.map(toolCall => this.executeSingleToolCall(toolCall))
      );
      
      for (let i = 0; i < parallelResults.length; i++) {
        const result = parallelResults[i];
        const toolCall = independentTools[i];
        
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
            result: { success: false, error: result.reason.message },
          });
        }
      }
    } else if (independentTools.length === 1) {
      const result = await this.executeSingleToolCall(independentTools[0]);
      results.push(result);
    }
    
    // Execute dependent tools sequentially
    for (const toolCall of dependentTools) {
      const result = await this.executeSingleToolCall(toolCall);
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Execute a single tool call with retry logic
   */
  async executeSingleToolCall(toolCall) {
    const toolName = toolCall.name;
    const args = toolCall.arguments;
    this.performanceMetrics.totalToolCalls++;
    
    if (this.verbose) {
      console.log(chalk.yellow(`\n🔧 Executing: ${toolName}`));
      if (args && Object.keys(args).length > 0) {
        const argStr = JSON.stringify(args);
        console.log(chalk.gray(`   Args: ${argStr.length > 100 ? argStr.substring(0, 100) + '...' : argStr}`));
      }
    }
    
    if (this.onToolStart) {
      this.onToolStart(toolName, args);
    }
    
    let lastError = null;
    
    // Retry logic for tool execution
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.tools.execute(toolName, args);
        
        if (this.verbose) {
          if (result.success !== false) {
            console.log(chalk.green(`   ✓ Success`));
          } else {
            console.log(chalk.red(`   ✗ Failed: ${result.error}`));
          }
        }
        
        if (this.onToolEnd) {
          this.onToolEnd(toolName, result);
        }
        
        return {
          toolCallId: toolCall.id,
          toolName,
          args,
          result,
        };
        
      } catch (error) {
        lastError = error;
        this.performanceMetrics.totalRetries++;
        
        if (attempt < this.maxRetries) {
          console.log(chalk.yellow(`   ⚠️ Retry ${attempt + 1}/${this.maxRetries} for ${toolName}`));
          await this.sleep(this.retryDelay * Math.pow(this.retryBackoff, attempt));
        }
      }
    }
    
    // All retries failed
    if (this.verbose) {
      console.log(chalk.red(`   ✗ Failed after ${this.maxRetries} retries: ${lastError.message}`));
    }
    
    if (this.onToolEnd) {
      this.onToolEnd(toolName, { success: false, error: lastError.message });
    }
    
    return {
      toolCallId: toolCall.id,
      toolName,
      args,
      result: { success: false, error: lastError.message },
    };
  }
  
  /**
   * Run a streaming version of the agent
   */
  async *runStream(userInput) {
    this.messages.push({ role: 'user', content: userInput });
    this.iterationCount = 0;
    
    while (this.iterationCount < this.maxIterations) {
      this.iterationCount++;
      
      yield { type: 'iteration', iteration: this.iterationCount };
      
      // Get streaming response
      const stream = this.client.chatStream(this.messages, {
        model: this.model,
        temperature: 0.3,
      });
      
      let fullContent = '';
      let toolCalls = [];
      
      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          fullContent += chunk.content;
          yield { type: 'content', content: chunk.content };
        } else if (chunk.type === 'tool_calls') {
          toolCalls = chunk.toolCalls;
        } else if (chunk.type === 'done') {
          if (chunk.usage) {
            this.totalTokensUsed += chunk.usage.total_tokens || 0;
          }
        }
      }
      
      if (toolCalls.length === 0) {
        // Final response
        this.messages.push({ role: 'assistant', content: fullContent });
        yield { type: 'done', content: fullContent };
        return;
      }
      
      // Execute tools
      yield { type: 'tools_start', count: toolCalls.length };
      
      const results = await this.executeToolCallsEnhanced(toolCalls);
      
      // Add messages
      this.messages.push({
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });
      
      for (const result of results) {
        this.messages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.result),
        });
      }
      
      yield {
        type: 'tools_done',
        results: results.map(r => ({ tool: r.toolName, success: r.result.success })),
      };
    }
    
    yield { type: 'max_iterations', iterations: this.iterationCount };
  }

  /**
   * Estimate token count (improved estimation)
   */
  estimateTokens() {
    let total = 0;
    for (const msg of this.messages) {
      if (msg.content) {
        // More accurate estimation: ~4 chars per token for English, ~3 for code
        const isCode = /[{}\[\]()=><]/.test(msg.content);
        total += isCode ? Math.ceil(msg.content.length / 3) : Math.ceil(msg.content.length / 4);
      }
      if (msg.tool_calls) total += JSON.stringify(msg.tool_calls).length / 3;
    }
    return Math.ceil(total);
  }

  /**
   * Compact context when approaching limit
   */
  async maybeCompactContext() {
    const estimatedTokens = this.estimateTokens();
    
    if (estimatedTokens < this.maxContextTokens * this.compactThreshold) {
      return; // Still have room
    }
    
    if (this.verbose) {
      console.log(chalk.yellow(`   ⚠️ Context compaction triggered (~${estimatedTokens} tokens)`));
    }
    
    // Keep system prompt + first user message + last N messages
    const systemMsg = this.messages.find(m => m.role === 'system');
    const userMsgs = this.messages.filter(m => m.role === 'user');
    const firstUser = userMsgs[0];
    
    // Keep last 10 messages (5 tool call rounds)
    const recentMessages = this.messages.slice(-20);
    
    // Rebuild messages
    const newMessages = [];
    if (systemMsg) newMessages.push(systemMsg);
    if (firstUser && !recentMessages.includes(firstUser)) {
      newMessages.push(firstUser);
      newMessages.push({
        role: 'assistant',
        content: '[Context was compacted. Previous tool calls and results were summarized.]',
      });
    }
    newMessages.push(...recentMessages);
    
    this.messages = newMessages;
    
    const newTokens = this.estimateTokens();
    if (this.verbose) {
      console.log(chalk.green(`   ✓ Context compacted: ~${estimatedTokens} → ~${newTokens} tokens`));
    }
  }

  /**
   * Chat without tools (simple conversation)
   */
  async chat(message, options = {}) {
    this.messages.push({ role: 'user', content: message });
    
    const result = await this.client.chat(this.messages, {
      model: options.model || this.model,
      temperature: options.temperature || 0.7,
    });
    
    this.messages.push({ role: 'assistant', content: result.content });
    
    if (result.usage) {
      this.totalTokensUsed += result.usage.total_tokens || 0;
    }
    
    return result;
  }

  /**
   * Get comprehensive session statistics
   */
  getStats() {
    return {
      iterations: this.iterationCount,
      totalMessages: this.messages.length,
      totalTokensUsed: this.totalTokensUsed,
      toolExecutions: this.history.reduce((sum, h) => sum + h.toolCalls.length, 0),
      toolsUsed: [...new Set(this.history.flatMap(h => h.toolCalls))],
      state: this.state,
      performance: this.performanceMetrics,
      estimatedTokens: this.estimateTokens(),
      contextUsage: `${Math.round((this.estimateTokens() / this.maxContextTokens) * 100)}%`,
    };
  }

  /**
   * Clear conversation history
   */
  clear() {
    this.messages = [];
    if (this.systemPrompt) {
      this.messages.push({ role: 'system', content: this.systemPrompt });
    }
    this.history = [];
    this.iterationCount = 0;
    this.state = 'idle';
    this.lastError = null;
    this.performanceMetrics = {
      totalIterations: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      totalRetries: 0,
      avgIterationTime: 0,
      totalExecutionTime: 0,
    };
  }

  /**
   * Export conversation with full state
   */
  export() {
    return {
      model: this.model,
      systemPrompt: this.systemPrompt,
      messages: this.messages,
      history: this.history,
      stats: this.getStats(),
      performance: this.performanceMetrics,
      state: this.state,
      timestamp: new Date().toISOString(),
      version: '3.0',
    };
  }

  /**
   * Import conversation with state restoration
   */
  import(data) {
    this.model = data.model || this.model;
    this.messages = data.messages || [];
    this.history = data.history || [];
    this.performanceMetrics = data.performance || this.performanceMetrics;
    this.state = data.state || 'idle';
    return this;
  }
  
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get checkpoint info (AgentSession handles checkpoint storage)
   */
  getCheckpoints() {
    return this.checkpoints;
  }
}

export default Agent;
