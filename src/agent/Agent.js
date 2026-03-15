/**
 * 🤖 Agent Engine
 * The core agentic loop: gather context → take action → verify results → repeat
 */

import { OpenRouterClient } from '../OpenRouterClient.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import chalk from 'chalk';

export class Agent {
  constructor(options = {}) {
    this.client = options.client || new OpenRouterClient(options);
    this.tools = options.tools || new ToolRegistry();
    this.model = options.model || 'anthropic/claude-sonnet-4';
    this.systemPrompt = options.systemPrompt || this.defaultSystemPrompt();
    this.messages = [];
    this.maxIterations = options.maxIterations || 30;
    this.verbose = options.verbose !== false;
    this.streaming = options.streaming !== false;
    this.onToolStart = options.onToolStart || null;
    this.onToolEnd = options.onToolEnd || null;
    this.onResponse = options.onResponse || null;
    this.iterationCount = 0;
    this.totalTokensUsed = 0;
    this.totalCost = 0;
    this.history = [];
    
    // Context management settings
    this.maxContextTokens = options.maxContextTokens || 800000; // Leave room for output
    this.maxToolResultChars = options.maxToolResultChars || 15000; // Truncate large tool results
    this.compactThreshold = options.compactThreshold || 0.7; // Compact when 70% full
    
    // Initialize with system prompt
    if (this.systemPrompt) {
      this.messages.push({ role: 'system', content: this.systemPrompt });
    }
  }

  /**
   * Default system prompt for agentic behavior
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

When you have completed the task, provide a clear summary of what was done.`;
  }

  /**
   * Run the agentic loop
   */
  async run(userInput, options = {}) {
    this.iterationCount = 0;
    
    // Add user message
    this.messages.push({ role: 'user', content: userInput });
    
    let finalResponse = null;
    
    while (this.iterationCount < this.maxIterations) {
      this.iterationCount++;
      
      if (this.verbose) {
        console.log(chalk.gray(`\n[Iteration ${this.iterationCount}/${this.maxIterations}]`));
      }
      
      // Check context size BEFORE calling LLM
      await this.maybeCompactContext();
      
      // Get LLM response with tools
      const response = await this.getLLMResponse();
      
      if (!response) {
        throw new Error('No response from model');
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
      
      // Execute tool calls
      const toolResults = await this.executeToolCalls(toolCalls);
      
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
      
      // Check if we need to compact context
      await this.maybeCompactContext();
      
      // Record in history
      this.history.push({
        iteration: this.iterationCount,
        response: response.content,
        toolCalls: toolCalls.map(tc => tc.name),
        toolResults: toolResults.map(tr => ({ tool: tr.toolName, success: tr.result.success })),
      });
    }
    
    if (!finalResponse && this.iterationCount >= this.maxIterations) {
      finalResponse = 'I reached the maximum number of iterations. Here\'s what I accomplished so far:\n\n' +
        this.history.map(h => `- Iteration ${h.iteration}: Used tools: ${h.toolCalls.join(', ')}`).join('\n');
    }
    
    return {
      response: finalResponse,
      iterations: this.iterationCount,
      history: this.history,
      messages: this.messages,
      stats: this.getStats(),
    };
  }

  /**
   * Get LLM response with tool calling
   */
  async getLLMResponse(retryCount = 0) {
    const maxRetries = 2;
    
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
        console.log(chalk.yellow(`   ⚠️ Retrying with shorter response (attempt ${retryCount + 1}/${maxRetries})`));
        
        // Compact context before retry
        await this.maybeCompactContext();
        
        // Retry with lower max_tokens to avoid truncation
        return this.getLLMResponse(retryCount + 1);
      }
      
      console.error(chalk.red(`LLM Error: ${error.message}`));
      throw error;
    }
  }

  /**
   * Execute tool calls from LLM
   */
  async executeToolCalls(toolCalls) {
    const results = [];
    
    for (const toolCall of toolCalls) {
      const toolName = toolCall.name;
      const args = toolCall.arguments;
      
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
      
      results.push({
        toolCallId: toolCall.id,
        toolName,
        args,
        result,
      });
    }
    
    return results;
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
      
      const results = await this.executeToolCalls(toolCalls);
      
      // Add messages
      this.messages.push({
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
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
   * Estimate token count (rough: ~4 chars per token)
   */
  estimateTokens() {
    let total = 0;
    for (const msg of this.messages) {
      if (msg.content) total += msg.content.length;
      if (msg.tool_calls) total += JSON.stringify(msg.tool_calls).length;
    }
    return Math.ceil(total / 4);
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
   * Get session statistics
   */
  getStats() {
    return {
      iterations: this.iterationCount,
      totalMessages: this.messages.length,
      totalTokensUsed: this.totalTokensUsed,
      toolExecutions: this.history.reduce((sum, h) => sum + h.toolCalls.length, 0),
      toolsUsed: [...new Set(this.history.flatMap(h => h.toolCalls))],
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
  }

  /**
   * Export conversation
   */
  export() {
    return {
      model: this.model,
      systemPrompt: this.systemPrompt,
      messages: this.messages,
      history: this.history,
      stats: this.getStats(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Import conversation
   */
  import(data) {
    this.model = data.model || this.model;
    this.messages = data.messages || [];
    this.history = data.history || [];
    return this;
  }
}

export default Agent;
