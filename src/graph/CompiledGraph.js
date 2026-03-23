/**
 * @fileoverview CompiledGraph — the runtime execution engine for graph workflows.
 *
 * Design decisions:
 * - `invoke()` is the primary entry point: it runs the graph to completion and
 *   returns the final state. For streaming, use `stream()` (async generator).
 * - State is immutable between steps: each `applyUpdate()` call returns a new
 *   object rather than mutating in place.
 * - Checkpointing is pluggable: any object with `save(threadId, state)` and
 *   `load(threadId)` works. If no checkpointer is provided, checkpoints are
 *   held in-memory (ephemeral).
 * - Interrupt handling is delegated to InterruptManager. The execution loop
 *   simply awaits the pause Promise and then continues with whatever the human
 *   provided.
 * - Retry with exponential backoff is handled by `_executeWithRetry()` using
 *   the node's `retryPolicy` config.
 * - Parallel fan-out is detected by checking `_parallelEdges` on the graph.
 *   When found, ParallelExecutor handles the concurrent execution and merge.
 */

import { START, END, INTERRUPT, GRAPH_DEFAULTS } from './constants.js';
import {
  GraphAbortError,
  GraphCycleError,
  GraphNodeError,
  GraphTimeoutError,
  GraphStateError,
} from './errors.js';
import { InterruptManager } from './InterruptManager.js';
import { ParallelExecutor } from './ParallelExecutor.js';

// Default in-memory checkpointer (used when none is provided)
class InMemoryCheckpointer {
  constructor() {
    this._store = new Map(); // threadId → state[]
  }

  save(threadId, state) {
    if (!this._store.has(threadId)) {
      this._store.set(threadId, []);
    }
    const history = this._store.get(threadId);
    history.push(state);
    // Trim to retention limit
    if (history.length > GRAPH_DEFAULTS.CHECKPOINT_RETENTION) {
      history.shift();
    }
  }

  load(threadId) {
    const history = this._store.get(threadId);
    return history && history.length > 0 ? history[history.length - 1] : null;
  }

  getHistory(threadId) {
    return this._store.get(threadId) || [];
  }

  clear(threadId) {
    this._store.delete(threadId);
  }
}

export class CompiledGraph {
  /**
   * @param {import('./WorkflowGraph.js').WorkflowGraph} graph
   * @param {CompiledGraphOptions} [options={}]
   */
  constructor(graph, options = {}) {
    /** @type {import('./WorkflowGraph.js').WorkflowGraph} */
    this._graph = graph;

    /** @type {import('./GraphState.js').GraphStateSchema} */
    this._schema = graph.stateSchema;

    /** @type {import('./InterruptManager.js').InterruptManager} */
    this.interruptManager = new InterruptManager();

    // Checkpointer: use provided or fall back to in-memory
    this._checkpointer = options.checkpointer || new InMemoryCheckpointer();

    this._maxCycles = options.maxCycles ?? GRAPH_DEFAULTS.MAX_CYCLES;
    this._verbose = options.verbose ?? false;

    // Bind log helper so it can be used as a callback
    this._log = this._log.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Executes the graph to completion and returns the final state.
   *
   * @param {Record<string, unknown>} input - Initial state values
   * @param {InvokeConfig} [config={}]
   * @returns {Promise<Record<string, unknown>>} Final state with `_executionLog`
   */
  async invoke(input, config = {}) {
    const { threadId, signal, metadata = {} } = config;

    // Build runtime config passed into every node
    const runtimeConfig = { threadId, signal, metadata, graph: this };

    // --- Initialize state ---
    let state;
    if (threadId) {
      // Try to resume from checkpoint
      const savedState = this._checkpointer.load(threadId);
      if (savedState) {
        this._log(`[${threadId}] Resuming from checkpoint`);
        state = this._schema.deserialize(savedState);
      } else {
        state = this._schema.createInitialState(input);
      }
    } else {
      state = this._schema.createInitialState(input);
    }

    let currentNode = START;
    let cycles = 0;
    const executionLog = [];

    // Execution loop
    // Break condition: nextNode is END or null (handled by _resolveNextNode)
    while (true) {
      // 1. Check for external abort signal
      if (signal?.aborted) {
        throw new GraphAbortError('Execution aborted via AbortSignal', { threadId, currentNode });
      }

      // 2. Resolve next node from START / current
      const nextNode = this._resolveNextNode(currentNode, state);
      this._log(`[graph] ${currentNode} → ${nextNode}`);

      // 3. Check for END
      if (nextNode === END || nextNode == null) {
        break;
      }

      currentNode = nextNode;

      // 4. Cycle guard
      cycles++;
      if (cycles > this._maxCycles) {
        throw new GraphCycleError(this._maxCycles, currentNode, { threadId });
      }

      // 5. Check interrupt BEFORE
      if (this._graph._interruptBefore.has(currentNode)) {
        this._log(`[interrupt:before] Pausing at "${currentNode}"`);
        const humanInput = await this.interruptManager.pause(threadId || `anon-${Date.now()}`, currentNode, state);
        // Human input can be used to modify state or just to signal approval
        if (humanInput != null && typeof humanInput === 'object') {
          try {
            state = this._schema.applyUpdate(state, humanInput);
          } catch {
            // If human input doesn't match schema, treat it as metadata only
          }
        }
      }

      // 6. Check for parallel fan-out
      if (this._graph._parallelEdges.has(currentNode)) {
        const { toNodes, joinNode } = this._graph._parallelEdges.get(currentNode);

        // Execute the source node first
        const nodeDef = this._graph._nodes.get(currentNode);
        const sourceUpdate = await this._executeNode(nodeDef, state, runtimeConfig);
        if (sourceUpdate != null) {
          state = this._schema.applyUpdate(state, sourceUpdate);
        }

        // Now fan out to parallel nodes
        const parallelNodeDefs = toNodes.map(name => ({
          name,
          def: this._graph._nodes.get(name),
        }));

        this._log(`[parallel] Fan-out from "${currentNode}" to [${toNodes.join(', ')}]`);
        const { mergedState } = await ParallelExecutor.executeParallel(
          parallelNodeDefs, state, runtimeConfig, this._schema
        );
        state = mergedState;

        executionLog.push({ node: currentNode, type: 'parallel', toNodes });

        // Move to join node
        currentNode = joinNode;
        cycles++;
        if (cycles > this._maxCycles) {
          throw new GraphCycleError(this._maxCycles, currentNode, { threadId });
        }

        // Execute join node
        const joinDef = this._graph._nodes.get(currentNode);
        const joinUpdate = await this._executeNode(joinDef, state, runtimeConfig);
        if (joinUpdate != null) {
          state = this._schema.applyUpdate(state, joinUpdate);
        }

        executionLog.push({ node: currentNode, type: 'join' });

        // Checkpoint after join
        if (threadId) {
          this._checkpointer.save(threadId, this._schema.serialize(state));
        }

        // Resolve next from join
        continue;
      }

      // 7. Execute node
      const nodeDef = this._graph._nodes.get(currentNode);
      if (!nodeDef) {
        throw new GraphStateError(`Node "${currentNode}" not found in graph.`, { currentNode });
      }

      const stepStart = Date.now();
      let update;
      try {
        update = await this._executeNode(nodeDef, state, runtimeConfig);
      } catch (err) {
        executionLog.push({ node: currentNode, error: err.message, durationMs: Date.now() - stepStart });
        throw err; // Already wrapped by _executeNode
      }

      // 8. Handle INTERRUPT return value from node
      if (update === INTERRUPT) {
        this._log(`[interrupt] Node "${currentNode}" returned INTERRUPT`);
        const humanInput = await this.interruptManager.pause(
          threadId || `anon-${Date.now()}`, currentNode, state
        );
        if (humanInput != null && typeof humanInput === 'object') {
          try {
            state = this._schema.applyUpdate(state, humanInput);
          } catch {
            // Non-schema human input: ignore for state, log it
          }
        }
        executionLog.push({ node: currentNode, type: 'interrupted', durationMs: Date.now() - stepStart });
      } else {
        // 9. Apply update to state
        if (update != null) {
          state = this._schema.applyUpdate(state, update);
        }
        executionLog.push({ node: currentNode, durationMs: Date.now() - stepStart });
      }

      // 10. Check interrupt AFTER
      if (this._graph._interruptAfter.has(currentNode)) {
        this._log(`[interrupt:after] Pausing after "${currentNode}"`);
        const humanInput = await this.interruptManager.pause(
          threadId || `anon-${Date.now()}`, currentNode, state
        );
        if (humanInput != null && typeof humanInput === 'object') {
          try {
            state = this._schema.applyUpdate(state, humanInput);
          } catch {
            // Ignore schema mismatches from human input
          }
        }
      }

      // 11. Checkpoint
      if (threadId) {
        this._checkpointer.save(threadId, this._schema.serialize(state));
      }
    }

    // Attach execution log to the returned state (non-schema field, added directly)
    return { ...state, _executionLog: executionLog };
  }

  /**
   * Streams graph execution, yielding after each node execution.
   * Useful for real-time UI updates and logging.
   *
   * @param {Record<string, unknown>} input
   * @param {InvokeConfig} [config={}]
   * @yields {{ node: string, state: Record<string, unknown>, update: unknown }}
   */
  async *stream(input, config = {}) {
    const { threadId, signal, metadata = {} } = config;
    const runtimeConfig = { threadId, signal, metadata, graph: this };

    let state;
    if (threadId) {
      const savedState = this._checkpointer.load(threadId);
      state = savedState ? this._schema.deserialize(savedState) : this._schema.createInitialState(input);
    } else {
      state = this._schema.createInitialState(input);
    }

    let currentNode = START;
    let cycles = 0;

    // Break condition: nextNode is END or null
    while (true) {
      if (signal?.aborted) {
        throw new GraphAbortError('Stream aborted via AbortSignal', { threadId, currentNode });
      }

      const nextNode = this._resolveNextNode(currentNode, state);
      if (nextNode === END || nextNode == null) break;

      currentNode = nextNode;
      cycles++;
      if (cycles > this._maxCycles) {
        throw new GraphCycleError(this._maxCycles, currentNode, { threadId });
      }

      if (this._graph._interruptBefore.has(currentNode)) {
        const humanInput = await this.interruptManager.pause(
          threadId || `anon-${Date.now()}`, currentNode, state
        );
        yield { node: `__interrupt_before__${currentNode}`, state: { ...state }, update: humanInput };
        if (humanInput != null && typeof humanInput === 'object') {
          try { state = this._schema.applyUpdate(state, humanInput); } catch { /* ignore */ }
        }
      }

      const nodeDef = this._graph._nodes.get(currentNode);
      if (!nodeDef) throw new GraphStateError(`Node "${currentNode}" not found.`, { currentNode });

      const update = await this._executeNode(nodeDef, state, runtimeConfig);

      if (update === INTERRUPT) {
        const humanInput = await this.interruptManager.pause(
          threadId || `anon-${Date.now()}`, currentNode, state
        );
        yield { node: currentNode, state: { ...state }, update: humanInput, interrupted: true };
        if (humanInput != null && typeof humanInput === 'object') {
          try { state = this._schema.applyUpdate(state, humanInput); } catch { /* ignore */ }
        }
      } else {
        if (update != null) {
          state = this._schema.applyUpdate(state, update);
        }
        yield { node: currentNode, state: { ...state }, update };
      }

      if (this._graph._interruptAfter.has(currentNode)) {
        const humanInput = await this.interruptManager.pause(
          threadId || `anon-${Date.now()}`, currentNode, state
        );
        yield { node: `__interrupt_after__${currentNode}`, state: { ...state }, update: humanInput };
        if (humanInput != null && typeof humanInput === 'object') {
          try { state = this._schema.applyUpdate(state, humanInput); } catch { /* ignore */ }
        }
      }

      if (threadId) {
        this._checkpointer.save(threadId, this._schema.serialize(state));
      }
    }
  }

  /**
   * Resumes a paused thread (interrupted graph execution).
   *
   * @param {string} threadId
   * @param {unknown} humanInput - Human-provided data to inject as state update
   * @throws {GraphError} If the thread is not currently paused
   */
  resume(threadId, humanInput) {
    this.interruptManager.resume(threadId, humanInput);
  }

  /**
   * Loads the latest checkpoint state for a thread.
   *
   * @param {string} threadId
   * @returns {Record<string, unknown> | null} Deserialized state, or null if not found
   */
  getState(threadId) {
    const raw = this._checkpointer.load(threadId);
    return raw ? this._schema.deserialize(raw) : null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Executes a single node with optional timeout.
   * Wraps errors as GraphNodeError, applies retryPolicy if configured.
   *
   * @param {import('./WorkflowGraph.js').NormalizedNodeDef} nodeDef
   * @param {Record<string, unknown>} state
   * @param {object} config
   * @returns {Promise<unknown>} Node's return value (partial state update)
   * @private
   */
  async _executeNode(nodeDef, state, config) {
    const timeoutMs = nodeDef.timeout ?? GRAPH_DEFAULTS.NODE_TIMEOUT_MS;

    try {
      let executionPromise = nodeDef.execute(state, config);

      // If the node returns a non-promise, wrap it
      if (!(executionPromise instanceof Promise)) {
        executionPromise = Promise.resolve(executionPromise);
      }

      // Apply timeout via Promise.race if configured (null = unlimited)
      if (timeoutMs != null && timeoutMs > 0) {
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new GraphTimeoutError(nodeDef.name, timeoutMs));
          }, timeoutMs);
        });

        try {
          return await Promise.race([executionPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutHandle);
        }
      }

      return await executionPromise;
    } catch (err) {
      // If already a graph error, re-throw as-is
      if (err.name === 'GraphTimeoutError') throw err;

      // Retry if policy defined
      if (nodeDef.retryPolicy) {
        return this._executeWithRetry(nodeDef, state, config, err);
      }

      throw new GraphNodeError(nodeDef.name, err);
    }
  }

  /**
   * Resolves the next node to execute based on current node and state.
   * Priority: conditional edges → simple edges → END (default fallback).
   *
   * @param {string} currentNode
   * @param {Record<string, unknown>} state
   * @returns {string} Next node name (or END)
   * @private
   */
  _resolveNextNode(currentNode, state) {
    // Conditional edge takes priority
    if (this._graph._conditionalEdges.has(currentNode)) {
      const { conditionFn, mapping } = this._graph._conditionalEdges.get(currentNode);
      let routeKey;
      try {
        routeKey = conditionFn(state);
      } catch (err) {
        throw new GraphNodeError(
          `${currentNode}[conditionFn]`, err,
          { node: currentNode, type: 'conditional' }
        );
      }

      if (!(routeKey in mapping)) {
        throw new GraphStateError(
          `Conditional edge from "${currentNode}" returned route key "${routeKey}" ` +
          `which is not in the mapping. Valid keys: ${Object.keys(mapping).join(', ')}`,
          { currentNode, routeKey, mapping }
        );
      }
      return mapping[routeKey];
    }

    // Simple edge
    if (this._graph._edges.has(currentNode)) {
      return this._graph._edges.get(currentNode);
    }

    // Parallel edge — handled in invoke() before _resolveNextNode is called,
    // but if someone calls _resolveNextNode after a parallel, we return the joinNode
    if (this._graph._parallelEdges.has(currentNode)) {
      return this._graph._parallelEdges.get(currentNode).joinNode;
    }

    // Default: END (dead-end nodes are warned about at compile time)
    return END;
  }

  /**
   * Retries a failed node execution with exponential backoff.
   *
   * @param {import('./WorkflowGraph.js').NormalizedNodeDef} nodeDef
   * @param {Record<string, unknown>} state
   * @param {object} config
   * @param {Error} initialError - The error that triggered retry
   * @returns {Promise<unknown>}
   * @private
   */
  async _executeWithRetry(nodeDef, state, config, initialError) {
    const policy = nodeDef.retryPolicy;
    const maxRetries = policy.maxRetries ?? 3;
    const initialDelayMs = policy.initialDelayMs ?? 1000;
    const backoffMultiplier = policy.backoffMultiplier ?? 2;

    let lastError = initialError;
    let delayMs = initialDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this._log(`[retry] Node "${nodeDef.name}" attempt ${attempt}/${maxRetries} after ${delayMs}ms`);
      await _sleep(delayMs);
      delayMs *= backoffMultiplier;

      try {
        const timeoutMs = nodeDef.timeout ?? GRAPH_DEFAULTS.NODE_TIMEOUT_MS;
        let executionPromise = nodeDef.execute(state, config);
        if (!(executionPromise instanceof Promise)) {
          executionPromise = Promise.resolve(executionPromise);
        }

        if (timeoutMs != null && timeoutMs > 0) {
          let timeoutHandle;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new GraphTimeoutError(nodeDef.name, timeoutMs)),
              timeoutMs
            );
          });
          try {
            return await Promise.race([executionPromise, timeoutPromise]);
          } finally {
            clearTimeout(timeoutHandle);
          }
        }

        return await executionPromise;
      } catch (err) {
        lastError = err;
        if (err.name === 'GraphTimeoutError') break; // Don't retry timeouts
      }
    }

    throw new GraphNodeError(nodeDef.name, lastError, { retriesExhausted: true, maxRetries });
  }

  /**
   * Conditional verbose logger.
   * @param {string} msg
   * @private
   */
  _log(msg) {
    if (this._verbose) {
      console.log(`[CompiledGraph] ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @typedef {object} InvokeConfig
 * @property {string} [threadId] - Thread ID for checkpointing and interrupt management
 * @property {AbortSignal} [signal] - AbortSignal for cancellation
 * @property {Record<string, unknown>} [metadata] - Arbitrary metadata passed to nodes
 */

/**
 * @typedef {object} CompiledGraphOptions
 * @property {object} [checkpointer] - Object with save(threadId, state) and load(threadId)
 * @property {number} [maxCycles] - Override GRAPH_DEFAULTS.MAX_CYCLES
 * @property {boolean} [verbose] - Enable verbose logging
 */
