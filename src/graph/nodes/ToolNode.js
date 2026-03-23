/**
 * ToolNode.js
 * Factory for tool-execution graph nodes. Calls a named tool via a ToolRegistry,
 * mapping graph state to tool arguments and tool results back to state updates.
 */

/**
 * Create a tool-execution graph node.
 *
 * @param {string} toolName - The name of the tool to execute (as registered in the ToolRegistry).
 * @param {Object} [options={}] - Node configuration.
 * @param {function(Object): Object} [options.argsMapper] - Maps graph state → tool arguments object.
 *   Defaults to returning the full state as the argument object.
 * @param {function(Object, Object): Object} [options.outputMapper] - Maps (toolResult, state) → partial state update.
 *   Defaults to returning `{ [toolName]: result }`.
 * @param {Object} [options.toolRegistry] - A ToolRegistry instance to use.
 *   If not provided, the registry must be supplied via `config.toolRegistry` at execute time.
 * @returns {{ type: 'tool', toolName: string, execute: function(Object, Object): Promise<Object> }}
 *
 * @example
 * const node = createToolNode('web_search', {
 *   argsMapper:   (state) => ({ query: state.searchQuery }),
 *   outputMapper: (result, state) => ({ searchResults: result.hits }),
 * });
 */
export function createToolNode(toolName, options = {}) {
  if (!toolName || typeof toolName !== 'string') {
    throw new TypeError('createToolNode: toolName must be a non-empty string');
  }

  const {
    argsMapper = (state) => structuredClone(state),
    outputMapper = (result, _state) => ({ [toolName]: result }),
    toolRegistry: staticRegistry = null,
  } = options;

  if (typeof argsMapper !== 'function') {
    throw new TypeError('createToolNode: options.argsMapper must be a function');
  }
  if (typeof outputMapper !== 'function') {
    throw new TypeError('createToolNode: options.outputMapper must be a function');
  }

  return {
    type: 'tool',
    toolName,

    /**
     * Execute the tool node.
     *
     * @param {Object} state - Current graph state.
     * @param {Object} [config={}] - Runtime configuration from the graph engine.
     * @param {Object} [config.toolRegistry] - ToolRegistry instance (used if not provided in options).
     * @returns {Promise<Object>} Partial state update to merge into graph state.
     * @throws {Error} If no ToolRegistry is available or the tool is not found.
     */
    async execute(state, config = {}) {
      // Resolve registry: options-level takes precedence, then runtime config
      const registry = staticRegistry ?? config?.toolRegistry;

      if (!registry) {
        throw new Error(
          `ToolNode("${toolName}"): No ToolRegistry available. ` +
          'Provide one via createToolNode(name, { toolRegistry }) or config.toolRegistry.'
        );
      }

      if (typeof registry.execute !== 'function') {
        throw new TypeError(
          `ToolNode("${toolName}"): toolRegistry must expose an execute(toolName, args) method`
        );
      }

      const toolArgs = argsMapper(structuredClone(state));
      const result = await registry.execute(toolName, toolArgs);

      return outputMapper(result, state);
    },
  };
}

export default createToolNode;
