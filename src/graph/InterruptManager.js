/**
 * @fileoverview Human-in-the-loop interrupt manager.
 *
 * Design decisions:
 * - EventEmitter-based so external consumers can subscribe to pause/resume/abort
 *   events without tight coupling to the execution engine.
 * - `pause()` returns a Promise that either resolves (resume) or rejects (abort).
 *   The CompiledGraph awaits this Promise inside the execution loop.
 * - One pending interrupt per threadId at a time. A second `pause()` on the same
 *   thread while it's already paused will throw immediately to surface logic errors.
 */

import { EventEmitter } from 'events';
import { GraphError } from './errors.js';

/**
 * Manages human-in-the-loop interruptions for graph workflows.
 * Each active thread can be paused and resumed independently.
 *
 * @extends EventEmitter
 *
 * @example
 * const manager = new InterruptManager();
 *
 * // In node execution:
 * const humanInput = await manager.pause(threadId, 'approval-node', currentState);
 *
 * // From the outside (UI, API handler, etc.):
 * manager.resume(threadId, { approved: true });
 */
export class InterruptManager extends EventEmitter {
  constructor() {
    super();
    // Allow many listeners for multi-thread scenarios without warnings
    this.setMaxListeners(Infinity);

    /**
     * Map of threadId → pending interrupt descriptor.
     * @type {Map<string, PendingInterrupt>}
     * @private
     */
    this._pending = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Pauses execution for the given thread.
   * Returns a Promise that resolves with human input when `resume()` is called,
   * or rejects when `abort()` is called.
   *
   * @param {string} threadId - Unique identifier for the execution thread
   * @param {string} nodeName - Name of the node that triggered the interrupt
   * @param {Record<string, unknown>} currentState - State snapshot at pause time
   * @returns {Promise<unknown>} Resolves with the humanInput passed to `resume()`
   * @throws {GraphError} If the thread is already paused
   */
  pause(threadId, nodeName, currentState) {
    if (this._pending.has(threadId)) {
      throw new GraphError(
        `Thread "${threadId}" is already paused at node "${this._pending.get(threadId).node}". ` +
        `Call resume() or abort() before pausing again.`,
        { threadId, nodeName }
      );
    }

    let _resolve, _reject;

    // Create the promise that the execution loop will await
    const promise = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });

    const descriptor = {
      node: nodeName,
      state: currentState,
      pausedAt: new Date(),
      resolve: _resolve,
      reject: _reject,
      promise,
    };

    this._pending.set(threadId, descriptor);

    /**
     * @event InterruptManager#paused
     * @type {object}
     * @property {string} threadId
     * @property {string} node
     * @property {Record<string, unknown>} state
     * @property {Date} pausedAt
     */
    this.emit('paused', { threadId, node: nodeName, state: currentState, pausedAt: descriptor.pausedAt });

    return promise;
  }

  /**
   * Resumes a paused thread by resolving its pending Promise with human input.
   *
   * @param {string} threadId
   * @param {unknown} humanInput - Data provided by the human (e.g., approval, correction)
   * @throws {GraphError} If the thread is not currently paused
   */
  resume(threadId, humanInput) {
    const pending = this._getPending(threadId, 'resume');
    pending.resolve(humanInput);
    this._pending.delete(threadId);

    /**
     * @event InterruptManager#resumed
     * @type {object}
     * @property {string} threadId
     * @property {unknown} humanInput
     */
    this.emit('resumed', { threadId, humanInput });
  }

  /**
   * Aborts a paused thread by rejecting its pending Promise.
   *
   * @param {string} threadId
   * @param {string|Error} [reason='Aborted by caller'] - Reason for the abort
   * @throws {GraphError} If the thread is not currently paused
   */
  abort(threadId, reason = 'Aborted by caller') {
    const pending = this._getPending(threadId, 'abort');
    const err = reason instanceof Error ? reason : new GraphError(String(reason), { threadId });
    pending.reject(err);
    this._pending.delete(threadId);

    /**
     * @event InterruptManager#aborted
     * @type {object}
     * @property {string} threadId
     * @property {string|Error} reason
     */
    this.emit('aborted', { threadId, reason });
  }

  /**
   * Returns whether the given thread is currently paused.
   *
   * @param {string} threadId
   * @returns {boolean}
   */
  isPaused(threadId) {
    return this._pending.has(threadId);
  }

  /**
   * Returns metadata about the pending interrupt (without the resolver functions).
   *
   * @param {string} threadId
   * @returns {{ node: string, state: Record<string, unknown>, pausedAt: Date } | null}
   *   Returns null if the thread is not paused.
   */
  getPendingInfo(threadId) {
    const pending = this._pending.get(threadId);
    if (!pending) return null;
    return {
      node: pending.node,
      state: pending.state,
      pausedAt: pending.pausedAt,
    };
  }

  /**
   * Returns all currently paused thread IDs.
   * @returns {string[]}
   */
  getPausedThreadIds() {
    return [...this._pending.keys()];
  }

  /**
   * Clean up all pending interrupts and remove all event listeners.
   * Useful for graceful shutdown.
   * @returns {void}
   */
  destroy() {
    // Abort all pending interrupts
    for (const threadId of this._pending.keys()) {
      this.abort(threadId, 'InterruptManager destroyed');
    }
    // Remove all event listeners
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @param {string} threadId
   * @param {string} operation - 'resume' or 'abort' (for error message)
   * @returns {PendingInterrupt}
   * @private
   */
  _getPending(threadId, operation) {
    const pending = this._pending.get(threadId);
    if (!pending) {
      throw new GraphError(
        `Cannot ${operation} thread "${threadId}": it is not currently paused. ` +
        `Currently paused threads: [${[...this._pending.keys()].join(', ') || 'none'}]`,
        { threadId }
      );
    }
    return pending;
  }
}

/**
 * @typedef {object} PendingInterrupt
 * @property {string} node
 * @property {Record<string, unknown>} state
 * @property {Date} pausedAt
 * @property {function} resolve
 * @property {function} reject
 * @property {Promise<unknown>} promise
 */
