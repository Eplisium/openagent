

import { OpenRouterClient, AbortError } from '../OpenRouterClient.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { CONFIG } from '../config.js';
import chalk from 'chalk';

function normalizeOptionalLimit(value, fallback = null) {
  const candidate = value ?? fallback;

  if (candidate === undefined || candidate === null || candidate === '') {
    return null;
  }

  const normalized = String(candidate).trim().toLowerCase();
  if (!normalized || ['0', 'none', 'null', 'unlimited', 'infinity', 'inf', 'auto'].includes(normalized)) {
    return null;
  }

  const parsed = parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePositiveInt(value, fallback) {
  const candidate = value ?? fallback;

  if (candidate === undefined || candidate === null || candidate === '') {
    return fallback;
  }

  const parsed = parseInt(candidate, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

export class AgentAbortError extends AgentError {
  constructor(message = 'Agent execution aborted') {
    super(message, 'AGENT_ABORTED');
    this.name = 'AgentAbortError';
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
    this.cachedEstimatedTokens = 0;
    this.contextStats = {
      estimatedTokens: 0,
      compactions: 0,
      lastPromptTokens: 0,
      lastCompletionTokens: 0,
      lastTotalTokens: 0,
    };
    this.maxIterations = normalizeOptionalLimit(options.maxIterations, CONFIG.AGENT_MAX_ITERATIONS);
    this.maxRuntimeMs = normalizeOptionalLimit(options.maxRuntimeMs, CONFIG.AGENT_MAX_RUNTIME_MS);
    this.maxToolCalls = normalizeOptionalLimit(options.maxToolCalls, CONFIG.AGENT_MAX_TOOL_CALLS);
    this.maxStallIterations = normalizePositiveInt(options.maxStallIterations, CONFIG.AGENT_MAX_STALL_ITERATIONS);
    this.verbose = options.verbose !== false;
    this.streaming = options.streaming !== false;
    this.onToolStart = options.onToolStart || null;
    this.onToolEnd = options.onToolEnd || null;
    this.onResponse = options.onResponse || null;
    this.onIterationStart = options.onIterationStart || null;
    this.onIterationEnd = options.onIterationEnd || null;
    this.onError = options.onError || null;
    this.onStatus = options.onStatus || null;
    this.iterationCount = 0;
    this.totalTokensUsed = 0;
    this.totalCost = 0;
    this.history = [];
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.repeatedToolRoundCount = 0;
    
    // Context management settings
    this.maxContextTokens = options.maxContextTokens || CONFIG.MAX_CONTEXT_TOKENS;
    this.maxToolResultChars = options.maxToolResultChars || CONFIG.MAX_TOOL_RESULT_CHARS;
    this.compactThreshold = options.compactThreshold || CONFIG.COMPACT_THRESHOLD;
    
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
    
    // AbortController for cancelling execution
    this.abortController = null;
    this.aborted = false;

    // Circuit breaker: track consecutive failures by error type
    this.consecutiveFailures = {}; // { errorCategory: count }
    this.circuitBreakerThreshold = 3;
    this.circuitBreakerTripped = false;

    // Stall detection: track last tool call for repeated identical calls
    this.lastSingleToolSignature = null;
    this.repeatedSingleToolCount = 0;
    this.singleToolStallThreshold = 3;

    // Initialize with system prompt
    if (this.systemPrompt) {
      this.pushMessage({ role: 'system', content: this.systemPrompt });
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
   * Abort the current execution
   */
  abort() {
    this.aborted = true;
    if (this.abortController) {
      this.abortController.abort();
    }
    this.state = 'aborted';
  }
  
  /**
   * Check if execution was aborted
   */
  checkAborted() {
    if (this.aborted) {
      throw new AgentAbortError('Agent execution was aborted');
    }
  }

  hasReachedIterationLimit() {
    return this.maxIterations !== null && this.iterationCount >= this.maxIterations;
  }

  hasReachedRuntimeLimit(startTime) {
    return this.maxRuntimeMs !== null && (Date.now() - startTime) >= this.maxRuntimeMs;
  }

  hasReachedToolCallLimit() {
    return this.maxToolCalls !== null && this.performanceMetrics.totalToolCalls >= this.maxToolCalls;
  }

  hasStalled() {
    return this.repeatedToolRoundCount >= this.maxStallIterations;
  }

  formatIterationLabel() {
    return this.maxIterations !== null
      ? `iteration ${this.iterationCount}/${this.maxIterations}`
      : `iteration ${this.iterationCount}`;
  }

  recordToolRound(toolCalls) {
    const signature = JSON.stringify(
      toolCalls.map(toolCall => ({
        name: toolCall.name,
        arguments: toolCall.arguments,
      }))
    );

    if (signature === this.lastToolCallSignature) {
      this.repeatedToolRoundCount++;
    } else {
      this.lastToolCallSignature = signature;
      this.repeatedToolRoundCount = 1;
    }
  }

  hasExternalRenderer() {
    return Boolean(
      this.onToolStart ||
      this.onToolEnd ||
      this.onResponse ||
      this.onIterationStart ||
      this.onIterationEnd ||
      this.onStatus
    );
  }

  shouldEmitVerboseLogs() {
    return this.verbose && !this.hasExternalRenderer();
  }

  emitStatus(type, message) {
    if (!this.onStatus) {
      return false;
    }

    this.onStatus({ type, message });
    return true;
  }

  estimateMessageTokens(message = {}) {
    let total = 0;

    if (message.content) {
      if (typeof message.content === 'string') {
        // String content: estimate based on character patterns
        const content = message.content;
        const isCode = /[{}\[\]()=><;]/.test(content);
        // Code is ~3 chars/token, prose is ~4 chars/token
        total += isCode ? Math.ceil(content.length / 3) : Math.ceil(content.length / 4);
      } else if (Array.isArray(message.content)) {
        // Multimodal content (text + images)
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            total += Math.ceil(part.text.length / 4);
          } else if (part.type === 'image_url') {
            // Images cost ~85 tokens for low-res, ~765 for high-res
            // Estimate ~85 tokens per image as baseline
            total += 85;
          }
        }
      } else {
        total += Math.ceil(JSON.stringify(message.content).length / 4);
      }
    }

    if (message.tool_calls) {
      total += Math.ceil(JSON.stringify(message.tool_calls).length / 3);
    }

    // Add overhead per message (~4 tokens for role/metadata)
    total += 4;

    return total;
  }

  recalculateEstimatedTokens() {
    this.cachedEstimatedTokens = this.messages.reduce(
      (sum, message) => sum + this.estimateMessageTokens(message),
      0
    );
    this.contextStats.estimatedTokens = this.cachedEstimatedTokens;
    return this.cachedEstimatedTokens;
  }

  setMessages(messages = []) {
    this.messages = Array.isArray(messages) ? messages : [];
    this.recalculateEstimatedTokens();
  }

  pushMessage(message) {
    this.messages.push(message);
    this.cachedEstimatedTokens += this.estimateMessageTokens(message);
    this.contextStats.estimatedTokens = this.cachedEstimatedTokens;
    return message;
  }

  setSystemPrompt(systemPrompt) {
    this.systemPrompt = systemPrompt || '';
    const systemMessageIndex = this.messages.findIndex(message => message.role === 'system');

    if (systemMessageIndex >= 0) {
      this.messages[systemMessageIndex].content = this.systemPrompt;
      this.recalculateEstimatedTokens();
      return;
    }

    if (this.systemPrompt) {
      this.setMessages([{ role: 'system', content: this.systemPrompt }, ...this.messages]);
    }
  }

  setMaxContextTokens(maxContextTokens) {
    if (Number.isFinite(maxContextTokens) && maxContextTokens > 0) {
      this.maxContextTokens = maxContextTokens;
    }

    return this.maxContextTokens;
  }

  updateUsageStats(usage) {
    if (!usage) {
      return;
    }

    this.totalTokensUsed += usage.total_tokens || 0;
    this.contextStats.lastPromptTokens = usage.prompt_tokens || 0;
    this.contextStats.lastCompletionTokens = usage.completion_tokens || 0;
    this.contextStats.lastTotalTokens = usage.total_tokens || 0;
  }

  getContextStats(maxTokens = this.maxContextTokens) {
    const usedTokens = this.estimateTokens();
    const safeMax = Number.isFinite(maxTokens) && maxTokens > 0
      ? maxTokens
      : CONFIG.MAX_CONTEXT_TOKENS;
    const percent = safeMax > 0
      ? Math.min(100, Math.round((usedTokens / safeMax) * 100))
      : 0;

    return {
      usedTokens,
      maxTokens: safeMax,
      percent,
      compactThreshold: this.compactThreshold,
      compactions: this.contextStats.compactions,
      lastPromptTokens: this.contextStats.lastPromptTokens,
      lastCompletionTokens: this.contextStats.lastCompletionTokens,
      lastTotalTokens: this.contextStats.lastTotalTokens,
    };
  }

  formatCompactNumber(value) {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return Math.round(value).toString();
  }

  truncateText(text, maxLength = 160) {
    if (!text || text.length <= maxLength) {
      return text;
    }

    return `${text.substring(0, maxLength - 3).trimEnd()}...`;
  }

  buildCompactionSummary(olderMessages = []) {
    const priorUserMessages = olderMessages
      .filter(message => message.role === 'user' && message.content)
      .slice(-3);
    const recentHistory = this.history.slice(-6);
    const lines = ['[Context compacted to preserve headroom.]'];

    if (priorUserMessages.length > 0) {
      lines.push('Recent user intents:');
      for (const message of priorUserMessages) {
        const normalized = String(message.content).replace(/\s+/g, ' ').trim();
        lines.push(`- ${this.truncateText(normalized, 160)}`);
      }
    }

    if (recentHistory.length > 0) {
      lines.push('Recent tool work:');
      for (const entry of recentHistory) {
        const tools = entry.toolCalls.join(', ') || 'no tools';
        lines.push(`- Iteration ${entry.iteration}: ${tools}`);
      }
    }

    return lines.join('\n');
  }

  formatRecentHistory(history, limit = 10) {
    if (!history || history.length === 0) {
      return '- No tool work was recorded.';
    }

    return history
      .slice(-limit)
      .map(entry => `- Iteration ${entry.iteration}: Used tools: ${entry.toolCalls.join(', ') || 'none'}`)
      .join('\n');
  }

  buildStopMessage(reason, history, startTime) {
    switch (reason) {
      case 'max_iterations':
        return `I stopped after reaching the configured iteration limit (${this.maxIterations}).\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'max_runtime':
        return `I stopped after reaching the configured runtime limit (${Math.round((Date.now() - startTime) / 1000)}s).\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'max_tool_calls':
        return `I stopped after reaching the configured tool-call limit (${this.maxToolCalls}).\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'stalled':
        return `I stopped because I appeared to be repeating the same tool workflow without making progress.\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
      case 'aborted':
        return 'Agent execution was aborted.';
      default:
        return `I stopped before producing a final answer.\n\nRecent progress:\n${this.formatRecentHistory(history)}`;
    }
  }
  
  /**
   * Run the agentic loop with enhanced error handling and performance tracking
   */
  async run(userInput, options = {}) {
    const startTime = Date.now();
    this.state = 'running';
    this.iterationCount = 0;
    this.lastError = null;
    this.aborted = false;
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.repeatedToolRoundCount = 0;
    this.abortController = new AbortController();
    
    // Add user message (skip if already pushed, e.g. multimodal messages)
    if (userInput !== undefined && userInput !== null) {
      this.pushMessage({ role: 'user', content: userInput });
    }
    
    let finalResponse = null;
    const runHistory = [];
    
    try {
      while (true) {
        this.checkAborted();

        if (this.hasReachedIterationLimit()) {
          this.stopReason = 'max_iterations';
          break;
        }

        if (this.hasReachedRuntimeLimit(startTime)) {
          this.stopReason = 'max_runtime';
          break;
        }

        if (this.hasReachedToolCallLimit()) {
          this.stopReason = 'max_tool_calls';
          break;
        }

        if (this.hasStalled()) {
          this.stopReason = 'stalled';
          break;
        }
        
        this.iterationCount++;
        this.performanceMetrics.totalIterations++;
        
        const iterationStart = Date.now();
        
        if (this.shouldEmitVerboseLogs()) {
          console.log(chalk.dim(`\n── ${this.formatIterationLabel()} ──`));
        }
        
        if (this.onIterationStart) {
          this.onIterationStart(this.iterationCount);
        }
        
        // Check context size BEFORE calling LLM
        await this.maybeCompactContext();
        
        // Proactive context warning at 60% usage
        const ctxStats = this.getContextStats();
        if (ctxStats.percent > 60 && ctxStats.percent <= 70) {
          const warnMsg = `Context usage at ${ctxStats.percent}% (~${this.formatCompactNumber(ctxStats.usedTokens)} tokens). Consider wrapping up soon.`;
          if (!this.emitStatus('context_warning', warnMsg) && this.shouldEmitVerboseLogs()) {
            console.log(chalk.yellow(`   ⚠️ ${warnMsg}`));
          }
        }
        
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
          this.pushMessage({ role: 'assistant', content: response.content });
          this.stopReason = 'completed';
          
          if (this.onResponse) {
            this.onResponse(response.content);
          }
          
          break;
        }
        
        // Execute tool calls with enhanced error handling
        const toolResults = await this.executeToolCallsEnhanced(toolCalls);

        // Circuit breaker: if tripped, inject a recovery message to the model
        if (this.circuitBreakerTripped) {
          const failedResults = toolResults.filter(r => r.result && r.result.success === false);
          if (failedResults.length > 0) {
            const lastFailure = failedResults[failedResults.length - 1];
            const suggestion = this.getRecoverySuggestion(lastFailure.result.error, lastFailure.toolName);
            this.pushMessage({
              role: 'user',
              content: `[System] Multiple consecutive tool failures detected (${lastFailure.toolName}). The same error type has occurred ${this.circuitBreakerThreshold}+ times in a row. ${suggestion} Please try a fundamentally different approach rather than retrying the same operation.`,
            });
            // Reset circuit breaker after injecting the message
            this.consecutiveFailures = {};
            this.circuitBreakerTripped = false;
          }
        }

        // Stall detection: if the model calls the same single tool with same args repeatedly
        if (toolCalls.length === 1) {
          const singleSig = JSON.stringify({ name: toolCalls[0].name, args: toolCalls[0].arguments });
          if (singleSig === this.lastSingleToolSignature) {
            this.repeatedSingleToolCount++;
          } else {
            this.lastSingleToolSignature = singleSig;
            this.repeatedSingleToolCount = 1;
          }

          if (this.repeatedSingleToolCount >= this.singleToolStallThreshold) {
            const stallTool = toolCalls[0].name;
            const stallMessage = `[System] You have called the "${stallTool}" tool with the same arguments ${this.repeatedSingleToolCount} times in a row without making progress. This suggests the approach is not working. Please: (1) try a different tool or strategy, (2) re-examine your plan, or (3) provide your best answer with what you have gathered so far.`;
            this.pushMessage({ role: 'user', content: stallMessage });
            this.repeatedSingleToolCount = 0;
            this.lastSingleToolSignature = null;
          }
        } else {
          // Multiple tool calls in one round - reset single-tool stall tracking
          this.lastSingleToolSignature = null;
          this.repeatedSingleToolCount = 0;
        }

        // Add assistant message with tool calls
        this.pushMessage({
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
            
            const truncationMessage = `Tool result truncated (${original.length} -> ${content.length} chars)`;
            if (!this.emitStatus('truncate', truncationMessage) && this.shouldEmitVerboseLogs()) {
              console.log(chalk.yellow(`   ⚠️ ${truncationMessage}`));
            }
          }
          
          this.pushMessage({
            role: 'tool',
            tool_call_id: result.toolCallId,
            content,
          });
        }
        
        // Record in history
        const iterationRecord = {
          iteration: this.iterationCount,
          response: response.content,
          toolCalls: toolCalls.map(tc => tc.name),
          toolResults: toolResults.map(tr => ({ tool: tr.toolName, success: tr.result.success })),
          duration: Date.now() - iterationStart,
        };
        this.history.push(iterationRecord);
        runHistory.push(iterationRecord);
        this.recordToolRound(toolCalls);
        
        // Update performance metrics
        this.performanceMetrics.avgIterationTime = 
          (this.performanceMetrics.avgIterationTime * (this.performanceMetrics.totalIterations - 1) + 
           (Date.now() - iterationStart)) / this.performanceMetrics.totalIterations;
        
        if (this.onIterationEnd) {
          this.onIterationEnd(this.iterationCount, Date.now() - iterationStart);
        }
      }
      
      if (!finalResponse) {
        finalResponse = this.buildStopMessage(this.stopReason, runHistory, startTime);
      }
      
      this.state = 'completed';
      this.performanceMetrics.totalExecutionTime = Date.now() - startTime;
      
      return {
        response: finalResponse,
        iterations: this.iterationCount,
        history: runHistory,
        messages: this.messages,
        stats: this.getStats(),
        performance: this.performanceMetrics,
        stopReason: this.stopReason,
        completed: this.stopReason === 'completed',
      };
      
    } catch (error) {
      if (error instanceof AgentAbortError || error instanceof AbortError) {
        this.state = 'aborted';
        this.stopReason = 'aborted';
      } else {
        this.state = 'error';
      }
      this.lastError = error;
      this.performanceMetrics.totalErrors++;
      
      if (this.onError) {
        this.onError(error);
      }
      
      throw error;
    } finally {
      this.abortController = null;
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
      this.updateUsageStats(result.usage);
      
      return result;
    } catch (error) {
      // Handle JSON parse errors by retrying with lower max_tokens
      const isJsonError = error.message.includes('JSON') || 
                          error.message.includes('Unexpected end') ||
                          error.message.includes('context length');
      
      if (isJsonError && retryCount < maxRetries) {
        this.performanceMetrics.totalRetries++;
        const retryMessage = `Retrying with shorter response (attempt ${retryCount + 1}/${maxRetries})`;
        if (!this.emitStatus('retry', retryMessage) && this.shouldEmitVerboseLogs()) {
          console.log(chalk.yellow(`   ⚠️ ${retryMessage}`));
        }
        
        // Compact context before retry
        await this.maybeCompactContext();
        
        // Exponential backoff
        await this.sleep(this.retryDelay * Math.pow(this.retryBackoff, retryCount));
        
        // Retry with lower max_tokens to avoid truncation
        return this.getLLMResponseWithRetry(retryCount + 1);
      }
      
      if (error.code === 'TIMEOUT') {
        console.error(chalk.red(`\n⏱️ Request timed out after ${Math.round(this.client.timeout / 1000)}s`));
        console.error(chalk.dim('   This can happen with complex tasks. Try:'));
        console.error(chalk.dim('   1. Increase TIMEOUT_MS in .env (e.g., TIMEOUT_MS=600000)'));
        console.error(chalk.dim('   2. Break the task into smaller pieces'));
        console.error(chalk.dim('   3. Use a faster model (e.g., claude-haiku-3)'));
      } else {
        console.error(chalk.red(`LLM Error: ${error.message}`));
      }
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

    // Track consecutive failures by error category for circuit breaker
    for (const result of results) {
      if (result.result && result.result.success === false) {
        const errorCategory = this.categorizeError({ message: result.result.error || '' });
        this.consecutiveFailures[errorCategory] = (this.consecutiveFailures[errorCategory] || 0) + 1;

        if (this.consecutiveFailures[errorCategory] >= this.circuitBreakerThreshold) {
          this.circuitBreakerTripped = true;
          const suggestion = this.getRecoverySuggestion(result.result.error, result.toolName);
          const circuitMessage = `Circuit breaker tripped: ${errorCategory} errors (${this.consecutiveFailures[errorCategory]} consecutive). ${suggestion}`;
          if (!this.emitStatus('circuit_breaker', circuitMessage) && this.shouldEmitVerboseLogs()) {
            console.log(chalk.red(`   ⚡ ${circuitMessage}`));
          }
        }
      } else {
        // Reset all consecutive failure counters on any success
        this.consecutiveFailures = {};
        this.circuitBreakerTripped = false;
      }
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
    
    if (this.shouldEmitVerboseLogs()) {
      // Compact tool output - avoid clashing with subagent UI
      const argPreview = args?.path || args?.command?.substring(0, 40) || args?.query?.substring(0, 40) || '';
      console.log(chalk.yellow(`  🔧 ${toolName}`) + (argPreview ? chalk.dim(` ${argPreview}`) : ''));
    }
    
    if (this.onToolStart) {
      this.onToolStart(toolName, args);
    }
    
    let lastError = null;
    
    // Retry logic for tool execution
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.tools.execute(toolName, args);
        
        if (this.shouldEmitVerboseLogs()) {
          if (result.success !== false) {
            console.log(chalk.green(`     ✓`));
          } else {
            console.log(chalk.red(`     ✗ ${result.error?.substring(0, 60) || 'failed'}`));
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
          const retryMessage = `Retry ${attempt + 1}/${this.maxRetries} for ${toolName}`;
          if (!this.emitStatus('retry', retryMessage) && this.shouldEmitVerboseLogs()) {
            console.log(chalk.yellow(`   ⚠️ ${retryMessage}`));
          }
          await this.sleep(this.retryDelay * Math.pow(this.retryBackoff, attempt));
        }
      }
    }
    
    // All retries failed
    if (this.shouldEmitVerboseLogs()) {
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
   * Categorize an error type for circuit breaker tracking
   * @param {Error} error - The error to categorize
   * @returns {string} Error category identifier
   */
  categorizeError(error) {
    const message = (error?.message || '').toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
      return 'TIMEOUT';
    }
    if (message.includes('permission') || message.includes('access denied') || message.includes('eacces') || message.includes('eperm')) {
      return 'PERMISSION';
    }
    if (message.includes('enoent') || message.includes('not found') || message.includes('no such file')) {
      return 'NOT_FOUND';
    }
    if (message.includes('econnrefused') || message.includes('network') || message.includes('dns') || message.includes('fetch failed')) {
      return 'NETWORK';
    }
    if (message.includes('json') || message.includes('parse') || message.includes('unexpected token')) {
      return 'PARSE_ERROR';
    }
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      return 'RATE_LIMIT';
    }
    if (message.includes('context length') || message.includes('token') || message.includes('too large')) {
      return 'SIZE_LIMIT';
    }

    return 'UNKNOWN';
  }

  /**
   * Get a recovery suggestion based on error type and tool name
   * @param {Error|string} error - The error that occurred
   * @param {string} toolName - The name of the tool that failed
   * @returns {string} A helpful recovery suggestion
   */
  getRecoverySuggestion(error, toolName) {
    const errorMessage = typeof error === 'string' ? error : (error?.message || '');
    const category = this.categorizeError(typeof error === 'string' ? { message: error } : error);

    const suggestions = {
      TIMEOUT: `The ${toolName} tool timed out. Try: (1) breaking the operation into smaller pieces, (2) using a more specific query or path, or (3) checking if the target resource is available.`,
      PERMISSION: `The ${toolName} tool encountered a permission error. Try: (1) checking file/directory permissions, (2) running with appropriate access rights, or (3) using a different path that you have access to.`,
      NOT_FOUND: `The ${toolName} tool could not find the target. Try: (1) verifying the path exists using list_directory or read_file first, (2) checking for typos in the path, or (3) searching for the file using search_in_files.`,
      NETWORK: `The ${toolName} tool encountered a network error. Try: (1) checking your internet connection, (2) verifying the URL is correct, (3) trying again after a brief wait, or (4) using an alternative data source.`,
      PARSE_ERROR: `The ${toolName} tool returned unparseable data. Try: (1) checking if the input arguments are correctly formatted, (2) verifying the tool is being used with valid parameters, or (3) simplifying the request.`,
      RATE_LIMIT: `The ${toolName} tool hit a rate limit. Try: (1) waiting before retrying, (2) reducing the frequency of calls, or (3) batching multiple operations into fewer calls.`,
      SIZE_LIMIT: `The ${toolName} tool encountered a size limit. Try: (1) reducing the amount of data being processed, (2) using pagination or chunking, or (3) filtering results to be more specific.`,
      UNKNOWN: `The ${toolName} tool failed with: "${errorMessage.substring(0, 100)}". Try: (1) reviewing the error details, (2) checking tool documentation, (3) using an alternative approach, or (4) breaking the task into smaller steps.`,
    };

    return suggestions[category] || suggestions.UNKNOWN;
  }

  /**
   * Run a streaming version of the agent
   */
  async *runStream(userInput) {
    this.pushMessage({ role: 'user', content: userInput });
    this.iterationCount = 0;
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.repeatedToolRoundCount = 0;
    const startTime = Date.now();
    
    while (true) {
      if (this.hasReachedIterationLimit()) {
        this.stopReason = 'max_iterations';
        break;
      }

      if (this.hasReachedRuntimeLimit(startTime)) {
        this.stopReason = 'max_runtime';
        break;
      }

      if (this.hasReachedToolCallLimit()) {
        this.stopReason = 'max_tool_calls';
        break;
      }

      if (this.hasStalled()) {
        this.stopReason = 'stalled';
        break;
      }

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
          this.updateUsageStats(chunk.usage);
        }
      }
      
      if (toolCalls.length === 0) {
        // Final response
        this.pushMessage({ role: 'assistant', content: fullContent });
        this.stopReason = 'completed';
        yield { type: 'done', content: fullContent };
        return;
      }
      
      // Execute tools
      yield { type: 'tools_start', count: toolCalls.length };
      
      const results = await this.executeToolCallsEnhanced(toolCalls);
      
      // Add messages
      this.pushMessage({
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
        this.pushMessage({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.result),
        });
      }
      
      yield {
        type: 'tools_done',
        results: results.map(r => ({ tool: r.toolName, success: r.result.success })),
      };

      this.recordToolRound(toolCalls);
    }
    
    if (this.stopReason === 'max_iterations') {
      yield { type: 'max_iterations', iterations: this.iterationCount, reason: this.stopReason };
      return;
    }

    yield { type: 'stopped', iterations: this.iterationCount, reason: this.stopReason };
  }

  /**
   * Estimate token count (improved estimation)
   */
  estimateTokens() {
    if (!Number.isFinite(this.cachedEstimatedTokens)) {
      this.recalculateEstimatedTokens();
    }

    return Math.ceil(this.cachedEstimatedTokens);
  }

  /**
   * Compact context when approaching limit
   */
  async maybeCompactContext() {
    const { usedTokens: estimatedTokens, maxTokens } = this.getContextStats();
    
    if (estimatedTokens < maxTokens * this.compactThreshold) {
      return; // Still have room
    }
    
    const triggerMessage = `Context compaction triggered (~${estimatedTokens} tokens)`;
    if (!this.emitStatus('compaction', triggerMessage) && this.shouldEmitVerboseLogs()) {
      console.log(chalk.yellow(`   ⚠️ ${triggerMessage}`));
    }
    
    // Smart compaction: preserve system message, first user message, and last 4 exchanges
    const systemMsg = this.messages.find(m => m.role === 'system');
    const nonSystemMessages = this.messages.filter(m => m.role !== 'system');

    // Find the first user message (original request)
    const firstUserMsgIndex = nonSystemMessages.findIndex(m => m.role === 'user');
    const firstUserMsg = firstUserMsgIndex >= 0 ? nonSystemMessages[firstUserMsgIndex] : null;

    // Identify exchange boundaries: each "exchange" starts with a user message or assistant+tool_calls
    // We want the last 4 exchanges from the end of the conversation
    const exchangeStarts = [];
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i];
      if (msg.role === 'user' || (msg.role === 'assistant' && msg.tool_calls)) {
        exchangeStarts.unshift(i);
      }
    }

    // Take the last 4 exchange start indices
    const last4StartIndices = exchangeStarts.slice(-4);
    const keepFromIndex = last4StartIndices.length > 0 ? last4StartIndices[0] : nonSystemMessages.length;

    // Messages to keep: from keepFromIndex to end
    const recentMessages = nonSystemMessages.slice(keepFromIndex);

    // Older messages (for summary): everything between first user msg and the kept window
    const olderStart = firstUserMsgIndex >= 0 ? firstUserMsgIndex + 1 : 0;
    const olderMessages = nonSystemMessages.slice(olderStart, keepFromIndex);

    // Rebuild messages
    const newMessages = [];
    if (systemMsg) newMessages.push(systemMsg);

    // Always preserve the first user message (the original request)
    if (firstUserMsg && !recentMessages.includes(firstUserMsg)) {
      newMessages.push(firstUserMsg);
    }

    if (olderMessages.length > 0) {
      newMessages.push({
        role: 'assistant',
        content: this.buildCompactionSummary(olderMessages),
      });
    }
    newMessages.push(...recentMessages);
    
    this.setMessages(newMessages);
    this.contextStats.compactions++;
    
    const newTokens = this.estimateTokens();
    const compactedMessage = `Context compacted: ~${estimatedTokens} -> ~${newTokens} tokens`;
    if (!this.emitStatus('compaction', compactedMessage) && this.shouldEmitVerboseLogs()) {
      console.log(chalk.green(`   ✓ ${compactedMessage}`));
    }
  }

  /**
   * Chat without tools (simple conversation)
   */
  async chat(message, options = {}) {
    this.pushMessage({ role: 'user', content: message });
    
    const result = await this.client.chat(this.messages, {
      model: options.model || this.model,
      temperature: options.temperature || 0.7,
    });
    
    this.pushMessage({ role: 'assistant', content: result.content });
    this.updateUsageStats(result.usage);
    
    return result;
  }

  /**
   * Get comprehensive session statistics
   */
  getStats() {
    const contextStats = this.getContextStats();
    return {
      iterations: this.iterationCount,
      totalMessages: this.messages.length,
      totalTokensUsed: this.totalTokensUsed,
      toolExecutions: this.history.reduce((sum, h) => sum + h.toolCalls.length, 0),
      toolsUsed: [...new Set(this.history.flatMap(h => h.toolCalls))],
      state: this.state,
      stopReason: this.stopReason,
      performance: this.performanceMetrics,
      estimatedTokens: contextStats.usedTokens,
      contextUsage: `${contextStats.percent}%`,
      contextCompactions: contextStats.compactions,
    };
  }

  /**
   * Clear conversation history
   */
  clear() {
    this.setMessages([]);
    if (this.systemPrompt) {
      this.pushMessage({ role: 'system', content: this.systemPrompt });
    }
    this.history = [];
    this.iterationCount = 0;
    this.state = 'idle';
    this.lastError = null;
    this.stopReason = null;
    this.lastToolCallSignature = null;
    this.repeatedToolRoundCount = 0;
    this.consecutiveFailures = {};
    this.circuitBreakerTripped = false;
    this.lastSingleToolSignature = null;
    this.repeatedSingleToolCount = 0;
    this.performanceMetrics = {
      totalIterations: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      totalRetries: 0,
      avgIterationTime: 0,
      totalExecutionTime: 0,
    };
    this.contextStats.compactions = 0;
    this.contextStats.lastPromptTokens = 0;
    this.contextStats.lastCompletionTokens = 0;
    this.contextStats.lastTotalTokens = 0;
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
      stopReason: this.stopReason,
      timestamp: new Date().toISOString(),
      version: '4.0',
    };
  }

  /**
   * Import conversation with state restoration
   */
  import(data) {
    this.model = data.model || this.model;
    this.systemPrompt = data.systemPrompt || this.systemPrompt;
    this.setMessages(data.messages || []);
    this.history = data.history || [];
    this.performanceMetrics = data.performance || this.performanceMetrics;
    this.state = data.state || 'idle';
    this.stopReason = data.stopReason || null;
    this.contextStats.compactions = data.stats?.contextCompactions || 0;
    this.contextStats.lastPromptTokens = 0;
    this.contextStats.lastCompletionTokens = 0;
    this.contextStats.lastTotalTokens = 0;
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
