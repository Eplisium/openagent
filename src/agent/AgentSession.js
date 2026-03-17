/**
 * 📋 Agent Session Manager v3.2
 * Manages sessions, checkpoints, and context with enhanced subagent integration
 */

import fs from 'fs-extra';
import path from 'path';
import { Agent } from './Agent.js';
import { SubagentManager } from './SubagentManager.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { fileTools } from '../tools/fileTools.js';
import { shellTools } from '../tools/shellTools.js';
import { webTools } from '../tools/webTools.js';
import { gitTools } from '../tools/gitTools.js';
import { createSubagentTools } from '../tools/subagentTools.js';
import chalk from 'chalk';

export class AgentSession {
  constructor(options = {}) {
    this.sessionId = options.sessionId || `session_${Date.now()}`;
    this.workingDir = options.workingDir || process.cwd();
    this.saveDir = options.saveDir || path.join(process.cwd(), '.sessions');
    this.model = options.model;
    this.checkpoints = [];
    this.metadata = {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      workingDir: this.workingDir,
    };
    
    // Create tool registry with all tools
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.registerAll([
      ...fileTools,
      ...shellTools,
      ...webTools,
      ...gitTools,
    ]);
    
    // Initialize subagent manager
    this.subagentManager = new SubagentManager({
      workingDir: this.workingDir,
      verbose: options.verbose !== false,
      maxConcurrent: options.maxSubagents || 3,
      parentAgent: null, // Will be set after agent creation
    });
    
    // Register subagent tools (includes new pipeline tool)
    const subagentTools = createSubagentTools(this.subagentManager);
    this.toolRegistry.registerAll(subagentTools);
    
    // Create agent
    this.agent = new Agent({
      tools: this.toolRegistry,
      model: this.model,
      verbose: options.verbose !== false,
      streaming: options.streaming !== false,
      maxIterations: options.maxIterations || 30,
      systemPrompt: options.systemPrompt || this.buildSystemPrompt(),
      ...options,
    });
    
    // Set parent agent reference for subagents to inherit model
    this.subagentManager.parentAgent = this.agent;
  }

  /**
   * Build system prompt with working directory context and enhanced delegation guidance
   */
  buildSystemPrompt() {
    return `You are an advanced AI coding assistant running in a terminal session.
Your working directory is: ${this.workingDir}

## Your Capabilities
You have access to powerful tools for:
- **File Operations**: read_file, write_file, edit_file, list_directory, search_in_files, get_file_info
- **Shell Execution**: exec, exec_background, process_status, system_info
- **Web Access**: web_search, read_webpage, fetch_url
- **Git Operations**: git_status, git_log, git_diff, git_add, git_commit, git_push, git_pull, git_branch, git_info
- **Subagent Delegation**: delegate_task, delegate_parallel, delegate_with_synthesis, delegate_pipeline, subagent_status

## 🤝 Subagent Delegation (Your Superpower)
You can delegate tasks to specialized subagents that work independently:

### When to Delegate
- **Coding tasks**: Delegate to "coder" subagent for writing/editing code
- **Research**: Delegate to "researcher" for web searches and information gathering
- **Code review**: Delegate to "reviewer" for quality analysis
- **Testing**: Delegate to "tester" for writing and running tests
- **Architecture**: Delegate to "architect" for system design and planning
- **Parallel work**: Use delegate_parallel for multiple independent tasks
- **Workflows**: Use delegate_pipeline for Plan → Code → Test → Review flows

### Delegation Best Practices
1. **Be specific** - Give subagents detailed task descriptions with file paths and exact requirements
2. **Trust results** - After delegation, present the subagent's results. Do NOT redo their work.
3. **Use parallel** - When you have 2+ independent tasks, run them in parallel for speed
4. **Use pipeline** - For multi-step workflows, use delegate_pipeline with {{previous}} references
5. **Choose specialization** - Pick the right subagent type for the task

### CRITICAL RULES for Subagents
- When subagents complete work, DO NOT repeat the same tool calls they already made
- After delegation, synthesize and present their results to the user
- If a subagent already read files, checked git, or gathered info, use their results directly
- Subagents have access to the same tools as you (files, shell, web, git)

## Working Style
1. **Understand** what the user wants before acting
2. **Explore** the codebase/context when needed
3. **Plan** complex tasks - consider if delegation would help
4. **Execute** using the most appropriate tools or subagents
5. **Verify** your work succeeded
6. **Summarize** what was done when complete

## Guidelines
- Always read files before editing them
- Use search_in_files to find relevant code
- Check git status before making commits
- Write clean, well-documented code
- If a tool fails, try alternative approaches
- Be concise in your responses
- Show code changes clearly

## Shell Commands on Windows
- The exec tool auto-detects PowerShell vs CMD
- PowerShell commands (Get-Process, Get-CimInstance, etc.) are automatically routed to PowerShell
- You do NOT need to prefix with "powershell" - just use the command directly

## Important
- You are running on Windows. Use Windows-style paths (C:\\Users\\...)
- Paths with spaces must be quoted`;
  }

  /**
   * Run a task
   */
  async run(task) {
    this.metadata.updated = new Date().toISOString();
    this.metadata.lastTask = task.substring(0, 100);
    
    // Create checkpoint before running
    this.createCheckpoint('before_task');
    
    try {
      const result = await this.agent.run(task);
      
      // Create checkpoint after successful run
      this.createCheckpoint('after_task');
      
      return result;
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      throw error;
    }
  }

  /**
   * Run with streaming
   */
  async *runStream(task) {
    this.metadata.updated = new Date().toISOString();
    
    for await (const chunk of this.agent.runStream(task)) {
      yield chunk;
    }
  }

  /**
   * Create a checkpoint
   */
  createCheckpoint(label = 'checkpoint') {
    const checkpoint = {
      id: `cp_${Date.now()}`,
      label,
      timestamp: new Date().toISOString(),
      messages: JSON.parse(JSON.stringify(this.agent.messages)),
      history: JSON.parse(JSON.stringify(this.agent.history)),
      stats: this.agent.getStats(),
    };
    
    this.checkpoints.push(checkpoint);
    
    // Keep only last 20 checkpoints
    if (this.checkpoints.length > 20) {
      this.checkpoints = this.checkpoints.slice(-20);
    }
    
    return checkpoint.id;
  }

  /**
   * Restore to a checkpoint
   */
  restoreCheckpoint(checkpointId) {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
      return { success: false, error: `Checkpoint ${checkpointId} not found` };
    }
    
    this.agent.messages = JSON.parse(JSON.stringify(checkpoint.messages));
    this.agent.history = JSON.parse(JSON.stringify(checkpoint.history));
    
    return { success: true, label: checkpoint.label, timestamp: checkpoint.timestamp };
  }

  /**
   * List checkpoints
   */
  listCheckpoints() {
    return this.checkpoints.map(cp => ({
      id: cp.id,
      label: cp.label,
      timestamp: cp.timestamp,
      iterations: cp.stats.iterations,
      messages: cp.stats.totalMessages,
    }));
  }

  /**
   * Save session to disk
   */
  async save() {
    await fs.ensureDir(this.saveDir);
    
    const sessionData = {
      sessionId: this.sessionId,
      metadata: this.metadata,
      agent: this.agent.export(),
      checkpoints: this.checkpoints,
      workingDir: this.workingDir,
    };
    
    const filePath = path.join(this.saveDir, `${this.sessionId}.json`);
    await fs.writeJson(filePath, sessionData, { spaces: 2 });
    
    return { success: true, path: filePath };
  }

  /**
   * Load session from disk
   */
  static async load(sessionId, saveDir) {
    const dir = saveDir || path.join(process.cwd(), '.sessions');
    const filePath = path.join(dir, `${sessionId}.json`);
    
    if (!await fs.pathExists(filePath)) {
      return null;
    }
    
    const data = await fs.readJson(filePath);
    
    const session = new AgentSession({
      sessionId: data.sessionId,
      workingDir: data.workingDir,
      saveDir: dir,
    });
    
    session.agent.import(data.agent);
    session.checkpoints = data.checkpoints || [];
    session.metadata = data.metadata;
    
    return session;
  }

  /**
   * List saved sessions
   */
  static async listSessions(saveDir) {
    const dir = saveDir || path.join(process.cwd(), '.sessions');
    
    if (!await fs.pathExists(dir)) {
      return [];
    }
    
    const files = await fs.readdir(dir);
    const sessions = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const data = await fs.readJson(path.join(dir, file));
          sessions.push({
            sessionId: data.sessionId,
            created: data.metadata?.created,
            updated: data.metadata?.updated,
            lastTask: data.metadata?.lastTask,
            iterations: data.agent?.stats?.iterations || 0,
          });
        } catch {}
      }
    }
    
    return sessions.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  }

  /**
   * Get session info
   */
  getInfo() {
    return {
      sessionId: this.sessionId,
      workingDir: this.workingDir,
      model: this.agent.model,
      stats: this.agent.getStats(),
      checkpoints: this.checkpoints.length,
      metadata: this.metadata,
      tools: this.toolRegistry.list().map(t => t.name),
      subagentStats: this.subagentManager.getStats(),
    };
  }
}

export default AgentSession;
