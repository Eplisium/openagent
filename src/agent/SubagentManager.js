/**
 * 🤝 Subagent Manager
 * Manages subagent lifecycle, task delegation, and result aggregation
 * 
 * Features:
 * - Task queue with priority
 * - Parallel subagent execution
 * - Result aggregation and synthesis
 * - Subagent isolation (separate message histories)
 * - Progress tracking and callbacks
 */

import { Agent } from './Agent.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { fileTools } from '../tools/fileTools.js';
import { shellTools } from '../tools/shellTools.js';
import { webTools } from '../tools/webTools.js';
import { gitTools } from '../tools/gitTools.js';
import chalk from 'chalk';

/**
 * Subagent task states
 */
const TaskState = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * Predefined subagent specializations
 */
const SUBAGENT_SPECIALIZATIONS = {
  coder: {
    name: '💻 Coder',
    description: 'Writes and edits code',
    systemPrompt: `You are a specialized coding subagent. Your ONLY job is to write, edit, or fix code.
- Write clean, efficient, well-documented code
- Follow existing code style in the project
- Include error handling
- Focus ONLY on the specific coding task given to you
- Return your completed code with a brief explanation`,
    model: 'anthropic/claude-sonnet-4',
    maxIterations: 15,
  },
  researcher: {
    name: '🔍 Researcher',
    description: 'Searches web and gathers information',
    systemPrompt: `You are a specialized research subagent. Your ONLY job is to find and summarize information.
- Search the web thoroughly
- Read and extract relevant content
- Synthesize findings into clear, actionable insights
- Cite sources when possible
- Return a well-organized summary of your findings`,
    model: 'anthropic/claude-sonnet-4',
    maxIterations: 10,
  },
  file_manager: {
    name: '📁 File Manager',
    description: 'Handles file operations',
    systemPrompt: `You are a specialized file management subagent. Your ONLY job is file operations.
- Read, write, edit, move, copy, delete files
- List directories and search for files
- Create directory structures
- Handle file organization tasks
- Report what you did clearly`,
    model: 'anthropic/claude-sonnet-4',
    maxIterations: 10,
  },
  tester: {
    name: '🧪 Tester',
    description: 'Runs tests and validates code',
    systemPrompt: `You are a specialized testing subagent. Your ONLY job is to test and validate.
- Run existing tests
- Create new test cases
- Verify code behavior
- Report test results clearly
- Identify bugs and issues`,
    model: 'anthropic/claude-sonnet-4',
    maxIterations: 15,
  },
  reviewer: {
    name: '✅ Reviewer',
    description: 'Reviews code for quality',
    systemPrompt: `You are a specialized code review subagent. Your ONLY job is to review code quality.
- Check for bugs and logic errors
- Identify security issues
- Suggest performance improvements
- Verify best practices
- Provide constructive, specific feedback`,
    model: 'anthropic/claude-sonnet-4',
    maxIterations: 10,
  },
  general: {
    name: '🤖 General',
    description: 'Handles any task',
    systemPrompt: `You are a helpful subagent. Complete the task given to you efficiently.
- Understand the task clearly
- Use appropriate tools to complete it
- Report your results concisely`,
    model: 'anthropic/claude-sonnet-4',
    maxIterations: 20,
  },
};

/**
 * Subagent Task
 */
class SubagentTask {
  constructor(id, task, specialization = 'general', options = {}) {
    this.id = id;
    this.task = task;
    this.specialization = specialization;
    this.state = TaskState.PENDING;
    this.priority = options.priority || 5;
    this.result = null;
    this.error = null;
    this.startTime = null;
    this.endTime = null;
    this.subagent = null;
    this.onProgress = options.onProgress || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
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
      hasResult: !!this.result,
      error: this.error,
    };
  }
}

/**
 * Subagent Manager
 */
export class SubagentManager {
  constructor(options = {}) {
    this.parentAgent = options.parentAgent || null;
    this.workingDir = options.workingDir || process.cwd();
    this.maxConcurrent = options.maxConcurrent || 3;
    this.verbose = options.verbose !== false;
    
    // Task management
    this.tasks = new Map();
    this.taskQueue = [];
    this.runningTasks = new Set();
    this.completedTasks = [];
    this.taskIdCounter = 0;
    
    // Shared tools for subagents
    this.sharedTools = new ToolRegistry();
    this.sharedTools.registerAll([
      ...fileTools,
      ...shellTools,
      ...webTools,
      ...gitTools,
    ]);
    
    // Callbacks
    this.onTaskStart = options.onTaskStart || null;
    this.onTaskComplete = options.onTaskComplete || null;
    this.onTaskError = options.onTaskError || null;
    this.onAllComplete = options.onAllComplete || null;
    
    // Stats
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalDuration: 0,
    };
  }

  /**
   * Generate unique task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${++this.taskIdCounter}`;
  }

  /**
   * Create a subagent for a specific specialization
   */
  createSubagent(specialization = 'general', customOptions = {}) {
    const spec = SUBAGENT_SPECIALIZATIONS[specialization] || SUBAGENT_SPECIALIZATIONS.general;
    
    const agent = new Agent({
      tools: this.sharedTools,
      model: customOptions.model || spec.model,
      systemPrompt: customOptions.systemPrompt || spec.systemPrompt,
      verbose: this.verbose,
      maxIterations: customOptions.maxIterations || spec.maxIterations,
      streaming: false, // Subagents don't stream to keep things clean
      workingDir: this.workingDir,
    });
    
    return agent;
  }

  /**
   * Delegate a task to a subagent
   */
  async delegate(task, options = {}) {
    const specialization = options.specialization || 'general';
    const taskId = this.generateTaskId();
    
    const subagentTask = new SubagentTask(taskId, task, specialization, {
      priority: options.priority,
      onProgress: options.onProgress,
      onComplete: options.onComplete,
      onError: options.onError,
    });
    
    this.tasks.set(taskId, subagentTask);
    this.stats.totalTasks++;
    
    if (this.verbose) {
      const spec = SUBAGENT_SPECIALIZATIONS[specialization];
      console.log(chalk.cyan(`\n🤝 Delegating to ${spec?.name || 'Subagent'}: ${task.substring(0, 60)}...`));
    }
    
    // Run the task
    return this.executeTask(subagentTask);
  }

  /**
   * Execute a single subagent task
   */
  async executeTask(subagentTask) {
    subagentTask.state = TaskState.RUNNING;
    subagentTask.startTime = Date.now();
    this.runningTasks.add(subagentTask.id);
    
    if (this.onTaskStart) {
      this.onTaskStart(subagentTask);
    }
    
    try {
      // Create subagent
      const subagent = this.createSubagent(subagentTask.specialization);
      subagentTask.subagent = subagent;
      
      // Run the task
      const result = await subagent.run(subagentTask.task);
      
      subagentTask.state = TaskState.COMPLETED;
      subagentTask.endTime = Date.now();
      subagentTask.result = result;
      
      this.stats.completedTasks++;
      this.stats.totalDuration += subagentTask.duration;
      
      if (this.verbose) {
        console.log(chalk.green(`\n✓ Subagent completed (${(subagentTask.duration / 1000).toFixed(1)}s, ${result.iterations} iterations)`));
      }
      
      if (this.onTaskComplete) {
        this.onTaskComplete(subagentTask);
      }
      
      return {
        success: true,
        taskId: subagentTask.id,
        response: result.response,
        iterations: result.iterations,
        duration: subagentTask.duration,
        stats: result.stats,
      };
      
    } catch (error) {
      subagentTask.state = TaskState.FAILED;
      subagentTask.endTime = Date.now();
      subagentTask.error = error.message;
      
      this.stats.failedTasks++;
      
      if (this.verbose) {
        console.log(chalk.red(`\n✗ Subagent failed: ${error.message}`));
      }
      
      if (this.onTaskError) {
        this.onTaskError(subagentTask, error);
      }
      
      return {
        success: false,
        taskId: subagentTask.id,
        error: error.message,
        duration: subagentTask.duration,
      };
      
    } finally {
      this.runningTasks.delete(subagentTask.id);
      this.completedTasks.push(subagentTask);
    }
  }

  /**
   * Delegate multiple tasks in parallel
   */
  async delegateParallel(tasks, options = {}) {
    const results = [];
    const maxConcurrent = options.maxConcurrent || this.maxConcurrent;
    
    if (this.verbose) {
      console.log(chalk.cyan(`\n🚀 Delegating ${tasks.length} tasks in parallel (max ${maxConcurrent} concurrent)`));
    }
    
    // Process tasks in batches
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(taskSpec => {
        const task = typeof taskSpec === 'string' 
          ? { task: taskSpec, specialization: 'general' }
          : taskSpec;
        
        return this.delegate(task.task, {
          specialization: task.specialization,
          priority: task.priority,
        });
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    if (this.onAllComplete) {
      this.onAllComplete(results);
    }
    
    return results;
  }

  /**
   * Delegate with synthesis - run multiple tasks then synthesize results
   */
  async delegateWithSynthesis(tasks, synthesisPrompt, options = {}) {
    // Run all tasks in parallel
    const results = await this.delegateParallel(tasks, options);
    
    // Filter successful results
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    
    if (successfulResults.length === 0) {
      return {
        success: false,
        error: 'All subagent tasks failed',
        failures: failedResults,
      };
    }
    
    // Synthesize results
    if (this.verbose) {
      console.log(chalk.cyan(`\n🔄 Synthesizing ${successfulResults.length} results...`));
    }
    
    const synthesisAgent = this.createSubagent('general', {
      maxIterations: 15,
      maxToolResultChars: 30000, // Allow larger results for synthesis
    });
    
    const synthesisTask = `${synthesisPrompt}

## Subagent Results

${successfulResults.map((r, i) => `
### Result ${i + 1}
${r.response}
`).join('\n')}

${failedResults.length > 0 ? `
## Failed Tasks
${failedResults.map(r => `- ${r.error}`).join('\n')}
` : ''}

Please synthesize these results into a coherent response.`;
    
    const synthesisResult = await synthesisAgent.run(synthesisTask);
    
    return {
      success: true,
      synthesis: synthesisResult.response,
      individualResults: results,
      stats: {
        total: results.length,
        successful: successfulResults.length,
        failed: failedResults.length,
      },
    };
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { error: 'Task not found' };
    }
    return task.toJSON();
  }

  /**
   * Get all tasks status
   */
  getAllTasksStatus() {
    const tasks = [];
    for (const [id, task] of this.tasks) {
      tasks.push(task.toJSON());
    }
    return tasks;
  }

  /**
   * Get manager stats
   */
  getStats() {
    return {
      ...this.stats,
      pendingTasks: this.taskQueue.length,
      runningTasks: this.runningTasks.size,
      avgDuration: this.stats.completedTasks > 0 
        ? Math.round(this.stats.totalDuration / this.stats.completedTasks) + 'ms'
        : 'N/A',
      successRate: this.stats.totalTasks > 0
        ? ((this.stats.completedTasks / this.stats.totalTasks) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }

  /**
   * Cancel a pending task
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    
    if (task.state === TaskState.PENDING) {
      task.state = TaskState.CANCELLED;
      return true;
    }
    
    return false;
  }

  /**
   * Clear completed tasks
   */
  clearCompleted() {
    this.completedTasks = [];
    for (const [id, task] of this.tasks) {
      if (task.state === TaskState.COMPLETED || task.state === TaskState.FAILED) {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * List available specializations
   */
  static listSpecializations() {
    return Object.entries(SUBAGENT_SPECIALIZATIONS).map(([key, spec]) => ({
      id: key,
      name: spec.name,
      description: spec.description,
      model: spec.model,
      maxIterations: spec.maxIterations,
    }));
  }
}

export { SUBAGENT_SPECIALIZATIONS, TaskState };
export default SubagentManager;
