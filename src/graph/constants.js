/**
 * @fileoverview Graph workflow engine constants
 * Shared constants for node names, types, and default configuration.
 */

/** Sentinel node name for the graph entry point */
export const START = '__start__';

/** Sentinel node name for the graph exit point */
export const END = '__end__';

/**
 * Symbol used as a return value from node functions to signal a human-in-the-loop
 * interruption. When a node returns INTERRUPT, the graph pauses and waits for
 * `resume()` to be called with human input before continuing.
 */
export const INTERRUPT = Symbol('INTERRUPT');

/**
 * Enumeration of supported node types.
 * Used for logging, visualization, and runtime behavior hints.
 */
export const NODE_TYPES = {
  /** Plain JavaScript function node */
  FUNCTION: 'function',
  /** Node that calls an LLM */
  LLM: 'llm',
  /** Node that executes a tool/action */
  TOOL: 'tool',
  /** Node that delegates to a nested WorkflowGraph */
  SUBGRAPH: 'subgraph',
  /** Node that fans out to multiple parallel subagents */
  SUBAGENT_FANOUT: 'subagent_fanout',
};

/**
 * Default runtime configuration for the graph engine.
 * All values can be overridden at compile() or invoke() time.
 */
export const GRAPH_DEFAULTS = {
  /** Maximum number of node execution cycles before aborting to prevent infinite loops */
  MAX_CYCLES: 50,
  /** Per-node execution timeout in milliseconds (5 minutes) */
  NODE_TIMEOUT_MS: 300_000,
  /** Maximum number of checkpoints to retain per thread */
  CHECKPOINT_RETENTION: 50,
};
