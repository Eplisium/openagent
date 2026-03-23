/**
 * @fileoverview Parallel node executor for fan-out graph patterns.
 *
 * Design decisions:
 * - Static-only class: no instance state needed; just a namespace for the utility.
 * - Uses Promise.allSettled so partial failures don't cancel successful branches.
 *   All results are collected and errors surfaced together via GraphParallelError.
 * - State merges are applied sequentially (in node-name order) for determinism.
 *   If two nodes update the same field, later nodes win (or the reducer decides).
 */

import { GraphParallelError } from './errors.js';

/**
 * Executes multiple graph nodes in parallel and merges their state updates.
 */
export class ParallelExecutor {
  /**
   * Executes a set of node definitions concurrently against the same input state.
   *
   * Each node receives the *same* `currentState` snapshot (not the merged result
   * of prior nodes in this batch). This is intentional: parallel branches should
   * be independent. Use a join node afterward to reconcile their outputs.
   *
   * @param {Array<{name: string, def: NodeDefinition}>} nodes
   *   Array of `{ name, def }` descriptors to execute in parallel.
   * @param {Record<string, unknown>} state - Current graph state (read-only snapshot)
   * @param {ExecutionConfig} config - Runtime config (abortSignal, threadId, etc.)
   * @param {import('./GraphState.js').GraphStateSchema} schema - For merging updates
   * @returns {Promise<{
   *   mergedState: Record<string, unknown>,
   *   results: Array<{node: string, update: unknown}>,
   *   errors: Array<{node: string, error: Error}>
   * }>}
   * @throws {GraphParallelError} If any node fails
   */
  static async executeParallel(nodes, state, config, schema) {
    if (!nodes || nodes.length === 0) {
      return { mergedState: { ...state }, results: [], errors: [] };
    }

    // Launch all nodes concurrently
    const settlements = await Promise.allSettled(
      nodes.map(({ name, def }) =>
        ParallelExecutor._runNode(name, def, state, config)
      )
    );

    const results = [];
    const errors = [];

    settlements.forEach((settlement, idx) => {
      const { name } = nodes[idx];
      if (settlement.status === 'fulfilled') {
        results.push({ node: name, update: settlement.value });
      } else {
        errors.push({ node: name, error: settlement.reason });
      }
    });

    // If any nodes failed, throw a combined error
    if (errors.length > 0) {
      throw new GraphParallelError(errors, {
        totalNodes: nodes.length,
        failedNodes: errors.length,
        succeededNodes: results.length,
      });
    }

    // Merge updates sequentially in deterministic order (node-name order is
    // maintained because Promise.allSettled preserves input order)
    let mergedState = { ...state };
    for (const { update } of results) {
      if (update != null && typeof update === 'object') {
        mergedState = schema.applyUpdate(mergedState, update);
      }
    }

    return { mergedState, results, errors };
  }

  /**
   * Runs a single node function, normalizing sync/async differences.
   *
   * @param {string} name
   * @param {NodeDefinition} def
   * @param {Record<string, unknown>} state
   * @param {ExecutionConfig} config
   * @returns {Promise<unknown>} The node's return value (partial state update)
   * @private
   */
  static async _runNode(name, def, state, config) {
    const fn = typeof def === 'function' ? def : def.execute;
    if (typeof fn !== 'function') {
      throw new Error(`Node "${name}" has no executable function`);
    }
    // Support both sync and async node functions
    return await fn(state, config);
  }
}

/**
 * @typedef {function|{execute: function, type?: string, timeout?: number, retryPolicy?: object}} NodeDefinition
 */

/**
 * @typedef {object} ExecutionConfig
 * @property {string} [threadId]
 * @property {AbortSignal} [signal]
 * @property {Record<string, unknown>} [metadata]
 */
