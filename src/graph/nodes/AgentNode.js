/**
 * AgentNode.js
 * Factory for LLM-backed graph nodes powered by AgentSession.
 * The AgentSession is created lazily on first invocation and reused for subsequent calls,
 * so the same node can maintain conversational context within a graph run.
 */

import AgentSession from '../../agent/AgentSession.js';

/**
 * Create an LLM-backed graph node using an AgentSession.
 *
 * @param {Object} options - Node configuration.
 * @param {string} [options.model] - The model identifier to use (passed to AgentSession).
 * @param {string} [options.systemPrompt] - System prompt for the agent.
 * @param {Array}  [options.tools=[]] - Tool definitions available to the agent.
 * @param {function(Object): string} [options.inputMapper] - Maps graph state → prompt string.
 *   Defaults to `state => JSON.stringify(state)`.
 * @param {function(Object, Object): Object} [options.outputMapper] - Maps (agentResult, state) → partial state update.
 *   Defaults to returning `{ agentOutput: result }`.
 * @returns {{ type: 'llm', execute: function(Object, Object): Promise<Object>, destroy: function(): void }}
 *   A compiled node descriptor with an execute function.
 *
 * @example
 * const node = createAgentNode({
 *   model: 'gpt-4o',
 *   systemPrompt: 'You are a helpful assistant.',
 *   inputMapper: (state) => state.userMessage,
 *   outputMapper: (result, state) => ({ assistantReply: result.content }),
 * });
 */
export function createAgentNode(options = {}) {
  const {
    model,
    systemPrompt,
    tools = [],
    inputMapper = (state) => JSON.stringify(state),
    outputMapper = (result, _state) => ({ agentOutput: result }),
  } = options;

  if (typeof inputMapper !== 'function') {
    throw new TypeError('createAgentNode: options.inputMapper must be a function');
  }
  if (typeof outputMapper !== 'function') {
    throw new TypeError('createAgentNode: options.outputMapper must be a function');
  }

  /** @type {AgentSession|null} Lazily initialised, shared across execute calls. */
  let session = null;
  let sessionInitialising = false;
  let pendingInit = null;

  /**
   * Get or create the shared AgentSession.
   *
   * @param {Object} config - Runtime config from the graph engine (may contain overrides).
   * @returns {Promise<AgentSession>}
   */
  async function getSession(config) {
    if (session) return session;

    // Guard against concurrent initialisation races
    if (sessionInitialising && pendingInit) {
      return pendingInit;
    }

    sessionInitialising = true;
    pendingInit = (async () => {
      const sessionOptions = {
        ...(model ? { model } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        tools: tools.length > 0 ? tools : undefined,
        // Allow runtime config to contribute options
        ...(config?.agentOptions ?? {}),
      };

      session = new AgentSession(sessionOptions);

      // Call init() if AgentSession exposes it
      if (typeof session.init === 'function') {
        await session.init();
      }

      return session;
    })();

    try {
      const s = await pendingInit;
      return s;
    } finally {
      sessionInitialising = false;
      pendingInit = null;
    }
  }

  return {
    type: 'llm',

    /**
     * Execute the agent node.
     *
     * @param {Object} state - Current graph state.
     * @param {Object} [config={}] - Runtime configuration from the graph engine.
     * @param {Object} [config.agentOptions] - Extra options forwarded to AgentSession constructor.
     * @returns {Promise<Object>} Partial state update to merge into graph state.
     */
    async execute(state, config = {}) {
      const agentSession = await getSession(config);

      const prompt = inputMapper(structuredClone(state));

      if (typeof prompt !== 'string' || prompt.length === 0) {
        throw new Error('AgentNode: inputMapper must return a non-empty string');
      }

      let result;
      if (typeof agentSession.run === 'function') {
        result = await agentSession.run(prompt);
      } else if (typeof agentSession.chat === 'function') {
        result = await agentSession.chat(prompt);
      } else {
        throw new Error(
          'AgentNode: AgentSession must expose a run(prompt) or chat(prompt) method'
        );
      }

      return outputMapper(result, state);
    },

    /**
     * Destroy the lazily-created AgentSession and release resources.
     * Call when the graph run is complete to avoid memory leaks.
     *
     * @returns {Promise<void>}
     */
    async destroy() {
      if (session && typeof session.destroy === 'function') {
        await session.destroy();
      }
      session = null;
    },
  };
}

export default createAgentNode;
