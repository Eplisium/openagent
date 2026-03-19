/**
 * 📋 Subagent Task
 * Represents a single delegated task with state tracking, retry support, and serialization.
 */

const TaskState = {
  QUEUED: 'queued',
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying',
};

class SubagentTask {
  constructor(id, task, specialization = 'general', options = {}) {
    this.id = id;
    this.task = task;
    this.specialization = specialization;
    this.state = TaskState.QUEUED;
    this.priority = options.priority || 5;
    this.result = null;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
    this.subagent = null;
    this.retryCount = 0;
    this.maxRetries = options.maxRetries || 1;
    this.onProgress = options.onProgress || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
    this.parentContext = options.parentContext || null;
  }

  get duration() {
    if (!this.startTime) return 0;
    return (this.endTime || Date.now()) - this.startTime;
  }

  toJSON() {
    return {
      id: this.id,
      task: this.task.substring(0, 100) + (this.task.length > 100 ? '...' : ''),
      specialization: this.specialization,
      state: this.state,
      priority: this.priority,
      duration: this.duration,
      retryCount: this.retryCount,
      hasResult: !!this.result,
      error: this.error,
    };
  }
}

export { SubagentTask, TaskState };
export default SubagentTask;
