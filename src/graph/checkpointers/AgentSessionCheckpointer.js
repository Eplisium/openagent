/**
 * AgentSessionCheckpointer.js
 * Bridges FileCheckpointer with AgentSession, recording graph checkpoints
 * both as files on disk and as AgentSession checkpoints for agent-level introspection.
 */

import { FileCheckpointer } from './FileCheckpointer.js';

export class AgentSessionCheckpointer extends FileCheckpointer {
  /**
   * @param {Object} agentSession - An AgentSession instance that exposes `createCheckpoint(label)`.
   * @param {Object} [options] - Configuration options passed to FileCheckpointer.
   * @param {string} [options.dir] - Directory for checkpoint files.
   * @param {number} [options.maxCheckpoints=50] - Maximum checkpoints to keep per thread.
   * @throws {TypeError} If agentSession is not provided or lacks createCheckpoint.
   */
  constructor(agentSession, options = {}) {
    super(options);

    if (!agentSession || typeof agentSession.createCheckpoint !== 'function') {
      throw new TypeError(
        'agentSession must be an object with a createCheckpoint(label) method'
      );
    }

    this._agentSession = agentSession;
  }

  /**
   * Save a snapshot for a given thread. Persists to file (via FileCheckpointer)
   * and also records a checkpoint label on the AgentSession.
   *
   * The AgentSession checkpoint label format is: `graph:{threadId}:{currentNode}`
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @param {Object} snapshot - The snapshot to persist.
   * @param {Object} snapshot.state - The full graph state at this checkpoint.
   * @param {string} snapshot.currentNode - The node that was active when snapshotted.
   * @param {number} snapshot.cycleCount - The current cycle/step count of the graph.
   * @returns {Promise<string>} The generated checkpointId from the file layer.
   */
  async save(threadId, snapshot) {
    // Persist to disk first (FileCheckpointer handles sanitisation & error handling)
    const checkpointId = await super.save(threadId, snapshot);

    // Record on AgentSession; don't let AgentSession failure block graph execution,
    // but do surface the error with a warning so it isn't silently swallowed.
    const label = `graph:${threadId}:${snapshot?.currentNode ?? 'unknown'}`;
    try {
      await this._agentSession.createCheckpoint(label);
    } catch (err) {
      // Non-fatal: file checkpoint already succeeded
      console.warn(
        `[AgentSessionCheckpointer] AgentSession.createCheckpoint("${label}") failed:`,
        err?.message ?? err
      );
    }

    return checkpointId;
  }

  /**
   * Returns the underlying AgentSession instance.
   *
   * @returns {Object}
   */
  get agentSession() {
    return this._agentSession;
  }
}

export default AgentSessionCheckpointer;
