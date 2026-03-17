/**
 * 📋 Agent Session Manager
 * Manages sessions, checkpoints, and context
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
    
    // Register subagent tools
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
   * Build system prompt with working directory context
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
- **Subagent Delegation**: delegate_task, delegate_parallel, delegate_with_synthesis, subagent_status

## Subagent Delegation
You can delegate tasks to specialized subagents:
- **delegate_task**: Send a single task to a specialized subagent (coder, researcher, file_manager, tester, reviewer, general)
- **delegate_parallel**: Run multiple independent tasks simultaneously
- **delegate_with_synthesis**: Run parallel tasks and automatically combine results
- Use subagents to parallelize work and handle specialized tasks efficiently

## CRITICAL: When Using Subagents
- When you use delegate_with_synthesis or delegate_parallel, the subagents DO THE WORK for you
- DO NOT repeat the same tool calls that your subagents already made
- After delegation, you should ONLY synthesize or present their results
- If subagents already gathered system info, DO NOT call system_info again
- If subagents already checked git status, DO NOT call git_status again
- Trust the subagent results and present them to the user

## Working Style
1. **Understand** what the user wants before acting
2. **Explore** the codebase/context when needed
3. **Plan** complex tasks into steps
4. **Execute** using the most appropriate tools
5. **Verify** your work succeeded
6. **Summarize** what you did when complete

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
- Examples: Get-Process, systeminfo, wmic, tasklist all work directly

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
