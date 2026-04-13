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
    this.recoverable = details.recoverable ?? false;
    this.suggestion = details.suggestion ?? null;
  }
}

export class ToolExecutionError extends AgentError {
  constructor(toolName, originalError) {
    super(`Tool '${toolName}' failed: ${originalError.message}`, 'TOOL_EXECUTION_ERROR', {
      toolName,
      originalError: originalError.message,
      recoverable: false,
      suggestion: 'Check tool inputs and implementation for errors.',
    });
    this.name = 'ToolExecutionError';
  }
}

export class ContextOverflowError extends AgentError {
  constructor(currentTokens, maxTokens) {
    super(`Context overflow: ${currentTokens} tokens exceeds limit of ${maxTokens}`, 'CONTEXT_OVERFLOW', {
      currentTokens,
      maxTokens,
      recoverable: false,
      suggestion: 'Reduce input size or use a model with a larger context window.',
    });
    this.name = 'ContextOverflowError';
  }
}

export class AgentAbortError extends AgentError {
  constructor(message = 'Agent execution aborted') {
    super(message, 'AGENT_ABORTED', {
      recoverable: false,
      suggestion: 'The agent was stopped. Restart the agent to continue.',
    });
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
    this.recoverable = details.recoverable ?? false;
    this.suggestion = details.suggestion ?? null;
  }
}

export class RateLimitError extends OpenRouterError {
  constructor(message, retryAfter, data = {}) {
    super(message, 'RATE_LIMIT_ERROR', {
      retryAfter,
      ...data,
      recoverable: true,
      suggestion: `Rate limit hit. Retry after ${retryAfter ?? 'a few'} seconds.`,
    });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class AuthenticationError extends OpenRouterError {
  constructor(message, data = {}) {
    super(message, 'AUTH_ERROR', {
      ...data,
      recoverable: false,
      suggestion: 'Verify your API key is correct and has not expired.',
    });
    this.name = 'AuthenticationError';
  }
}

export class AbortError extends OpenRouterError {
  constructor(message = 'Request aborted') {
    super(message, 'ABORTED', {
      recoverable: false,
      suggestion: 'The request was cancelled. Retry if this was unintentional.',
    });
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

// ─── Extended Error Hierarchy ───────────────────────────────────────────────

/**
 * APIError — base class for HTTP/API-level errors from OpenRouter or other services.
 * Extends OpenRouterError so existing catch blocks still work.
 */
export class APIError extends OpenRouterError {
  constructor(message, statusCode, code = 'API_ERROR', details = {}) {
    super(message, code, {
      ...details,
      statusCode,
      recoverable: details.recoverable ?? (statusCode >= 500 || statusCode === 429),
      suggestion: details.suggestion ?? APIError.suggestionForStatus(statusCode),
    });
    this.name = 'APIError';
    this.statusCode = statusCode;
  }

  static suggestionForStatus(statusCode) {
    if (statusCode === 429) return 'Rate limit exceeded. Back off and retry.';
    if (statusCode >= 500) return 'Server error. Retry later — this is likely temporary.';
    if (statusCode === 404) return 'Resource not found. Verify the endpoint or model ID.';
    if (statusCode === 400) return 'Bad request. Check your request parameters.';
    if (statusCode === 401 || statusCode === 403) return 'Authentication or permission issue. Check your API key and access rights.';
    return 'An API error occurred. Check the status code for details.';
  }
}

/**
 * ModelError — model-specific failures (model not found, context length exceeded, etc.).
 */
export class ModelError extends OpenRouterError {
  constructor(message, modelId, reason = 'unknown', details = {}) {
    super(message, 'MODEL_ERROR', {
      ...details,
      modelId,
      reason,
      recoverable: false,
      suggestion: details.suggestion ?? ModelError.suggestionForReason(reason, modelId),
    });
    this.name = 'ModelError';
    this.modelId = modelId;
    this.reason = reason;
  }

  static suggestionForReason(reason, modelId) {
    switch (reason) {
      case 'not_found':
        return `Model '${modelId}' is not available. Check the model ID or try a different model.`;
      case 'context_length_exceeded':
        return `Input exceeds the context length for '${modelId}'. Shorten your input or switch to a model with a larger context window.`;
      case 'deprecated':
        return `Model '${modelId}' has been deprecated. Migrate to a supported model.`;
      case 'overloaded':
        return `Model '${modelId}' is currently overloaded. Retry later or use an alternative model.`;
      default:
        return `Model '${modelId}' encountered an error. Check model availability and input constraints.`;
    }
  }
}

/**
 * NetworkError — connection failures, DNS issues, timeouts at the transport layer.
 * Always recoverable since transient network issues are common.
 */
export class NetworkError extends Error {
  constructor(message, cause = null, details = {}) {
    super(message);
    this.name = 'NetworkError';
    this.code = 'NETWORK_ERROR';
    this.cause = cause;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.recoverable = true;
    this.suggestion = details.suggestion ?? 'Network connection failed. Check your internet connection and retry.';
  }
}

/**
 * ToolValidationError — thrown when tool input parameters fail schema validation.
 */
export class ToolValidationError extends Error {
  constructor(toolName, parameter, message, details = {}) {
    super(message);
    this.name = 'ToolValidationError';
    this.code = 'TOOL_VALIDATION_ERROR';
    this.toolName = toolName;
    this.parameter = parameter;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.recoverable = false;
    this.suggestion = details.suggestion ?? `Invalid value for parameter '${parameter}' in tool '${toolName}'. Check the tool schema for expected types and constraints.`;
  }
}

/**
 * ToolTimeoutError — thrown when a tool execution exceeds its time limit.
 */
export class ToolTimeoutError extends Error {
  constructor(toolName, timeout, details = {}) {
    super(`Tool '${toolName}' timed out after ${timeout}ms`);
    this.name = 'ToolTimeoutError';
    this.code = 'TOOL_TIMEOUT_ERROR';
    this.toolName = toolName;
    this.timeout = timeout;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.recoverable = true;
    this.suggestion = details.suggestion ?? `Tool '${toolName}' took longer than ${timeout}ms. Consider increasing the timeout or optimizing the tool.`;
  }
}

/**
 * SessionError — session lifecycle issues (expired, not found, corrupted state).
 */
export class SessionError extends Error {
  constructor(message, sessionId, reason = 'unknown', details = {}) {
    super(message);
    this.name = 'SessionError';
    this.code = 'SESSION_ERROR';
    this.sessionId = sessionId;
    this.reason = reason;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.recoverable = details.recoverable ?? (reason === 'expired');
    this.suggestion = details.suggestion ?? SessionError.suggestionForReason(reason);
  }

  static suggestionForReason(reason) {
    switch (reason) {
      case 'expired':
        return 'Session has expired. Start a new session to continue.';
      case 'not_found':
        return 'Session not found. Verify the session ID or create a new session.';
      case 'corrupted':
        return 'Session state is corrupted. Reset the session and retry.';
      case 'limit_exceeded':
        return 'Maximum number of sessions reached. Close unused sessions and retry.';
      default:
        return 'A session error occurred. Try creating a new session.';
    }
  }
}

/**
 * ConfigError — configuration problems (missing env vars, invalid settings, etc.).
 */
export class ConfigError extends Error {
  constructor(message, field = null, details = {}) {
    super(message);
    this.name = 'ConfigError';
    this.code = 'CONFIG_ERROR';
    this.field = field;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.recoverable = false;
    this.suggestion = details.suggestion ?? (field
      ? `Configuration field '${field}' is invalid or missing. Check your environment variables or config file.`
      : 'Configuration error. Review your settings and environment variables.');
  }
}

// ─── Error Categorization Helper ────────────────────────────────────────────

/**
 * Categorizes any error into a normalized object for consistent handling.
 *
 * @param {Error|unknown} error - Any error instance or value
 * @returns {{ type: string, code: string, message: string, recoverable: boolean, suggestion: string|null, details: object }}
 */
export function categorizeError(error) {
  // Already one of our known error classes
  if (error instanceof AgentError || error instanceof OpenRouterError) {
    return {
      type: error.name,
      code: error.code,
      message: error.message,
      recoverable: error.recoverable ?? false,
      suggestion: error.suggestion ?? null,
      details: error.details ?? {},
    };
  }

  // NetworkError / ToolValidationError / ToolTimeoutError / SessionError / ConfigError
  if (
    error instanceof NetworkError ||
    error instanceof ToolValidationError ||
    error instanceof ToolTimeoutError ||
    error instanceof SessionError ||
    error instanceof ConfigError
  ) {
    return {
      type: error.name,
      code: error.code,
      message: error.message,
      recoverable: error.recoverable ?? false,
      suggestion: error.suggestion ?? null,
      details: error.details ?? {},
    };
  }

  // Native TypeError often indicates a programming bug or bad input
  if (error instanceof TypeError) {
    return {
      type: 'TypeError',
      code: 'TYPE_ERROR',
      message: error.message,
      recoverable: false,
      suggestion: 'A type error occurred. Check the data types of your inputs.',
      details: {},
    };
  }

  // Native RangeError
  if (error instanceof RangeError) {
    return {
      type: 'RangeError',
      code: 'RANGE_ERROR',
      message: error.message,
      recoverable: false,
      suggestion: 'A value is out of the expected range. Check numeric or array bounds.',
      details: {},
    };
  }

  // Generic Error
  if (error instanceof Error) {
    return {
      type: 'Error',
      code: 'UNKNOWN_ERROR',
      message: error.message,
      recoverable: false,
      suggestion: 'An unexpected error occurred. Check logs for more details.',
      details: {},
    };
  }

  // Non-Error values (strings, objects, etc.)
  return {
    type: 'Unknown',
    code: 'UNKNOWN_ERROR',
    message: typeof error === 'string' ? error : JSON.stringify(error),
    recoverable: false,
    suggestion: 'An unexpected error occurred. Check logs for more details.',
    details: { raw: error },
  };
}
