/**
 * @fileoverview Public API for the OpenAgent graph workflow engine.
 *
 * Usage:
 * ```js
 * import { GraphState, WorkflowGraph, START, END } from './graph/index.js';
 *
 * const schema = GraphState.define({
 *   messages: { default: () => [], reducer: (cur, upd) => [...cur, ...upd] },
 *   status:   { default: 'idle' },
 * });
 *
 * const graph = new WorkflowGraph(schema)
 *   .addNode('agent', agentFn)
 *   .addNode('tools', toolFn)
 *   .setEntryPoint('agent')
 *   .addConditionalEdge('agent', routeFn, { continue: 'tools', end: END })
 *   .addEdge('tools', 'agent');
 *
 * const compiled = graph.compile({ verbose: true });
 * const result = await compiled.invoke({ messages: [{ role: 'user', content: 'Hello' }] });
 * ```
 */

// --- Constants ---
export { START, END, INTERRUPT, NODE_TYPES, GRAPH_DEFAULTS } from './constants.js';

// --- Errors ---
export {
  GraphError,
  GraphAbortError,
  GraphCycleError,
  GraphNodeError,
  GraphEdgeError,
  GraphTimeoutError,
  GraphStateError,
  GraphParallelError,
} from './errors.js';

// --- State management ---
export { GraphState, GraphStateSchema } from './GraphState.js';

// --- Graph builder ---
export { WorkflowGraph } from './WorkflowGraph.js';

// --- Runtime (typically used indirectly via graph.compile()) ---
export { CompiledGraph } from './CompiledGraph.js';

// --- Parallel execution ---
export { ParallelExecutor } from './ParallelExecutor.js';

// --- Interrupt/HITL management ---
export { InterruptManager } from './InterruptManager.js';
