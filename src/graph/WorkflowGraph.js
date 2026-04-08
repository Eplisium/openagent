/**
 * @fileoverview WorkflowGraph — the graph builder/compiler class.
 *
 * Design decisions:
 * - Builder pattern: all `add*` methods are chainable and mutate internal maps.
 * - `compile()` triggers validation and returns a CompiledGraph, making the
 *   builder immutable (conceptually) after compilation.
 * - Mermaid output is generated on-demand, not cached, so it always reflects
 *   the current builder state even before compilation.
 * - Parallel edges are stored as a special edge type so CompiledGraph can detect
 *   and route through ParallelExecutor when needed.
 */

import { START, END, NODE_TYPES } from './constants.js';
import { GraphEdgeError, GraphError } from './errors.js';
import { CompiledGraph } from './CompiledGraph.js';

export class WorkflowGraph {
  /**
   * @param {import('./GraphState.js').GraphStateSchema} stateSchema
   */
  constructor(stateSchema) {
    if (!stateSchema || typeof stateSchema.createInitialState !== 'function') {
      throw new TypeError(
        'WorkflowGraph requires a GraphStateSchema instance. ' +
        'Use GraphState.define({...}) to create one.'
      );
    }

    /** @type {import('./GraphState.js').GraphStateSchema} */
    this.stateSchema = stateSchema;

    /**
     * Registered nodes: name → NodeDefinition
     * @type {Map<string, NormalizedNodeDef>}
     */
    this._nodes = new Map();

    /**
     * Simple edges: from → to (one target per source in simple edges)
     * @type {Map<string, string>}
     */
    this._edges = new Map();

    /**
     * Conditional edges: from → { conditionFn, mapping }
     * @type {Map<string, ConditionalEdge>}
     */
    this._conditionalEdges = new Map();

    /**
     * Parallel edges: from → { toNodes: string[], joinNode: string }
     * @type {Map<string, ParallelEdge>}
     */
    this._parallelEdges = new Map();

    /** @type {string | null} */
    this._entryPoint = null;

    /**
     * Node names that trigger a HITL pause BEFORE execution.
     * @type {Set<string>}
     */
    this._interruptBefore = new Set();

    /**
     * Node names that trigger a HITL pause AFTER execution.
     * @type {Set<string>}
     */
    this._interruptAfter = new Set();
  }

  // ---------------------------------------------------------------------------
  // Builder methods
  // ---------------------------------------------------------------------------

  /**
   * Registers a node in the graph.
   *
   * @param {string} name - Unique node identifier
   * @param {Function | NodeDef} fnOrDef
   *   Either a plain function `(state, config) => partialState` or a definition
   *   object `{ execute, type?, timeout?, retryPolicy? }`.
   * @param {NodeOptions} [options={}] - Optional overrides (type, timeout, retryPolicy)
   * @returns {this}
   */
  addNode(name, fnOrDef, options = {}) {
    if (name === START || name === END) {
      throw new GraphEdgeError(`Cannot register a node named "${name}" — reserved name.`, { name });
    }
    if (this._nodes.has(name)) {
      throw new GraphEdgeError(`Node "${name}" is already registered.`, { name });
    }

    let normalized;
    if (typeof fnOrDef === 'function') {
      normalized = {
        execute: fnOrDef,
        type: options.type || NODE_TYPES.FUNCTION,
        timeout: options.timeout ?? null,
        retryPolicy: options.retryPolicy ?? null,
        name,
      };
    } else if (fnOrDef && typeof fnOrDef.execute === 'function') {
      normalized = {
        execute: fnOrDef.execute,
        type: fnOrDef.type || options.type || NODE_TYPES.FUNCTION,
        timeout: fnOrDef.timeout ?? options.timeout ?? null,
        retryPolicy: fnOrDef.retryPolicy ?? options.retryPolicy ?? null,
        name,
      };
    } else {
      throw new GraphEdgeError(
        `Node "${name}" must be a function or an object with an "execute" function.`,
        { name }
      );
    }

    this._nodes.set(name, normalized);
    return this;
  }

  /**
   * Adds a simple (unconditional) edge from one node to another.
   *
   * @param {string} from - Source node name (or START)
   * @param {string} to - Destination node name (or END)
   * @returns {this}
   */
  addEdge(from, to) {
    this._assertEdgeSourceOk(from);
    this._assertEdgeTargetOk(to);
    if (this._edges.has(from)) {
      throw new GraphEdgeError(
        `Node "${from}" already has a simple edge to "${this._edges.get(from)}". ` +
        `Remove the existing edge or use a conditional edge instead.`,
        { from, to }
      );
    }
    this._edges.set(from, to);
    return this;
  }

  /**
   * Adds a conditional edge from a node.
   * The `conditionFn` receives the current state and returns a route key.
   * The key is looked up in `mapping` to find the next node name.
   *
   * @param {string} from - Source node name
   * @param {function(state: Record<string, unknown>): string} conditionFn
   * @param {Record<string, string>} mapping - { routeKey: nodeName }
   * @returns {this}
   */
  addConditionalEdge(from, conditionFn, mapping) {
    if (from === END) {
      throw new GraphEdgeError('Cannot add an edge from END.', { from });
    }
    if (typeof conditionFn !== 'function') {
      throw new GraphEdgeError(
        `conditionFn for node "${from}" must be a function.`,
        { from }
      );
    }
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new GraphEdgeError(
        `mapping for conditional edge from "${from}" must be a plain object.`,
        { from }
      );
    }
    if (this._conditionalEdges.has(from)) {
      throw new GraphEdgeError(
        `Node "${from}" already has a conditional edge.`,
        { from }
      );
    }
    this._conditionalEdges.set(from, { conditionFn, mapping });
    return this;
  }

  /**
   * Sets the graph's entry point.
   * Automatically adds a START → nodeName edge.
   *
   * @param {string} name - Name of the entry node
   * @returns {this}
   */
  setEntryPoint(name) {
    if (!name || typeof name !== 'string') {
      throw new GraphEdgeError('Entry point name must be a non-empty string.', { name });
    }
    this._entryPoint = name;
    // Add the implicit START → entry edge (replaces any existing one silently)
    this._edges.set(START, name);
    return this;
  }

  /**
   * Marks nodes to be interrupted BEFORE execution (human approval/inspection).
   *
   * @param {string[]} nodeNames
   * @returns {this}
   */
  interruptBefore(nodeNames) {
    for (const name of nodeNames) {
      this._interruptBefore.add(name);
    }
    return this;
  }

  /**
   * Marks nodes to be interrupted AFTER execution (human review of output).
   *
   * @param {string[]} nodeNames
   * @returns {this}
   */
  interruptAfter(nodeNames) {
    for (const name of nodeNames) {
      this._interruptAfter.add(name);
    }
    return this;
  }

  /**
   * Adds parallel (fan-out) edges from one node to multiple nodes,
   * with a join node that executes after all parallel nodes complete.
   *
   * @param {string} from - Fan-out source node
   * @param {string[]} toNodes - Parallel destination nodes
   * @param {string} joinNode - Node to execute after all parallel nodes finish
   * @returns {this}
   */
  addParallelEdges(from, toNodes, joinNode) {
    if (!Array.isArray(toNodes) || toNodes.length < 2) {
      throw new GraphEdgeError(
        `addParallelEdges requires at least 2 destination nodes (got ${toNodes?.length ?? 0}).`,
        { from, toNodes, joinNode }
      );
    }
    if (!joinNode || typeof joinNode !== 'string') {
      throw new GraphEdgeError(
        'addParallelEdges requires a joinNode string.',
        { from, toNodes }
      );
    }
    if (this._parallelEdges.has(from)) {
      throw new GraphEdgeError(
        `Node "${from}" already has parallel edges.`,
        { from }
      );
    }
    this._parallelEdges.set(from, { toNodes: [...toNodes], joinNode });
    return this;
  }

  /**
   * Validates and compiles the graph into an executable CompiledGraph.
   *
   * @param {CompileOptions} [options={}]
   * @returns {CompiledGraph}
   */
  compile(options = {}) {
    this._validate();
    return new CompiledGraph(this, options);
  }

  // ---------------------------------------------------------------------------
  // Visualization
  // ---------------------------------------------------------------------------

  /**
   * Generates a Mermaid flowchart diagram string representing the graph.
   * Can be pasted into https://mermaid.live for visualization.
   *
   * @returns {string} Mermaid diagram source
   */
  toMermaid() {
    const lines = ['graph TD'];
    const sanitize = name => name.replace(/[^a-zA-Z0-9_]/g, '_');

    // Nodes
    lines.push(`  ${sanitize(START)}([START])`);
    lines.push(`  ${sanitize(END)}([END])`);
    for (const [name, def] of this._nodes) {
      const label = `${name}\\n[${def.type}]`;
      lines.push(`  ${sanitize(name)}["${label}"]`);
    }

    // Simple edges
    for (const [from, to] of this._edges) {
      lines.push(`  ${sanitize(from)} --> ${sanitize(to)}`);
    }

    // Conditional edges
    for (const [from, { mapping }] of this._conditionalEdges) {
      for (const [key, target] of Object.entries(mapping)) {
        lines.push(`  ${sanitize(from)} -->|"${key}"| ${sanitize(target)}`);
      }
    }

    // Parallel edges
    for (const [from, { toNodes, joinNode }] of this._parallelEdges) {
      for (const to of toNodes) {
        lines.push(`  ${sanitize(from)} -.->|parallel| ${sanitize(to)}`);
      }
      for (const to of toNodes) {
        lines.push(`  ${sanitize(to)} --> ${sanitize(joinNode)}`);
      }
    }

    // Interrupt annotations
    for (const name of this._interruptBefore) {
      lines.push(`  style ${sanitize(name)} stroke:#f90,stroke-width:2px`);
    }
    for (const name of this._interruptAfter) {
      lines.push(`  style ${sanitize(name)} stroke:#09f,stroke-width:2px,stroke-dasharray:5`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Internal validation
  // ---------------------------------------------------------------------------

  /**
   * Validates the graph structure before compilation.
   * Throws on fatal errors, warns on suspicious (but non-fatal) issues.
   * @private
   */
  _validate() {
    const errors = [];
    const warnings = [];

    // 1. Entry point must be set
    if (!this._entryPoint) {
      errors.push('No entry point set. Call setEntryPoint(nodeName) before compiling.');
    } else if (!this._nodes.has(this._entryPoint)) {
      errors.push(`Entry point "${this._entryPoint}" is not a registered node.`);
    }

    // 2. All edge targets must reference registered nodes or END
    const validTargets = new Set([...this._nodes.keys(), END]);
    const validSources = new Set([...this._nodes.keys(), START]);

    for (const [from, to] of this._edges) {
      if (from !== START && !validSources.has(from)) {
        errors.push(`Simple edge from unknown node "${from}".`);
      }
      if (!validTargets.has(to)) {
        errors.push(`Simple edge to unknown node "${to}" (from "${from}").`);
      }
    }

    for (const [from, { mapping }] of this._conditionalEdges) {
      if (!this._nodes.has(from)) {
        errors.push(`Conditional edge from unknown node "${from}".`);
      }
      for (const [key, target] of Object.entries(mapping)) {
        if (!validTargets.has(target)) {
          errors.push(`Conditional edge route "${key}" from "${from}" points to unknown node "${target}".`);
        }
      }
    }

    for (const [from, { toNodes, joinNode }] of this._parallelEdges) {
      if (!this._nodes.has(from)) {
        errors.push(`Parallel edge from unknown node "${from}".`);
      }
      for (const to of toNodes) {
        if (!this._nodes.has(to)) {
          errors.push(`Parallel edge to unknown node "${to}" (from "${from}").`);
        }
      }
      if (!this._nodes.has(joinNode)) {
        errors.push(`Parallel join node "${joinNode}" is not a registered node.`);
      }
    }

    // 3. Interrupt references must be valid nodes
    for (const name of this._interruptBefore) {
      if (!this._nodes.has(name)) {
        errors.push(`interruptBefore references unknown node "${name}".`);
      }
    }
    for (const name of this._interruptAfter) {
      if (!this._nodes.has(name)) {
        errors.push(`interruptAfter references unknown node "${name}".`);
      }
    }

    // 4. Warn about dead-end nodes (no outgoing edge, not END)
    for (const name of this._nodes.keys()) {
      const hasSimpleOut = this._edges.has(name);
      const hasConditionalOut = this._conditionalEdges.has(name);
      const hasParallelOut = this._parallelEdges.has(name);
      if (!hasSimpleOut && !hasConditionalOut && !hasParallelOut) {
        warnings.push(`Node "${name}" has no outgoing edge — execution will stop here (treated as END).`);
      }
    }

    // 5. Warn about unreachable nodes (basic reachability from START)
    const reachable = new Set();
    const queue = [this._entryPoint].filter(Boolean);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || reachable.has(current) || current === END) continue;
      reachable.add(current);

      if (this._edges.has(current)) queue.push(this._edges.get(current));
      if (this._conditionalEdges.has(current)) {
        for (const target of Object.values(this._conditionalEdges.get(current).mapping)) {
          queue.push(target);
        }
      }
      if (this._parallelEdges.has(current)) {
        const { toNodes, joinNode } = this._parallelEdges.get(current);
        queue.push(...toNodes, joinNode);
      }
    }
    for (const name of this._nodes.keys()) {
      if (!reachable.has(name)) {
        warnings.push(`Node "${name}" is unreachable from the entry point.`);
      }
    }

    // 6. Detect cycles in the graph (excluding parallel edges which are handled at runtime)
    const cycleError = this._detectCycle();
    if (cycleError) {
      errors.push(cycleError);
    }

    // Surface warnings to stderr (non-fatal)
    if (warnings.length > 0) {
      for (const w of warnings) {
        process.stderr.write(`[WorkflowGraph] WARNING: ${w}\n`);
      }
    }

    // Surface errors (fatal)
    if (errors.length > 0) {
      throw new GraphError(
        `Graph validation failed with ${errors.length} error(s):\n` +
        errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n'),
        { errors, warnings }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @param {string} name
   * @private
   */
  _assertEdgeSourceOk(name) {
    if (name === END) {
      throw new GraphEdgeError('Cannot add an edge from END.', { name });
    }
    if (name !== START && !this._nodes.has(name)) {
      throw new GraphEdgeError(
        `Cannot add edge from unknown node "${name}". Register the node first with addNode().`,
        { name }
      );
    }
  }

  /**
   * @param {string} name
   * @private
   */
  _assertEdgeTargetOk(name) {
    if (name === START) {
      throw new GraphEdgeError('Cannot add an edge to START.', { name });
    }
    if (name !== END && !this._nodes.has(name)) {
      throw new GraphEdgeError(
        `Cannot add edge to unknown node "${name}". Register the node first with addNode().`,
        { name }
      );
    }
  }

  /**
   * Detects cycles in the graph using DFS.
   * @returns {string|null} Error message if cycle detected, null otherwise
   * @private
   */
  _detectCycle() {
    const visited = new Set();
    const recursionStack = new Set();

    // Build adjacency list from all edge types
    const getEdges = (node) => {
      const edges = [];
      if (this._edges.has(node)) {
        edges.push(this._edges.get(node));
      }
      if (this._conditionalEdges.has(node)) {
        const mapping = this._conditionalEdges.get(node).mapping;
        edges.push(...Object.values(mapping));
      }
      // Note: parallel edges are excluded from cycle detection as they're
      // handled at runtime with explicit join nodes
      return edges;
    };

    const dfs = (node, path) => {
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart).concat(node);
        return `Cycle detected: ${cycle.join(' → ')}`;
      }

      if (visited.has(node)) {
        return null;
      }

      visited.add(node);
      recursionStack.add(node);

      const edges = getEdges(node);
      for (const next of edges) {
        if (next === END || next === START) continue;
        if (!this._nodes.has(next)) continue; // Skip invalid nodes (will be caught by other validation)

        const result = dfs(next, [...path, next]);
        if (result) return result;
      }

      recursionStack.delete(node);
      return null;
    };

    // Check from entry point and all reachable nodes
    const startNodes = this._entryPoint ? [this._entryPoint] : [];
    for (const node of startNodes) {
      const result = dfs(node, [node]);
      if (result) return result;
    }

    return null;
  }
}

/**
 * @typedef {object} NormalizedNodeDef
 * @property {string} name
 * @property {function} execute
 * @property {string} type
 * @property {number|null} timeout
 * @property {RetryPolicy|null} retryPolicy
 */

/**
 * @typedef {object} NodeDef
 * @property {function} execute
 * @property {string} [type]
 * @property {number} [timeout]
 * @property {RetryPolicy} [retryPolicy]
 */

/**
 * @typedef {object} NodeOptions
 * @property {string} [type]
 * @property {number} [timeout]
 * @property {RetryPolicy} [retryPolicy]
 */

/**
 * @typedef {object} RetryPolicy
 * @property {number} maxRetries
 * @property {number} [initialDelayMs]
 * @property {number} [backoffMultiplier]
 */

/**
 * @typedef {object} ConditionalEdge
 * @property {function} conditionFn
 * @property {Record<string, string>} mapping
 */

/**
 * @typedef {object} ParallelEdge
 * @property {string[]} toNodes
 * @property {string} joinNode
 */

/**
 * @typedef {object} CompileOptions
 * @property {object} [checkpointer] - Checkpointer instance
 * @property {number} [maxCycles]
 * @property {boolean} [verbose]
 */
