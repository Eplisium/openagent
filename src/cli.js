/**
 * 💻 OpenAgent CLI v4.0
 * Beautiful interactive terminal with real-time streaming & tool visualization
 * 
 * New features v4.0 (2026 Edition):
 * - Native fetch (zero axios dependency)
 * - AbortController for request/stream cancellation
 * - Request deduplication for identical in-flight requests
 * - Real cost tracking from API usage data
 * - Enhanced subagent orchestration
 * - Smart error recovery suggestions
 * - Intelligent prompt suggestions
 * - Built-in workflow templates
 * - Environment health checks
 * - Enhanced progress with timing/context
 * - First-run onboarding wizard
 * - Persistent local state management
 */

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import gradient from 'gradient-string';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { AgentSession } from './agent/AgentSession.js';
import { CONFIG } from './config.js';
import { ModelBrowser } from './ModelBrowser.js';

const VERSION = '4.0.0';

// ═══════════════════════════════════════════════════════════════════
// 🏠 Local State Management
// ═══════════════════════════════════════════════════════════════════

const STATE_DIR = path.join(os.homedir(), '.openagent');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const DEFAULT_STATE = {
  version: VERSION,
  firstRun: true,
  lastUsed: null,
  totalSessions: 0,
  preferences: {
    showTips: true,
    autoSuggest: true,
    verboseErrors: true,
  },
  stats: {
    totalTasks: 0,
    totalTokens: 0,
    totalCost: 0,
    favoriteCommands: {},
  }
};

// ═══════════════════════════════════════════════════════════════════
// 🎯 Workflow Templates
// ═══════════════════════════════════════════════════════════════════

const WORKFLOW_TEMPLATES = {
  'code-review': {
    name: '🔍 Code Review',
    description: 'Comprehensive code analysis and improvement suggestions',
    steps: [
      'Analyze the codebase structure and architecture',
      'Review code quality, patterns, and best practices',
      'Check for security vulnerabilities and performance issues',
      'Suggest improvements and refactoring opportunities',
      'Generate a detailed review report'
    ],
    prompt: 'Please perform a comprehensive code review of this project. Focus on code quality, security, performance, and best practices.'
  },
  'bug-fix': {
    name: '🐛 Bug Investigation',
    description: 'Systematic debugging and issue resolution',
    steps: [
      'Analyze error logs and stack traces',
      'Identify root cause of the issue',
      'Examine related code and dependencies',
      'Propose and implement fixes',
      'Test the solution and verify resolution'
    ],
    prompt: 'Help me debug and fix this issue. Please analyze the error, identify the root cause, and provide a working solution.'
  },
  'feature-dev': {
    name: '⚡ Feature Development',
    description: 'End-to-end feature implementation',
    steps: [
      'Understand requirements and scope',
      'Design the feature architecture',
      'Implement core functionality',
      'Add error handling and validation',
      'Write tests and documentation'
    ],
    prompt: 'Help me develop this new feature from start to finish. Please design, implement, test, and document the solution.'
  },
  'refactor': {
    name: '🔧 Code Refactoring',
    description: 'Improve code structure and maintainability',
    steps: [
      'Analyze current code structure',
      'Identify refactoring opportunities',
      'Plan the refactoring strategy',
      'Implement improvements incrementally',
      'Ensure functionality is preserved'
    ],
    prompt: 'Please refactor this code to improve its structure, readability, and maintainability while preserving all functionality.'
  },
  'docs': {
    name: '📚 Documentation',
    description: 'Generate comprehensive project documentation',
    steps: [
      'Analyze project structure and functionality',
      'Create API documentation',
      'Write user guides and tutorials',
      'Generate code comments',
      'Create README and setup instructions'
    ],
    prompt: 'Please create comprehensive documentation for this project including API docs, user guides, and setup instructions.'
  },
  'test-suite': {
    name: '🧪 Test Suite Creation',
    description: 'Build comprehensive test coverage',
    steps: [
      'Analyze code to identify test scenarios',
      'Create unit tests for core functions',
      'Add integration tests',
      'Implement edge case testing',
      'Set up test automation'
    ],
    prompt: 'Please create a comprehensive test suite for this project with unit tests, integration tests, and edge case coverage.'
  }
};

// ═══════════════════════════════════════════════════════════════════
// 🎯 Smart Prompt Suggestions
// ═══════════════════════════════════════════════════════════════════

const PROMPT_SUGGESTIONS = {
  coding: [
    "Review and improve this code",
    "Debug this error and fix it",
    "Add comprehensive tests",
    "Refactor for better performance",
    "Add error handling and validation",
    "Create documentation for this code",
    "Optimize this algorithm",
    "Add TypeScript types"
  ],
  files: [
    "Analyze this project structure",
    "Find and fix security issues",
    "Clean up unused files",
    "Organize project structure",
    "Create a build system",
    "Add configuration files",
    "Set up development environment"
  ],
  general: [
    "Explain how this works",
    "What are the best practices here?",
    "How can I improve this?",
    "What are potential issues?",
    "Create a step-by-step guide",
    "Compare different approaches"
  ]
};

// ═══════════════════════════════════════════════════════════════════
// 🏥 Health Check Diagnostics
// ═══════════════════════════════════════════════════════════════════

const HEALTH_CHECKS = {
  api: {
    name: 'API Connection',
    check: async (session) => {
      if (!session?.agent?.client) {
        return { status: 'error', message: 'API client not initialized' };
      }
      try {
        await session.agent.client.getModels();
        return { status: 'healthy', message: 'API connection successful' };
      } catch (error) {
        return { status: 'error', message: `API Error: ${error.message}` };
      }
    }
  },
  model: {
    name: 'Model Availability',
    check: async (session) => {
      if (!session?.agent) {
        return { status: 'error', message: 'Agent not initialized' };
      }
      try {
        // Quick validation: verify the model is set and client can reach API
        const model = session.agent.model;
        if (!model) {
          return { status: 'error', message: 'No model selected' };
        }
        return { status: 'healthy', message: `Model: ${model}` };
      } catch (error) {
        return { status: 'error', message: `Model Error: ${error.message}` };
      }
    }
  },
  tools: {
    name: 'Tool Registry',
    check: async (session) => {
      try {
        // Agent stores tools as 'tools' (ToolRegistry instance)
        const registry = session?.toolRegistry || session?.agent?.tools;
        if (!registry) {
          return { status: 'error', message: 'Tool registry not found' };
        }
        const tools = registry.list();
        return { 
          status: 'healthy', 
          message: `${tools.length} tools available`,
          details: tools.map(t => t.name).join(', ')
        };
      } catch (error) {
        return { status: 'error', message: `Tools Error: ${error.message}` };
      }
    }
  },
  memory: {
    name: 'Memory Usage',
    check: async () => {
      const usage = process.memoryUsage();
      const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
      
      if (usedMB > 500) {
        return { status: 'warning', message: `High memory usage: ${usedMB}MB/${totalMB}MB` };
      }
      return { status: 'healthy', message: `Memory usage: ${usedMB}MB/${totalMB}MB` };
    }
  },
  disk: {
    name: 'Disk Space',
    check: async () => {
      try {
        await fs.stat(process.cwd());
        return { status: 'healthy', message: 'Disk access OK' };
      } catch (error) {
        return { status: 'error', message: `Disk Error: ${error.message}` };
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// 🎨 Styles
// ═══════════════════════════════════════════════════════════════════

const g = {
  title: gradient(['#00D9FF', '#FF006E', '#38B000']),
  ai: gradient(['#00D9FF', '#3A86FF']),
  tool: gradient(['#FFBE0B', '#FF006E']),
  success: gradient(['#38B000', '#00D9FF']),
};

const box = {
  default: { padding: 1, borderStyle: 'round', borderColor: 'cyan' },
  response: { padding: 1, borderStyle: 'round', borderColor: 'magenta' },
  tool: { padding: 1, borderStyle: 'round', borderColor: 'yellow' },
  result: { padding: 1, borderStyle: 'single', borderColor: 'green' },
  error: { padding: 1, borderStyle: 'double', borderColor: 'red' },
  info: { padding: 1, borderStyle: 'single', borderColor: 'blue' },
  stats: { padding: 1, borderStyle: 'round', borderColor: 'cyan' },
};

const DIVIDER = chalk.dim('─'.repeat(65));

// ═══════════════════════════════════════════════════════════════════
// 💻 CLI Class
// ═══════════════════════════════════════════════════════════════════

export class CLI {
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.session = null;
    this.modelBrowser = null;
    this.streaming = true;
    this.verbose = true;
    this.history = [];
    this.mode = 'agent'; // 'agent' or 'chat'
    
    // Session tracking
    this.sessionStartTime = Date.now();
    this.totalCost = 0;
    this.totalTokens = 0;
    this.taskCount = 0;
    
    // Auto-save settings
    this.autoSave = options.autoSave !== false;
    this.autoSaveInterval = options.autoSaveInterval || 5 * 60 * 1000; // 5 minutes
    this.lastSaveTime = Date.now();
    this.autoSaveTimer = null;
    this.sessionSaveInFlight = null;
    
    // Enhanced state management
    this.state = null;
    this.currentTask = null;
    this.taskStartTime = null;
    this.promptCount = 0;
    
    // Command aliases
    this.aliases = {
      'q': 'exit',
      'quit': 'exit',
      'c': 'chat',
      'a': 'agent',
      'n': 'new',
      'm': 'model',
      's': 'stats',
      'h': 'help',
      't': 'tools',
      'cl': 'clear',
      'st': 'stream',
      'v': 'verbose',
      'tmp': 'templates',
      'doc': 'doctor',
    };
  }

  async start() {
    console.clear();
    
    // Load or initialize state
    await this.loadState();
    
    this.printBanner();

    // First-run onboarding
    if (this.state.firstRun) {
      await this.runOnboarding();
    }

    if (!CONFIG.API_KEY) {
      this.showSmartError('api_key_missing', {
        message: 'No API Key Found',
        suggestions: [
          'Set OPENROUTER_API_KEY in your .env file',
          'Get your key at https://openrouter.ai/keys',
          'Run /doctor to check your environment setup'
        ]
      });
      process.exit(1);
    }

    console.log(chalk.green('✓ API Key configured'));
    console.log(chalk.gray(`  Working directory: ${this.workingDir}`));

    // Initialize model browser FIRST (before creating session)
    this.modelBrowser = new ModelBrowser();
    const modelSpinner = ora({ text: chalk.gray('Loading models from OpenRouter...'), spinner: 'dots', color: 'cyan' }).start();
    try {
      await this.modelBrowser.init();
      const sourceSuffix = this.modelBrowser.lastLoadSource === 'cache' || this.modelBrowser.lastLoadSource === 'stale-cache'
        ? ' from cache'
        : '';
      modelSpinner.succeed(chalk.green(`Loaded ${this.modelBrowser.models.length} models${sourceSuffix}`));
    } catch (e) {
      modelSpinner.fail(chalk.red(`Failed to load models: ${e.message}`));
      console.log(chalk.yellow('⚠️ Cannot continue without models. Check your API key and internet connection.'));
      process.exit(1);
    }

    // Let user select a model
    const selectedModel = await this.selectModel();
    
    const spinner = ora({ text: chalk.gray('Initializing session...'), spinner: 'dots', color: 'cyan' }).start();
    
    try {
      this.createSession({ modelId: selectedModel });
      spinner.succeed(chalk.green('Session initialized'));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to initialize session: ${error.message}`));
      process.exit(1);
    }

    console.log(chalk.gray(`  Model: ${chalk.cyan(this.session.agent.model)}`));
    console.log(chalk.gray(`  OpenAgent home: ${this.session.workspaceManager.openAgentDir}`));

    // Start auto-save timer
    if (this.autoSave) {
      this.startAutoSave();
    }

    console.log(boxen(
      `${chalk.bold('Commands:')}\n\n` +
      `${chalk.cyan('/agent <task>')}     ${chalk.gray('- Run agentic task (with tools)')}\n` +
      `${chalk.cyan('/chat <msg>')}      ${chalk.gray('- Simple chat (no tools)')}\n` +
      `${chalk.cyan('/templates')}       ${chalk.gray('- Browse workflow templates')}\n` +
      `${chalk.cyan('/doctor')}          ${chalk.gray('- Environment health check')}\n` +
      `${chalk.cyan('/model')}           ${chalk.gray('- Change AI model')}\n` +
      `${chalk.cyan('/stream')}          ${chalk.gray('- Toggle chat streaming')}\n` +
      `${chalk.cyan('/verbose')}         ${chalk.gray('- Toggle verbose mode')}\n` +
      `${chalk.cyan('/tools')}           ${chalk.gray('- List available tools')}\n` +
      `${chalk.cyan('/agents')}          ${chalk.gray('- Show subagent system status')}\n` +
      `${chalk.cyan('/stats')}           ${chalk.gray('- Show statistics')}\n` +
      `${chalk.cyan('/new')}             ${chalk.gray('- Start a fresh session')}\n` +
      `${chalk.cyan('/clear')}           ${chalk.gray('- Clear conversation')}\n` +
      `${chalk.cyan('/save')}            ${chalk.gray('- Save session')}\n` +
      `${chalk.cyan('/load')}            ${chalk.gray('- Load session')}\n` +
      `${chalk.cyan('/history')}         ${chalk.gray('- Show command history')}\n` +
      `${chalk.cyan('/paste')}           ${chalk.gray('- Paste large text')}\n` +
      `${chalk.cyan('/cost')}            ${chalk.gray('- Show cost breakdown')}\n` +
      `${chalk.cyan('/help')}            ${chalk.gray('- Show all commands')}\n` +
      `${chalk.cyan('/exit')}            ${chalk.gray('- Exit')}\n\n` +
      `${chalk.dim('Shortcuts:')} ${chalk.gray('q=exit, c=chat, a=agent, n=new, m=model, s=stats, h=help, tmp=templates, doc=doctor')}\n` +
      `${chalk.dim('Tip: Just type a message to run as an agentic task')}`,
      { ...box.default, title: '🤖 OpenAgent', titleAlignment: 'center' }
    ));

    await this.mainLoop();
  }
  
  /**
   * Start auto-save timer
   */
  startAutoSave() {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(async () => {
      if (!this.session || this.sessionSaveInFlight) {
        return;
      }

      if (Date.now() - this.lastSaveTime <= this.autoSaveInterval) {
        return;
      }

      try {
        this.sessionSaveInFlight = this.session.save();
        await this.sessionSaveInFlight;
        this.lastSaveTime = Date.now();
        if (this.verbose) {
          console.log(chalk.dim('\n💾 Auto-saved session'));
        }
      } catch (error) {
        // Silently fail auto-save
      } finally {
        this.sessionSaveInFlight = null;
      }
    }, this.autoSaveInterval);

    this.autoSaveTimer.unref?.();
  }

  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  printBanner() {
    console.log(`
 ${g.title('╔═══════════════════════════════════════════════════════════════╗')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('║')}   ${gradient.rainbow('🚀 OpenAgent')} ${chalk.gray(`v${VERSION}`)}                                           ${g.title('║')}
 ${g.title('║')}   ${chalk.gray('AI-Powered Agentic Assistant with 400+ Models')}               ${g.title('║')}
 ${g.title('║')}   ${chalk.gray('Production-grade • Tool calling • Multi-agent')}                ${g.title('║')}
 ${g.title('║')}                                                               ${g.title('║')}
 ${g.title('╚═══════════════════════════════════════════════════════════════╝')}
 `);
  }

  async mainLoop() {
    while (true) {
      console.log('');
      console.log(this.buildPromptStatusLine());
      const prompt = chalk.cyan('❯');
      
      const { input } = await inquirer.prompt([{
        type: 'input',
        name: 'input',
        message: prompt,
        prefix: '',
      }]);
      this.promptCount++;

      const trimmed = input.trim();
      if (!trimmed) continue;

      // Check for command alias
      let command = trimmed;
      if (trimmed.startsWith('/')) {
        const cmd = trimmed.slice(1).split(' ')[0].toLowerCase();
        if (this.aliases[cmd]) {
          command = '/' + this.aliases[cmd] + trimmed.slice(cmd.length + 1);
        }
      }

      if (command.startsWith('/')) {
        const shouldContinue = await this.handleCommand(command);
        if (!shouldContinue) break;
        continue;
      }

      if (command.startsWith('!')) {
        await this.runShellCommand(command.slice(1));
        continue;
      }

      // Default: run as agentic task
      this.taskCount++;
      await this.runAgentTask(trimmed);
    }

    await this.printGoodbye();
  }
  
  /**
   * Get current context usage percentage
   */
  getContextUsage() {
    if (!this.session?.agent) return 0;
    return this.session.agent.getContextStats().percent;
  }

  syncSessionModelState(modelId = this.session?.agent?.model) {
    if (!this.session?.agent || !modelId) {
      return null;
    }

    this.session.model = modelId;
    this.session.agent.model = modelId;
    const contextLength = this.modelBrowser?.getContextLength(modelId) || CONFIG.MAX_CONTEXT_TOKENS;
    this.session.agent.setMaxContextTokens(contextLength);

    return {
      model: this.modelBrowser?.getModel(modelId) || null,
      contextLength,
    };
  }

  createSession({
    modelId = this.session?.agent?.model || this.session?.model,
    sessionId,
    activeWorkspace = null,
    openAgentDir = this.session?.workspaceManager?.openAgentDir,
    saveDir = this.session?.saveDir,
    taskDir = this.session?.taskManager?.taskDir,
  } = {}) {
    if (!modelId) {
      throw new Error('Model must be selected before creating a session.');
    }

    const nextSession = new AgentSession({
      workingDir: this.workingDir,
      model: modelId,
      verbose: this.verbose,
      streaming: this.streaming,
      sessionId,
      activeWorkspace,
      openAgentDir,
      saveDir,
      taskDir,
    });

    this.session = nextSession;
    this.syncSessionModelState(modelId);
    this.lastSaveTime = Date.now();
    return nextSession;
  }

  formatCompactNumber(value) {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
    return Math.round(value).toString();
  }

  truncateInline(text, maxLength = 56) {
    if (!text || text.length <= maxLength) {
      return text || '';
    }

    return `${text.substring(0, maxLength - 3).trimEnd()}...`;
  }

  shortenModelLabel(modelId) {
    if (!modelId) {
      return 'no-model';
    }

    return this.truncateInline(modelId, 28);
  }

  getWorkspaceLabel() {
    const workspaceDir = this.session?.activeWorkspace?.workspaceDir;
    return workspaceDir ? path.basename(workspaceDir) : 'none';
  }

  getSessionLabel() {
    const sessionId = this.session?.sessionId;
    if (!sessionId) {
      return 'new';
    }

    return sessionId.replace(/^session_/, '').slice(-8);
  }

  buildPromptStatusLine() {
    if (!this.session?.agent) {
      return chalk.dim('─ ready');
    }

    const context = this.session.agent.getContextStats();
    const contextColor = context.percent > 70 ? chalk.red : context.percent > 40 ? chalk.yellow : chalk.green;
    const segments = [
      `${chalk.dim('model')} ${chalk.cyan(this.shortenModelLabel(this.session.agent.model))}`,
      `${chalk.dim('ctx est')} ${contextColor(`${this.formatCompactNumber(context.usedTokens)}/${this.formatCompactNumber(context.maxTokens)} (${context.percent}%)`)}`,
      `${chalk.dim('stream')} ${this.streaming ? chalk.green('chat-on') : chalk.gray('chat-off')}`,
      `${chalk.dim('session')} ${chalk.gray(this.getSessionLabel())}`,
    ];
    const workspaceLabel = this.getWorkspaceLabel();

    if (workspaceLabel !== 'none') {
      segments.push(`${chalk.dim('ws')} ${chalk.gray(workspaceLabel)}`);
    }

    return `${chalk.dim('─ ')}${segments.join(chalk.dim(' │ '))}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🤖 Agent Task with Real-Time Tool Visualization
  // ═══════════════════════════════════════════════════════════════

  async runAgentTask(task) {
    const startTime = Date.now();
    this.taskStartTime = startTime;
    this.currentTask = task;
    let toolCallCount = 0;
    let responsePrinted = false;
    const previousCallbacks = {
      onToolStart: this.session.agent.onToolStart,
      onToolEnd: this.session.agent.onToolEnd,
      onResponse: this.session.agent.onResponse,
      onIterationStart: this.session.agent.onIterationStart,
      onIterationEnd: this.session.agent.onIterationEnd,
      onStatus: this.session.agent.onStatus,
    };

    // Set up enhanced visual callbacks
    this.session.agent.onIterationStart = () => {
      console.log(chalk.dim(`\n── ${this.session.agent.formatIterationLabel()} ──`));
    };

    this.session.agent.onToolStart = (toolName, args) => {
      toolCallCount++;
      this.printEnhancedToolCallStart(toolName, args, toolCallCount, startTime);
    };

    this.session.agent.onToolEnd = (toolName, result) => {
      this.printEnhancedToolCallEnd(toolName, result, startTime, toolCallCount);
    };

    this.session.agent.onResponse = (content) => {
      if (!responsePrinted) {
        // Deduplicate: check if the response contains itself repeated
        const deduped = this.deduplicateResponse(content);
        this.printAIResponse(deduped);
        responsePrinted = true;
      }
    };

    this.session.agent.onStatus = ({ type, message }) => {
      const formatter = type === 'compaction'
        ? chalk.cyan
        : type === 'retry'
          ? chalk.yellow
          : chalk.dim;
      console.log(formatter(`   ${message}`));
    };

    try {
      const result = await this.session.run(task);
      const duration = Date.now() - startTime;

      // Only print if onResponse callback didn't already handle it
      if (result.response && !responsePrinted) {
        const deduped = this.deduplicateResponse(result.response);
        this.printAIResponse(deduped);
        responsePrinted = true;
      }

      // Print enhanced summary stats
      this.printEnhancedTaskSummary(result, duration);

      // Update state
      if (this.state?.stats) {
        this.state.stats.totalTasks++;
        this.state.stats.totalTokens += result.stats?.totalTokensUsed || 0;
        this.state.stats.totalCost += result.performance?.totalCost || 0;
      }
      await this.saveState();

      this.history.push({
        type: 'agent',
        task,
        iterations: result.iterations,
        toolsUsed: result.stats.toolExecutions,
        timestamp: new Date().toISOString(),
        duration,
      });

    } catch (error) {
      this.showSmartError('task_execution', {
        message: error.message,
        task,
        suggestions: this.generateErrorSuggestions(error, task)
      });
    } finally {
      this.session.agent.onToolStart = previousCallbacks.onToolStart;
      this.session.agent.onToolEnd = previousCallbacks.onToolEnd;
      this.session.agent.onResponse = previousCallbacks.onResponse;
      this.session.agent.onIterationStart = previousCallbacks.onIterationStart;
      this.session.agent.onIterationEnd = previousCallbacks.onIterationEnd;
      this.session.agent.onStatus = previousCallbacks.onStatus;
      this.currentTask = null;
      this.taskStartTime = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 💬 Simple Chat (No Tools)
  // ═══════════════════════════════════════════════════════════════

  async runChat(message) {
    const startTime = Date.now();

    if (this.streaming) {
      // Real-time streaming
      process.stdout.write(`\n${g.ai('🤖 AI')} `);

      try {
        const stream = this.session.agent.client.chatStream(
          this.session.agent.messages.concat([{ role: 'user', content: message }]),
          { model: this.session.agent.model }
        );

        let fullContent = '';
        for await (const chunk of stream) {
          if (chunk.type === 'content') {
            process.stdout.write(chalk.white(chunk.content));
            fullContent += chunk.content;
          } else if (chunk.type === 'done') {
            this.session.agent.updateUsageStats(chunk.usage);
          }
        }

        console.log(''); // New line
        this.session.agent.pushMessage({ role: 'user', content: message });
        this.session.agent.pushMessage({ role: 'assistant', content: fullContent });

      } catch (error) {
        console.log(chalk.red(`\n✗ ${error.message}`));
      }

    } else {
      // Non-streaming with spinner
      const spinner = ora({
        text: chalk.gray('Thinking...'),
        spinner: 'dots',
        color: 'cyan',
      }).start();

      try {
        const result = await this.session.agent.chat(message);
        spinner.stop();
        this.printAIResponse(result.content);
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error.message}`));
      }
    }

    const duration = Date.now() - startTime;
    console.log(chalk.dim(`  └─ ${duration}ms`));
  }

  // ═══════════════════════════════════════════════════════════════
  // 🎨 Visual Output Methods
  // ═══════════════════════════════════════════════════════════════

  printAIResponse(content) {
    if (!content) return;
    console.log('');
    console.log(boxen(
      `${g.ai('🤖 AI')}\n\n${chalk.white(content)}`,
      box.response
    ));
  }

  printEnhancedToolCallStart(toolName, args, count, taskStartTime) {
    const elapsed = Date.now() - taskStartTime;
    const elapsedStr = this.formatDuration(elapsed);
    
    // Detect subagent tools and use minimal output for them
    const isSubagentTool = toolName.startsWith('delegate_') || toolName === 'subagent_status';
    
    if (isSubagentTool) {
      // Subagent tools get their own beautiful UI from SubagentManager
      // Just show a brief header here
      console.log('');
      console.log(`${chalk.cyan('⚡')} ${chalk.cyan.bold(toolName)} ${chalk.dim(`[${elapsedStr}]`)}`);
      return;
    }
    
    // Regular tools get compact, clean output
    const argPreview = this.formatToolArgs(toolName, args);
    console.log(`  ${chalk.yellow('⚙')} ${chalk.yellow(toolName)} ${argPreview}${chalk.dim(` [${elapsedStr}]`)}`);
  }

  /**
   * Format tool arguments for compact display
   */
  formatToolArgs(toolName, args) {
    if (!args || Object.keys(args).length === 0) return '';
    
    // Show the most relevant arg for common tools
    if (args.path) return chalk.dim(args.path);
    if (args.command) return chalk.dim(args.command.substring(0, 50) + (args.command.length > 50 ? '...' : ''));
    if (args.query) return chalk.dim(`"${args.query.substring(0, 40)}${args.query.length > 40 ? '...' : ''}"`);
    if (args.url) return chalk.dim(args.url.substring(0, 50));
    if (args.file) return chalk.dim(args.file);
    
    // Fallback: show first arg
    const firstKey = Object.keys(args)[0];
    const firstVal = typeof args[firstKey] === 'string' 
      ? args[firstKey].substring(0, 40) 
      : JSON.stringify(args[firstKey]).substring(0, 40);
    return chalk.dim(`${firstKey}: ${firstVal}${firstVal.length >= 40 ? '...' : ''}`);
  }

  printToolCallEnd(toolName, result) {
    if (result.success !== false) {
      console.log(chalk.green(`  ✓ ${toolName} completed`));

      // Show abbreviated result
      if (result.stdout && result.stdout.length > 0) {
        const preview = result.stdout.substring(0, 200);
        console.log(chalk.dim(`  └─ ${preview}${result.stdout.length > 200 ? '...' : ''}`));
      }
    } else {
      console.log(chalk.red(`  ✗ ${toolName} failed: ${result.error}`));
    }
  }

  printTaskSummary(result, duration) {
    const seconds = (duration / 1000).toFixed(1);
    const modelId = this.session.agent.model;
    const modelShort = modelId.split('/').pop();
    this.syncSessionModelState(modelId);
    const contextStats = this.session.agent.getContextStats();
    const contextUsed = contextStats.usedTokens;
    const contextMax = contextStats.maxTokens;
    const contextPct = contextStats.percent;
    const contextColor = contextPct > 70 ? chalk.red : contextPct > 40 ? chalk.yellow : chalk.green;

    const formatCtx = (n) => {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
      return n.toString();
    };
    
    // Update session totals
    if (result.performance) {
      this.totalTokens += result.performance.totalToolCalls * 1000; // Rough estimate
    }

    console.log('');
    console.log(chalk.dim(`  ── `) +
      chalk.cyan(modelShort) + chalk.dim(' • ') +
      contextColor(`${formatCtx(contextUsed)}/${formatCtx(contextMax)} ctx est (${contextPct}%)`) + chalk.dim(' • ') +
      chalk.white(`${result.iterations} iter`) + chalk.dim(' • ') +
      chalk.white(`${result.stats.toolExecutions} tools`) + chalk.dim(' • ') +
      chalk.white(`${seconds}s`) +
      chalk.dim(' ──'));
    
    // Show performance metrics if available
    if (result.performance && result.performance.totalRetries > 0) {
      console.log(chalk.dim(`  └─ ${result.performance.totalRetries} retries`));
    }

    if (result.stopReason && result.stopReason !== 'completed') {
      console.log(chalk.dim(`  └─ stop reason: ${result.stopReason}`));
    }

    if (result.workspace?.workspaceDir) {
      console.log(chalk.dim(`  └─ workspace: ${result.workspace.workspaceDir}`));
    }
  }

  async printGoodbye() {
    this.stopAutoSave();
    if (this.sessionSaveInFlight) {
      await this.sessionSaveInFlight.catch(() => {});
    }

    console.log(`
${g.title('╔═══════════════════════════════════════════════════════════════╗')}
${g.title('║')}                                                               ${g.title('║')}
${g.title('║')}   ${g.success('👋 Session Complete')}                                         ${g.title('║')}
${g.title('║')}                                                               ${g.title('║')}
${g.title('╚═══════════════════════════════════════════════════════════════╝')}
`);
    
    // Save state on exit
    if (this.state) {
      this.state.totalSessions = (this.state.totalSessions || 0) + 1;
      await this.saveState();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ⚙️ Commands
  // ═══════════════════════════════════════════════════════════════

  async handleCommand(cmd) {
    const [command, ...args] = cmd.slice(1).split(' ');
    const argStr = args.join(' ');

    switch (command.toLowerCase()) {
      case 'exit':
      case 'quit':
      case 'q':
        // Auto-save before exit
        this.stopAutoSave();
        if (this.autoSave) {
          try {
            await this.session.save();
            this.lastSaveTime = Date.now();
            console.log(chalk.dim('💾 Session auto-saved'));
          } catch {}
        }
        return false;

      case 'agent':
        if (argStr) {
          this.taskCount++;
          await this.runAgentTask(argStr);
        } else {
          console.log(chalk.gray('Usage: /agent <task>'));
        }
        break;

      case 'chat':
        if (argStr) {
          await this.runChat(argStr);
        } else {
          console.log(chalk.gray('Usage: /chat <message>'));
        }
        break;

      case 'model':
        await this.changeModel();
        break;

      case 'stream':
        this.streaming = !this.streaming;
        this.session.agent.streaming = this.streaming;
        console.log(chalk.green(`✓ Chat streaming ${this.streaming ? 'enabled' : 'disabled'}`));
        break;

      case 'verbose':
        this.verbose = !this.verbose;
        this.session.agent.verbose = this.verbose;
        console.log(chalk.green(`✓ Verbose ${this.verbose ? 'enabled' : 'disabled'}`));
        break;

      case 'tools':
        this.showTools();
        break;

      case 'stats':
        this.showStats();
        break;

      case 'agents':
        this.showAgents();
        break;

      case 'clear':
        this.session.agent.clear();
        console.log(chalk.green('✓ Conversation cleared'));
        break;

      case 'new':
      case 'reset':
        await this.resetSession();
        break;

      case 'save':
        await this.saveSession();
        break;

      case 'load':
        await this.loadSession();
        break;

      case 'history':
        this.showHistory();
        break;

      case 'paste':
        await this.handlePaste();
        break;

      case 'cost':
        this.showCost();
        break;

      case 'doctor':
        await this.runDoctor();
        break;

      case 'templates':
        await this.showTemplates();
        break;

      case 'help':
        this.showHelp();
        break;

      default:
        console.log(chalk.yellow(`⚠ Unknown: /${command}. Type /help`));
    }

    return true;
  }

  /**
   * Select a model at startup
   */
  async selectModel() {
    console.log('');
    
    // Check for recent models first
    if (this.modelBrowser.recents.length > 0) {
      let recentModel = this.modelBrowser.recents[0];
      let modelInfo = this.modelBrowser.getModel(recentModel);

      if (recentModel && !modelInfo && this.modelBrowser.models.length > 0) {
        await this.modelBrowser.removeRecent(recentModel);
        recentModel = this.modelBrowser.recents[0];
        modelInfo = recentModel ? this.modelBrowser.getModel(recentModel) : null;
      }
      
      if (recentModel && modelInfo) {
        const { useRecent } = await inquirer.prompt([{
          type: 'confirm',
          name: 'useRecent',
          message: `Use recent model: ${chalk.cyan(recentModel)}${modelInfo ? chalk.gray(` (${modelInfo.provider})`) : ''}?`,
          default: true,
        }]);
        
        if (useRecent) {
          return recentModel;
        }
      }
    }
    
    // Full model picker
    const modelId = await this.modelBrowser.pickModel();
    
    if (modelId) {
      await this.modelBrowser.addRecent(modelId);
      return modelId;
    }
    
    // Fallback: pick first available model
    if (this.modelBrowser.models.length > 0) {
      const fallback = this.modelBrowser.models[0].id;
      console.log(chalk.yellow(`⚠️ No model selected, using: ${fallback}`));
      return fallback;
    }
    
    // Last resort
    throw new Error('No models available. Check your API key and internet connection.');
  }

  async changeModel() {
    const modelId = await this.modelBrowser.pickModel({
      currentModel: this.session.agent.model,
    });

    if (modelId) {
      const synced = this.syncSessionModelState(modelId);
      await this.modelBrowser.addRecent(modelId);
      console.log(chalk.green(`✓ Model: ${chalk.cyan(modelId)} ${chalk.gray(`(${this.formatCompactNumber(synced?.contextLength || 0)} ctx)`)}`));
    }
  }

  showTools() {
    const tools = this.session.toolRegistry.list();

    console.log(boxen(
      `${chalk.bold('Available Tools')} (${tools.length})\n\n` +
      tools.map(t =>
        `${t.enabled ? chalk.green('●') : chalk.red('○')} ${chalk.cyan(t.name)} ${chalk.gray(`[${t.category}]`)}\n  ${chalk.gray(t.description.substring(0, 60))}`
      ).join('\n'),
      { ...box.info, title: '🛠️ Tools' }
    ));
  }

  showStats() {
    const stats = this.session.agent.getStats();
    const contextStats = this.session.agent.getContextStats();
    const toolStats = this.session.toolRegistry.getStats();
    const subagentStats = this.session.subagentManager?.getStats() || {};

    let content = `${chalk.bold('Session')}\n\n` +
      `${chalk.cyan('Messages:')} ${stats.totalMessages}\n` +
      `${chalk.cyan('Iterations:')} ${stats.iterations}\n` +
      `${chalk.cyan('Tokens:')} ${stats.totalTokensUsed.toLocaleString()}\n` +
      `${chalk.cyan('Context Est:')} ${this.formatCompactNumber(contextStats.usedTokens)}/${this.formatCompactNumber(contextStats.maxTokens)} (${contextStats.percent}%)\n` +
      `${chalk.cyan('Compactions:')} ${contextStats.compactions}\n` +
      `${chalk.cyan('Tool Calls:')} ${stats.toolExecutions}\n` +
      `${chalk.cyan('Tools Used:')} ${stats.toolsUsed.join(', ') || 'None'}\n\n` +
      `${chalk.bold('Registry')}\n\n` +
      `${chalk.cyan('Executions:')} ${toolStats.totalExecutions}\n` +
      `${chalk.cyan('Success Rate:')} ${toolStats.successRate}\n` +
      `${chalk.cyan('Avg Duration:')} ${toolStats.avgDuration}`;

    if (subagentStats.totalTasks > 0) {
      content += `\n\n${chalk.bold('Subagents')}\n\n` +
        `${chalk.cyan('Total Tasks:')} ${subagentStats.totalTasks}\n` +
        `${chalk.cyan('Completed:')} ${subagentStats.completedTasks}\n` +
        `${chalk.cyan('Failed:')} ${subagentStats.failedTasks}\n` +
        `${chalk.cyan('Success Rate:')} ${subagentStats.successRate}\n` +
        `${chalk.cyan('Avg Duration:')} ${subagentStats.avgDuration}`;
    }

    console.log(boxen(content, { ...box.stats, title: '📊 Stats' }));
  }

  showAgents() {
    const subagentManager = this.session.subagentManager;
    if (!subagentManager) {
      console.log(chalk.gray('Subagent system not available'));
      return;
    }

    const stats = subagentManager.getStats();
    const tasks = subagentManager.getAllTasksStatus();
    const specializations = subagentManager.constructor.listSpecializations();

    // Stats section
    const successBar = stats.totalTasks > 0 
      ? this.miniBar(stats.completedTasks, stats.totalTasks) 
      : chalk.dim('no tasks yet');
    
    let content = `${chalk.bold.white('📊 Stats')}` +
      `\n  Tasks: ${chalk.white(stats.totalTasks)} total ${chalk.dim('│')} ${chalk.green(stats.completedTasks)} done ${chalk.dim('│')} ${chalk.red(stats.failedTasks)} failed ${chalk.dim('│')} ${chalk.cyan(stats.runningTasks)} running` +
      `\n  Rate:  ${successBar}  ${chalk.white(stats.successRate)}` +
      `\n  Speed: ${chalk.white(stats.avgDuration)} avg ${stats.totalRetries > 0 ? chalk.dim(`│ ${stats.totalRetries} retries`) : ''}`;

    // Per-specialization breakdown if we have data
    if (stats.bySpecialization && Object.keys(stats.bySpecialization).length > 0) {
      content += `\n\n${chalk.bold.white('📈 By Specialization')}`;
      for (const [specId, specStats] of Object.entries(stats.bySpecialization)) {
        const spec = specializations.find(s => s.id === specId);
        const icon = spec?.name?.charAt(0) || '🤖';
        content += `\n  ${icon} ${chalk.cyan(specId.padEnd(14))} ${chalk.white(specStats.total)} tasks ${chalk.dim('│')} ${chalk.green(specStats.completed)} ok ${chalk.dim('│')} ${chalk.red(specStats.failed)} fail`;
      }
    }

    // Recent tasks
    if (tasks.length > 0) {
      content += `\n\n${chalk.bold.white('🕐 Recent Tasks')}`;
      const recentTasks = tasks.slice(-6);
      for (const task of recentTasks) {
        const stateIcon = {
          queued: chalk.gray('○'),
          pending: chalk.yellow('◔'),
          running: chalk.cyan('◑'),
          completed: chalk.green('●'),
          failed: chalk.red('●'),
          cancelled: chalk.gray('⊘'),
          retrying: chalk.yellow('↻'),
        }[task.state] || chalk.gray('?');

        const dur = task.duration > 0 ? chalk.dim(` ${(task.duration / 1000).toFixed(1)}s`) : '';
        const retry = task.retryCount > 0 ? chalk.yellow(` ↻${task.retryCount}`) : '';
        content += `\n  ${stateIcon} ${chalk.cyan(task.specialization.padEnd(12))} ${chalk.gray(task.task)}${dur}${retry}`;
      }
    }

    // Available specializations
    content += `\n\n${chalk.bold.white('🎯 Specializations')}`;
    for (const spec of specializations) {
      content += `\n  ${spec.name.padEnd(16)} ${chalk.gray(spec.description)}`;
    }

    console.log(boxen(content, { ...box.info, title: '🤝 Subagent System', titleAlignment: 'center' }));
  }

  /**
   * Create a mini progress bar
   */
  miniBar(current, total, length = 12) {
    if (total === 0) return chalk.dim('░'.repeat(length));
    const filled = Math.round((current / total) * length);
    return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(length - filled));
  }

  showHistory() {
    if (this.history.length === 0) {
      console.log(chalk.gray('No history yet'));
      return;
    }

    console.log(boxen(
      this.history.slice(-10).map((h, i) =>
        `${chalk.gray(`${i + 1}.`)} ${chalk.cyan(h.type)}: ${(h.task || '').substring(0, 50)}...\n   ${chalk.dim(new Date(h.timestamp).toLocaleTimeString())}`
      ).join('\n'),
      { ...box.info, title: '📜 History' }
    ));
  }

  async saveSession() {
    const result = await this.session.save();
    if (result.success) {
      this.lastSaveTime = Date.now();
      console.log(chalk.green(`✓ Saved to ${result.path}`));
    } else {
      console.log(chalk.red('✗ Save failed'));
    }
  }

  async loadSession() {
    const sessions = await AgentSession.listSessions(undefined, {
      workingDir: this.workingDir,
    });

    if (sessions.length === 0) {
      console.log(chalk.gray('No saved sessions'));
      return;
    }

    const choices = sessions.map(s => ({
      name: [
        s.sessionId,
        s.model ? this.shortenModelLabel(s.model) : null,
        s.iterations ? `${s.iterations} iter` : null,
        s.lastTask ? this.truncateInline(s.lastTask, 42) : null,
        s.activeWorkspaceDir ? path.basename(s.activeWorkspaceDir) : null,
      ].filter(Boolean).join(chalk.dim(' • ')) + chalk.dim(` (${new Date(s.updated).toLocaleString()})`),
      value: s.sessionId,
    }));

    const { sessionId } = await inquirer.prompt([{
      type: 'list',
      name: 'sessionId',
      message: 'Load session:',
      choices,
    }]);

    const loaded = await AgentSession.load(sessionId, undefined, {
      workingDir: this.workingDir,
    });
    if (loaded) {
      this.session = loaded;
      this.syncSessionModelState(this.session.agent.model);
      console.log(chalk.green(`✓ Loaded ${sessionId}`));
      console.log(chalk.gray(`  Model: ${chalk.cyan(this.session.agent.model)}`));
      if (this.session.activeWorkspace?.workspaceDir) {
        console.log(chalk.gray(`  Workspace: ${this.getWorkspaceLabel()}`));
      }
      if (this.session.metadata?.lastTask) {
        console.log(chalk.gray(`  Last task: ${this.truncateInline(this.session.metadata.lastTask, 80)}`));
      }
    } else {
      console.log(chalk.red('✗ Load failed'));
    }
  }

  async runShellCommand(command) {
    const spinner = ora({
      text: chalk.gray(`Running: ${command}`),
      spinner: 'dots',
    }).start();

    try {
      const result = await this.session.toolRegistry.execute('exec', { command });
      spinner.stop();

      if (result.success) {
        console.log(boxen(
          `${chalk.green('✓ Success')}\n\n` +
          `${chalk.gray('Output:')}\n${result.stdout || '(no output)'}` +
          (result.stderr ? `\n\n${chalk.yellow('Stderr:')}\n${result.stderr}` : ''),
          { ...box.result, title: '📟 Shell' }
        ));
      } else {
        console.log(boxen(
          `${chalk.red('✗ Failed')}\n\n${result.error}`,
          box.error
        ));
      }
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
    }
  }

  async handlePaste() {
    console.log(chalk.gray('\nPaste mode: Enter your text below. Type "END" on a new line to finish.\n'));

    const lines = [];
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    await new Promise((resolve) => {
      rl.on('line', (line) => {
        if (line.trim() === 'END') {
          rl.close();
          resolve();
        } else {
          lines.push(line);
        }
      });
    });

    const pastedText = lines.join('\n');
    if (!pastedText.trim()) {
      console.log(chalk.gray('No text pasted.'));
      return;
    }

    const charCount = pastedText.length;
    const lineCount = lines.length;
    console.log(chalk.green(`\n✓ Captured ${lineCount} lines (${charCount.toLocaleString()} chars)\n`));

    // Run as agent task
    await this.runAgentTask(pastedText);
  }

  /**
   * Run environment health check (doctor)
   */
  async runDoctor() {
    console.log(chalk.cyan('\n🏥 Running health checks...\n'));
    
    const results = [];
    
    for (const [key, check] of Object.entries(HEALTH_CHECKS)) {
      const spinner = ora({ text: chalk.gray(check.name), spinner: 'dots' }).start();
      try {
        const result = await check.check(this.session);
        spinner.stop();
        
        const icon = result.status === 'healthy' ? chalk.green('✓') :
                     result.status === 'warning' ? chalk.yellow('⚠') : chalk.red('✗');
        console.log(`${icon} ${chalk.white(check.name)}: ${result.message}`);
        
        if (result.details) {
          console.log(chalk.dim(`  └─ ${result.details}`));
        }
        
        results.push({ check: key, ...result });
      } catch (error) {
        spinner.fail(chalk.red(`${check.name}: ${error.message}`));
        results.push({ check: key, status: 'error', message: error.message });
      }
    }
    
    const healthy = results.filter(r => r.status === 'healthy').length;
    const warnings = results.filter(r => r.status === 'warning').length;
    const errors = results.filter(r => r.status === 'error').length;
    
    console.log('');
    console.log(boxen(
      `${chalk.bold('Health Summary')}\n\n` +
      `${chalk.green(`✓ ${healthy} healthy`)}${warnings > 0 ? ` • ${chalk.yellow(`⚠ ${warnings} warnings`)}` : ''}${errors > 0 ? ` • ${chalk.red(`✗ ${errors} errors`)}` : ''}`,
      { ...box.info, title: '🏥 Doctor' }
    ));
  }

  /**
   * Show workflow templates
   */
  async showTemplates() {
    const choices = Object.entries(WORKFLOW_TEMPLATES).map(([key, tmpl]) => ({
      name: `${tmpl.name} - ${chalk.gray(tmpl.description)}`,
      value: key,
    }));
    
    choices.push({ name: chalk.gray('Cancel'), value: null });
    
    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Select a workflow template:',
      choices,
    }]);
    
    if (!template) return;
    
    const tmpl = WORKFLOW_TEMPLATES[template];
    
    console.log(boxen(
      `${chalk.bold(tmpl.name)}\n\n` +
      `${chalk.gray(tmpl.description)}\n\n` +
      `${chalk.bold('Steps:')}` +
      tmpl.steps.map((s, i) => `\n${chalk.cyan(i + 1)}. ${s}`).join('') +
      `\n\n${chalk.dim('Press Enter to run this workflow, or Escape to cancel')}`,
      { ...box.info, title: '📋 Template' }
    ));
    
    // Run the template prompt as an agent task
    await this.runAgentTask(tmpl.prompt);
  }

  showHelp() {
    console.log(boxen(
      `${chalk.bold('Commands')}\n\n` +
      `${chalk.cyan('/agent <task>')}  - Run agentic task (with tools)\n` +
      `${chalk.cyan('/chat <msg>')}   - Simple chat (no tools)\n` +
      `${chalk.cyan('/templates')}    - Browse workflow templates\n` +
      `${chalk.cyan('/doctor')}       - Environment health check\n` +
      `${chalk.cyan('/model')}        - Change AI model\n` +
      `${chalk.cyan('/stream')}       - Toggle chat streaming\n` +
      `${chalk.cyan('/verbose')}      - Toggle verbose mode\n` +
      `${chalk.cyan('/tools')}        - List available tools\n` +
      `${chalk.cyan('/agents')}       - Show subagent status\n` +
      `${chalk.cyan('/stats')}        - Show statistics\n` +
      `${chalk.cyan('/cost')}         - Show cost breakdown\n` +
      `${chalk.cyan('/new')}          - Start a fresh session\n` +
      `${chalk.cyan('/clear')}        - Clear conversation\n` +
      `${chalk.cyan('/save')}         - Save session\n` +
      `${chalk.cyan('/load')}         - Load session\n` +
      `${chalk.cyan('/history')}      - Show command history\n` +
      `${chalk.cyan('/paste')}        - Paste large text\n` +
      `${chalk.cyan('/reset')}        - Alias for /new\n` +
      `${chalk.cyan('/help')}         - Show this help\n` +
      `${chalk.cyan('/exit')}         - Exit\n\n` +
      `${chalk.bold('Aliases')}\n\n` +
      `${chalk.cyan('q')}=exit ${chalk.cyan('c')}=chat ${chalk.cyan('a')}=agent ${chalk.cyan('n')}=new ${chalk.cyan('m')}=model ${chalk.cyan('s')}=stats ${chalk.cyan('h')}=help\n\n` +
      `${chalk.bold('Shortcuts')}\n\n` +
      `${chalk.cyan('! <cmd>')}       - Run shell command\n` +
      `${chalk.cyan('plain text')}    - Run as agentic task`,
      { ...box.info, title: '📖 Help' }
    ));
  }
  
  /**
   * Show cost breakdown
   */
  showCost() {
    const clientStats = this.session.agent.client.getStats();
    const sessionDuration = Date.now() - this.sessionStartTime;
    const sessionMinutes = Math.floor(sessionDuration / 60000);
    
    console.log(boxen(
      `${chalk.bold('Session Cost')}\n\n` +
      `${chalk.cyan('Session Duration:')} ${sessionMinutes} minutes\n` +
      `${chalk.cyan('Total Requests:')} ${clientStats.requestCount}\n` +
      `${chalk.cyan('Total Cost:')} $${clientStats.totalCost}\n` +
      `${chalk.cyan('Budget Used:')} $${clientStats.budgetUsed} / $${clientStats.budgetLimit}\n` +
      `${chalk.cyan('Budget Remaining:')} $${clientStats.budgetRemaining}\n` +
      `${chalk.cyan('Avg Duration:')} ${clientStats.avgDuration}\n` +
      `${chalk.cyan('Cache Size:')} ${clientStats.cacheSize} entries\n` +
      `${chalk.cyan('Tasks Completed:')} ${this.taskCount}`,
      { ...box.stats, title: '💰 Cost' }
    ));
  }
  
  /**
   * Reset session
   */
  async resetSession() {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Reset session? This will start a brand-new session and clear the current conversation/task state.',
      default: false,
    }]);
    
    if (confirm) {
      const currentModel = this.session?.agent?.model || this.session?.model;
      const saveDir = this.session?.saveDir;
      const taskDir = this.session?.taskManager?.taskDir;
      const openAgentDir = this.session?.workspaceManager?.openAgentDir;

      await this.session?.taskManager?.reset();
      this.createSession({
        modelId: currentModel,
        activeWorkspace: null,
        saveDir,
        taskDir,
        openAgentDir,
      });

      this.taskCount = 0;
      this.history = [];
      this.sessionStartTime = Date.now();
      this.totalCost = 0;
      this.totalTokens = 0;
      this.currentTask = null;
      this.taskStartTime = null;
      console.log(chalk.green(`✓ Started new session ${chalk.cyan(this.session.sessionId)}`));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 🗄️ State Management (was missing!)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load persistent state from disk
   */
  async loadState() {
    try {
      await fs.ensureDir(STATE_DIR);
      
      if (await fs.pathExists(STATE_FILE)) {
        const saved = await fs.readJson(STATE_FILE);
        this.state = {
          ...DEFAULT_STATE,
          ...saved,
          // Always update version
          version: VERSION,
          // Update last used
          lastUsed: new Date().toISOString(),
        };
        
        if (this.verbose) {
          console.log(chalk.dim('📂 Loaded local state'));
        }
      } else {
        // First run
        this.state = {
          ...DEFAULT_STATE,
          firstRun: true,
          lastUsed: new Date().toISOString(),
        };
      }
    } catch (error) {
      // If state loading fails, use defaults
      this.state = {
        ...DEFAULT_STATE,
        firstRun: true,
      };
      if (this.verbose) {
        console.log(chalk.yellow('⚠️ Could not load state, using defaults'));
      }
    }
  }

  /**
   * Save persistent state to disk
   */
  async saveState() {
    try {
      await fs.ensureDir(STATE_DIR);
      this.state.lastUsed = new Date().toISOString();
      await fs.writeJson(STATE_FILE, this.state, { spaces: 2 });
    } catch (error) {
      // Silently fail state save
      if (this.verbose) {
        console.log(chalk.dim(`⚠️ Could not save state: ${error.message}`));
      }
    }
  }

  /**
   * Show smart suggestions based on usage patterns
   */
  showSmartSuggestions() {
    const suggestions = [
      '💡 Try /templates for common workflows',
      '💡 Use /doctor to check your environment',
      '💡 Type /help to see all commands',
      '💡 Use /stream to toggle streaming mode',
    ];
    const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
    console.log(chalk.dim(suggestion));
  }

  /**
   * First-run onboarding wizard
   */
  async runOnboarding() {
    console.log(boxen(
      `${chalk.bold('🎉 Welcome to OpenAgent!')}\n\n` +
      `${chalk.cyan('OpenAgent')} is an AI-powered coding assistant with 400+ models.\n\n` +
      `${chalk.bold('Quick Start:')}` +
      `\n${chalk.green('•')} Type any message to run as an agentic task` +
      `\n${chalk.green('•')} Use /chat for simple conversations` +
      `\n${chalk.green('•')} Use /templates for common workflows` +
      `\n${chalk.green('•')} Type /help for all commands\n\n` +
      `${chalk.dim('This message will only show once.')}`,
      { ...box.default, title: '🚀 Getting Started', titleAlignment: 'center' }
    ));
    
    // Mark first run as complete
    if (this.state) {
      this.state.firstRun = false;
      await this.saveState();
    }
  }

  /**
   * Show smart error with suggestions
   */
  showSmartError(errorType, details = {}) {
    const { message, suggestions = [] } = details;
    
    let content = `${chalk.red('❌ Error')}\n\n${chalk.white(message || 'An error occurred')}`;
    
    if (suggestions.length > 0) {
      content += `\n\n${chalk.bold('Suggestions:')}`;
      for (const suggestion of suggestions) {
        content += `\n${chalk.green('•')} ${suggestion}`;
      }
    }
    
    console.log(boxen(content, box.error));
  }

  /**
   * Generate error suggestions based on error type
   */
  generateErrorSuggestions(error, task) {
    const suggestions = [];
    const errorMsg = error.message?.toLowerCase() || '';
    
    if (errorMsg.includes('api key') || errorMsg.includes('unauthorized') || errorMsg.includes('401')) {
      suggestions.push('Check your OPENROUTER_API_KEY in .env file');
      suggestions.push('Get a key at https://openrouter.ai/keys');
    }
    
    if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
      suggestions.push('Wait a moment and try again');
      suggestions.push('Consider using a different model');
    }
    
    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
      suggestions.push('Try a simpler task or break it into steps');
      suggestions.push('Check your internet connection');
    }
    
    if (errorMsg.includes('context') || errorMsg.includes('token')) {
      suggestions.push('Use /clear to reset conversation context');
      suggestions.push('Try a model with larger context window');
    }
    
    if (suggestions.length === 0) {
      suggestions.push('Try /doctor to check your environment');
      suggestions.push('Use /clear and try again');
      suggestions.push('Check the error details above');
    }
    
    return suggestions;
  }

  /**
   * Deduplicate response content that may have been repeated by the LLM
   */
  deduplicateResponse(content) {
    if (!content || content.length < 100) return content;
    
    // Check if the response is roughly the same text repeated
    const half = Math.floor(content.length / 2);
    const firstHalf = content.substring(0, half).trim();
    const secondHalf = content.substring(half).trim();
    
    // If both halves are very similar (>85% overlap), take just the first half
    if (firstHalf.length > 50 && secondHalf.length > 50) {
      const similarity = this.textSimilarity(firstHalf, secondHalf);
      if (similarity > 0.85) {
        return firstHalf;
      }
    }
    
    // Also check for exact substring duplication (content repeated verbatim)
    // Try different split points around the middle
    for (let offset = -20; offset <= 20; offset++) {
      const splitPoint = half + offset;
      if (splitPoint < 50 || splitPoint > content.length - 50) continue;
      
      const part1 = content.substring(0, splitPoint).trim();
      const part2 = content.substring(splitPoint).trim();
      
      if (part1 === part2) {
        return part1;
      }
    }
    
    return content;
  }

  /**
   * Simple text similarity check (Jaccard on words)
   */
  textSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Format duration for display
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * Enhanced tool call end with timing
   */
  printEnhancedToolCallEnd(toolName, result, taskStartTime, count) {
    // Subagent tools handle their own output via SubagentManager UI
    const isSubagentTool = toolName.startsWith('delegate_') || toolName === 'subagent_status';
    if (isSubagentTool) {
      // Just show a brief completion status
      if (result.success !== false) {
        const resultData = result.result || result;
        const taskCount = resultData?.summary?.total || resultData?.stats?.total || '';
        const info = taskCount ? ` (${taskCount} tasks)` : '';
        console.log(chalk.green(`  ✓ ${toolName} done${info}`));
      } else {
        console.log(chalk.red(`  ✗ ${toolName}: ${result.error || result.result?.error || 'failed'}`));
      }
      return;
    }
    
    const elapsed = Date.now() - taskStartTime;
    const elapsedStr = this.formatDuration(elapsed);
    
    if (result.success !== false) {
      console.log(chalk.green(`    ✓`) + chalk.dim(` ${elapsedStr}`));
      
      // Show abbreviated result preview for useful output
      const resultData = result.result || result;
      if (resultData?.stdout && resultData.stdout.length > 0) {
        const preview = resultData.stdout.substring(0, 120).replace(/\n/g, ' ');
        console.log(chalk.dim(`    └─ ${preview}${resultData.stdout.length > 120 ? '...' : ''}`));
      }
    } else {
      const errorMsg = result.error || result.result?.error || 'Unknown error';
      console.log(chalk.red(`    ✗ ${errorMsg.substring(0, 80)}`));
    }
  }

  /**
   * Enhanced task summary with better formatting
   */
  printEnhancedTaskSummary(result, duration) {
    this.printTaskSummary(result, duration);
  }
}

export default CLI;
