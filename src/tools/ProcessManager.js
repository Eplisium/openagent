/**
 * ProcessManager - Manages background processes without global state
 */
export class ProcessManager {
  constructor(options = {}) {
    this.processes = {};
    this.cleanupOnExit = options.cleanupOnExit !== false;
    this._exitHandlerRegistered = false;
  }

  /**
   * Register a background process
   * @param {string} label - Unique label for the process
   * @param {object} procData - Process data { pid, proc, command, cwd, startTime, label }
   */
  add(label, procData) {
    this.processes[label] = { ...procData, running: true, exitCode: null, signal: null, error: null };
    
    // Register exit handler on first process add
    if (this.cleanupOnExit && !this._exitHandlerRegistered) {
      this._exitHandlerRegistered = true;
      process.on('exit', () => this.killAll());
      // Also handle uncaught exceptions to clean up
      process.on('uncaughtException', () => this.killAll());
      process.on('unhandledRejection', () => this.killAll());
    }
  }

  /**
   * Get a process by label
   * @param {string} label
   * @returns {object|undefined}
   */
  get(label) {
    return this.processes[label];
  }

  /**
   * List all processes
   * @returns {object[]}
   */
  list() {
    return Object.values(this.processes);
  }

  /**
   * Remove a process by label
   * @param {string} label
   * @returns {boolean} true if removed, false if not found
   */
  remove(label) {
    if (this.processes[label]) {
      delete this.processes[label];
      return true;
    }
    return false;
  }

  /**
   * Kill all tracked processes
   * Used for cleanup when parent process exits
   */
  killAll() {
    for (const [label, procData] of Object.entries(this.processes)) {
      if (procData.proc && !procData.proc.killed) {
        try {
          procData.proc.kill('SIGTERM');
          // Force kill after 5 seconds if still running
          setTimeout(() => {
            if (procData.proc && !procData.proc.killed) {
              procData.proc.kill('SIGKILL');
            }
          }, 5000);
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
    }
    this.processes = {};
  }
}

const defaultProcessManager = new ProcessManager();
export default defaultProcessManager;
