/**
 * 🔄 Long-Running Agent v1.0
 * Enhanced agent with task planning, progress tracking, and verification
 * 
 * Based on Anthropic's "Effective harnesses for long-running agents":
 * - Task decomposition into features
 * - Progress tracking across sessions
 * - Incremental work on ONE feature at a time
 * - Clean state enforcement
 * - End-to-end verification
 * - Git-based recovery
 */

import { Agent } from './Agent.js';
import { TaskManager, FeatureStatus } from './TaskManager.js';
import chalk from 'chalk';

export class LongRunningAgent extends Agent {
  constructor(options = {}) {
    super(options);
    
    this.taskManager = new TaskManager({
      workingDir: options.workingDir || process.cwd(),
      verbose: options.verbose !== false,
    });
    
    this.currentTask = null;
    this.currentFeature = null;
    this.planningMode = options.planningMode !== false;
    this.requireVerification = options.requireVerification !== false;
    this.maxFeatureAttempts = options.maxFeatureAttempts || 3;
  }

  /**
   * Enhanced system prompt for long-running tasks
   */
  defaultSystemPrompt() {
    return `You are an advanced AI coding assistant designed for long-running, complex tasks. You excel at breaking down large projects into manageable features and working through them systematically.

## Your Core Workflow

### 1. PLANNING PHASE (First Session Only)
When starting a new task, you MUST:
- Break the task into specific, testable features
- Create a feature list with priorities
- Identify dependencies between features
- Save the plan for future sessions

### 2. INCREMENTAL WORK (Every Session)
- Work on ONE feature at a time
- Before starting: check progress file for current state
- After completing: verify the feature works end-to-end
- Leave the codebase in a clean, committable state

### 3. VERIFICATION PHASE
For each feature:
- Write or update tests
- Run the feature manually if possible
- Check for regressions in existing features
- Mark as "passing" only when fully verified

## Critical Rules for Long Tasks

### State Management
- ALWAYS read the progress file at session start
- ALWAYS update progress when completing work
- Use git commits to save working states
- Write clear commit messages for each feature

### Incremental Progress
- Never try to implement everything at once
- Focus on making ONE feature work perfectly
- If a feature is too large, break it into sub-features
- It's better to have 5 working features than 10 half-done ones

### Clean State Protocol
Before ending a session:
1. Run tests to verify nothing is broken
2. Commit all changes with descriptive message
3. Update progress file with what was accomplished
4. Note any blockers or issues for next session

### Recovery Protocol
If you get stuck or something breaks:
1. Check git log for last working state
2. Read progress file to understand what changed
3. Revert to last working commit if needed
4. Try a different approach

## Tools Available
- File Operations: read_file, write_file, edit_file, list_directory, search_in_files
- Shell: exec (run tests, start servers, etc.)
- Web: web_search, read_webpage (for documentation)
- Git: git_status, git_log, git_diff, git_add, git_commit, git_push
- Subagents: delegate_task, delegate_parallel (for parallel work)

## Progress Tracking
You have access to a task manager that tracks:
- Feature list with status (pending/in_progress/passing/failing)
- Current feature being worked on
- Session history and accomplishments
- Overall progress percentage

Use this to:
- Know where you left off
- Avoid redoing completed work
- Track what still needs to be done
- Report progress to the user

## Communication Style
- Be concise but thorough
- Show progress updates
- Explain what you're doing and why
- Report blockers immediately
- Celebrate completed features`;
  }

  /**
   * Run with task management
   */
  async run(userInput, options = {}) {
    // Check if this is a new task or continuation
    const status = await this.taskManager.getStatus();
    
    if (status.status === 'not_initialized') {
      // First session - initialize and plan
      console.log(chalk.cyan('\n📋 New task detected - entering planning phase\n'));
      
      await this.taskManager.initialize(userInput);
      
      // Add planning context to user input
      const planningPrompt = `${userInput}

## IMPORTANT: This is your FIRST session on this task.

You MUST:
1. Break this task into specific, testable features
2. Create a feature list using the create_feature_list tool
3. Start working on the highest priority feature
4. Save progress as you work

Remember: Work incrementally. One feature at a time. Verify each feature works before moving on.`;
      
      return await super.run(planningPrompt, options);
    } else {
      // Continuation - load context
      console.log(chalk.cyan('\n🔄 Continuing existing task\n'));
      
      const progressReport = await this.taskManager.generateProgressReport();
      
      const continuationPrompt = `## Task Continuation

${progressReport}

## User Request
${userInput}

## Instructions
1. Check the progress report above to see where you left off
2. If a feature is in progress, continue working on it
3. If no feature is in progress, start the next pending feature
4. Always verify your work before marking features complete
5. Update progress as you work`;

      return await super.run(continuationPrompt, options);
    }
  }

  /**
   * Create feature list from task analysis
   */
  async createFeatureList(features) {
    return await this.taskManager.createFeatureList(features);
  }

  /**
   * Start working on a feature
   */
  async startFeature(featureId) {
    this.currentFeature = await this.taskManager.startFeature(featureId);
    return this.currentFeature;
  }

  /**
   * Complete a feature with verification
   */
  async completeFeature(featureId, verification = {}) {
    if (this.requireVerification && !verification.tested) {
      console.log(chalk.yellow('   ⚠️ Feature marked complete without verification'));
    }
    
    this.currentFeature = null;
    return await this.taskManager.completeFeature(featureId, verification);
  }

  /**
   * Fail a feature
   */
  async failFeature(featureId, error) {
    this.currentFeature = null;
    return await this.taskManager.failFeature(featureId, error);
  }

  /**
   * Get current task status
   */
  async getTaskStatus() {
    return await this.taskManager.getStatus();
  }

  /**
   * Get progress report
   */
  async getProgressReport() {
    return await this.taskManager.generateProgressReport();
  }

  /**
   * Save session and update progress
   */
  async endSession(summary) {
    await this.taskManager.saveSessionLog();
    
    if (summary) {
      console.log(chalk.cyan('\n📊 Session Summary'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(summary);
      console.log(chalk.dim('─'.repeat(40)));
    }
  }
}

export default LongRunningAgent;
