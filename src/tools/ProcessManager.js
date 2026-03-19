/**
 * ProcessManager - Manages background processes without global state
 */
export class ProcessManager {
  constructor() {
    this.processes = {};
  }

  /**
   * Register a background process
   * @param {string} label - Unique label for the process
   * @param {object} procData - Process data { pid, proc, command, cwd, startTime, label }
   */
  add(label, procData) {
    this.processes[label] = procData;
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
}

const defaultProcessManager = new ProcessManager();
export default defaultProcessManager;
