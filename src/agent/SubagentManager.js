/**
 * 🤝 Subagent Manager v0.1.20
 * Production-grade subagent lifecycle, task delegation, and result aggregation
 * 
 * v0.1.20 improvements:
 * - Auto-inject project file tree into subagent system prompts
 * - Platform-aware shell command guidance (no Unix commands on Windows)
 * - Full file editing rules in all specialization prompts
 * - Path prefix guidance (project:, workspace:, openagent:)
 * - Higher maxIterations for coding tasks (35 vs 20)
 * - Longer default timeout (8min vs 5min)
 * 
 * Earlier improvements:
 * - Clean visual separation between parent and subagent output
 * - Enhanced coding-focused system prompts with tool guidance
 * - Progress tracking with spinners and live status
 * - Retry logic at the subagent task level
 * - Smart result aggregation with priority weighting
 * - Resource pooling to avoid redundant tool registrations
 * - Isolated console output with indented subagent logs
 * - Task dependency chains for sequential workflows
 * - AbortController support for cancelling subagent execution
 * - Real-time progress callbacks
 * - Graceful shutdown on parent abort
 */

import { Agent } from './Agent.js';
import path from 'path';
import fs from 'fs-extra';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { createFileTools } from '../tools/fileTools.js';
import { createShellTools } from '../tools/shellTools.js';
import { webTools } from '../tools/webTools.js';
import { createGitTools } from '../tools/gitTools.js';
import { createMcpTools } from '../tools/mcpTools.js';
import { createA2ATools } from '../tools/a2aTools.js';
import { createAGUITools } from '../tools/aguiTools.js';
import chalk from 'chalk';
import { SUBAGENT_SPECIALIZATIONS } from './subagents/specializations.js';
import { UI } from './subagents/subagentUI.js';
import { SubagentTask, TaskState } from './subagents/SubagentTask.js';

// ─── Project Context Scanner ───────────────────────────────────

/**
 * Scan a directory tree and return a compact text representation.
 * Skips node_modules, .git, dist, build, .openagent, and other noise.
 * @param {string} dir - Root directory to scan
 * @param {number} maxDepth - Maximum depth (default 3)
 * @param {number} maxEntries - Maximum total entries (default 80)
 * @returns {string} Text file tree
 */
function scanProjectTree(dir, maxDepth = 3, maxEntries = 80) {
  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.openagent',
    '.openagent-tasks', '.sessions', '.tool-cache', '.windop-backups',
    '__pycache__', '.venv', 'venv', '.env', 'coverage', '.nyc_output',
  ]);

  const SKIP_EXTENSIONS = new Set(['.log', '.bak', '.tmp', '.swp', '.lock']);
  const lines = [];
  let entryCount = 0;

  function walk(currentDir, prefix, depth) {
    if (depth > maxDepth || entryCount >= maxEntries) return;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    // Filter out skipped dirs and files
    const filtered = entries.filter(e => {
      if (SKIP_DIRS.has(e.name)) return false;
      if (e.name.startsWith('.') && e.name !== '.' && !e.name.endsWith('.env') && e.name !== '.gitignore') return false;
      if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (SKIP_EXTENSIONS.has(ext)) return false;
      }
      return true;
    });

    const total = filtered.length;
    filtered.forEach((entry, index) => {
      if (entryCount >= maxEntries) return;
      const isLast = index === total - 1;
      const connector = isLast ? '└── ' : '├── ';
      const name = entry.isDirectory() ? entry.name + '/' : entry.name;
      lines.push(prefix + connector + name);
      entryCount++;

      if (entry.isDirectory()) {
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
        walk(path.join(currentDir, entry.name), nextPrefix, depth + 1);
      }
    });
  }

  try {
    const rootName = path.basename(dir) || dir;
    lines.push(rootName + '/');
    walk(dir, '', 0);
  } catch {
    return '';
  }

  if (entryCount >= maxEntries) {
    lines.push('  ... (truncated)');
  }

  return lines.join('\n');
}



// ═══════════════════════════════════════════════════════════════════
// 🧠 Enhanced Subagent Specializations

// ═══════════════════════════════════════════════════════════════════
// 📋 Subagent Task

// ═══════════════════════════════════════════════════════════════════
// 🎯 Subagent Manager
// ═══════════════════════════════════════════════════════════════════

export class SubagentManager {
  constructor(options = {}) {
    this.parentAgent = options.parentAgent || null;
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.workspaceDir = options.workspaceDir ? path.resolve(options.workspaceDir) : null;
    this.openAgentDir = options.openAgentDir ? path.resolve(options.openAgentDir) : null;
    this.permissions = {
      allowFileDelete: true,
      ...options.permissions,
    };
    this.allowFullAccess = options.allowFullAccess === true || this.permissions.allowFullAccess === true;
    const externalWorkspaceGetter = typeof options.getWorkspaceDir === 'function' ? options.getWorkspaceDir : null;
    this.getWorkspaceDir = () => {
      const workspaceDir = externalWorkspaceGetter ? externalWorkspaceGetter() : this.workspaceDir;
      return workspaceDir ? path.resolve(workspaceDir) : null;
    };
    this.maxConcurrent = options.maxConcurrent || 3;
    this.verbose = options.verbose !== false;
    
    // Task management
    this.tasks = new Map();
    this.runningTasks = new Set();
    this.completedTasks = [];
    this.taskIdCounter = 0;
    
    // Shared tools - created once, reused by all subagents
    this.sharedTools = new ToolRegistry({ permissions: this.permissions });
    this.sharedTools.registerAll([
      ...createFileTools({
        baseDir: this.workingDir,
        getWorkspaceDir: () => this.getWorkspaceDir(),
        getOpenAgentDir: () => this.openAgentDir,
        permissions: this.permissions,
        allowFullAccess: this.allowFullAccess,
      }),
      ...createShellTools({
        baseDir: this.workingDir,
        getWorkspaceDir: () => this.getWorkspaceDir(),
        getOpenAgentDir: () => this.openAgentDir,
        permissions: this.permissions,
        allowFullAccess: this.allowFullAccess,
      }),
      ...webTools,
      ...createGitTools({
        baseDir: this.workingDir,
        getWorkspaceDir: () => this.getWorkspaceDir(),
      }),
      ...createMcpTools({
        baseDir: this.workingDir,
      }),
      ...createA2ATools(),
      ...createAGUITools(),
      ...this._createMessageBusTools(),
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
      totalRetries: 0,
      bySpecialization: {},
    };
    
    // Abort support
    this.aborted = false;
    this.abortController = null;
    this.activeSubagents = new Set();
    this.subagentTimers = new Map(); // subagent -> timeout timer ID
    
    // Message bus for inter-subagent communication
    this.messageBus = new Map(); // subagentId -> message queue (array of messages)
    this.sharedContext = new Map(); // key -> value shared across subagents
    
    // Periodic cleanup of stale subagents (every 60 seconds)
    this._cleanupInterval = setInterval(() => {
      try {
        this.cleanupStaleSubagents();
      } catch (err) {
        // Swallow errors from cleanup to avoid crashing the interval
        if (this.verbose) {
          console.error(chalk.red(`[SubagentManager] Cleanup error: ${err.message}`));
        }
      }
    }, 60000);
    this._cleanupInterval.unref?.();
  }

  setWorkspaceDir(workspaceDir) {
    this.workspaceDir = workspaceDir ? path.resolve(workspaceDir) : null;
  }
  
  /**
   * Abort all running subagents
   */
  abort() {
    this.aborted = true;
    if (this.abortController) {
      this.abortController.abort();
    }
    // Abort all active subagents
    for (const subagent of this.activeSubagents) {
      if (subagent.abort) {
        subagent.abort();
      }
    }
  }
  
  /**
   * Reset abort state
   */
  resetAbort() {
    this.aborted = false;
    this.abortController = null;
    this.activeSubagents.clear();
  }
  
  /**
   * Check if aborted
   */
  checkAborted() {
    if (this.aborted) {
      throw new Error('SubagentManager was aborted');
    }
  }

  // ─── Task ID Generation ────────────────────────────────────────

  generateTaskId() {
    return `sub_${Date.now()}_${++this.taskIdCounter}`;
  }

  // ─── Subagent Factory ──────────────────────────────────────────

  createSubagent(specialization = 'general', customOptions = {}) {
    const spec = SUBAGENT_SPECIALIZATIONS[specialization] || SUBAGENT_SPECIALIZATIONS.general;
    
    const model = customOptions.model || this.parentAgent?.model;
    const workspaceDir = this.getWorkspaceDir();
    
    if (!model) {
      throw new Error('Model must be specified for subagent. Pass model in customOptions or set parentAgent.');
    }
    
    // Build enhanced system prompt with working directory + project context
    let projectContext = '';
    try {
      const tree = scanProjectTree(this.workingDir, 3, 80);
      if (tree) {
        projectContext = `
## Project Structure
\`\`\`
${tree}
\`\`\`
`;
      }
    } catch {
      // If scanning fails, continue without tree context
    }

    const enhancedPrompt = `${customOptions.systemPrompt || spec.systemPrompt}

## Environment
- Working directory: ${this.workingDir}
- Task workspace: ${workspaceDir || 'not set'}
- Relative paths resolve from the working directory
- Use \`project:\` for project files (e.g., \`project:src/index.js\`)
- Use \`workspace:\` for notes, artifacts, temporary scripts, and scratch files
- Platform: ${process.platform}
- You are a SUBAGENT - complete your specific task and return results. Do not ask questions.
- Be thorough but focused. Do exactly what was asked, nothing more.${projectContext}`;
    
    const agent = new Agent({
      tools: this.sharedTools,
      model: model,
      systemPrompt: enhancedPrompt,
      verbose: false, // Subagents are quiet - we handle their output
      maxIterations: customOptions.maxIterations ?? spec.maxIterations,
      streaming: false, // Subagents never stream
      workingDir: this.workingDir,
      maxToolResultChars: customOptions.maxToolResultChars ?? 40000,
      // Use longer timeouts for subagents to handle complex tasks
      maxRetries: 3,
      retryDelay: 1500,
    });
    
    // Enforce max runtime timeout (default: 10 minutes for coding tasks)
    const maxRuntime = customOptions.maxRuntime || 600000;
    const timeoutTimer = setTimeout(() => {
      if (this.verbose) {
        console.log(UI.progress(chalk.red(`⏰ Subagent exceeded max runtime (${maxRuntime}ms) - aborting`)));
      }
      if (typeof agent.abort === 'function') {
        agent.abort();
      }
      this.subagentTimers.delete(agent);
    }, maxRuntime);
    
    // Store timer reference so we can clear it on normal completion
    this.subagentTimers.set(agent, timeoutTimer);
    
    return agent;
  }

  // ─── Single Task Delegation ────────────────────────────────────

  async delegate(task, options = {}) {
    const specialization = options.specialization || 'general';
    const taskId = this.generateTaskId();
    
    const subagentTask = new SubagentTask(taskId, task, specialization, {
      priority: options.priority,
      maxRetries: options.maxRetries || 1,
      onProgress: options.onProgress,
      onComplete: options.onComplete,
      onError: options.onError,
      parentContext: options.parentContext,
    });
    
    this.tasks.set(taskId, subagentTask);
    this.stats.totalTasks++;
    
    // Track by specialization
    if (!this.stats.bySpecialization[specialization]) {
      this.stats.bySpecialization[specialization] = { total: 0, completed: 0, failed: 0 };
    }
    this.stats.bySpecialization[specialization].total++;
    
    const spec = SUBAGENT_SPECIALIZATIONS[specialization] || SUBAGENT_SPECIALIZATIONS.general;
    
    if (this.verbose) {
      console.log(UI.header(spec.name, task.substring(0, 100)));
    }
    
    let result = await this.executeTask(subagentTask);
    
    // Validate result - check for non-empty response on success
    if (result.success && (!result.response || result.response.trim() === '')) {
      if (this.verbose) {
        console.log(UI.progress(chalk.yellow('⚠ Empty response from subagent - retrying once')));
      }
      // Reset task state for a single retry
      subagentTask.state = TaskState.QUEUED;
      subagentTask.retryCount = 0;
      subagentTask.maxRetries = 1;
      subagentTask.startTime = null;
      subagentTask.endTime = null;
      subagentTask.error = null;
      result = await this.executeTask(subagentTask);
    }
    
    if (this.verbose) {
      console.log(UI.footer(
        result.success,
        subagentTask.duration,
        result.iterations
      ));
    }
    
    return result;
  }

  // ─── Task Execution with Retry ─────────────────────────────────

  async executeTask(subagentTask) {
    this.checkAborted();
    
    subagentTask.state = TaskState.RUNNING;
    subagentTask.startTime = Date.now();
    this.runningTasks.add(subagentTask.id);
    
    if (this.onTaskStart) {
      this.onTaskStart(subagentTask);
    }
    
    let lastError = null;
    
    for (let attempt = 0; attempt <= subagentTask.maxRetries; attempt++) {
      let subagent = null;
      try {
        if (attempt > 0) {
          subagentTask.state = TaskState.RETRYING;
          subagentTask.retryCount = attempt;
          this.stats.totalRetries++;
          
          if (this.verbose) {
            console.log(UI.progress(`↻ Retry ${attempt}/${subagentTask.maxRetries}...`));
          }
          
          // Brief backoff before retry
          await this.sleep(1000 * attempt);
        }
        
        // Create fresh subagent for each attempt
        subagent = this.createSubagent(subagentTask.specialization);
        subagentTask.subagent = subagent;
        this.activeSubagents.add(subagent);
        
        // Wire up progress logging for verbose mode
        if (this.verbose) {
          let toolCount = 0;
          subagent.onToolStart = (toolName) => {
            toolCount++;
            console.log(UI.progress(`🔧 ${chalk.yellow(toolName)} ${chalk.dim(`(#${toolCount})`)}`));
          };
          subagent.onToolEnd = (toolName, result) => {
            if (result.success !== false) {
              console.log(UI.progress(`${chalk.green('✓')} ${chalk.dim(toolName)}`));
            } else {
              console.log(UI.progress(`${chalk.red('✗')} ${chalk.dim(toolName)}: ${chalk.red(result.error || 'failed')}`));
            }
          };
        }
        
        // Run the task
        let result;
        try {
          result = await subagent.run(subagentTask.task);
        } finally {
          // Always clean up the subagent's resources, even on failure
          this.cleanupSubagent(subagent);
          this.activeSubagents.delete(subagent);
          if (subagentTask.subagent === subagent) {
            subagentTask.subagent = null;
          }
        }

        if (!result || result.completed === false) {
          const stopReason = result?.stopReason || 'incomplete';
          const incompleteError = new Error(`Subagent stopped before completion (${stopReason})`);
          incompleteError.partialResult = result;
          throw incompleteError;
        }
        
        // Success
        subagentTask.state = TaskState.COMPLETED;
        subagentTask.endTime = Date.now();
        subagentTask.result = result;
        
        this.stats.completedTasks++;
        this.stats.totalDuration += subagentTask.duration;
        if (this.stats.bySpecialization[subagentTask.specialization]) {
          this.stats.bySpecialization[subagentTask.specialization].completed++;
        }
        
        if (this.onTaskComplete) {
          this.onTaskComplete(subagentTask);
        }
        
        // Cleanup on success
        this.runningTasks.delete(subagentTask.id);
        this.completedTasks.push(subagentTask);
        
        return {
          success: true,
          taskId: subagentTask.id,
          specialization: subagentTask.specialization,
          response: result.response,
          iterations: result.iterations,
          duration: subagentTask.duration,
          retries: subagentTask.retryCount,
          stats: result.stats,
          stopReason: result.stopReason,
        };
        
      } catch (error) {
        lastError = error;
        if (error.partialResult) {
          subagentTask.result = error.partialResult;
        }
        
        // Clean up subagent resources on error
        if (subagent) {
          this.cleanupSubagent(subagent);
          this.activeSubagents.delete(subagent);
          if (subagentTask.subagent === subagent) {
            subagentTask.subagent = null;
          }
        }
        
        if (this.verbose && attempt < subagentTask.maxRetries) {
          console.log(UI.progress(`${chalk.yellow('⚠')} ${chalk.yellow(error.message.substring(0, 80))}`));
        }
      }
    }
    
    // All attempts failed
    subagentTask.state = TaskState.FAILED;
    subagentTask.endTime = Date.now();
    subagentTask.error = lastError.message;
    
    this.stats.failedTasks++;
    if (this.stats.bySpecialization[subagentTask.specialization]) {
      this.stats.bySpecialization[subagentTask.specialization].failed++;
    }
    
    if (this.onTaskError) {
      this.onTaskError(subagentTask, lastError);
    }
    
    // Cleanup
    this.runningTasks.delete(subagentTask.id);
    this.completedTasks.push(subagentTask);
    if (subagentTask.subagent) {
      this.activeSubagents.delete(subagentTask.subagent);
    }
    
    return {
      success: false,
      taskId: subagentTask.id,
      specialization: subagentTask.specialization,
      error: lastError.message,
      duration: subagentTask.duration,
      retries: subagentTask.retryCount,
      response: lastError.partialResult?.response,
      stopReason: lastError.partialResult?.stopReason,
    };
  }

  // ─── Parallel Task Delegation ──────────────────────────────────

  async delegateParallel(tasks, options = {}) {
    this.checkAborted();
    
    const maxConcurrent = options.maxConcurrent || this.maxConcurrent;
    const results = [];
    
    if (this.verbose) {
      console.log(UI.parallelHeader(tasks.length, maxConcurrent));
      
      // Show task list
      tasks.forEach((taskSpec, iteration) => {
        const task = typeof taskSpec === 'string' 
          ? { task: taskSpec, specialization: 'general' }
          : taskSpec;
        const spec = SUBAGENT_SPECIALIZATIONS[task.specialization || 'general'] || SUBAGENT_SPECIALIZATIONS.general;
        console.log(UI.taskRow(iteration, spec.name, TaskState.QUEUED, task.task.substring(0, 60)));
      });
      console.log(chalk.dim('  ╠' + '═'.repeat(58) + '╣'));
    }
    
    // Process tasks in batches
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      
      if (this.verbose && i > 0) {
        console.log(UI.progress(`── Batch ${Math.floor(i / maxConcurrent) + 1} ──`));
      }
      
      const batchPromises = batch.map((taskSpec, _batchIdx) => {
        const task = typeof taskSpec === 'string' 
          ? { task: taskSpec, specialization: 'general' }
          : taskSpec;
        
        return this.delegate(task.task, {
          specialization: task.specialization || 'general',
          priority: task.priority,
          maxRetries: task.maxRetries || 1,
        });
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason?.message || 'Unknown error',
            duration: 0,
          });
        }
      }
    }
    
    if (this.verbose) {
      console.log(UI.parallelFooter(results));
    }
    
    if (this.onAllComplete) {
      this.onAllComplete(results);
    }
    
    return results;
  }

  // ─── Parallel with Synthesis ───────────────────────────────────

  async delegateWithSynthesis(tasks, synthesisPrompt, options = {}) {
    this.checkAborted();
    
    // Run all tasks in parallel
    const results = await this.delegateParallel(tasks, options);
    
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
      console.log(UI.header('🔄 Synthesizer', `Combining ${successfulResults.length} results...`));
    }
    
    const synthesisAgent = this.createSubagent('general', {
      maxIterations: 10,
      maxToolResultChars: 40000,
    });
    
    const synthesisTask = `${synthesisPrompt || 'Synthesize these results into a clear, organized summary.'}

## Subagent Results

${successfulResults.map((r, i) => `
### Result ${i + 1} (${r.specialization || 'general'})
${r.response}
`).join('\n---\n')}

${failedResults.length > 0 ? `
## Failed Tasks (${failedResults.length})
${failedResults.map(r => `- ${r.error}`).join('\n')}
` : ''}

Please synthesize these results into a single coherent, well-organized response. Remove any redundancy. Highlight the most important findings.`;
    
    try {
      const synthesisResult = await synthesisAgent.run(synthesisTask);
      
      if (this.verbose) {
        console.log(UI.footer(true, 0, synthesisResult.iterations));
      }
      
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
    } catch (error) {
      // If synthesis fails, just concatenate results
      if (this.verbose) {
        console.log(UI.footer(false, 0));
      }
      
      return {
        success: true,
        synthesis: successfulResults.map((r, i) => `## Result ${i + 1}\n${r.response}`).join('\n\n'),
        individualResults: results,
        stats: {
          total: results.length,
          successful: successfulResults.length,
          failed: failedResults.length,
          synthesisError: error.message,
        },
      };
    }
  }

  // ─── Sequential Pipeline ───────────────────────────────────────

  async delegatePipeline(stages, options = {}) {
    this.checkAborted();
    
    const results = [];
    let previousResult = null;
    
    if (this.verbose) {
      console.log('');
      console.log(chalk.cyan.bold(`  📋 Pipeline: ${stages.length} stages`));
      console.log(chalk.dim('  ' + '─'.repeat(58)));
    }
    
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      
      // Allow stages to reference previous results
      let task = stage.task;
      if (previousResult && task.includes('{{previous}}')) {
        task = task.replace('{{previous}}', previousResult.response || '');
      }
      
      if (this.verbose) {
        console.log(chalk.cyan(`  Stage ${i + 1}/${stages.length}: ${stage.specialization || 'general'}`));
      }
      
      const result = await this.delegate(task, {
        specialization: stage.specialization || 'general',
        priority: stage.priority || 5,
        maxRetries: stage.maxRetries || 1,
      });
      
      results.push(result);
      previousResult = result;
      
      // Stop pipeline on failure unless configured to continue
      if (!result.success && !options.continueOnFailure) {
        if (this.verbose) {
          console.log(chalk.red(`  Pipeline stopped at stage ${i + 1}: ${result.error}`));
        }
        break;
      }
    }
    
    return {
      success: results.every(r => r.success),
      stages: results,
      finalResult: results[results.length - 1],
    };
  }

  // ─── Status & Stats ────────────────────────────────────────────

  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { error: 'Task not found' };
    }
    return task.toJSON();
  }

  getAllTasksStatus() {
    const tasks = [];
    for (const [_id, task] of this.tasks) {
      tasks.push(task.toJSON());
    }
    return tasks;
  }

  getStats() {
    return {
      ...this.stats,
      runningTasks: this.runningTasks.size,
      avgDuration: this.stats.completedTasks > 0 
        ? Math.round(this.stats.totalDuration / this.stats.completedTasks) + 'ms'
        : 'N/A',
      successRate: this.stats.totalTasks > 0
        ? ((this.stats.completedTasks / this.stats.totalTasks) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }

  // ─── Task Management ───────────────────────────────────────────

  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    
    if (task.state === TaskState.QUEUED || task.state === TaskState.PENDING) {
      task.state = TaskState.CANCELLED;
      return true;
    }
    
    return false;
  }

  clearCompleted() {
    this.completedTasks = [];
    for (const [id, task] of this.tasks) {
      if (task.state === TaskState.COMPLETED || task.state === TaskState.FAILED || task.state === TaskState.CANCELLED) {
        this.tasks.delete(id);
      }
    }
  }
  
  /**
   * Get active subagent count
   */
  getActiveCount() {
    return this.activeSubagents.size;
  }

  // ─── Static Helpers ────────────────────────────────────────────

  static listSpecializations() {
    return Object.entries(SUBAGENT_SPECIALIZATIONS).map(([key, spec]) => ({
      id: key,
      name: spec.name,
      description: spec.description,
      maxIterations: spec.maxIterations,
    }));
  }

  // ─── Stale Subagent Cleanup ─────────────────────────────────────

  /**
   * Clean up subagents that have been running longer than expected.
   * Kills stale subagents and marks their tasks as failed.
   * @param {number} [maxRuntimeMs=600000] - Max allowed runtime in ms (default: 10 minutes)
   */
  cleanupStaleSubagents(maxRuntimeMs = 600000) {
    const now = Date.now();
    
    for (const [taskId, task] of this.tasks) {
      if (task.state !== TaskState.RUNNING && task.state !== TaskState.RETRYING) {
        continue;
      }
      
      if (!task.startTime) continue;
      
      const elapsed = now - task.startTime;
      if (elapsed > maxRuntimeMs) {
        if (this.verbose) {
          console.log(UI.progress(
            chalk.red(`🗑 Cleaning up stale subagent ${task.id} (running ${(elapsed / 1000).toFixed(0)}s)`)
          ));
        }
        
        // Abort the subagent if it exists
        if (task.subagent) {
          this.cleanupSubagent(task.subagent);
          this.activeSubagents.delete(task.subagent);
        }
        
        // Mark task as failed
        task.state = TaskState.FAILED;
        task.endTime = now;
        task.error = `Subagent exceeded max runtime of ${maxRuntimeMs}ms`;
        
        this.runningTasks.delete(taskId);
        this.completedTasks.push(task);
        this.stats.failedTasks++;
        if (this.stats.bySpecialization[task.specialization]) {
          this.stats.bySpecialization[task.specialization].failed++;
        }
      }
    }
  }

  /**
   * Clean up a single subagent's resources: clear its timeout timer and abort it.
   * @param {Agent} subagent
   */
  cleanupSubagent(subagent) {
    if (!subagent) return;
    
    // Clear the timeout timer if one exists
    const timer = this.subagentTimers.get(subagent);
    if (timer) {
      clearTimeout(timer);
      this.subagentTimers.delete(subagent);
    }
    
    // Abort the subagent if it supports abort
    if (typeof subagent.abort === 'function') {
      try {
        subagent.abort();
      } catch (_err) {
        // Ignore abort errors - subagent may have already finished
      }
    }
  }

  /**
   * Shut down the SubagentManager: clear the cleanup interval and abort all
   * running subagents. Call this when the parent agent is shutting down.
   */
  shutdown() {
    // Stop the periodic cleanup interval
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    
    // Abort all active subagents and clear their timers
    for (const subagent of this.activeSubagents) {
      this.cleanupSubagent(subagent);
    }
    this.activeSubagents.clear();
    
    // Mark any running tasks as cancelled
    for (const [taskId, task] of this.tasks) {
      if (task.state === TaskState.RUNNING || task.state === TaskState.RETRYING) {
        task.state = TaskState.CANCELLED;
        task.endTime = Date.now();
        task.error = 'SubagentManager shut down';
        this.runningTasks.delete(taskId);
        this.completedTasks.push(task);
      }
    }
    
    this.aborted = true;
  }

  // ─── Message Bus Tool Factory ───────────────────────────────────

  /**
   * Create tools that allow subagents to use the message bus and shared context.
   * These tools are registered in the shared tool registry so all subagents can access them.
   * @returns {Array} Array of tool definitions
   */
  _createMessageBusTools() {
    const manager = this;
    return [
      {
        name: 'send_subagent_message',
        description: 'Send a message to another subagent by its task ID. Messages persist and can be retrieved even after the target subagent completes.',
        category: 'subagent',
        parameters: {
          type: 'object',
          properties: {
            subagentId: {
              type: 'string',
              description: 'The task ID of the target subagent (e.g., "sub_1234567890_1")',
            },
            message: {
              type: 'string',
              description: 'The message content to send',
            },
          },
          required: ['subagentId', 'message'],
        },
        timeout: 5000,
        async execute(args) {
          try {
            const result = manager.sendMessage(args.subagentId, args.message);
            return { success: true, ...result };
          } catch (error) {
            return { success: false, error: error.message };
          }
        },
      },
      {
        name: 'get_subagent_messages',
        description: 'Retrieve and clear all pending messages for a subagent. Returns messages sent to this subagent\'s task ID.',
        category: 'subagent',
        parameters: {
          type: 'object',
          properties: {
            subagentId: {
              type: 'string',
              description: 'The task ID of the subagent to retrieve messages for',
            },
          },
          required: ['subagentId'],
        },
        timeout: 5000,
        async execute(args) {
          try {
            const messages = manager.receiveMessages(args.subagentId);
            return { success: true, messages, count: messages.length };
          } catch (error) {
            return { success: false, error: error.message };
          }
        },
      },
      {
        name: 'set_shared_context',
        description: 'Set a shared context value accessible by all subagents. Use this to share data between subagents without direct messaging.',
        category: 'subagent',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'The context key (use descriptive names like "analysis_results" or "target_files")',
            },
            value: {
              description: 'The value to store (string, number, object, or array)',
            },
          },
          required: ['key', 'value'],
        },
        timeout: 5000,
        async execute(args) {
          try {
            manager.setSharedContext(args.key, args.value);
            return { success: true, key: args.key };
          } catch (error) {
            return { success: false, error: error.message };
          }
        },
      },
      {
        name: 'get_shared_context',
        description: 'Get a shared context value by key, or all shared context if no key is provided.',
        category: 'subagent',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'The context key to retrieve. Omit to get all shared context.',
            },
          },
        },
        timeout: 5000,
        async execute(args) {
          try {
            if (args.key) {
              const value = manager.getSharedContext(args.key);
              return { success: true, key: args.key, value, found: value !== undefined };
            } else {
              const allContext = manager.getAllSharedContext();
              return { success: true, context: allContext, keys: Object.keys(allContext) };
            }
          } catch (error) {
            return { success: false, error: error.message };
          }
        },
      },
    ];
  }

  // ─── Message Bus ────────────────────────────────────────────────

  /**
   * Send a message to a subagent's message queue.
   * Messages persist even after the subagent completes, allowing post-completion communication.
   * @param {string} subagentId - The task ID of the target subagent
   * @param {string|object} message - The message to send (string or serializable object)
   * @returns {{success: boolean, queueSize: number}}
   */
  sendMessage(subagentId, message) {
    if (!this.messageBus.has(subagentId)) {
      this.messageBus.set(subagentId, []);
    }
    const queue = this.messageBus.get(subagentId);
    const entry = {
      id: `msg_${Date.now()}_${queue.length}`,
      timestamp: new Date().toISOString(),
      content: typeof message === 'string' ? message : JSON.stringify(message),
    };
    queue.push(entry);
    return { success: true, queueSize: queue.length, messageId: entry.id };
  }

  /**
   * Retrieve and clear all pending messages for a subagent.
   * @param {string} subagentId - The task ID of the subagent
   * @returns {Array<{id: string, timestamp: string, content: string}>} Messages (cleared from queue after retrieval)
   */
  receiveMessages(subagentId) {
    const queue = this.messageBus.get(subagentId) || [];
    // Return a copy and clear the queue
    this.messageBus.set(subagentId, []);
    return [...queue];
  }

  /**
   * Set a shared context value accessible by all subagents.
   * @param {string} key - Context key
   * @param {*} value - Context value (must be serializable)
   */
  setSharedContext(key, value) {
    this.sharedContext.set(key, value);
  }

  /**
   * Get a shared context value.
   * @param {string} key - Context key
   * @returns {*} The value, or undefined if not set
   */
  getSharedContext(key) {
    return this.sharedContext.get(key);
  }

  /**
   * Get all shared context as a plain object.
   * @returns {Object} All shared context key-value pairs
   */
  getAllSharedContext() {
    const result = {};
    for (const [key, value] of this.sharedContext) {
      result[key] = value;
    }
    return result;
  }

  // ─── Utilities ─────────────────────────────────────────────────

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default SubagentManager;
