/**
 * @fileoverview Graph workflow engine error hierarchy
 * All graph-specific errors extend GraphError for easy catch discrimination.
 */

/**
 * Base error class for all graph workflow errors.
 * Includes an optional `details` payload for structured error context.
 */
export class GraphError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {object} [details={}] - Additional structured context (node name, state snapshot, etc.)
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'GraphError';
    this.details = details;
    // Capture stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when graph execution is aborted via AbortController or manual abort.
 */
export class GraphAbortError extends GraphError {
  /**
   * @param {string} [message='Graph execution aborted']
   * @param {object} [details={}]
   */
  constructor(message = 'Graph execution aborted', details = {}) {
    super(message, details);
    this.name = 'GraphAbortError';
  }
}

/**
 * Thrown when the graph execution exceeds the maximum allowed cycle count.
 * This prevents infinite loops in graphs with cyclic edges.
 */
export class GraphCycleError extends GraphError {
  /**
   * @param {number} cycleCount - Number of cycles executed before aborting
   * @param {string} [currentNode] - The node that was executing when the limit was hit
   * @param {object} [details={}]
   */
  constructor(cycleCount, currentNode, details = {}) {
    super(
      `Graph exceeded maximum cycle count of ${cycleCount}` +
      (currentNode ? ` at node "${currentNode}"` : ''),
      { cycleCount, currentNode, ...details }
    );
    this.name = 'GraphCycleError';
    this.cycleCount = cycleCount;
    this.currentNode = currentNode;
  }
}

/**
 * Thrown when an error occurs during node execution.
 * Wraps the original cause error for full stack trace preservation.
 */
export class GraphNodeError extends GraphError {
  /**
   * @param {string} nodeName - Name of the node that failed
   * @param {Error} cause - The original error thrown by the node function
   * @param {object} [details={}]
   */
  constructor(nodeName, cause, details = {}) {
    super(
      `Node "${nodeName}" failed: ${cause?.message || String(cause)}`,
      { nodeName, ...details }
    );
    this.name = 'GraphNodeError';
    this.nodeName = nodeName;
    // Standard Error cause chain (Node.js 16.9+)
    this.cause = cause;
  }
}

/**
 * Thrown when an edge definition is invalid (e.g., references a non-existent node,
 * or a conditional mapping points to an unknown route key).
 */
export class GraphEdgeError extends GraphError {
  /**
   * @param {string} message
   * @param {object} [details={}]
   */
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'GraphEdgeError';
  }
}

/**
 * Thrown when a node execution exceeds its configured timeout.
 */
export class GraphTimeoutError extends GraphError {
  /**
   * @param {string} nodeName - Node that timed out
   * @param {number} timeoutMs - The timeout threshold in milliseconds
   * @param {object} [details={}]
   */
  constructor(nodeName, timeoutMs, details = {}) {
    super(
      `Node "${nodeName}" timed out after ${timeoutMs}ms`,
      { nodeName, timeoutMs, ...details }
    );
    this.name = 'GraphTimeoutError';
    this.nodeName = nodeName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when state schema validation fails (unknown fields, invalid values,
 * or schema definition errors).
 */
export class GraphStateError extends GraphError {
  /**
   * @param {string} message
   * @param {object} [details={}]
   */
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'GraphStateError';
  }
}

/**
 * Thrown when one or more nodes in a parallel fan-out fail.
 * Contains an array of all node errors so callers can inspect partial failures.
 */
export class GraphParallelError extends GraphError {
  /**
   * @param {Array<{node: string, error: Error}>} nodeErrors - Errors from failed parallel nodes
   * @param {object} [details={}]
   */
  constructor(nodeErrors, details = {}) {
    const names = nodeErrors.map(e => `"${e.node}"`).join(', ');
    super(
      `Parallel execution failed for nodes: ${names}`,
      { nodeErrors, ...details }
    );
    this.name = 'GraphParallelError';
    /** @type {Array<{node: string, error: Error}>} */
    this.nodeErrors = nodeErrors;
  }
}
