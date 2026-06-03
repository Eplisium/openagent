/**
 * RetryHandler — LLM retry, fallback model, and error handling logic.
 *
 * Extracted from Agent.js to keep the main agent class focused on orchestration.
 * All methods read/write state on the owning Agent instance via `this.agent`.
 */

import { AgentError } from '../errors.js';
import { logger } from '../logger.js';
import { ToolErrorType } from '../errors.js';

export class RetryHandler {
  /**
   * @param {import('./Agent.js').Agent} agent – the owning Agent instance
   */
  constructor(agent) {
    this.agent = agent;
  }

  /**
   * Get LLM response with tool calling, retry logic, and fallback models.
   *
   * On JSON/parse errors or empty responses, retries up to `maxRetries` times
   * with exponential backoff and context compaction between attempts.
   *
   * On rate-limit / auth / server errors, falls back to alternative models
   * from the configured `fallbackModels` list.
   *
   * @param {number} retryCount – current retry depth (0 on first call)
   * @param {Array} messages – messages to send (defaults to agent.messages)
   * @param {Array|null} fallbackCandidates – fallback model list
   * @param {Error|null} originalError – the first error in a retry chain
   * @returns {Promise<object>} The LLM response
   */
  async getLLMResponseWithRetry(retryCount = 0, messages = null, fallbackCandidates = null, originalError = null) {
    const a = this.agent;
    const maxRetries = a.maxRetries;
    const messagesToSend = messages || a.messages;
    const fallbackModels = fallbackCandidates || a.fallbackModels;

    // Use model's actual max output — reducing it makes truncation WORSE, not better
    const maxTokens = a.maxOutputTokens;

    try {
      const result = await a.client.chatWithTools(
        messagesToSend,
        a.getRelevantToolDefinitions(),
        {
          model: a.model,
          temperature: 0.3,
          max_tokens: maxTokens,
        }
      );

      // Validate response has expected structure
      if (!result || (result.choices && result.choices.length === 0)) {
        throw new AgentError('Empty or malformed response from model (no choices)', 'EMPTY_RESPONSE', { response: result });
      }

      // Track usage
      a.updateUsageStats(result.usage);

      // Detect truncation from token limit
      if (result.finishReason === 'length') {
        const warnMsg = `⚠️ Response truncated (hit token limit at ${result.usage?.completion_tokens || '?'} tokens). Consider breaking your request into smaller parts.`;
        a.emitStatus('truncation_warning', warnMsg);
        if (a.shouldEmitVerboseLogs()) logger.warn(warnMsg);
      }

      return result;
    } catch (error) {
      // Handle JSON parse errors by retrying with lower max_tokens
      const isJsonError = error.message.includes('JSON') ||
                          error.message.includes('Unexpected end') ||
                          error.message.includes('context length');

      // Also retry on empty response errors — transient API issue
      const isEmptyResponse = error.code === 'EMPTY_RESPONSE' ||
                              error.message.includes('No message in response') ||
                              error.message.includes('Empty or malformed response');

      if ((isJsonError || isEmptyResponse) && retryCount < maxRetries) {
        a.performanceMetrics.totalRetries++;
        const retryMessage = `Retrying with shorter response (attempt ${retryCount + 1}/${maxRetries})`;
        if (!a.emitStatus('retry', retryMessage) && a.shouldEmitVerboseLogs()) {
          logger.warn(retryMessage, { attempt: retryCount + 1, maxRetries });
        }

        // Compact context before retry
        await a.maybeCompactContext();

        // Exponential backoff
        await a.sleep(a.retryDelay * Math.pow(a.retryBackoff, retryCount));

        // Retry — context was already compacted above
        return this.getLLMResponseWithRetry(retryCount + 1, messagesToSend, fallbackModels, originalError);
      }

      const statusCode = error.statusCode || error.details?.statusCode;
      const errorCode = error.code || '';
      const errorMessage = error.message || '';
      const shouldFallback =
        errorCode === 'RATE_LIMIT_ERROR' ||
        errorCode === 'AUTH_ERROR' ||
        errorCode === 'AUTHENTICATION_ERROR' ||
        errorCode === 'SERVICE_ERROR' ||
        /^HTTP_5\d\d$/.test(errorCode) ||
        errorCode === 'HTTP_401' ||
        errorCode === 'HTTP_403' ||
        statusCode === 429 ||
        statusCode === 401 ||
        statusCode === 403 ||
        (statusCode && statusCode >= 500) ||
        /\b429\b/.test(errorMessage) ||
        /\b(?:401|403)\b/.test(errorMessage) ||
        /\b5\d\d\b/.test(errorMessage) ||
        errorMessage.toLowerCase().includes('rate limit');

      if (shouldFallback && fallbackModels && fallbackModels.length > 0 && retryCount < fallbackModels.length) {
        const fallbackModel = fallbackModels[retryCount];
        const failedModel = a.model;
        logger.warn(`Model ${failedModel} failed (${error.code || error.message}), falling back to ${fallbackModel}`);
        a.model = fallbackModel;
        return this.getLLMResponseWithRetry(retryCount + 1, messagesToSend, fallbackModels, originalError || error);
      }

      if (error.code === 'TIMEOUT') {
        logger.error(`Request timed out after ${Math.round(a.client.timeout / 1000)}s`, {
          timeout: a.client.timeout,
          suggestion: 'Increase TIMEOUT_MS or use faster model'
        });
      } else {
        logger.error(`LLM Error: ${error.message}`, { code: error.code });
      }
      throw originalError || error;
    }
  }

  /**
   * Determine whether a tool failure is worth retrying.
   * Validation, permission, and not-found errors are never retryable.
   * Network and timeout errors on web tools are retryable.
   *
   * @param {string} toolName
   * @param {object} result – tool execution result
   * @returns {boolean}
   */
  isRetryableToolFailure(toolName, result = {}) {
    if (!result || result.success !== false) {
      return false;
    }

    if (result.errorType === ToolErrorType.VALIDATION_ERROR ||
        result.errorType === ToolErrorType.PERMISSION_DENIED ||
        result.errorType === ToolErrorType.NOT_FOUND) {
      return false;
    }

    if (result.errorType === ToolErrorType.TIMEOUT) {
      return true;
    }

    const message = `${result.error || ''} ${result.status || ''} ${result.statusText || ''}`.toLowerCase();
    const isNetworkTool = ['web_search', 'read_webpage', 'fetch_url'].includes(toolName);

    if (!isNetworkTool && result.errorType !== ToolErrorType.EXECUTION_ERROR) {
      return false;
    }

    if (message.includes('no search results were found') || message.includes('not available in the current environment')) {
      return false;
    }

    // Validation/argument errors and not-a-git-repo are never worth retrying
    if (message.includes('1-indexed') || message.includes('must be greater') ||
        message.includes('must be ≥') || message.includes('exceeds file length') ||
        message.includes('not a git repository') || message.includes('not a git repo')) {
      return false;
    }

    return [
      'timeout',
      'timed out',
      'network',
      'fetch failed',
      'temporarily',
      'rate limit',
      'http 429',
      'http 500',
      'http 502',
      'http 503',
      'http 504',
      'all searx instances failed',
      'search failed',
    ].some((fragment) => message.includes(fragment));
  }
}

export default RetryHandler;
