/**
 * FileCheckpointer.js
 * File-backed checkpoint implementation using fs-extra.
 * Persists checkpoints as JSON files on disk, one file per thread.
 */

import path from 'path';
import fs from '../../utils/fs-compat.js';
import { BaseCheckpointer } from './BaseCheckpointer.js';

/** Maximum number of checkpoints retained per thread file. */
const MAX_CHECKPOINTS_PER_THREAD = 50;

export class FileCheckpointer extends BaseCheckpointer {
  /**
   * @param {Object} [options] - Configuration options.
   * @param {string} [options.dir] - Directory for checkpoint files.
   *   Defaults to `.openagent/graph-checkpoints/` in the current working directory.
   * @param {number} [options.maxCheckpoints=50] - Maximum checkpoints to keep per thread.
   */
  constructor(options = {}) {
    super();
    this._dir = options.dir
      ? path.resolve(options.dir)
      : path.join(process.cwd(), '.openagent', 'graph-checkpoints');
    this._maxCheckpoints = options.maxCheckpoints ?? MAX_CHECKPOINTS_PER_THREAD;
  }

  /**
   * Returns the absolute file path for a thread's checkpoint file.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {string} Absolute path to the JSON checkpoint file.
   * @protected
   */
  _threadPath(threadId) {
    // Sanitize threadId to prevent path traversal
    const safeId = threadId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this._dir, `${safeId}.json`);
  }

  /**
   * Ensure the checkpoint directory exists.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _ensureDir() {
    await fs.ensureDir(this._dir);
  }

  /**
   * Read existing checkpoints from a thread file.
   *
   * @param {string} filePath - Absolute path to the file.
   * @returns {Promise<Array<Object>>} Array of checkpoint entries (may be empty).
   * @private
   */
  async _readFile(filePath) {
    try {
      const data = await fs.readJson(filePath);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Save a snapshot for a given thread. Appends to the file, retaining at most
   * `maxCheckpoints` entries. Uses an atomic write pattern (write to temp, rename).
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @param {Object} snapshot - The snapshot to persist.
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

    await this._ensureDir();

    const filePath = this._threadPath(threadId);
    const checkpoints = await this._readFile(filePath);

    const random = Math.random().toString(36).slice(2, 10);
    const checkpointId = `cp_${Date.now()}_${random}`;
    const timestamp = Date.now();

    const entry = {
      checkpointId,
      timestamp,
      currentNode: snapshot.currentNode ?? null,
      cycleCount: snapshot.cycleCount ?? 0,
      state: structuredClone(snapshot.state ?? {}),
    };

    checkpoints.push(entry);

    // Trim to maxCheckpoints
    if (checkpoints.length > this._maxCheckpoints) {
      checkpoints.splice(0, checkpoints.length - this._maxCheckpoints);
    }

    // Atomic write: write to temp file first, then rename to prevent corruption
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    await fs.writeJson(tempPath, checkpoints, { spaces: 2 });
    await fs.rename(tempPath, filePath);

    return checkpointId;
  }

  /**
   * Load the most recent snapshot for a given thread.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<Object|null>} The last saved snapshot, or null if none exists.
   */
  async load(threadId) {
    const filePath = this._threadPath(threadId);
    const checkpoints = await this._readFile(filePath);

    if (checkpoints.length === 0) {
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
    const filePath = this._threadPath(threadId);
    const checkpoints = await this._readFile(filePath);

    return checkpoints.map(({ checkpointId, currentNode, timestamp, cycleCount }) => ({
      checkpointId,
      currentNode,
      timestamp,
      cycleCount,
    }));
  }

  /**
   * Delete all checkpoints for a given thread by removing its file.
   *
   * @param {string} threadId - Unique identifier for the execution thread.
   * @returns {Promise<void>}
   */
  async delete(threadId) {
    const filePath = this._threadPath(threadId);
    try {
      await fs.remove(filePath);
    } catch (err) {
      // Ignore "file not found" — idempotent delete
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /**
   * Returns the configured checkpoint directory.
   *
   * @returns {string}
   */
  get dir() {
    return this._dir;
  }
}

export default FileCheckpointer;
