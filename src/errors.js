/**
 * 🚨 OpenAgent Error Classes
 * Centralized error types for the entire OpenAgent system.
 */

// ─── Agent Errors ───────────────────────────────────────────────────────────

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

// ─── OpenRouter Client Errors ───────────────────────────────────────────────

export class OpenRouterError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class RateLimitError extends OpenRouterError {
  constructor(message, retryAfter, data = {}) {
    super(message, 'RATE_LIMIT_ERROR', { retryAfter, ...data });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class AuthenticationError extends OpenRouterError {
  constructor(message, data = {}) {
    super(message, 'AUTH_ERROR', data);
    this.name = 'AuthenticationError';
  }
}

export class AbortError extends OpenRouterError {
  constructor(message = 'Request aborted') {
    super(message, 'ABORTED');
    this.name = 'AbortError';
  }
}

// ─── Tool Registry Error Types ──────────────────────────────────────────────

export const ToolErrorType = {
  NOT_FOUND: 'TOOL_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
  TIMEOUT: 'TOOL_TIMEOUT',
};
