/**
 * SubgraphNode.js
 * Factory for subgraph-delegation graph nodes. Invokes a compiled child graph
 * from within a parent graph node, mapping state in/out via mapper functions.
 *
 * This enables hierarchical graph composition: a parent graph can embed an entire
 * compiled child graph as a single node.
 */

/**
 * Create a subgraph delegation node.
 *
 * @param {Object} compiledGraph - A compiled graph instance that exposes an `invoke(input, config?)` method.
 *   Typically the output of `graph.compile()` from the graph builder.
 * @param {Object} [options={}] - Node configuration.
 * @param {function(Object): Object} [options.inputMapper] - Maps parent graph state → subgraph input.
 *   Defaults to passing the full parent state to the subgraph.
 * @param {function(Object, Object): Object} [options.outputMapper] - Maps (subgraphResult, parentState) → partial parent state update.
 *   Defaults to returning `{ subgraphOutput: result }`.
 * @returns {{ type: 'subgraph', execute: function(Object, Object): Promise<Object> }}
 *
 * @example
 * const node = createSubgraphNode(compiledChildGraph, {
 *   inputMapper:  (state) => ({ topic: state.currentTopic }),
 *   outputMapper: (result, state) => ({ childSummary: result.summary }),
 * });
 */
export function createSubgraphNode(compiledGraph, options = {}) {
  if (!compiledGraph || typeof compiledGraph.invoke !== 'function') {
    throw new TypeError(
      'createSubgraphNode: compiledGraph must be an object with an invoke(input, config?) method'
    );
  }

  const {
    inputMapper = (state) => structuredClone(state),
    outputMapper = (result, _state) => ({ subgraphOutput: result }),
  } = options;

  if (typeof inputMapper !== 'function') {
    throw new TypeError('createSubgraphNode: options.inputMapper must be a function');
  }
  if (typeof outputMapper !== 'function') {
    throw new TypeError('createSubgraphNode: options.outputMapper must be a function');
  }

  return {
    type: 'subgraph',

    /**
     * Execute the subgraph node.
     *
     * Maps parent state to subgraph input, runs the compiled child graph,
     * then maps the child result back into a partial parent state update.
     *
     * @param {Object} state - Current parent graph state.
     * @param {Object} [config={}] - Runtime configuration from the parent graph engine.
     *   Forwarded to the subgraph's invoke call so it inherits checkpointer,
     *   recursion limits, etc., if the subgraph respects them.
     * @returns {Promise<Object>} Partial parent state update from outputMapper.
     * @throws {Error} If the subgraph invocation fails.
     */
    async execute(state, config = {}) {
      const subgraphInput = inputMapper(structuredClone(state));

      let result;
      try {
        result = await compiledGraph.invoke(subgraphInput, config);
      } catch (err) {
        throw new Error(
          `SubgraphNode: subgraph invocation failed — ${err?.message ?? String(err)}`,
          { cause: err }
        );
      }

      return outputMapper(result, state);
    },
  };
}

export default createSubgraphNode;
