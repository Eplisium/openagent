/**
 * BaseCheckpointer.js
 * Abstract base class defining the interface for all graph checkpoint implementations.
 * Subclasses must implement save, load, list, and delete.
 */

export class BaseCheckpointer {
  /**
   * Save a snapshot for a given thread.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @param {Object} snapshot - The snapshot to persist.
   * @param {Object} snapshot.state - The full graph state at this checkpoint.
   * @param {string} snapshot.currentNode - The node that was active when snapshotted.
   * @param {number} snapshot.cycleCount - The current cycle/step count of the graph.
   * @returns {Promise<string>} The generated checkpointId.
   * @abstract
   */
  async save(threadId, snapshot) {
    throw new Error(`${this.constructor.name}.save() is not implemented`);
  }

  /**
   * Load the most recent snapshot for a given thread.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<Object|null>} The last saved snapshot, or null if none exists.
   * @abstract
   */
  async load(threadId) {
    throw new Error(`${this.constructor.name}.load() is not implemented`);
  }

  /**
   * List checkpoint metadata for a given thread (without full state payloads).
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<Array<{checkpointId: string, currentNode: string, timestamp: number}>>}
   *   Array of checkpoint metadata objects, ordered from oldest to newest.
   * @abstract
   */
  async list(threadId) {
    throw new Error(`${this.constructor.name}.list() is not implemented`);
  }

  /**
   * Delete all checkpoints for a given thread.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<void>}
   * @abstract
   */
  async delete(threadId) {
    throw new Error(`${this.constructor.name}.delete() is not implemented`);
  }
}

export default BaseCheckpointer;
