/**
 * 🤝 Subagent Manager v4.0
 * Production-grade subagent lifecycle, task delegation, and result aggregation
 * 
 * Major improvements:
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
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { createFileTools } from '../tools/fileTools.js';
import { createShellTools } from '../tools/shellTools.js';
import { webTools } from '../tools/webTools.js';
import { createGitTools } from '../tools/gitTools.js';
import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════════
// 📊 Task States
// ═══════════════════════════════════════════════════════════════════

const TaskState = {
  QUEUED: 'queued',
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying',
};

// ═══════════════════════════════════════════════════════════════════
// 🎨 UI Helpers - Clean visual output for subagent system
// ═══════════════════════════════════════════════════════════════════

const UI = {
  SUBAGENT_PREFIX: chalk.dim('  │ '),
  SUBAGENT_START: chalk.dim('  ┌─'),
  SUBAGENT_END: chalk.dim('  └─'),
  SUBAGENT_DIVIDER: chalk.dim('  ├' + '─'.repeat(50)),
  
  header(specName, taskPreview) {
    const lines = [];
    lines.push('');
    lines.push(chalk.dim('  ┌' + '─'.repeat(58) + '┐'));
    lines.push(chalk.dim('  │ ') + chalk.cyan.bold(`⚡ Subagent: ${specName}`) + chalk.dim(' '.repeat(Math.max(0, 43 - specName.length)) + '│'));
    if (taskPreview) {
      const preview = taskPreview.length > 52 ? taskPreview.substring(0, 49) + '...' : taskPreview;
      lines.push(chalk.dim('  │ ') + chalk.gray(preview) + chalk.dim(' '.repeat(Math.max(0, 55 - preview.length)) + '│'));
    }
    lines.push(chalk.dim('  ├' + '─'.repeat(58) + '┤'));
    return lines.join('\n');
  },
  
  footer(success, duration, iterations) {
    const status = success 
      ? chalk.green.bold('✓ Complete') 
      : chalk.red.bold('✗ Failed');
    const time = chalk.gray(`${(duration / 1000).toFixed(1)}s`);
    const iters = iterations ? chalk.gray(`${iterations} iterations`) : '';
    const line = `${status} ${time}${iters ? ' • ' + iters : ''}`;
    const lines = [];
    lines.push(chalk.dim('  ├' + '─'.repeat(58) + '┤'));
    lines.push(chalk.dim('  │ ') + line + chalk.dim(' '.repeat(Math.max(0, 55 - stripAnsi(line).length)) + '│'));
    lines.push(chalk.dim('  └' + '─'.repeat(58) + '┘'));
    lines.push('');
    return lines.join('\n');
  },
  
  progress(message) {
    return chalk.dim('  │ ') + chalk.gray(`  ${message}`);
  },
  
  parallelHeader(taskCount, maxConcurrent) {
    const lines = [];
    lines.push('');
    lines.push(chalk.dim('  ╔' + '═'.repeat(58) + '╗'));
    lines.push(chalk.dim('  ║ ') + chalk.cyan.bold(`🚀 Parallel Execution: ${taskCount} tasks`) + chalk.gray(` (max ${maxConcurrent} concurrent)`) + chalk.dim(' '.repeat(Math.max(0, 30 - String(taskCount).length - String(maxConcurrent).length)) + '║'));
    lines.push(chalk.dim('  ╠' + '═'.repeat(58) + '╣'));
    return lines.join('\n');
  },
  
  parallelFooter(results) {
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalDuration = Math.max(...results.map(r => r.duration || 0));
    
    const lines = [];
    lines.push(chalk.dim('  ╠' + '═'.repeat(58) + '╣'));
    const summary = `${chalk.green(`✓ ${success} passed`)}${failed > 0 ? chalk.red(` • ✗ ${failed} failed`) : ''} ${chalk.gray(`• ${(totalDuration / 1000).toFixed(1)}s total`)}`;
    lines.push(chalk.dim('  ║ ') + summary + chalk.dim(' '.repeat(Math.max(0, 55 - stripAnsi(summary).length)) + '║'));
    lines.push(chalk.dim('  ╚' + '═'.repeat(58) + '╝'));
    lines.push('');
    return lines.join('\n');
  },

  taskRow(index, specName, status, preview) {
    const icons = {
      [TaskState.QUEUED]: chalk.gray('○'),
      [TaskState.PENDING]: chalk.yellow('◔'),
      [TaskState.RUNNING]: chalk.cyan('◑'),
      [TaskState.COMPLETED]: chalk.green('●'),
      [TaskState.FAILED]: chalk.red('●'),
      [TaskState.RETRYING]: chalk.yellow('↻'),
    };
    const icon = icons[status] || chalk.gray('?');
    const shortPreview = preview.length > 40 ? preview.substring(0, 37) + '...' : preview;
    return chalk.dim('  ║ ') + `  ${icon} ${chalk.white(`#${index + 1}`)} ${chalk.cyan(specName.padEnd(12))} ${chalk.gray(shortPreview)}`;
  },
};

/** Strip ANSI codes for length calculation */
function stripAnsi(str) {
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

// ═══════════════════════════════════════════════════════════════════
// 🧠 Enhanced Subagent Specializations
// ═══════════════════════════════════════════════════════════════════

const SUBAGENT_SPECIALIZATIONS = {
  coder: {
    name: '💻 Coder',
    description: 'Expert code writer, editor, and debugger',
    systemPrompt: `You are an expert coding subagent. Your ONLY job is to write, edit, and fix code with precision.

## Your Approach
1. **Read first** - Always read existing files before editing them
2. **Understand context** - Check the project structure and coding style
3. **Write clean code** - Follow existing patterns, add error handling, document your work
4. **Verify** - After writing/editing, verify the changes look correct
5. **Report clearly** - Summarize exactly what you changed and why

## Tool Usage Guidelines
- Use read_file before edit_file or write_file
- Use list_directory and search_in_files to understand project structure
- Use exec to run tests or verify code compiles
- For large edits, use edit_file with find/replace for precision
- For new files, use write_file with complete content

## Code Quality Standards
- Include error handling for all edge cases
- Add JSDoc/docstring comments for functions
- Follow the existing code style exactly
- Keep functions small and focused
- Use meaningful variable names
- Add type hints where applicable

## CRITICAL RULES
- NEVER leave placeholder comments like "// TODO" or "// implement this"
- ALWAYS write complete, working code
- If you're unsure about something, read more files for context first
- Return a clear summary of all files changed`,
    maxIterations: 20,
  },

  architect: {
    name: '🏗️ Architect',
    description: 'Designs systems, plans refactors, creates project structures',
    systemPrompt: `You are a system architecture subagent. Your ONLY job is to analyze, design, and plan.

## Your Approach
1. **Analyze** - Read the existing codebase thoroughly
2. **Identify patterns** - Understand the architecture and design decisions
3. **Plan** - Create detailed, actionable plans with specific file changes
4. **Consider trade-offs** - Note pros/cons of different approaches

## What You Produce
- Detailed architecture plans with file-by-file changes
- Dependency diagrams described in text
- Migration strategies for refactors
- API design specifications
- Project structure recommendations

## CRITICAL: Be specific. Don't give vague advice. List exact files, exact changes.`,
    maxIterations: 15,
  },

  researcher: {
    name: '🔍 Researcher',
    description: 'Searches web, reads docs, gathers information',
    systemPrompt: `You are a specialized research subagent. Your ONLY job is to find and synthesize information.

## Your Approach
1. **Search broadly** - Use web_search with multiple relevant queries
2. **Read deeply** - Use read_webpage to get full content from promising results
3. **Cross-reference** - Verify information across multiple sources
4. **Synthesize** - Combine findings into clear, actionable insights

## Output Format
- Start with a TL;DR summary
- Organize findings by topic
- Include source URLs
- Highlight actionable recommendations
- Note any conflicting information

## CRITICAL: Cite your sources. Always include URLs where you found information.`,
    maxIterations: 12,
  },

  file_manager: {
    name: '📁 File Manager',
    description: 'Handles file operations, organization, and structure',
    systemPrompt: `You are a specialized file management subagent. Your ONLY job is file operations.

## Your Capabilities
- Read, write, edit, and organize files
- Create directory structures
- Search for files and content
- Rename and restructure projects
- Generate configuration files

## Guidelines
- Always verify operations succeeded
- Report what you did with exact file paths
- Use list_directory to confirm structure after changes
- Be careful with destructive operations`,
    maxIterations: 12,
  },

  tester: {
    name: '🧪 Tester',
    description: 'Creates tests, runs validation, checks code quality',
    systemPrompt: `You are a specialized testing subagent. Your ONLY job is to test and validate code.

## Your Approach
1. **Read the code** - Understand what needs testing
2. **Identify test cases** - Cover happy paths, edge cases, error cases
3. **Write tests** - Create comprehensive test files
4. **Run tests** - Execute tests and analyze results
5. **Report** - Clear pass/fail summary with details on failures

## Test Quality
- Test both success and failure paths
- Include edge cases (empty inputs, large inputs, null values)
- Mock external dependencies when needed
- Use descriptive test names that explain what's being tested

## CRITICAL: Always run the tests after writing them. Report actual results, not assumptions.`,
    maxIterations: 18,
  },

  reviewer: {
    name: '✅ Reviewer',
    description: 'Reviews code for quality, security, and best practices',
    systemPrompt: `You are a specialized code review subagent. Your ONLY job is to review code quality.

## Review Checklist
1. **Correctness** - Logic errors, off-by-one, race conditions
2. **Security** - Injection, XSS, auth issues, secret exposure
3. **Performance** - N+1 queries, unnecessary loops, memory leaks
4. **Style** - Consistency, naming, documentation
5. **Architecture** - Separation of concerns, coupling, cohesion

## Output Format
For each issue found:
- 🔴 Critical / 🟡 Warning / 🔵 Suggestion
- File and line reference
- What's wrong
- How to fix it

## CRITICAL: Be specific. Reference exact files and line numbers. Suggest exact fixes.`,
    maxIterations: 12,
  },

  general: {
    name: '🤖 General',
    description: 'Handles any task flexibly',
    systemPrompt: `You are a helpful subagent. Complete the assigned task efficiently.

## Guidelines
- Understand the task clearly before starting
- Use the most appropriate tools
- Verify your work
- Report results concisely with clear outcomes
- If the task is ambiguous, make reasonable assumptions and note them`,
    maxIterations: 20,
  },
};

// ═══════════════════════════════════════════════════════════════════
// 📋 Subagent Task
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// 🎯 Subagent Manager
// ═══════════════════════════════════════════════════════════════════

export class SubagentManager {
  constructor(options = {}) {
    this.parentAgent = options.parentAgent || null;
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.workspaceDir = options.workspaceDir ? path.resolve(options.workspaceDir) : null;
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
    this.sharedTools = new ToolRegistry();
    this.sharedTools.registerAll([
      ...createFileTools({
        baseDir: this.workingDir,
        getWorkspaceDir: () => this.getWorkspaceDir(),
      }),
      ...createShellTools({
        baseDir: this.workingDir,
        getWorkspaceDir: () => this.getWorkspaceDir(),
      }),
      ...webTools,
      ...createGitTools({
        baseDir: this.workingDir,
        getWorkspaceDir: () => this.getWorkspaceDir(),
      }),
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
    
    // Build enhanced system prompt with working directory context
    const enhancedPrompt = `${customOptions.systemPrompt || spec.systemPrompt}

## Environment
- Working directory: ${this.workingDir}
- Task workspace: ${workspaceDir || 'not set'}
- Relative paths resolve from the working directory
- Use workspace: for notes, artifacts, temporary scripts, and scratch files
- Platform: ${process.platform}
- You are a SUBAGENT - complete your specific task and return results. Do not ask questions.
- Be thorough but focused. Do exactly what was asked, nothing more.`;
    
    const agent = new Agent({
      tools: this.sharedTools,
      model: model,
      systemPrompt: enhancedPrompt,
      verbose: false, // Subagents are quiet - we handle their output
      maxIterations: customOptions.maxIterations ?? spec.maxIterations,
      streaming: false, // Subagents never stream
      workingDir: this.workingDir,
      maxToolResultChars: customOptions.maxToolResultChars ?? 20000,
      // Use longer timeouts for subagents to handle complex tasks
      maxRetries: 2,
      retryDelay: 2000,
    });
    
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
    
    const result = await this.executeTask(subagentTask);
    
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
        const subagent = this.createSubagent(subagentTask.specialization);
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
        const result = await subagent.run(subagentTask.task);
        
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
        this.activeSubagents.delete(subagent);
        
        return {
          success: true,
          taskId: subagentTask.id,
          specialization: subagentTask.specialization,
          response: result.response,
          iterations: result.iterations,
          duration: subagentTask.duration,
          retries: subagentTask.retryCount,
          stats: result.stats,
        };
        
      } catch (error) {
        lastError = error;
        
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
      tasks.forEach((taskSpec, i) => {
        const task = typeof taskSpec === 'string' 
          ? { task: taskSpec, specialization: 'general' }
          : taskSpec;
        const spec = SUBAGENT_SPECIALIZATIONS[task.specialization || 'general'] || SUBAGENT_SPECIALIZATIONS.general;
        console.log(UI.taskRow(i, spec.name, TaskState.QUEUED, task.task.substring(0, 60)));
      });
      console.log(chalk.dim('  ╠' + '═'.repeat(58) + '╣'));
    }
    
    // Process tasks in batches
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      
      if (this.verbose && i > 0) {
        console.log(UI.progress(`── Batch ${Math.floor(i / maxConcurrent) + 1} ──`));
      }
      
      const batchPromises = batch.map((taskSpec, batchIdx) => {
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
    for (const [id, task] of this.tasks) {
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

  // ─── Utilities ─────────────────────────────────────────────────

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { SUBAGENT_SPECIALIZATIONS, TaskState };
export default SubagentManager;
