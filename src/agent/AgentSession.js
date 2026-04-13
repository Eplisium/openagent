/**
 * 📋 Agent Session Manager v3.2
 * Manages sessions, checkpoints, and context with enhanced subagent integration
 */


import fs from '../utils/fs-compat.js';
import path from 'path';
import { CONFIG } from '../config.js';
import { Agent } from './Agent.js';
import { SubagentManager } from './SubagentManager.js';
import { TaskManager } from './TaskManager.js';
import { WorkspaceManager } from './WorkspaceManager.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { createFileTools } from '../tools/fileTools.js';
import { createShellTools } from '../tools/shellTools.js';
import { webTools } from '../tools/webTools.js';
import { createGitTools } from '../tools/gitTools.js';
import { createSubagentTools } from '../tools/subagentTools.js';
import { createTaskTools } from '../tools/taskTools.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { SkillManager } from '../skills/SkillManager.js';
import { HookManager } from '../hooks/HookManager.js';
import { createMemoryTools } from '../tools/memoryTools.js';
import { createSkillTools } from '../tools/skillTools.js';
import { createMcpTools } from '../tools/mcpTools.js';
import { createA2ATools } from '../tools/a2aTools.js';
import { createAGUITools } from '../tools/aguiTools.js';
import { createGraphTools } from '../tools/graphTools.js';
import { AutoGenBridge } from '../autogen/AutoGenBridge.js';
import { WorkflowGraph } from '../graph/index.js';
import { FileCheckpointer as GraphFileCheckpointer } from '../graph/checkpointers/FileCheckpointer.js';
import { OutcomeTracker } from './OutcomeTracker.js';
import { PromptEvolutionEngine } from './PromptEvolutionEngine.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazy-load the agent system prompt template once at module level
let _agentSystemPromptTemplate = null;
function getAgentSystemPromptTemplate() {
  if (!_agentSystemPromptTemplate) {
    // Try bundled location first (dist/../prompts/), then source location (src/prompts/)
    const candidates = [
      path.join(__dirname, '..', 'prompts', 'agent-system.md'),
      path.join(__dirname, '..', '..', 'src', 'prompts', 'agent-system.md'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        _agentSystemPromptTemplate = fs.readFileSync(p, 'utf-8');
        break;
      }
    }
    if (!_agentSystemPromptTemplate) {
      throw new Error(`agent-system.md not found. Tried: ${candidates.join(', ')}`);
    }
  }
  return _agentSystemPromptTemplate;
}

function createSessionId() {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `session_${timestamp}_${randomSuffix}`;
}

export class AgentSession {
  constructor(options = {}) {
    this.sessionId = options.sessionId || createSessionId();
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.permissions = {
      allowFileDelete: true,
      ...options.permissions,
    };
    this.allowFullAccess = options.allowFullAccess === true || this.permissions.allowFullAccess === true;
    this.workspaceManager = options.workspaceManager || new WorkspaceManager({
      workingDir: this.workingDir,
      openAgentDir: options.openAgentDir || CONFIG.OPENAGENT_HOME,
      saveDir: options.saveDir,
      taskDir: options.taskDir,
      verbose: options.verbose !== false,
    });
    this.saveDir = options.saveDir || this.workspaceManager.sessionsDir;
    this.model = options.model;
    this.activeWorkspace = options.activeWorkspace || null;
    this.checkpoints = [];
    this.metadata = {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      workingDir: this.workingDir,
      activeWorkspaceDir: this.activeWorkspace?.workspaceDir || null,
    };
    this.channelContext = options.channelContext || { type: 'cli', id: 'local' };
    this._activeSkill = options.activeSkill || 'none';
    this._activeSpecialization = options.activeSpecialization || 'general';

    const toolPathOptions = {
      getBaseDir: () => this.workingDir,
      getWorkspaceDir: () => this.activeWorkspace?.workspaceDir || null,
      getOpenAgentDir: () => this.workspaceManager.openAgentDir,
      permissions: this.permissions,
      allowFullAccess: this.allowFullAccess,
    };
    
    // Create tool registry with all tools
    this.toolRegistry = new ToolRegistry({ permissions: this.permissions });
    this.toolRegistry.registerAll([
      ...createFileTools(toolPathOptions),
      ...createShellTools(toolPathOptions),
      ...webTools,
      ...createGitTools(toolPathOptions),
    ]);
    
    // Initialize task manager for long-running tasks
    this.taskManager = new TaskManager({
      workingDir: this.workingDir,
      taskDir: options.taskDir || this.workspaceManager.taskStateDir,
      workspaceDir: this.activeWorkspace?.workspaceDir || null,
      openAgentDir: this.workspaceManager.openAgentDir,
      verbose: options.verbose !== false,
    });
    
    // Register task management tools
    const taskTools = createTaskTools(this.taskManager);
    this.toolRegistry.registerAll(taskTools);
    
    // Initialize subagent manager
    this.subagentManager = new SubagentManager({
      workingDir: this.workingDir,
      workspaceDir: this.activeWorkspace?.workspaceDir || null,
      getWorkspaceDir: () => this.activeWorkspace?.workspaceDir || null,
      openAgentDir: this.workspaceManager.openAgentDir,
      permissions: this.permissions,
      allowFullAccess: this.allowFullAccess,
      verbose: options.verbose !== false,
      maxConcurrent: options.maxSubagents || 3,
      parentAgent: null, // Will be set after agent creation
    });
    
    // Register subagent tools (includes new pipeline tool)
    const subagentTools = createSubagentTools(this.subagentManager);
    this.toolRegistry.registerAll(subagentTools);

    // Register protocol tools (MCP, A2A, AG-UI)
    this.toolRegistry.registerAll(createMcpTools({ baseDir: this.workingDir }));
    this.toolRegistry.registerAll(createA2ATools());
    this.toolRegistry.registerAll(createAGUITools());

    // Initialize memory manager
    this.memoryManager = new MemoryManager({
      workingDir: this.workingDir,
      openAgentDir: this.workspaceManager.openAgentDir,
      verbose: options.verbose !== false,
    });

    // Register memory tools
    const memoryTools = createMemoryTools(this.memoryManager);
    this.toolRegistry.registerAll(memoryTools);

    // Initialize skill manager
    this.skillManager = new SkillManager({
      workingDir: this.workingDir,
      openAgentDir: this.workspaceManager.openAgentDir,
      verbose: options.verbose !== false,
    });

    // Register skill tools
    const skillTools = createSkillTools(this.skillManager);
    this.toolRegistry.registerAll(skillTools);

    // Initialize hook manager
    this.hookManager = new HookManager({
      workingDir: this.workingDir,
      openAgentDir: this.workspaceManager.openAgentDir,
      verbose: options.verbose !== false,
    });

    // Create agent (basic system prompt — memory/skills loaded on first run)
    this.agent = new Agent({
      ...options,
      tools: this.toolRegistry,
      model: this.model,
      verbose: options.verbose !== false,
      streaming: options.streaming !== false,
      systemPrompt: options.systemPrompt || this.buildSystemPrompt(),
      workspaceDir: this.activeWorkspace?.workspaceDir || this.workingDir,
    });
    
    // Set parent agent reference for subagents to inherit model
    this.subagentManager.parentAgent = this.agent;

    // ─── Graph Workflow Engine ─────────────────────────────────────
    // Registry of named workflow graphs that can be invoked by the agent
    /** @type {Map<string, {graph: WorkflowGraph, compiled: CompiledGraph, stateSchema: object}>} */
    this.workflowRegistry = new Map();
    // Track active running graph executions by threadId
    /** @type {Map<string, CompiledGraph>} */
    this.activeGraphs = new Map();
    // Graph checkpointer for persistence across sessions
    this.graphCheckpointer = new GraphFileCheckpointer({
      dir: path.join(this.workspaceManager.openAgentDir, 'graph-checkpoints'),
    });

    // Register graph management tools so the agent can run workflows
    const graphTools = createGraphTools(this);
    this.toolRegistry.registerAll(graphTools);

    // ─── AutoGen Integration Layer ───────────────────────────────
    this.autoGenBridge = new AutoGenBridge(this);
    this.autoGenBridge.registerTools(this.toolRegistry);

    // ─── Self-Improvement Layer (Outcome Tracking + Prompt Evolution) ──
    this.outcomeTracker = new OutcomeTracker({
      outcomesDir: this.workspaceManager.openAgentDir,
    });
    this.promptEvolution = new PromptEvolutionEngine(this.outcomeTracker, {
      evolutionsDir: path.join(this.workspaceManager.openAgentDir, 'evolutions'),
    });
    // Load persisted data (async — don't block constructor)
    this._initPromise = Promise.all([
      this.outcomeTracker.load(),
      this.promptEvolution.load(),
    ]).catch(err => console.warn('[AgentSession] Self-improvement init warning:', err.message));
  }

  /**
   * Full cleanup for memory leak prevention.
   * Tears down subagent manager, aborts all active requests, and clears timers.
   */
  cleanup() {
    // Clean up subagent manager (aborts subagents, clears timers, stops cleanup interval)
    try {
      this.subagentManager?.cleanup();
    } catch { /* best-effort */ }

    // Stop OpenRouter client cache cleanup and abort in-flight requests
    try {
      this.agent?.client?.stopCacheCleanup?.();
    } catch { /* best-effort */ }
    try {
      this.agent?.client?.abortAll?.();
    } catch { /* best-effort */ }

    // Clear active graph executions
    this.activeGraphs.clear();
  }

  // ─── Graph Workflow Methods ──────────────────────────────────────

  /**
   * Register a workflow graph by name so the agent can invoke it.
   * @param {string} name - Unique workflow name (e.g., 'code-review', 'research')
   * @param {WorkflowGraph} graph - The workflow graph builder instance
   * @param {object} [options] - Compilation options
   * @returns {{ graph, compiled, stateSchema }} The compiled graph ready for use
   */
  registerWorkflow(name, graph, options = {}) {
    if (!(graph instanceof WorkflowGraph)) {
      throw new TypeError('registerWorkflow requires a WorkflowGraph instance');
    }
    const compiled = graph.compile({
      checkpointer: this.graphCheckpointer,
      maxCycles: options.maxCycles || 50,
      verbose: options.verbose !== false,
    });

    const entry = {
      graph,
      compiled,
      stateSchema: graph.stateSchema,
      registered: new Date().toISOString(),
    };

    this.workflowRegistry.set(name, entry);

    // Listen for HITL pauses on this workflow
    compiled.interruptManager.on('paused', ({ threadId, _nodeName, _state }) => {
      // Track active graph so tools can find it
      this.activeGraphs.set(threadId, compiled);
    });

    // Clean up active graphs when they complete
    compiled.interruptManager.on('resumed', ({ _threadId }) => {
      // Still active after resume
    });

    return entry;
  }

  /**
   * Get a registered workflow by name.
   * @param {string} name
   * @returns {{ graph, compiled, stateSchema } | null}
   */
  getWorkflow(name) {
    return this.workflowRegistry.get(name) || null;
  }

  /**
   * List all registered workflows.
   * @returns {Array<{name: string, registered: string, nodeCount: number}>}
   */
  listWorkflows() {
    const results = [];
    for (const [name, entry] of this.workflowRegistry) {
      results.push({
        name,
        registered: entry.registered,
        nodeCount: entry.graph._nodes.size,
      });
    }
    return results;
  }

  /**
   * Run a registered workflow directly.
   * @param {string} name - Workflow name
   * @param {object} input - Initial state input
   * @param {object} [options] - Runtime options (threadId, etc.)
   * @returns {Promise<object>} Final graph state
   */
  async runWorkflow(name, input, options = {}) {
    const entry = this.workflowRegistry.get(name);
    if (!entry) {
      throw new Error(`Workflow "${name}" not found. Available: ${[...this.workflowRegistry.keys()].join(', ')}`);
    }

    const threadId = options.threadId || `${name}_${Date.now()}`;
    const config = {
      threadId,
      model: this.model,
      workingDir: this.workingDir,
      toolRegistry: this.toolRegistry,
      parentAgent: this.agent,
      abortController: options.abortController || new AbortController(),
      agents: options.agents || {},
    };

    this.activeGraphs.set(threadId, entry.compiled);

    try {
      const result = await entry.compiled.invoke(input, config);
      return result;
    } finally {
      this.activeGraphs.delete(threadId);
    }
  }

  /**
   * Resume a paused graph workflow.
   * @param {string} threadId - The thread to resume
   * @param {object|null} humanInput - Optional state update from human
   * @returns {Promise<object>} Final graph state
   */
  async resumeWorkflow(threadId, humanInput = null) {
    // Find the compiled graph for this thread
    for (const [_name, entry] of this.workflowRegistry) {
      const state = await entry.compiled.getState(threadId);
      if (state) {
        this.activeGraphs.set(threadId, entry.compiled);
        return entry.compiled.resume(threadId, humanInput);
      }
    }
    throw new Error(`No active or paused workflow found for thread "${threadId}"`);
  }

  /**
   * Get the active graph engine (for createGraphTools).
   * Returns `this` since this AgentSession holds the registry and active graphs.
   */
  getGraphEngine() {
    return this;
  }

  /**
   * Build system prompt synchronously (for constructor)
   */
  buildSystemPrompt(memoryContext, skillContext) {
    memoryContext = memoryContext || '';
    skillContext = skillContext || '';
    const workspaceDir = this.activeWorkspace?.workspaceDir || path.join(this.workspaceManager.workspacesDir, '<created-on-run>');
    const projectMemoryPath = this.memoryManager?.paths?.projectMemory || path.join(this.workspaceManager.openAgentDir, 'memory', 'MEMORY.md');
    const platformName = process.platform;
    const pathStyle = platformName === 'win32' ? 'Windows-style' : 'POSIX-style';
    const projectTree = this._buildProjectTree();
    const template = getAgentSystemPromptTemplate();
    return template
      .replace(/\{\{WORKING_DIR\}\}/g, this.workingDir)
      .replace(/\{\{WORKSPACE_DIR\}\}/g, workspaceDir)
      .replace(/\{\{OPENAGENT_DIR\}\}/g, this.workspaceManager.openAgentDir)
      .replace(/\{\{PROJECT_MEMORY_PATH\}\}/g, projectMemoryPath)
      .replace(/\{\{PLATFORM_NAME\}\}/g, platformName)
      .replace(/\{\{PATH_STYLE\}\}/g, pathStyle)
      .replace(/\{\{MEMORY_CONTEXT\}\}/g, memoryContext)
      .replace(/\{\{SKILL_CONTEXT\}\}/g, skillContext)
      .replace(/\{\{PROJECT_TREE\}\}/g, projectTree);
  }

  /**
   * Build a synchronous file tree of the working directory.
   * This is injected into the system prompt so the agent never needs to explore.
   * @returns {string} Formatted file tree
   */
  _buildProjectTree() {
    try {
      const SKIP = new Set(['node_modules', '.git', '.openagent', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '.windop-backups']);
      const MAX_DEPTH = 3;
      const MAX_ENTRIES = 200;
      let count = 0;

      const build = (dir, depth) => {
        if (depth > MAX_DEPTH || count >= MAX_ENTRIES) return '';
        let entries;
        try { entries = fs.readdirSync(dir); } catch { return ''; }
        const filtered = entries.filter(e => !e.startsWith('.') && !SKIP.has(e)).sort();
        let result = '';
        for (const name of filtered) {
          if (count >= MAX_ENTRIES) { result += '  ... (truncated)\n'; break; }
          const fullPath = path.join(dir, name);
          try {
            const stat = fs.lstatSync(fullPath);
            if (stat.isDirectory()) {
              result += `${'  '.repeat(depth)}${name}/\n`;
              count++;
              result += build(fullPath, depth + 1);
            } else {
              const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(0)}KB`;
              result += `${'  '.repeat(depth)}${name} (${size})\n`;
              count++;
            }
          } catch { /* skip broken symlinks */ }
        }
        return result;
      };

      const basename = path.basename(this.workingDir);
      const tree = build(this.workingDir, 1);
      return `\`\`\`\n${basename}/\n${tree}\`\`\``;
    } catch {
      return '(file tree unavailable)';
    }
  }

  /**
   * Build system prompt with async memory/skill loading
   */
  async buildSystemPromptAsync() {
    let memoryContext = '';
    try { 
      memoryContext = await this.memoryManager.getContext(); 
    } catch (err) {
      // Log memory context loading errors but don't fail the whole prompt
      console.warn('[AgentSession] Failed to load memory context:', err.message);
    }
    let skillContext = '';
    try {
      const skillDesc = await this.skillManager.buildToolDescription();
      if (skillDesc) {
        skillContext = "\n## 🎯 Available Skills\n\n" + skillDesc + "\n\nUse the `use_skill` tool to activate a skill when relevant to the task.";
      }
    } catch (err) {
      // Log skill context loading errors but don't fail the whole prompt
      console.warn('[AgentSession] Failed to load skill context:', err.message);
    }
    return this.buildSystemPrompt(memoryContext, skillContext);
  }

  async refreshSystemPrompt() {
    const systemPrompt = await this.buildSystemPromptAsync();
    this.agent.setSystemPrompt(systemPrompt);
  }

  async prepareTaskWorkspace(task) {
    const progress = await this.taskManager.loadProgress();
    const shouldReuseWorkspace = progress.status !== 'not_initialized' &&
      progress.status !== 'complete' &&
      progress.workspaceDir;
    const currentWorkspaceDir = this.activeWorkspace?.workspaceDir || null;

    const workspace = await this.workspaceManager.prepareTaskWorkspace(task, {
      workspaceDir: currentWorkspaceDir || (shouldReuseWorkspace ? progress.workspaceDir : undefined),
      task,
      sessionId: this.sessionId,
      source: 'agent-session',
    });

    this.activeWorkspace = workspace;
    this.metadata.activeWorkspaceDir = workspace.workspaceDir;
    this.taskManager.setWorkspaceDir(workspace.workspaceDir);
    this.subagentManager.setWorkspaceDir(workspace.workspaceDir);
    await this.refreshSystemPrompt();

    return workspace;
  }

  /**
   * Run a task
   */
  async run(task) {
    // Ensure self-improvement data is loaded
    if (this._initPromise) await this._initPromise;

    await this.prepareTaskWorkspace(task);
    this.metadata.updated = new Date().toISOString();
    this.metadata.lastTask = task.substring(0, 100);
    
    // Load hooks
    await this.hookManager.load();
    
    // Inject evolved prompt guidance from past outcomes
    const evolutionGuidance = this.promptEvolution.analyze({
      skill: this._activeSkill || 'none',
      specialization: this._activeSpecialization || 'general',
      taskType: this._classifyTaskType(task),
    });
    if (evolutionGuidance) {
      await this.agent.injectSystemMessage(evolutionGuidance);
    }

    // Create checkpoint before running
    this.createCheckpoint('before_task');

    const startTime = Date.now();
    const taskType = this._classifyTaskType(task);
    
    try {
      const result = await this.agent.run(task);
      result.workspace = this.activeWorkspace;
      
      // Run stop hooks
      await this.hookManager.runStop({ reason: 'task_complete', task });
      
      // Create checkpoint after successful run
      this.createCheckpoint('after_task');

      // Record successful outcome
      await this.outcomeTracker.record({
        skill: this._activeSkill || 'none',
        specialization: this._activeSpecialization || 'general',
        taskType,
        success: true,
        durationMs: Date.now() - startTime,
        taskSummary: task.substring(0, 200),
      });
      await this.outcomeTracker.flush();
      
      return result;
    } catch (error) {
      // Run stop hooks on error
      await this.hookManager.runStop({ reason: 'error', error: error.message });

      // Record failed outcome
      await this.outcomeTracker.record({
        skill: this._activeSkill || 'none',
        specialization: this._activeSpecialization || 'general',
        taskType,
        success: false,
        durationMs: Date.now() - startTime,
        errorCategory: this._classifyError(error),
        errorMessage: error.message,
        taskSummary: task.substring(0, 200),
      });
      await this.outcomeTracker.flush();

      // Learn from the failure
      await this.promptEvolution.learn({
        skill: this._activeSkill,
        specialization: this._activeSpecialization,
        taskType,
        success: false,
        failureReason: error.message,
      });

      throw error;
    }
  }

  /**
   * Run with streaming
   */
  async *runStream(task) {
    await this.prepareTaskWorkspace(task);
    this.metadata.updated = new Date().toISOString();
    
    for await (const chunk of this.agent.runStream(task)) {
      yield chunk;
    }
  }

  /**
   * Compress a message for checkpoint storage by keeping only essential fields
   * and truncating large content.
   * @param {object} msg - Raw message object
   * @returns {object} Compressed message
   */
  _compressMessage(msg) {
    const compressed = {
      role: msg.role,
    };

    // Compress content - truncate if over 1000 chars
    if (typeof msg.content === 'string') {
      compressed.content = msg.content.length > 1000
        ? msg.content.substring(0, 1000) + `\n... [truncated, ${msg.content.length - 1000} chars omitted]`
        : msg.content;
    } else if (msg.content !== undefined) {
      compressed.content = msg.content;
    }

    // Preserve tool_calls metadata (without full result payloads)
    if (msg.tool_calls) {
      compressed.tool_calls = msg.tool_calls.map(tc => ({
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function?.name,
          arguments: tc.function?.arguments?.length > 500
            ? tc.function.arguments.substring(0, 500) + '...'
            : tc.function?.arguments,
        },
      }));
    }

    // Preserve tool_call_id for tool response messages
    if (msg.tool_call_id) {
      compressed.tool_call_id = msg.tool_call_id;
    }

    // Compress tool result content
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 1000) {
      compressed.content = msg.content.substring(0, 1000) + `\n... [truncated, ${msg.content.length - 1000} chars omitted]`;
    }

    return compressed;
  }

  /**
   * Compute a shallow diff between two arrays of messages.
   * Returns only the delta (new messages added since the base).
   * @param {Array} base - Previous messages array
   * @param {Array} current - Current messages array
   * @returns {Array} New messages not in base
   */
  _computeMessageDiff(base, current) {
    if (!base || base.length === 0) {
      return current.map(m => this._compressMessage(m));
    }
    // Messages are append-only; diff = messages after the base length
    if (current.length <= base.length) {
      return [];
    }
    return current.slice(base.length).map(m => this._compressMessage(m));
  }

  /**
   * Create a checkpoint using diff-based storage.
   * Only stores the delta from the previous checkpoint to reduce memory usage.
   * @param {string} label - Checkpoint label
   * @returns {string} Checkpoint ID
   */
  createCheckpoint(label = 'checkpoint') {
    const prevCheckpoint = this.checkpoints.length > 0
      ? this.checkpoints[this.checkpoints.length - 1]
      : null;

    const currentMessages = this.agent.messages;
    const currentHistory = this.agent.history;

    let messagesDelta;
    let historyDelta;
    const isFirstCheckpoint = !prevCheckpoint;

    if (isFirstCheckpoint) {
      // First checkpoint: store compressed full snapshot
      messagesDelta = currentMessages.map(m => this._compressMessage(m));
      historyDelta = currentHistory.map(h => this._compressMessage(h));
    } else {
      // Diff-based: only store new messages since last checkpoint
      const prevFullMessages = this._reconstructMessages(prevCheckpoint);
      const prevFullHistory = this._reconstructHistory(prevCheckpoint);
      messagesDelta = this._computeMessageDiff(prevFullMessages, currentMessages);
      historyDelta = this._computeMessageDiff(prevFullHistory, currentHistory);
    }

    const checkpoint = {
      id: `cp_${Date.now()}`,
      label,
      timestamp: new Date().toISOString(),
      messages: messagesDelta,
      history: historyDelta,
      stats: this.agent.getStats(),
      isDiff: !isFirstCheckpoint,
      baseCheckpointId: prevCheckpoint?.id || null,
      totalMessages: currentMessages.length,
      totalHistory: currentHistory.length,
      costSnapshot: (() => {
        const cs = this.agent?.client?.getStats?.() || {};
        return {
          totalCost: cs.totalCost || 0,
          budgetUsed: cs.budgetUsed || 0,
          requestCount: cs.requestCount || 0,
        };
      })(),
    };

    this.checkpoints.push(checkpoint);

    // Keep only last 20 checkpoints
    if (this.checkpoints.length > 20) {
      this.checkpoints = this.checkpoints.slice(-20);
    }

    return checkpoint.id;
  }

  /**
   * Reconstruct the full messages array from a checkpoint by walking back
   * through the diff chain to the nearest full snapshot.
   * @param {object} checkpoint - The checkpoint to reconstruct from
   * @returns {Array} Full reconstructed messages array
   */
  _reconstructMessages(checkpoint) {
    if (!checkpoint) return [];
    if (!checkpoint.isDiff) {
      return checkpoint.messages || [];
    }
    // Walk back to find the base checkpoint
    const base = this.checkpoints.find(cp => cp.id === checkpoint.baseCheckpointId);
    const baseMessages = this._reconstructMessages(base);
    // Append the diff
    return [...baseMessages, ...(checkpoint.messages || [])];
  }

  /**
   * Reconstruct the full history array from a checkpoint.
   * @param {object} checkpoint - The checkpoint to reconstruct from
   * @returns {Array} Full reconstructed history array
   */
  _reconstructHistory(checkpoint) {
    if (!checkpoint) return [];
    if (!checkpoint.isDiff) {
      return checkpoint.history || [];
    }
    const base = this.checkpoints.find(cp => cp.id === checkpoint.baseCheckpointId);
    const baseHistory = this._reconstructHistory(base);
    return [...baseHistory, ...(checkpoint.history || [])];
  }

  /**
   * Reconstruct a full checkpoint state from the diff chain.
   * @param {string} checkpointId - The checkpoint ID to reconstruct
   * @returns {{success: boolean, label?: string, timestamp?: string, messageCount?: number, error?: string}}
   */
  reconstructCheckpoint(checkpointId) {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
      return { success: false, error: `Checkpoint ${checkpointId} not found` };
    }

    const fullMessages = this._reconstructMessages(checkpoint);
    const fullHistory = this._reconstructHistory(checkpoint);

    // Apply reconstructed state
    this.agent.setMessages(fullMessages);
    this.agent.history = fullHistory;

    return {
      success: true,
      label: checkpoint.label,
      timestamp: checkpoint.timestamp,
      messageCount: fullMessages.length,
      historyCount: fullHistory.length,
    };
  }

  /**
   * Restore to a checkpoint (handles both full snapshots and diff-based checkpoints)
   */
  restoreCheckpoint(checkpointId) {
    return this.reconstructCheckpoint(checkpointId);
  }

  /**
   * List checkpoints with storage info
   */
  listCheckpoints() {
    return this.checkpoints.map(cp => ({
      id: cp.id,
      label: cp.label,
      timestamp: cp.timestamp,
      iterations: cp.stats.iterations,
      messages: cp.totalMessages || cp.stats.totalMessages,
      isDiff: cp.isDiff || false,
      deltaMessages: cp.messages?.length || 0,
      baseCheckpointId: cp.baseCheckpointId || null,
    }));
  }

  /**
   * Save session to disk
   */
  async save() {
    await this.workspaceManager.ensureBaseDirs();
    
    const subagentStats = this.subagentManager?.getStats?.() || {};
    const autoGenStats = this.autoGenBridge?.getStats?.() || {};

    const sessionData = {
      sessionId: this.sessionId,
      metadata: this.metadata,
      agent: this.agent.export(),
      checkpoints: this.checkpoints,
      workingDir: this.workingDir,
      activeWorkspace: this.activeWorkspace,
      workspaceManager: this.workspaceManager.getInfo(),
      cost: {
        subagent: {
          totalCost: subagentStats.totalCost || 0,
          totalInputTokens: subagentStats.totalInputTokens || 0,
          totalOutputTokens: subagentStats.totalOutputTokens || 0,
          totalTasks: subagentStats.totalTasks || 0,
          completedTasks: subagentStats.completedTasks || 0,
          failedTasks: subagentStats.failedTasks || 0,
        },
        autoGen: {
          totalTeamCost: autoGenStats.totalTeamCost || 0,
          teamCount: autoGenStats.teamCount || 0,
          groupChatCount: autoGenStats.groupChatCount || 0,
        },
      },
      // CLI-level session tracking (bridged via setCLISessionMeta)
      cliSession: this._cliSessionMeta || null,
      // Aggregated cost snapshot for easy querying
      sessionCost: this._buildSessionCostSnapshot(subagentStats, autoGenStats),
    };
    
    const filePath = path.join(this.saveDir, `${this.sessionId}.json`);
    await fs.writeJson(filePath, sessionData, { spaces: 2 });

    // Write lightweight meta file for fast startup recovery checks
    const metaPath = path.join(this.saveDir, '_meta.json');
    const meta = {
      lastSave: new Date().toISOString(),
      sessionId: this.sessionId,
      model: this.model,
      workingDir: this.workingDir,
    };
    await fs.writeJson(metaPath, meta, { spaces: 0 });

    return { success: true, path: filePath };
  }

  /**
   * Load session from disk
   */
  static async load(sessionId, saveDir, options = {}) {
    const dir = saveDir || new WorkspaceManager({
      workingDir: options.workingDir || process.cwd(),
      openAgentDir: options.openAgentDir || CONFIG.OPENAGENT_HOME,
    }).sessionsDir;
    const filePath = path.join(dir, `${sessionId}.json`);
    
    if (!await fs.pathExists(filePath)) {
      return null;
    }
    
    const data = await fs.readJson(filePath);
    
    const session = new AgentSession({
      sessionId: data.sessionId,
      workingDir: data.workingDir,
      saveDir: dir,
      model: data.agent?.model,
      openAgentDir: options.openAgentDir || data.workspaceManager?.openAgentDir || CONFIG.OPENAGENT_HOME,
      permissions: options.permissions,
      allowFullAccess: options.allowFullAccess,
      activeWorkspace: data.activeWorkspace || null,
    });
    
    session.agent.import(data.agent);
    session.checkpoints = data.checkpoints || [];
    session.metadata = data.metadata || session.metadata;
    session.activeWorkspace = data.activeWorkspace || null;
    session.taskManager.setWorkspaceDir(session.activeWorkspace?.workspaceDir || null);
    session.subagentManager.setWorkspaceDir(session.activeWorkspace?.workspaceDir || null);

    // Restore cost data from saved session
    if (data.cost?.subagent && session.subagentManager?.stats) {
      session.subagentManager.stats.totalCost = data.cost.subagent.totalCost || 0;
      session.subagentManager.stats.totalInputTokens = data.cost.subagent.totalInputTokens || 0;
      session.subagentManager.stats.totalOutputTokens = data.cost.subagent.totalOutputTokens || 0;
      session.subagentManager.stats.totalTasks = data.cost.subagent.totalTasks || 0;
      session.subagentManager.stats.completedTasks = data.cost.subagent.completedTasks || 0;
      session.subagentManager.stats.failedTasks = data.cost.subagent.failedTasks || 0;
    }
    if (data.cost?.autoGen && session.autoGenBridge) {
      session.autoGenBridge.totalTeamCost = data.cost.autoGen.totalTeamCost || 0;
    }

    // Restore CLI-level session metadata
    if (data.cliSession) {
      session._cliSessionMeta = data.cliSession;
    }

    await session.refreshSystemPrompt();

    return session;
  }

  /**
   * Read the lightweight _meta.json file for fast startup recovery checks.
   * Returns null if no meta file exists or it cannot be parsed.
   */
  static async getLastSessionMeta(workingDir, options = {}) {
    const dir = options.saveDir || new WorkspaceManager({
      workingDir: workingDir || process.cwd(),
      openAgentDir: options.openAgentDir || CONFIG.OPENAGENT_HOME,
    }).sessionsDir;

    const metaPath = path.join(dir, '_meta.json');
    if (!await fs.pathExists(metaPath)) {
      return null;
    }

    try {
      const meta = await fs.readJson(metaPath);
      return meta;
    } catch {
      return null;
    }
  }

  /**
   * Recover the most recently updated session.
   * Returns the loaded AgentSession, or null if no sessions exist.
   */
  static async recoverLastSession(workingDir, options = {}) {
    const sessions = await AgentSession.listSessions(options.saveDir, {
      workingDir,
      openAgentDir: options.openAgentDir,
    });

    if (!sessions.length) {
      return null;
    }

    // sessions are already sorted by updated descending
    const mostRecent = sessions[0];
    const dir = options.saveDir || new WorkspaceManager({
      workingDir: workingDir || process.cwd(),
      openAgentDir: options.openAgentDir || CONFIG.OPENAGENT_HOME,
    }).sessionsDir;

    const session = await AgentSession.load(mostRecent.sessionId, dir, {
      workingDir,
      openAgentDir: options.openAgentDir,
      permissions: options.permissions,
      allowFullAccess: options.allowFullAccess,
    });

    return session;
  }

  /**
   * List saved sessions
   */
  static async listSessions(saveDir, options = {}) {
    const dir = saveDir || new WorkspaceManager({
      workingDir: options.workingDir || process.cwd(),
      openAgentDir: options.openAgentDir || CONFIG.OPENAGENT_HOME,
    }).sessionsDir;
    
    if (!await fs.pathExists(dir)) {
      return [];
    }
    
    const files = await fs.readdir(dir);
    const sessions = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('_')) {
        try {
          const data = await fs.readJson(path.join(dir, file));
          sessions.push({
            sessionId: data.sessionId,
            created: data.metadata?.created,
            updated: data.metadata?.updated,
            lastTask: data.metadata?.lastTask,
            model: data.agent?.model || null,
            iterations: data.agent?.stats?.iterations || 0,
            activeWorkspaceDir: data.metadata?.activeWorkspaceDir || data.activeWorkspace?.workspaceDir || null,
          });
        } catch { /* session data may be corrupt — skip */ }
      }
    }
    
    return sessions.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  }

  /**
   * Search through saved sessions for messages matching a query string.
   * Scans message content in session files and returns matching sessions with context snippets.
   * @param {string} query - Search query (case-insensitive substring match)
   * @param {object} [options] - Search options
   * @param {string} [options.saveDir] - Directory to search in
   * @param {string} [options.workingDir] - Working directory for workspace resolution
   * @param {number} [options.maxResults=20] - Maximum number of sessions to return
   * @param {number} [options.snippetLength=120] - Characters of context around each match
   * @returns {Promise<Array<{sessionId: string, created: string, updated: string, lastTask: string, matches: Array<{role: string, snippet: string, messageIndex: number}>}>>}
   */
  static async searchSessions(query, options = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return [];
    }

    const dir = options.saveDir || new WorkspaceManager({
      workingDir: options.workingDir || process.cwd(),
      openAgentDir: options.openAgentDir || CONFIG.OPENAGENT_HOME,
    }).sessionsDir;

    if (!await fs.pathExists(dir)) {
      return [];
    }

    const files = await fs.readdir(dir);
    const results = [];
    const maxResults = options.maxResults || 20;
    const snippetLength = options.snippetLength || 120;
    const queryLower = query.toLowerCase();

    for (const file of files) {
      if (results.length >= maxResults) break;
      if (!file.endsWith('.json') || file.startsWith('_')) continue;

      try {
        const data = await fs.readJson(path.join(dir, file));
        const messages = data.agent?.messages || [];
        const matches = [];

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');

          if (content.toLowerCase().includes(queryLower)) {
            // Extract a snippet around the match
            const lowerContent = content.toLowerCase();
            const matchIndex = lowerContent.indexOf(queryLower);
            const start = Math.max(0, matchIndex - Math.floor(snippetLength / 2));
            const end = Math.min(content.length, matchIndex + query.length + Math.floor(snippetLength / 2));
            let snippet = content.substring(start, end).replace(/\n/g, ' ').trim();
            if (start > 0) snippet = '...' + snippet;
            if (end < content.length) snippet = snippet + '...';

            matches.push({
              role: msg.role || 'unknown',
              snippet,
              messageIndex: i,
            });
          }

          // Limit matches per session
          if (matches.length >= 5) break;
        }

        if (matches.length > 0) {
          results.push({
            sessionId: data.sessionId,
            created: data.metadata?.created,
            updated: data.metadata?.updated,
            lastTask: data.metadata?.lastTask,
            model: data.agent?.model || null,
            matchCount: matches.length,
            matches,
          });
        }
      } catch {
        // Skip unreadable session files
      }
    }

    // Sort by most recently updated
    return results.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  }

  /**
   * Set CLI-level session metadata for persistence.
   * Bridges the gap between CLI state and session storage.
   */
  setCLISessionMeta({ sessionStartTime, totalCost, totalTokens, taskCount }) {
    this._cliSessionMeta = {
      sessionStartTime: sessionStartTime || Date.now(),
      totalCost: totalCost || 0,
      totalTokens: totalTokens || 0,
      taskCount: taskCount || 0,
    };
  }

  /** @private */
  _buildSessionCostSnapshot(subagentStats, autoGenStats) {
    const clientStats = this.agent?.client?.getStats?.() || {};
    const mainCost = clientStats.totalCost || 0;
    const subCost = subagentStats.totalCost || 0;
    const teamCost = autoGenStats.totalTeamCost || 0;
    return {
      mainAgent: {
        totalCost: mainCost,
        budgetUsed: clientStats.budgetUsed || 0,
        budgetLimit: clientStats.budgetLimit || 0,
        budgetRemaining: (clientStats.budgetLimit || 0) - (clientStats.budgetUsed || 0),
        requestCount: clientStats.requestCount || 0,
        totalInputTokens: clientStats.totalInputTokens || 0,
        totalOutputTokens: clientStats.totalOutputTokens || 0,
      },
      subagent: {
        totalCost: subCost,
        totalInputTokens: subagentStats.totalInputTokens || 0,
        totalOutputTokens: subagentStats.totalOutputTokens || 0,
        totalTasks: subagentStats.totalTasks || 0,
        completedTasks: subagentStats.completedTasks || 0,
        failedTasks: subagentStats.failedTasks || 0,
      },
      autoGen: {
        totalTeamCost: teamCost,
        teamCount: autoGenStats.teamCount || 0,
        groupChatCount: autoGenStats.groupChatCount || 0,
      },
      totalCost: mainCost + subCost + teamCost,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Get session info
   */
  getInfo() {
    return {
      sessionId: this.sessionId,
      workingDir: this.workingDir,
      workspace: this.activeWorkspace,
      model: this.agent.model,
      stats: this.agent.getStats(),
      checkpoints: this.checkpoints.length,
      metadata: this.metadata,
      tools: this.toolRegistry.list().map(t => t.name),
      subagentStats: this.subagentManager.getStats(),
      paths: this.workspaceManager.getInfo(),
      graphWorkflows: this.listWorkflows(),
      activeGraphThreads: [...this.activeGraphs.keys()],
      autoGen: {
        groupChats: this.autoGenBridge?.groupChats?.size || 0,
        teams: this.autoGenBridge?.teams?.size || 0,
      },
    };
  }

  // ─── Self-Improvement Helpers ──────────────────────────────────

  /**
   * Classify a task into a type category for outcome tracking
   * @private
   */
  _classifyTaskType(task) {
    const lower = task.toLowerCase();
    if (/git\s+(commit|push|pull|branch|merge|rebase)/.test(lower)) return 'git-operation';
    if (/write|create|implement|build|add/.test(lower) && /file|function|class|module|component/.test(lower)) return 'code-write';
    if (/edit|fix|update|modify|refactor|change/.test(lower)) return 'code-edit';
    if (/test|spec|jest|vitest|mocha/.test(lower)) return 'testing';
    if (/review|audit|check|analyze/.test(lower)) return 'code-review';
    if (/search|find|grep|look/.test(lower)) return 'search';
    if (/install|npm|yarn|pnpm|pip|cargo/.test(lower)) return 'dependency';
    if (/deploy|build|compile|bundle/.test(lower)) return 'build-deploy';
    if (/read|show|list|explain|describe|what is/.test(lower)) return 'exploration';
    if (/debug|error|fix|bug|issue|problem/.test(lower)) return 'debugging';
    return 'general';
  }

  /**
   * Classify an error into a category for outcome tracking
   * @private
   */
  _classifyError(error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
    if (msg.includes('permission') || msg.includes('eacces') || msg.includes('forbidden')) return 'PERMISSION';
    if (msg.includes('enoent') || msg.includes('not found') || msg.includes('no such file')) return 'NOT_FOUND';
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed')) return 'NETWORK';
    if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMIT';
    if (msg.includes('parse') || msg.includes('json')) return 'PARSE_ERROR';
    if (msg.includes('edit mismatch') || msg.includes('text not found')) return 'EDIT_MISMATCH';
    if (msg.includes('budget') || msg.includes('cost')) return 'BUDGET_EXCEEDED';
    return 'UNKNOWN';
  }
}

export default AgentSession;
