/**
 * SubagentNode.js
 * Factory for fan-out graph nodes that delegate tasks to multiple subagents in parallel
 * via SubagentManager, then join results back into graph state.
 */

import SubagentManager from '../../agent/SubagentManager.js';

/**
 * @typedef {Object} SubagentTask
 * @property {string} specialization - The subagent specialization/role.
 * @property {string} prompt - The prompt to send to the subagent.
 * @property {string} outputKey - Key under which to store the subagent's result.
 */

/**
 * Create a fan-out graph node that runs multiple subagent tasks in parallel.
 *
 * @param {Object} options - Node configuration.
 * @param {SubagentTask[]|function(Object): SubagentTask[]} options.tasks
 *   Either a static array of task descriptors, or a function that receives the current
 *   graph state and returns a task array. Each task has `{ specialization, prompt, outputKey }`.
 * @param {function(Object, Object): Object} [options.joinReducer]
 *   Maps `(results, state) => partialState`.
 *   `results` is a `Map<outputKey, subagentResult>`.
 *   Defaults to spreading all outputKey → result entries into state.
 * @param {Object} [options.subagentManagerOptions={}]
 *   Extra options forwarded to `new SubagentManager(options)`.
 * @returns {{ type: 'fanout', execute: function(Object, Object): Promise<Object> }}
 *
 * @example
 * const node = createSubagentFanoutNode({
 *   tasks: (state) => [
 *     { specialization: 'researcher', prompt: `Research: ${state.topic}`, outputKey: 'research' },
 *     { specialization: 'writer',     prompt: `Write about: ${state.topic}`,  outputKey: 'draft'    },
 *   ],
 *   joinReducer: (results, state) => ({
 *     research: results.get('research'),
 *     draft:    results.get('draft'),
 *   }),
 * });
 */
export function createSubagentFanoutNode(options = {}) {
  const {
    tasks,
    joinReducer = (results, _state) => Object.fromEntries(results),
    subagentManagerOptions = {},
  } = options;

  if (tasks === undefined || tasks === null) {
    throw new TypeError('createSubagentFanoutNode: options.tasks is required');
  }
  if (typeof tasks !== 'function' && !Array.isArray(tasks)) {
    throw new TypeError(
      'createSubagentFanoutNode: options.tasks must be an array or a function returning an array'
    );
  }
  if (typeof joinReducer !== 'function') {
    throw new TypeError('createSubagentFanoutNode: options.joinReducer must be a function');
  }

  return {
    type: 'fanout',

    /**
     * Execute the fan-out node.
     *
     * @param {Object} state - Current graph state.
     * @param {Object} [config={}] - Runtime configuration from the graph engine.
     * @returns {Promise<Object>} Partial state update from joinReducer.
     */
    async execute(state, config = {}) {
      // Resolve tasks (static array or dynamic factory)
      const resolvedTasks =
        typeof tasks === 'function' ? tasks(structuredClone(state)) : tasks;

      if (!Array.isArray(resolvedTasks)) {
        throw new TypeError(
          'SubagentFanoutNode: tasks function must return an array'
        );
      }
      if (resolvedTasks.length === 0) {
        // Nothing to do — return empty partial state
        return joinReducer(new Map(), state);
      }

      // Validate task shape
      for (const task of resolvedTasks) {
        if (!task.specialization || !task.prompt || !task.outputKey) {
          throw new TypeError(
            'SubagentFanoutNode: each task must have { specialization, prompt, outputKey }'
          );
        }
      }

      const manager = new SubagentManager({
        ...subagentManagerOptions,
        ...(config?.subagentManagerOptions ?? {}),
      });

      // Delegate all tasks in parallel
      const delegationPromises = resolvedTasks.map(async (task) => {
        const result = await manager.delegate({
          specialization: task.specialization,
          prompt: task.prompt,
        });
        return [task.outputKey, result];
      });

      // Wait for all subagents and collect into a Map
      const settled = await Promise.allSettled(delegationPromises);

      const results = new Map();
      const errors = [];

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          const [key, value] = outcome.value;
          results.set(key, value);
        } else {
          errors.push(outcome.reason);
        }
      }

      if (errors.length > 0) {
        const messages = errors.map((e) => e?.message ?? String(e)).join('; ');
        throw new Error(`SubagentFanoutNode: ${errors.length} task(s) failed: ${messages}`);
      }

      // Cleanup manager if it exposes a destroy method
      if (typeof manager.destroy === 'function') {
        await manager.destroy().catch((err) => {
          console.warn('[SubagentFanoutNode] manager.destroy() failed:', err?.message ?? err);
        });
      }

      return joinReducer(results, state);
    },
  };
}

export default createSubagentFanoutNode;
