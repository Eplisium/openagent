/**
 * MemoryCheckpointer.js
 * In-memory checkpoint implementation. All data is lost when the process exits.
 * Suitable for testing, short-lived workflows, or when persistence is not needed.
 */

import { BaseCheckpointer } from './BaseCheckpointer.js';

export class MemoryCheckpointer extends BaseCheckpointer {
  /**
   * @param {Object} [options] - Optional configuration.
   * @param {number} [options.maxCheckpoints=50] - Maximum checkpoints to retain per thread.
   */
  constructor(options = {}) {
    super();
    /** @type {Map<string, Array<Object>>} */
    this._store = new Map();
    this._maxCheckpoints = options.maxCheckpoints ?? 50;
  }

  /**
   * Save a snapshot for a given thread. Appends to the in-memory array, keeping
   * at most `maxCheckpoints` entries. Deep-clones the snapshot to prevent mutation.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @param {Object} snapshot - The snapshot to store.
   * @param {Object} snapshot.state - The full graph state at this checkpoint.
   * @param {string} snapshot.currentNode - The node that was active when snapshotted.
   * @param {number} snapshot.cycleCount - The current cycle/step count of the graph.
   * @returns {Promise<string>} The generated checkpointId.
   */
  async save(threadId, snapshot) {
    if (!threadId || typeof threadId !== 'string') {
      throw new TypeError('threadId must be a non-empty string');
    }
    if (!snapshot || typeof snapshot !== 'object') {
      throw new TypeError('snapshot must be an object');
    }

    const checkpointId = `mem_cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = Date.now();

    const entry = {
      checkpointId,
      timestamp,
      currentNode: snapshot.currentNode ?? null,
      cycleCount: snapshot.cycleCount ?? 0,
      state: structuredClone(snapshot.state ?? {}),
    };

    if (!this._store.has(threadId)) {
      this._store.set(threadId, []);
    }

    const checkpoints = this._store.get(threadId);
    checkpoints.push(entry);

    // Trim to maxCheckpoints
    if (checkpoints.length > this._maxCheckpoints) {
      checkpoints.splice(0, checkpoints.length - this._maxCheckpoints);
    }

    return checkpointId;
  }

  /**
   * Load the most recent snapshot for a given thread.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<Object|null>} The last saved snapshot (deep-cloned), or null if none exists.
   */
  async load(threadId) {
    const checkpoints = this._store.get(threadId);
    if (!checkpoints || checkpoints.length === 0) {
      return null;
    }
    return structuredClone(checkpoints[checkpoints.length - 1]);
  }

  /**
   * List checkpoint metadata for a given thread (without full state payloads).
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<Array<{checkpointId: string, currentNode: string, timestamp: number, cycleCount: number}>>}
   */
  async list(threadId) {
    const checkpoints = this._store.get(threadId);
    if (!checkpoints) {
      return [];
    }
    return checkpoints.map(({ checkpointId, currentNode, timestamp, cycleCount }) => ({
      checkpointId,
      currentNode,
      timestamp,
      cycleCount,
    }));
  }

  /**
   * Delete all checkpoints for a given thread.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<void>}
   */
  async delete(threadId) {
    this._store.delete(threadId);
  }

  /**
   * Clear all checkpoints for all threads. Useful for test teardown.
   *
   * @returns {void}
   */
  clear() {
    this._store.clear();
  }

  /**
   * Returns the number of threads currently tracked.
   *
   * @returns {number}
   */
  get threadCount() {
    return this._store.size;
  }
}

export default MemoryCheckpointer;
