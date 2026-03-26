#!/usr/bin/env node
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
import { parseXmlToolCalls, hasXmlToolCalls } from './tools/xmlToolParser.js';
import ora from 'ora';
import boxen from 'boxen';
import gradient from 'gradient-string';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderMarkdown } from './cli/markdown.js';
import { renderDiff } from './cli/diffViewer.js';
import { AgentSession } from './agent/AgentSession.js';
import { CONFIG } from './config.js';
import { getInstallationDir, isInsideInstallationDir } from './paths.js';
import { ModelBrowser } from './ModelBrowser.js';
import { processInput, readDroppedFile, formatDroppedContent } from './inputHandler.js';
import { isVisionModel, buildMultimodalMessage } from './vision.js';
import { gradients, boxStyles } from './utils.js';
import { resolveCommand, parseCommand } from './cli/commands.js';
import { multilinePrompt, MultilineInput } from './cli/multilineInput.js';
import { createReadlineInterfaceWithTerminalReset, promptWithTerminalReset } from './cli/terminal.js';
import { runOnboarding } from './cli/onboarding.js';
import { showStats, showCost, showAgents } from './cli/stats.js';
import { VERSION, STATE_DIR, STATE_FILE, DEFAULT_STATE } from './cli/state.js';
import { getTheme, listThemes, nextTheme, THEME_ORDER } from './cli/themes.js';
import { startInkUI } from './cli-ink.js';

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

const COMMAND_ENTRIES = [
  ['/agent <task>', 'Run agentic task (with tools)'],
  ['/chat <msg>', 'Simple chat (no tools)'],
  ['/templates', 'Browse workflow templates'],
  ['/doctor', 'Environment health check'],
  ['/model', 'Change AI model'],
  ['/model <id>', 'Switch to specific model'],
  ['/stream', 'Toggle chat streaming'],
  ['/verbose', 'Toggle verbose mode'],
  ['/render', 'Toggle markdown rendering'],
  ['/tools', 'List available tools'],
  ['/agents', 'Show subagent system status'],
  ['/stats', 'Show statistics'],
  ['/context', 'Show context usage'],
  ['/new', 'Start a fresh session'],
  ['/clear', 'Clear conversation history'],
  ['/session save [name]', 'Save session checkpoint'],
  ['/session restore <id>', 'Restore session checkpoint'],
  ['/session list', 'List saved sessions'],
  ['/save', 'Save session (alias)'],
  ['/load', 'Load session'],
  ['/history', 'Show command history'],
  ['/paste', 'Capture large multi-line input'],
  ['/cost', 'Show cost breakdown'],
  ['/undo', 'Undo last file change'],
  ['/diff', 'Show pending file changes'],
  ['/export', 'Export conversation as markdown'],
  ['/help', 'Show all commands'],
  ['/exit', 'Exit'],
];

const SHORTCUT_ENTRIES = [
  'q=exit',
  'c=chat',
  'a=agent',
  'n=new',
  'm=model',
  's=stats',
  'h=help',
  'tmp=templates',
  'doc=doctor',
  'u=undo',
  'd=diff',
  'co=cost',
  'ex=export',
];

const INPUT_SHORTCUT_ENTRIES = [
  '↵ send',
  'Ctrl+O newline',
  'Ctrl+L clear screen',
  'Ctrl+T cycle theme',
  'Ctrl+P session stats',
  'Ctrl+V paste',
  'Ctrl+C copy',
  'Ctrl+K exit',
  'Ctrl+Z undo',
  'Ctrl+A select all',
];

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

// Gradients and box styles imported from ./utils.js
const g = gradients;
const box = boxStyles;

const DIVIDER = chalk.dim('─'.repeat(Math.max(40, (process.stdout.columns || 80) - 2)));

// 💻 CLI Class
// ═══════════════════════════════════════════════════════════════════

export class CLI {
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.session = null;
    this.modelBrowser = null;
    this.streaming = true;
    this.verbose = true;
    this.allowFullAccess = options.allowFullAccess === true || options.permissions?.allowFullAccess === true;
    this.permissions = {
      allowFileDelete: true,
      ...options.permissions,
      allowFullAccess: this.allowFullAccess,
    };
    this.history = [];
    this.mode = 'agent'; // 'agent' or 'chat'
    
    // Maximum history entries to prevent unbounded memory growth
    this.maxHistorySize = 100;
    
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
    this.promptActive = false;

    // Theme system
    this.currentTheme = 'catppuccin';
    this.theme = getTheme('catppuccin');

    // File content cache for inline diffs
    this.fileContentCache = new Map();

  }

  async start() {
    console.clear();
    
    // Load or initialize state
    await this.loadState();
    
    this.printBanner();

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

    // First-run onboarding (after model browser is ready)
    if (this.state.firstRun) {
      await runOnboarding(this.state, () => this.saveState(), this.modelBrowser);
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

    // Get model info for display
    const modelInfo = this.modelBrowser.getModel(selectedModel);
    const contextLength = modelInfo?.contextLength || CONFIG.MAX_CONTEXT_TOKENS;
    const toolCount = this.session.toolRegistry?.list()?.length || 0;
    
    // Show session info box
    console.log(boxen(
      `${chalk.bold('🚀 OpenAgent')} ${chalk.gray(`v${VERSION}`)}\n\n` +
      `${chalk.bold('Model:')} ${chalk.cyan(this.session.agent.model)}\n` +
      `${chalk.bold('Context:')} ${this.formatCompactNumber(contextLength)}\n` +
      `${chalk.bold('Tools:')} ${toolCount} available\n` +
      `${chalk.bold('Dir:')} ${chalk.gray(this.workingDir)}`,
      { ...box.info, title: '📋 Session Info', titleAlignment: 'center' }
    ));

    // Warn if running from the OpenAgent installation directory
    if (isInsideInstallationDir(this.workingDir) && !this.allowFullAccess) {
      const installDir = getInstallationDir();
      console.log(boxen(
        chalk.yellow('⚠️  You are running OpenAgent from its installation directory.\n') +
        chalk.yellow('The AI will NOT be able to write files here.\n') +
        chalk.gray(`Installation: ${installDir}\n`) +
        chalk.gray('To work on a project, run OpenAgent from your project directory:') +
        chalk.cyan('\n  cd /path/to/your/project && openagent'),
        { ...box.warning, title: '🛡️ Installation Protection Active', titleAlignment: 'center' }
      ));
    }

    // Start auto-save timer
    if (this.autoSave) {
      this.startAutoSave();
    }

    console.log(boxen(
      `${chalk.bold('Commands:')}\n\n` +
      `${this.formatCommandList()}\n\n` +
      `${chalk.dim('Shortcuts:')} ${chalk.gray(this.getShortcutSummary())}\n` +
      `${chalk.dim('Input:')} ${chalk.gray(this.getInputShortcutSummary())}\n` +
      `${chalk.dim('Tip: Just type a message to run as an agentic task')}`,
      { ...box.default, title: '🤖 OpenAgent', titleAlignment: 'center' }
    ));

    await this.mainLoop();
  }
  
  /**
   * Handle paste mode - multi-line input with confirmation
   */
  async handlePaste() {
    console.log(chalk.yellow('\n📝 Paste Mode'));
    console.log(chalk.gray('Paste your content below. Type "END" on a new line to finish.\n'));

    const lines = [];
    const readline = await import('readline');
    const rl = await createReadlineInterfaceWithTerminalReset(readline, {
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
      console.log(chalk.gray('No content provided.'));
      return;
    }

    const charCount = pastedText.length;
    const lineCount = lines.length;
    
    // Show preview
    console.log(chalk.yellow(`\n📋 Content captured (${lineCount} lines, ${charCount.toLocaleString()} chars):`));
    console.log(chalk.dim('─'.repeat(60)));
    
    const previewLines = lines.slice(0, 10);
    for (const line of previewLines) {
      console.log(chalk.gray(line));
    }
    if (lines.length > 10) {
      console.log(chalk.dim(`... (${lines.length - 10} more lines)`));
    }
    
    console.log(chalk.dim('─'.repeat(60)));

    // Ask for confirmation
    const { action } = await promptWithTerminalReset([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '✓ Send this content', value: 'send' },
        { name: '✗ Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      console.log(chalk.gray('Cancelled.'));
      return;
    }

    console.log(chalk.green('✓ Sending content...'));
    this.taskCount++;
    await this.runAgentTask(pastedText);
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

      if (Date.now() - this.lastSaveTime < this.autoSaveInterval) {
        return;
      }

      try {
        this.sessionSaveInFlight = this.session.save();
        await this.sessionSaveInFlight;
        this.lastSaveTime = Date.now();
        if (this.verbose && !this.promptActive) {
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
      const statusLine = this.buildPromptStatusLine();
      const promptStr = chalk.cyan('❯ ');

      let input;
      this.promptActive = true;
      try {
        input = await multilinePrompt({
          prompt: promptStr,
          statusLine: statusLine,
          placeholder: 'Type your message... (Enter sends, Ctrl+O newline, Ctrl+L clear, Ctrl+T theme)',
        });
      } finally {
        this.promptActive = false;
      }
      this.promptCount++;

      // CANCEL sentinel means Ctrl+K was pressed on empty buffer — exit the app
      if (input === MultilineInput.CANCEL) {
        break;
      }

      // Keyboard shortcut sentinels
      if (input === MultilineInput.CLEAR_SCREEN) {
        console.clear();
        continue;
      }
      if (input === MultilineInput.CYCLE_THEME) {
        this.currentTheme = nextTheme(this.currentTheme);
        this.theme = getTheme(this.currentTheme);
        console.log(chalk.hex(this.theme.accent)(`🎨 Theme: ${this.theme.name}`));
        continue;
      }
      if (input === MultilineInput.SHOW_STATS) {
        this.printSessionStats();
        continue;
      }
      const trimmed = input.trim();
      if (!trimmed) continue;

      // Process input for drag-and-drop detection
      const processed = await processInput(trimmed, { validateExistence: true });

      if (processed.type === 'paths' && processed.paths.length > 0) {
        const dropResults = [];
        const imageResults = [];
        for (const dropPath of processed.paths) {
          try {
            const result = await readDroppedFile(dropPath);
            if (result.type === 'image') { imageResults.push(result); } else { dropResults.push(result); }
            console.log(chalk.dim(`  Detected: ${result.name || path.basename(dropPath)} (${result.type})`));
          } catch (err) { console.log(chalk.yellow(`  Could not read: ${dropPath} - ${err.message}`)); }
        }
        let contextText = formatDroppedContent(dropResults);
        if (imageResults.length > 0) {
          const modelId = this.session?.agent?.model || '';
          if (isVisionModel(modelId)) {
            const images = imageResults.map(img => ({ base64: img.base64, mimeType: img.mimeType }));
            const textPart = contextText + '\n\nAnalyze attached images: ' + imageResults.map(i => i.name).join(', ');
            const multimodalMsg = buildMultimodalMessage(textPart, images);
            console.log(chalk.green(`  ${imageResults.length} image(s) attached for vision`));
            this.taskCount++; await this.runAgentTaskWithContext(multimodalMsg); continue;
          } else {
            contextText += '\n\nImages dropped: ' + imageResults.map(i => `${i.name} (${i.mimeType})`).join(', ');
          }
        }
        if (contextText) { this.taskCount++; await this.runAgentTask('Analyze dropped content:\n\n' + contextText); }
        continue;
      }

      if (processed.type === 'mixed' && processed.paths.length > 0) {
        const dropResults = [];
        const imageResults = [];
        for (const dropPath of processed.paths) {
          try {
            const result = await readDroppedFile(dropPath);
            if (result.type === 'image') { imageResults.push(result); } else { dropResults.push(result); }
          } catch {}
        }
        let contextText = formatDroppedContent(dropResults);
        if (imageResults.length > 0) {
          const modelId = this.session?.agent?.model || '';
          if (isVisionModel(modelId)) {
            const images = imageResults.map(img => ({ base64: img.base64, mimeType: img.mimeType }));
            const fullText = (contextText ? contextText + '\n\n' : '') + processed.text;
            const multimodalMsg = buildMultimodalMessage(fullText, images);
            console.log(chalk.green(`  ${imageResults.length} image(s) attached`));
            this.taskCount++; await this.runAgentTaskWithContext(multimodalMsg); continue;
          }
        }
        const fullTask = contextText ? `Context from dropped files:\n\n${contextText}\n\n---\n\nUser request: ${processed.text}` : processed.text;
        this.taskCount++; await this.runAgentTask(fullTask); continue;
      }

      // Check for command alias
      const command = trimmed.startsWith('/') ? resolveCommand(trimmed) : trimmed;

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
      permissions: this.permissions,
      allowFullAccess: this.allowFullAccess,
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

  formatCommandList(entries = COMMAND_ENTRIES) {
    const commandWidth = entries.reduce((max, [command]) => Math.max(max, command.length), 0);
    return entries
      .map(([command, description]) =>
        `${chalk.cyan(command.padEnd(commandWidth + 2))}${chalk.gray(`- ${description}`)}`
      )
      .join('\n');
  }

  getShortcutSummary() {
    return SHORTCUT_ENTRIES.join(', ');
  }

  getInputShortcutSummary() {
    return INPUT_SHORTCUT_ENTRIES.join(' · ');
  }

  getProjectMemoryLabel() {
    const memoryPath = this.session?.memoryManager?.paths?.projectMemory;
    if (!memoryPath) {
      return 'openagent:memory/MEMORY.md';
    }

    const relativePath = path.relative(this.workingDir, memoryPath);
    if (!relativePath || relativePath.startsWith('..')) {
      return memoryPath;
    }

    return relativePath;
  }

  buildPromptStatusLine() {
    if (!this.session?.agent) {
      return chalk.dim('─ ready');
    }

    const context = this.session.agent.getContextStats();
    
    // Color coding based on context usage
    let contextColor;
    let contextBar;
    const barLength = 10;
    const filledBars = Math.round((context.percent / 100) * barLength);
    
    if (context.percent > 70) {
      contextColor = chalk.red;
      contextBar = chalk.red('█'.repeat(filledBars)) + chalk.dim('░'.repeat(barLength - filledBars));
    } else if (context.percent > 40) {
      contextColor = chalk.yellow;
      contextBar = chalk.yellow('█'.repeat(filledBars)) + chalk.dim('░'.repeat(barLength - filledBars));
    } else {
      contextColor = chalk.green;
      contextBar = chalk.green('█'.repeat(filledBars)) + chalk.dim('░'.repeat(barLength - filledBars));
    }
    
    // Get session stats
    const stats = this.session.agent.getStats();
    const clientStats = this.session.agent.client.getStats();
    
    // Format cost
    const costStr = clientStats.totalCost > 0 
      ? chalk.yellow(`$${clientStats.totalCost.toFixed(2)}`)
      : chalk.dim('$0.00');
    
    // Format elapsed time since session start
    const elapsedMs = Date.now() - this.sessionStartTime;
    const elapsedStr = this.formatElapsedTime(elapsedMs);
    
    // Tool call count
    const toolCount = stats.toolExecutions || 0;
    const toolStr = toolCount > 0 
      ? chalk.white(`${toolCount} tools`)
      : chalk.dim('0 tools');
    
    // Shorten working dir for display (show last 2 path components)
    const dirParts = this.workingDir.replace(/\\/g, '/').split('/');
    const shortDir = dirParts.length > 2
      ? '…/' + dirParts.slice(-2).join('/')
      : this.workingDir;

    const segments = [
      `${chalk.dim('🤖')} ${chalk.cyan(this.shortenModelLabel(this.session.agent.model))}`,
      `${chalk.dim('[')}${contextBar}${chalk.dim(']')} ${contextColor(context.percent + '%')}`,
      costStr,
      toolStr,
      `${chalk.dim(elapsedStr)}`,
      `${chalk.gray(shortDir)}`,
    ];
    
    const workspaceLabel = this.getWorkspaceLabel();

    if (workspaceLabel !== 'none') {
      segments.splice(5, 0, `${chalk.dim('ws')} ${chalk.gray(workspaceLabel)}`);
    }

    return `${chalk.dim('─ ')}${segments.join(chalk.dim(' │ '))}`;
  }
  
  /**
   * Format elapsed time for display
   */
  formatElapsedTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m elapsed`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s elapsed`;
    } else {
      return `${seconds}s elapsed`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 🤖 Agent Task with Real-Time Tool Visualization
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run agent task with separators and smooth transitions
   */
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

    // Show separator before agent runs
    console.log(chalk.dim('──────────────────────'));
    
    // Set up enhanced visual callbacks
    this.session.agent.onIterationStart = (iteration) => {
      const iterationLabel = this.session.agent.formatIterationLabel();
      console.log(chalk.dim(`\n── ${iterationLabel} ──`));
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

    // Progress indicator for long-running tasks
    let progressInterval = null;
    const startProgressIndicator = () => {
      let elapsed = 0;
      progressInterval = setInterval(() => {
        elapsed += 1;
        const elapsedStr = elapsed.toFixed(1) + 's';
        process.stdout.write(`\r  ${chalk.yellow('⏳')} ${chalk.gray('Working...')} ${chalk.white(elapsedStr)}  `);
      }, 1000);
    };
    
    const stopProgressIndicator = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
        process.stdout.write('\r' + ' '.repeat(40) + '\r'); // Clear the progress line
      }
    };
    
    // Start progress after 5 seconds
    const progressTimeout = setTimeout(startProgressIndicator, 5000);

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
      
      // Show completion message
      console.log(chalk.dim(`\n✨ Done in ${this.formatDuration(duration)}`));

      // Update state
      if (this.state?.stats) {
        this.state.stats.totalTasks++;
        this.state.stats.totalTokens += result.stats?.totalTokensUsed || 0;
        this.state.stats.totalCost += result.performance?.totalCost || 0;
      }
      this.history.push({
        type: 'agent',
        task,
        iterations: result.iterations,
        toolsUsed: result.stats.toolExecutions,
        timestamp: new Date().toISOString(),
        duration,
      });
      await this.saveState();

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

  async runAgentTaskWithContext(multimodalMsg) {
    const startTime = Date.now();
    this.taskStartTime = startTime;
    this.currentTask = multimodalMsg.content?.find(c => c.type === 'text')?.text || '[multimodal]';
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
    
    // Show separator before agent runs
    console.log(chalk.dim('──────────────────────'));
    
    this.session.agent.onIterationStart = () => { console.log(chalk.dim(`\n── ${this.session.agent.formatIterationLabel()} ──`)); };
    this.session.agent.onToolStart = (toolName, args) => { toolCallCount++; this.printEnhancedToolCallStart(toolName, args, toolCallCount, startTime); };
    this.session.agent.onToolEnd = (toolName, result) => { this.printEnhancedToolCallEnd(toolName, result, startTime, toolCallCount); };
    this.session.agent.onResponse = (content) => { if (!responsePrinted) { this.printAIResponse(this.deduplicateResponse(content)); responsePrinted = true; } };
    this.session.agent.onStatus = ({ type, message }) => { const f = type === 'compaction' ? chalk.cyan : type === 'retry' ? chalk.yellow : chalk.dim; console.log(f(`   ${message}`)); };
    try {
      this.session.agent.pushMessage(multimodalMsg);
      const result = await this.session.agent.run();
      const duration = Date.now() - startTime;
      if (result.response && !responsePrinted) { this.printAIResponse(this.deduplicateResponse(result.response)); responsePrinted = true; }
      this.printEnhancedTaskSummary(result, duration);
      
      // Show completion message
      console.log(chalk.dim(`\n✨ Done in ${this.formatDuration(duration)}`));
      
      if (this.state?.stats) { this.state.stats.totalTasks++; this.state.stats.totalTokens += result.stats?.totalTokensUsed || 0; this.state.stats.totalCost += result.performance?.totalCost || 0; }
      this.history.push({ type: 'agent', task: this.currentTask, iterations: result.iterations, toolsUsed: result.stats.toolExecutions, timestamp: new Date().toISOString(), duration });
      // Trim history to prevent unbounded growth
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(-this.maxHistorySize);
      }
      await this.saveState();
    } catch (error) {
      this.showSmartError('task_execution', { message: error.message, task: this.currentTask, suggestions: this.generateErrorSuggestions(error, this.currentTask) });
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
    let succeeded = false;

    if (this.streaming) {
      // Real-time streaming (raw text during stream; markdown rendered via printAIResponse for non-streaming)
      process.stdout.write(`\n${g.ai('🤖 AI')} `);

      try {
        const stream = this.session.agent.client.chatStream(
          this.session.agent.messages.concat([{ role: 'user', content: message }]),
          { model: this.session.agent.model }
        );

        let fullContent = '';
        let sawToolCalls = false;
        for await (const chunk of stream) {
          if (chunk.type === 'content') {
            fullContent += chunk.content;
          } else if (chunk.type === 'tool_calls') {
            sawToolCalls = true;
          } else if (chunk.type === 'done') {
            this.session.agent.updateUsageStats(chunk.usage);
          }
        }

        let displayContent = fullContent;
        if (displayContent && hasXmlToolCalls(displayContent)) {
          displayContent = parseXmlToolCalls(displayContent).cleanContent;
        }
        if (typeof displayContent !== 'string') {
          displayContent = displayContent == null ? '' : String(displayContent);
        }
        if (sawToolCalls && !displayContent.trim()) {
          displayContent = '[Model returned tool calls in chat mode; suppressed from regular chat output.]';
        }

        process.stdout.write(chalk.white(displayContent));
        console.log(''); // New line
        this.session.agent.pushMessage({ role: 'user', content: message });
        this.session.agent.pushMessage({ role: 'assistant', content: displayContent });
        succeeded = true;

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
        succeeded = true;
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error.message}`));
      }
    }

    const duration = Date.now() - startTime;
    if (succeeded) {
      this.history.push({
        type: 'chat',
        task: message,
        timestamp: new Date().toISOString(),
        duration,
      });
      // Trim history to prevent unbounded growth
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(-this.maxHistorySize);
      }
      await this.saveState();
    }
    console.log(chalk.dim(`  └─ ${duration}ms`));
  }

  // ═══════════════════════════════════════════════════════════════
  // 🎨 Visual Output Methods
  // ═══════════════════════════════════════════════════════════════

  printAIResponse(content) {
    if (!content) return;
    const rendered = this.isMarkdownEnabled() ? renderMarkdown(content) : content;
    console.log('');
    console.log(boxen(
      `${g.ai('🤖 AI')}\n\n${rendered}`,
      box.response
    ));
  }

  /**
   * Show thinking spinner during LLM response time
   */
  showThinkingSpinner() {
    const frames = ['🤔', '🤔.', '🤔..', '🤔...'];
    let frame = 0;
    const interval = setInterval(() => {
      process.stdout.write(`\r${chalk.gray(frames[frame])} `);
      frame = (frame + 1) % frames.length;
    }, 300);
    
    return {
      stop: () => {
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(10) + '\r');
      }
    };
  }

  /**
   * Show AI responding indicator
   */
  showRespondingIndicator() {
    const indicator = chalk.cyan('💬 ') + chalk.gray('AI responding...');
    process.stdout.write(indicator + ' ');
    
    return {
      clear: () => {
        process.stdout.write('\r' + ' '.repeat(indicator.length + 5) + '\r');
      }
    };
  }

  /**
   * Check if markdown rendering is enabled in preferences
   */
  isMarkdownEnabled() {
    return this.state?.preferences?.renderMarkdown !== false;
  }

  printEnhancedToolCallStart(toolName, args, count, taskStartTime) {
    const elapsed = Date.now() - taskStartTime;
    const elapsedStr = this.formatDuration(elapsed);
    const t = this.theme;
    
    // Detect subagent tools and use minimal output for them
    const isSubagentTool = toolName.startsWith('delegate_') || toolName === 'subagent_status';
    
    if (isSubagentTool) {
      console.log('');
      console.log(`${chalk.hex(t.tool)('⚡')} ${chalk.hex(t.tool).bold(toolName)} ${chalk.dim(`[${elapsedStr}]`)}`);
      return;
    }

    // Spinner frame for active tool
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const frame = spinnerFrames[count % spinnerFrames.length];
    
    // Regular tools get compact, clean output with theme colors
    const argPreview = this.formatToolArgs(toolName, args);

    // Enhanced display for specific tool types
    let extraInfo = '';
    if (toolName === 'edit_file' && args) {
      const findPreview = args.find ? args.find.substring(0, 60) : '';
      const replacePreview = args.replace ? args.replace.substring(0, 60) : '';
      if (findPreview) {
        extraInfo = `\n  ${chalk.dim('├─')} ${chalk.red('- ' + findPreview)}${chalk.dim(' → ')}${chalk.green('+ ' + replacePreview)}`;
      }
    } else if (toolName === 'exec' && args?.command) {
      extraInfo = `\n  ${chalk.dim('├─')} ${chalk.hex(t.muted)('$ ' + args.command.substring(0, 80))}`;
    } else if (toolName === 'read_file' && args?.path) {
      extraInfo = `\n  ${chalk.dim('├─')} ${chalk.hex(t.muted)(args.path)}`;
    }

    process.stdout.write(`  ${chalk.hex(t.tool)(frame)} ${chalk.hex(t.tool)(toolName)} ${argPreview}${chalk.dim(` [${elapsedStr}]`)}${extraInfo}`);
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
    const { name: command, args: argStr } = parseCommand(cmd);

    switch (command) {
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
        if (argStr) {
          // Direct model switch: /model <model-id> — validate model exists first
          const modelInfo = this.modelBrowser?.getModel(argStr);
          if (!modelInfo) {
            console.log(chalk.yellow(`⚠ Model not found: ${argStr}`));
            console.log(chalk.gray('  Use /model (no args) to browse available models.'));
          } else {
            const synced = this.syncSessionModelState(argStr);
            await this.modelBrowser.addRecent(argStr);
            console.log(chalk.green(`✓ Model: ${chalk.cyan(argStr)} ${chalk.gray(`(${this.formatCompactNumber(synced.contextLength || 0)} ctx)`)}`));
          }
        } else {
          await this.changeModel();
        }
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

      case 'render':
        if (!this.state.preferences) this.state.preferences = {};
        this.state.preferences.renderMarkdown = !this.isMarkdownEnabled();
        await this.saveState();
        console.log(chalk.green(`✓ Markdown rendering ${this.state.preferences.renderMarkdown ? 'enabled' : 'disabled'}`));
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

      case 'cost':
        this.showCost();
        break;

      case 'context':
        this.showContext();
        break;

      case 'session':
        await this.handleSessionCommand(argStr);
        break;

      case 'undo':
        await this.handleUndo();
        break;

      case 'diff':
        await this.handleDiff();
        break;

      case 'export':
        await this.handleExport();
        break;

      case 'paste':
        await this.handlePaste();
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
        const { useRecent } = await promptWithTerminalReset([{
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

  /**
   * Handle model change - shows model card when switching
   */
  async changeModel() {
    const modelId = await this.modelBrowser.pickModel({
      currentModel: this.session.agent.model,
    });

    if (modelId) {
      // Show model switch card
      const synced = this.syncSessionModelState(modelId);
      await this.modelBrowser.addRecent(modelId);
      
      // Get model info for display
      const modelInfo = this.modelBrowser.getModel(modelId);
      const contextLength = synced?.contextLength || modelInfo?.contextLength || 0;
      const inputCost = modelInfo?.inputPrice || 0;
      const outputCost = modelInfo?.outputPrice || 0;
      
      console.log(boxen(
        `${chalk.green('✓ Model switched')}\n\n` +
        `${chalk.bold('🔄 Switched to:')} ${chalk.cyan(modelId.split('/').pop())}\n` +
        `${chalk.gray('Context:')} ${this.formatCompactNumber(contextLength)}\n` +
        `${chalk.gray('Pricing:')} $${inputCost.toFixed(2)}/M input · $${outputCost.toFixed(2)}/M output`,
        { ...box.success, title: '🤖 Model', titleAlignment: 'center' }
      ));
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

    const entries = this.history.slice(-10).reverse();
    let totalDuration = 0;
    let totalTools = 0;
    let agentCount = 0;
    let chatCount = 0;
    
    const content = entries.map((entry, index) => {
      // Track totals
      totalDuration += entry.duration || 0;
      totalTools += entry.toolsUsed || 0;
      if (entry.type === 'agent') agentCount++;
      if (entry.type === 'chat') chatCount++;
      
      // Icon by type
      const typeIcon = entry.type === 'agent' ? '🤖' : entry.type === 'chat' ? '💬' : '📁';
      const typeColor = entry.type === 'agent' ? chalk.cyan : entry.type === 'chat' ? chalk.magenta : chalk.yellow;
      
      // Duration color coding
      let durationColor;
      const duration = entry.duration || 0;
      if (duration < 5000) {
        durationColor = chalk.green; // Fast - green
      } else if (duration < 30000) {
        durationColor = chalk.yellow; // Medium - yellow
      } else {
        durationColor = chalk.red; // Slow - red
      }
      
      // Format duration
      const durationStr = durationColor(this.formatDuration(duration));
      
      // Relative timestamp
      const timestamp = entry.timestamp ? this.getRelativeTime(new Date(entry.timestamp)) : '';
      
      // Build summary line
      const summaryParts = [];
      if (entry.iterations !== undefined) summaryParts.push(`${entry.iterations} iter`);
      if (entry.toolsUsed !== undefined) summaryParts.push(`${entry.toolsUsed} tools`);
      summaryParts.push(durationStr);
      if (timestamp) summaryParts.push(timestamp);
      
      const summary = summaryParts.join(chalk.dim(' • '));
      
      return `${chalk.gray(`${index + 1}.`)} ${typeIcon} ${typeColor(entry.type)}: ${this.truncateInline(entry.task || '', 60)}\n   ${chalk.dim(summary)}`;
    }).join('\n\n');
    
    // Summary at bottom
    const summaryContent = [
      `${chalk.bold('Summary:')}`,
      `  ${chalk.cyan('🤖 Agent tasks:')} ${agentCount}`,
      `  ${chalk.magenta('💬 Chat messages:')} ${chatCount}`,
      `  ${chalk.white('⏱️ Total time:')} ${this.formatDuration(totalDuration)}`,
      `  ${chalk.yellow('🔧 Total tools:')} ${totalTools}`,
    ].join('\n');

    console.log(boxen(
      content + '\n\n' + chalk.dim('─'.repeat(40)) + '\n\n' + summaryContent,
      { ...box.info, title: '📜 History' }
    ));
  }
  
  /**
   * Get relative time string (e.g., "2m ago", "1h ago")
   */
  getRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    
    return date.toLocaleDateString();
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

    const { sessionId } = await promptWithTerminalReset([{
      type: 'list',
      name: 'sessionId',
      message: 'Load session:',
      choices,
    }]);

    const loaded = await AgentSession.load(sessionId, undefined, {
      workingDir: this.workingDir,
      permissions: this.permissions,
      allowFullAccess: this.allowFullAccess,
    });
    if (loaded) {
      this.session = loaded;
      this.syncSessionModelState(this.session.agent.model);
      console.log(chalk.green(`✓ Loaded ${sessionId}`));
      console.log(chalk.gray(`  Model: ${chalk.cyan(this.session.agent.model)}`));
      console.log(chalk.gray(`  Project memory: ${chalk.cyan(this.getProjectMemoryLabel())}`));
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
    
    const { template } = await promptWithTerminalReset([{
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
      `\n\n${chalk.dim('Choose whether to run it now or cancel.')}`,
      { ...box.info, title: '📋 Template' }
    ));

    const { shouldRun } = await promptWithTerminalReset([{
      type: 'confirm',
      name: 'shouldRun',
      message: `Run ${tmpl.name} now?`,
      default: true,
    }]);

    if (!shouldRun) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }

    // Run the template prompt as an agent task
    await this.runAgentTask(tmpl.prompt);
  }

  showHelp() {
    console.log(boxen(
      `${chalk.bold('Commands')}\n\n` +
      `${this.formatCommandList([...COMMAND_ENTRIES.slice(0, -1), ['/reset', 'Alias for /new'], COMMAND_ENTRIES.at(-1)])}\n\n` +
      `${chalk.bold('Aliases')}\n\n` +
      `${SHORTCUT_ENTRIES.map((entry) => {
        const [alias, target] = entry.split('=');
        return `${chalk.cyan(alias)}=${target}`;
      }).join(' ')}\n\n` +
      `${chalk.bold('Input')}\n\n` +
      `${chalk.gray(this.getInputShortcutSummary())}\n\n` +
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
   * Show context usage statistics
   */
  showContext() {
    const contextStats = this.session.agent.getContextStats();
    
    // Get tokens from client stats
    const clientStats = this.session.agent.client.getStats();
    
    const contextColor = contextStats.percent > 70 ? chalk.red : 
                         contextStats.percent > 40 ? chalk.yellow : chalk.green;
    
    console.log(boxen(
      `${chalk.bold('Context Usage')}\n\n` +
      `${chalk.cyan('Used Tokens:')} ${this.formatCompactNumber(contextStats.usedTokens)} / ${this.formatCompactNumber(contextStats.maxTokens)}\n` +
      `${chalk.cyan('Usage:')} ${contextColor(contextStats.percent + '%')}\n` +
      `${chalk.cyan('Compactions:')} ${contextStats.compactions}\n` +
      `${chalk.cyan('Last Prompt:')} ${this.formatCompactNumber(contextStats.lastPromptTokens)} tokens\n` +
      `${chalk.cyan('Last Completion:')} ${this.formatCompactNumber(contextStats.lastCompletionTokens)} tokens\n` +
      `${chalk.cyan('Total Messages:')} ${this.session.agent.messages.length}\n` +
      `${chalk.cyan('History Items:')} ${this.session.agent.history.length}`,
      { ...box.stats, title: '📊 Context' }
    ));
  }

  /**
   * Handle session subcommands: save, restore, list
   */
  async handleSessionCommand(args) {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const subArgs = parts.slice(1).join(' ');
    
    switch (subcommand) {
      case 'save':
      case '':
        // /session save [name]
        await this.sessionSaveWithName(subArgs);
        break;
        
      case 'restore':
        // /session restore <id>
        if (!subArgs) {
          console.log(chalk.gray('Usage: /session restore <checkpoint-id>'));
          console.log(chalk.gray('Use /session list to see available checkpoints'));
        } else {
          await this.sessionRestoreCheckpoint(subArgs);
        }
        break;
        
      case 'list':
        // /session list
        await this.sessionListCheckpoints();
        break;
        
      default:
        console.log(chalk.gray('Usage: /session <save|restore|list>'));
        console.log(chalk.gray('  save [name]    - Save current session'));
        console.log(chalk.gray('  restore <id>   - Restore a checkpoint'));
        console.log(chalk.gray('  list           - List available checkpoints'));
    }
  }

  /**
   * Save session with optional name
   */
  async sessionSaveWithName(name) {
    const label = name || `manual_${Date.now()}`;
    const checkpointId = this.session.createCheckpoint(label);
    console.log(chalk.green(`✓ Checkpoint created: ${chalk.cyan(checkpointId)}`));
    
    // Also save full session
    await this.session.save();
    console.log(chalk.green(`✓ Session saved`));
  }

  /**
   * Restore a session checkpoint
   */
  async sessionRestoreCheckpoint(checkpointId) {
    const result = this.session.restoreCheckpoint(checkpointId);
    if (result.success) {
      console.log(chalk.green(`✓ Restored checkpoint: ${chalk.cyan(result.label)}`));
      console.log(chalk.gray(`  Messages: ${result.messageCount}, History: ${result.historyCount}`));
    } else {
      console.log(chalk.red(`✗ ${result.error}`));
    }
  }

  /**
   * List session checkpoints
   */
  async sessionListCheckpoints() {
    const checkpoints = this.session.listCheckpoints();
    
    if (checkpoints.length === 0) {
      console.log(chalk.gray('No checkpoints found'));
      return;
    }
    
    console.log(chalk.bold('\n📋 Session Checkpoints\n'));
    for (const cp of checkpoints) {
      const date = new Date(cp.timestamp).toLocaleString();
      console.log(`  ${chalk.cyan(cp.id)}`);
      console.log(`    ${chalk.gray('Label:')} ${cp.label} ${chalk.gray('|')} ${chalk.gray(date)}`);
      console.log(`    ${chalk.gray('Messages:')} ${cp.messages} ${chalk.gray('|')} ${chalk.gray('Iterations:')} ${cp.iterations}`);
      console.log('');
    }
  }
  
  /**
   * Undo last file change by restoring a .bak file
   */
  async handleUndo() {
    const bakFiles = await this.findBakFiles();
    
    if (bakFiles.length === 0) {
      console.log(chalk.gray('No .bak files found in the working directory'));
      return;
    }
    
    const choices = bakFiles.map(f => ({
      name: `${chalk.cyan(f.relative)} ${chalk.dim(`(${new Date(f.mtime).toLocaleString()})`)}`,
      value: f.path,
    }));
    choices.push({ name: chalk.gray('Cancel'), value: null });
    
    const { selected } = await promptWithTerminalReset([{
      type: 'list',
      name: 'selected',
      message: 'Select a backup to restore:',
      choices,
    }]);
    
    if (!selected) return;
    
    const originalPath = selected.replace(/\.bak$/, '');
    try {
      await fs.copy(selected, originalPath);
      await fs.remove(selected);
      console.log(chalk.green(`✓ Restored ${path.relative(this.workingDir, originalPath)}`));
    } catch (error) {
      console.log(chalk.red(`✗ Restore failed: ${error.message}`));
    }
  }
  
  /**
   * Find all .bak files in the working directory recursively
   */
  async findBakFiles() {
    const results = [];
    const walk = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            await walk(fullPath);
          } else if (entry.name.endsWith('.bak')) {
            const stat = await fs.stat(fullPath);
            results.push({
              path: fullPath,
              relative: path.relative(this.workingDir, fullPath),
              mtime: stat.mtime,
            });
          }
        }
      } catch {}
    };
    await walk(this.workingDir);
    return results.sort((a, b) => b.mtime - a.mtime);
  }
  
  /**
   * Show line-by-line diffs for .bak files vs current
   */
  async handleDiff() {
    const bakFiles = await this.findBakFiles();
    
    if (bakFiles.length === 0) {
      console.log(chalk.gray('No .bak files found'));
      return;
    }
    
    for (const bak of bakFiles) {
      const originalPath = bak.path.replace(/\.bak$/, '');
      let backupContent, currentContent;
      
      try {
        backupContent = await fs.readFile(bak.path, 'utf-8');
      } catch {
        continue;
      }
      
      try {
        currentContent = await fs.readFile(originalPath, 'utf-8');
      } catch {
        currentContent = '';
      }
      
      if (backupContent === currentContent) {
        console.log(chalk.gray(`  ${bak.relative}: no changes`));
        continue;
      }
      
      const backupLines = backupContent.split('\n');
      const currentLines = currentContent.split('\n');
      const maxLines = Math.max(backupLines.length, currentLines.length);
      
      console.log('');
      console.log(chalk.cyan(`📄 ${bak.relative}`));
      console.log(chalk.dim(`   Backup: ${backupLines.length} lines │ Current: ${currentLines.length} lines`));
      
      let diffCount = 0;
      for (let i = 0; i < maxLines && diffCount < 20; i++) {
        const backupLine = backupLines[i];
        const currentLine = currentLines[i];
        
        if (backupLine === undefined) {
          console.log(chalk.green(`   + ${i + 1}: ${currentLine}`));
          diffCount++;
        } else if (currentLine === undefined) {
          console.log(chalk.red(`   - ${i + 1}: ${backupLine}`));
          diffCount++;
        } else if (backupLine !== currentLine) {
          console.log(chalk.red(`   - ${i + 1}: ${backupLine}`));
          console.log(chalk.green(`   + ${i + 1}: ${currentLine}`));
          diffCount++;
        }
      }
      
      if (diffCount >= 20) {
        console.log(chalk.dim(`   ... and more differences`));
      }
    }
  }
  
  /**
   * Export conversation as markdown to .openagent/exports/
   */
  async handleExport() {
    const messages = this.session?.agent?.messages || [];
    
    if (messages.length === 0) {
      console.log(chalk.gray('No conversation to export'));
      return;
    }
    
    const exportDir = path.join(this.workingDir, '.openagent', 'exports');
    await fs.ensureDir(exportDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `conversation-${timestamp}.md`;
    const exportPath = path.join(exportDir, filename);
    
    let markdown = `# OpenAgent Conversation Export\n\n`;
    markdown += `**Date:** ${new Date().toLocaleString()}\n`;
    markdown += `**Model:** ${this.session?.agent?.model || 'unknown'}\n`;
    markdown += `**Messages:** ${messages.length}\n\n`;
    markdown += `---\n\n`;
    
    for (const msg of messages) {
      const role = msg.role === 'user' ? '👤 User' : msg.role === 'assistant' ? '🤖 Assistant' : `⚙️ ${msg.role}`;
      markdown += `## ${role}\n\n`;
      
      if (typeof msg.content === 'string') {
        markdown += `${msg.content}\n\n`;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            markdown += `${part.text}\n\n`;
          } else if (part.type === 'tool_use') {
            markdown += `**Tool Call:** \`${part.name}\`\n\n`;
            markdown += `\`\`\`json\n${JSON.stringify(part.input, null, 2)}\n\`\`\`\n\n`;
          } else if (part.type === 'tool_result') {
            markdown += `**Tool Result:**\n\n`;
            markdown += `\`\`\`\n${typeof part.content === 'string' ? part.content : JSON.stringify(part.content, null, 2)}\n\`\`\`\n\n`;
          }
        }
      }
      
      markdown += `---\n\n`;
    }
    
    await fs.writeFile(exportPath, markdown);
    console.log(chalk.green(`✓ Exported ${messages.length} messages to ${path.relative(this.workingDir, exportPath)}`));
  }
  
  /**
   * Reset session
   */
  async resetSession() {
    const { confirm } = await promptWithTerminalReset([{
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
        this.history = this.state.history || [];

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
      this.state.history = this.history.slice(-50); // Keep last 50 entries
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

  /**
   * Show smart error with suggestions
   */
  showSmartError(errorType, details = {}) {
    const { message, suggestions = [], httpStatus, errorData, context } = details;
    
    // Determine error category
    const errorCategory = this.categorizeError(errorType, message, errorData);
    
    // Build error content based on category
    let content = '';
    let title = '❌ Error';
    let fixSuggestions = suggestions.length > 0 ? suggestions : errorCategory.suggestions;
    
    // Header with error type and status
    if (httpStatus) {
      title += ` ${chalk.yellow('⚠')} ${chalk.white(httpStatus)}`;
    } else if (errorCategory.statusCode) {
      title += ` ${chalk.yellow('⚠')} ${chalk.white(errorCategory.statusCode)}`;
    }
    
    content += `${title}\n\n`;
    content += `${chalk.white(message || 'An error occurred')}\n`;
    
    // Fix suggestions section
    if (fixSuggestions.length > 0) {
      content += `\n${chalk.bold('🔧 Fix:')}\n`;
      for (let i = 0; i < fixSuggestions.length; i++) {
        content += `${chalk.green(`${i + 1}.`)} ${fixSuggestions[i]}\n`;
      }
    }
    
    // Error details section (for API errors, etc.)
    if (errorData) {
      const detailsStr = typeof errorData === 'string' ? errorData : JSON.stringify(errorData, null, 2);
      const truncatedDetails = detailsStr.length > 500 ? detailsStr.substring(0, 500) + '...' : detailsStr;
      content += `\n${chalk.bold('🔍 Details:')}\n`;
      content += chalk.gray(truncatedDetails);
    }
    
    // Context hint
    if (context) {
      content += `\n\n${chalk.dim('Context: ' + context)}`;
    }
    
    console.log(boxen(content, box.error));
    
    // Check for command typos and suggest corrections
    if (errorCategory.commandHint) {
      console.log(chalk.dim(`\n💡 ${errorCategory.commandHint}`));
    }
  }

  /**
   * Categorize error and provide appropriate suggestions
   */
  categorizeError(errorType, message, errorData) {
    const msg = (message || '').toLowerCase();
    const dataStr = typeof errorData === 'string' ? errorData : JSON.stringify(errorData || {}).toLowerCase();
    const combinedMsg = msg + ' ' + dataStr;
    
    // Common command typos
    const commandTypos = {
      '/hel': '/help',
      '/hlp': '/help',
      '/hep': '/help',
      '/hel p': '/help',
      '/exi': '/exit',
      '/exot': '/exit',
      '/qui': '/quit',
      '/qit': '/quit',
      '/stat': '/stats',
      '/satats': '/stats',
      '/modle': '/model',
      '/modle': '/model',
      '/histroy': '/history',
      '/histoy': '/history',
      '/histry': '/history',
    };
    
    // Check for command typos in the message
    for (const [typo, correct] of Object.entries(commandTypos)) {
      if (msg.includes(typo)) {
        return {
          statusCode: null,
          suggestions: [],
          commandHint: `Did you mean ${chalk.cyan(correct)}?`,
        };
      }
    }
    
    // API errors (401, 403, 429, 500, etc.)
    if (combinedMsg.includes('api key') || combinedMsg.includes('unauthorized') || 
        combinedMsg.includes('401') || combinedMsg.includes('403') || combinedMsg.includes('invalid key')) {
      return {
        statusCode: combinedMsg.includes('401') ? '401' : combinedMsg.includes('403') ? '403' : null,
        suggestions: [
          'Check OPENROUTER_API_KEY in your .env file',
          'Get a new key → https://openrouter.ai/keys',
          'Run /doctor to diagnose',
        ],
      };
    }
    
    // Rate limit errors
    if (combinedMsg.includes('rate limit') || combinedMsg.includes('429') || combinedMsg.includes('too many requests')) {
      return {
        statusCode: '429',
        suggestions: [
          'Wait a moment and try again',
          'Consider using a different model',
          'Check your API quota at https://openrouter.ai/accounts',
        ],
      };
    }
    
    // Network errors
    if (combinedMsg.includes('network') || combinedMsg.includes('fetch') || 
        combinedMsg.includes('econnrefused') || combinedMsg.includes('timeout') || combinedMsg.includes('enotfound')) {
      return {
        statusCode: null,
        suggestions: [
          'Check your internet connection',
          'Verify the API endpoint is accessible',
          'Try again in a few seconds',
        ],
      };
    }
    
    // File errors
    if (combinedMsg.includes('enoent') || combinedMsg.includes('eacces') || 
        combinedMsg.includes('permission') || combinedMsg.includes('not found') || combinedMsg.includes('no such file')) {
      const pathMatch = dataStr.match(/"path":\s*"([^"]+)"/) || msg.match(/([A-Za-z]:\\[^\s]+|\/[^\s]+\/[^\s]+)/);
      const filePath = pathMatch ? pathMatch[1] : 'the file';
      
      return {
        statusCode: null,
        suggestions: [
          `Check that ${chalk.cyan(filePath)} exists`,
          'Verify file permissions',
          'Use absolute paths instead of relative paths',
        ],
      };
    }
    
    // Agent errors (iteration limits, tool limits)
    if (combinedMsg.includes('iteration') || combinedMsg.includes('max iterations') || 
        combinedMsg.includes('tool call') || combinedMsg.includes('max tools')) {
      return {
        statusCode: null,
        suggestions: [
          'Break your task into smaller steps',
          'Use /clear to reset the conversation',
          'Try a simpler request first',
        ],
      };
    }
    
    // Context/token errors
    if (combinedMsg.includes('context') || combinedMsg.includes('token') || combinedMsg.includes('max tokens')) {
      return {
        statusCode: null,
        suggestions: [
          'Use /clear to reset conversation context',
          'Try a model with larger context window',
          'Break long conversations into shorter ones',
        ],
      };
    }
    
    // Server errors
    if (combinedMsg.includes('500') || combinedMsg.includes('502') || combinedMsg.includes('503') ||
        combinedMsg.includes('internal error') || combinedMsg.includes('server error')) {
      return {
        statusCode: '5xx',
        suggestions: [
          'This is a server-side issue, not your fault',
          'Wait a moment and try again',
          'Check https://status.openrouter.ai for outages',
        ],
      };
    }
    
    // Default fallback
    return {
      statusCode: null,
      suggestions: [
        'Try /doctor to check your environment',
        'Use /clear and try again',
        'Check the error details above',
      ],
    };
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
   * Enhanced tool call end with timing and rich result display
   */
  printEnhancedToolCallEnd(toolName, result, taskStartTime, count) {
    const t = this.theme;
    // Subagent tools handle their own output via SubagentManager UI
    const isSubagentTool = toolName.startsWith('delegate_') || toolName === 'subagent_status';
    const resultData = result.result || result;
    if (isSubagentTool) {
      if (resultData?.partial) {
        const successful = resultData.summary?.successful ?? 0;
        const total = resultData.summary?.total ?? 0;
        console.log(chalk.hex(t.warning)(`  ⚠ ${toolName}: partial success (${successful}/${total} tasks)`));
      } else if (result.success !== false) {
        const taskCount = resultData?.summary?.total || resultData?.stats?.total || '';
        const info = taskCount ? ` (${taskCount} tasks)` : '';
        console.log(chalk.hex(t.success)(`  ✓ ${toolName} done${info}`));
      } else {
        console.log(chalk.hex(t.error)(`  ✗ ${toolName}: ${result.error || result.result?.error || 'failed'}`));
      }
      return;
    }
    
    const elapsed = Date.now() - taskStartTime;
    const elapsedStr = this.formatDuration(elapsed);
    
    if (result.success !== false) {
      console.log(chalk.hex(t.success)(`    ✓`) + chalk.dim(` ${elapsedStr}`));
      
      // Show rich result previews based on tool type
      switch (toolName) {
        case 'read_file': {
          const content = resultData?.content || '';
          const lines = content.split('\n');
          const lineCount = lines.length;
          const sizeStr = content.length > 1024
            ? `${(content.length / 1024).toFixed(1)}KB`
            : `${content.length}B`;
          // Cache file content for inline diffs on future writes/edits
          const cachePath = resultData?.path || resultData?.file;
          if (cachePath && content) {
            this.fileContentCache.set(cachePath, content);
          }
          if (lineCount > 0) {
            console.log(chalk.hex(t.muted)(`    ├─ ${lineCount} lines · ${sizeStr}`));
            const preview = lines.slice(0, 3).join('\n');
            if (preview) {
              console.log(chalk.hex(t.muted)(`    └─ ${preview.split('\n').slice(0, 2).join('\n    │ ')}`));
              if (lineCount > 3) {
                console.log(chalk.hex(t.muted)(`    │ ${chalk.gray('...')} ${lineCount - 3} more lines`));
              }
            }
          }
          break;
        }
        
        case 'write_file':
        case 'edit_file': {
          const filePath = resultData?.path || resultData?.file || 'unknown';
          const linesWritten = resultData?.linesWritten || resultData?.linesModified || 0;
          const linesDeleted = resultData?.linesDeleted || 0;
          let changeInfo = '';
          if (linesWritten > 0 || linesDeleted > 0) {
            const addPart = linesWritten > 0 ? chalk.hex(t.success)('+' + linesWritten) : '';
            const delPart = linesDeleted > 0 ? chalk.hex(t.error)(' -' + linesDeleted) : '';
            changeInfo = ` (${addPart}${delPart})`;
          }
          console.log(chalk.hex(t.muted)(`    └─ ${filePath}${changeInfo}`));

          // Show inline diff if we have cached content
          const cachedContent = this.fileContentCache.get(filePath);
          const newContent = resultData?.content;
          if (cachedContent !== undefined && newContent !== undefined) {
            try {
              const themeObj = {
                accent: (s) => chalk.hex(t.accent)(s),
                muted: (s) => chalk.hex(t.muted)(s),
                error: (s) => chalk.hex(t.error)(s),
                success: (s) => chalk.hex(t.success)(s),
              };
              const diffOutput = renderDiff(cachedContent, newContent, filePath, themeObj);
              console.log(diffOutput);
              // Update cache with new content
              this.fileContentCache.set(filePath, newContent);
            } catch {}
          } else if (newContent !== undefined) {
            // No cached before-image — just show line count
            const lineCount = newContent.split('\n').length;
            console.log(chalk.hex(t.muted)(`    │ ${lineCount} lines`));
            this.fileContentCache.set(filePath, newContent);
          }
          break;
        }
        
        case 'exec':
        case 'shell_exec': {
          const exitCode = resultData?.exitCode ?? 0;
          const exitStr = exitCode === 0
            ? chalk.hex(t.success)(`exit:${exitCode}`)
            : chalk.hex(t.error)(`exit:${exitCode}`);
          if (resultData?.stdout && resultData.stdout.length > 0) {
            const firstLine = resultData.stdout.split('\n')[0].substring(0, 80);
            console.log(chalk.hex(t.muted)(`    ├─ ${exitStr}`));
            console.log(chalk.hex(t.muted)(`    └─ ${firstLine}`));
          } else {
            console.log(chalk.hex(t.muted)(`    └─ ${exitStr}`));
          }
          break;
        }
        
        case 'web_search': {
          const results = resultData?.results || [];
          const cnt = results.length;
          if (cnt > 0) {
            console.log(chalk.hex(t.muted)(`    ├─ ${cnt} result${cnt === 1 ? '' : 's'}`));
            results.slice(0, 3).forEach((r, i) => {
              const title = r.title ? r.title.substring(0, 60) : 'No title';
              console.log(chalk.hex(t.muted)(`    │ ${i + 1}. ${title}`));
            });
            if (cnt > 3) {
              console.log(chalk.hex(t.muted)(`    │ ${chalk.gray('...')} ${cnt - 3} more`));
            }
          }
          break;
        }
        
        case 'git_status': {
          const status = resultData?.status || {};
          const files = Object.keys(status).length;
          if (files > 0) {
            console.log(chalk.hex(t.muted)(`    ├─ ${files} file${files === 1 ? '' : 's'} changed`));
            const staged = status.filter?.length || 0;
            const modified = status.modified?.length || 0;
            const untracked = status.untracked?.length || 0;
            console.log(chalk.hex(t.muted)(`    └─ ${staged ? ' +' + staged : ''}${modified ? ' ~' + modified : ''}${untracked ? ' ?' + untracked : ''}`));
          } else {
            console.log(chalk.hex(t.muted)(`    └─ working tree clean`));
          }
          break;
        }
        
        case 'git_log': {
          const commits = resultData?.commits || [];
          if (commits.length > 0) {
            console.log(chalk.hex(t.muted)(`    ├─ ${commits.length} commits`));
            commits.slice(0, 3).forEach((c) => {
              const msg = c.message ? c.message.substring(0, 50) : 'No message';
              console.log(chalk.hex(t.muted)(`    │ ${chalk.hex(t.accent)(c.hash?.substring(0, 7) || '???????')} ${msg}`));
            });
          }
          break;
        }
        
        case 'list_directory': {
          const entries = resultData?.entries || resultData?.files || [];
          const fileCount = entries.length;
          if (fileCount > 0) {
            console.log(chalk.hex(t.muted)(`    ├─ ${fileCount} item${fileCount === 1 ? '' : 's'}`));
            entries.slice(0, 3).map(e => typeof e === 'string' ? e : e.name).forEach(e => {
              console.log(chalk.hex(t.muted)(`    │ ${e}`));
            });
            if (fileCount > 3) {
              console.log(chalk.hex(t.muted)(`    │ ${chalk.gray('...')} ${fileCount - 3} more`));
            }
          }
          break;
        }
        
        case 'read_webpage': {
          const preview = [
            resultData.title ? this.truncateInline(resultData.title, 90) : null,
            resultData.status ? `HTTP ${resultData.status}` : null,
          ].filter(Boolean).join(' • ');
          if (preview) {
            console.log(chalk.hex(t.muted)(`    └─ ${preview}`));
          }
          break;
        }
        
        case 'fetch_url': {
          const preview = [
            resultData.status ? `HTTP ${resultData.status}` : null,
            resultData.statusText || null,
          ].filter(Boolean).join(' ');
          if (preview) {
            console.log(chalk.hex(t.muted)(`    └─ ${preview}`));
          }
          break;
        }
        
        default: {
          // Generic fallback for other tools
          if (resultData?.stdout && resultData.stdout.length > 0) {
            const preview = resultData.stdout.substring(0, 120).replace(/\n/g, ' ');
            console.log(chalk.hex(t.muted)(`    └─ ${preview}${resultData.stdout.length > 120 ? '...' : ''}`));
          }
          break;
        }
      }
    } else {
      const statusSummary = resultData?.status ? `HTTP ${resultData.status}` : null;
      const errorMsg = result.error || result.result?.error || statusSummary || 'Unknown error';
      const truncated = errorMsg.substring(0, 200);
      console.log(chalk.hex(t.error)(`    ✗ ${truncated}`));
    }
  }

  /**
   * Print session stats inline (triggered by Ctrl+P)
   */
  printSessionStats() {
    if (!this.session?.agent) {
      console.log(chalk.gray('  No active session'));
      return;
    }
    const stats = this.session.agent.getStats();
    const contextStats = this.session.agent.getContextStats();
    const clientStats = this.session.agent.client.getStats();
    const elapsedMs = Date.now() - this.sessionStartTime;
    const elapsedStr = this.formatElapsedTime(elapsedMs);
    const t = this.theme;

    console.log('');
    console.log(chalk.hex(t.header)(`  ══ Session Stats ══`));
    console.log(`  ${chalk.hex(t.text)('Tokens:')}   ${chalk.white(stats.totalTokensUsed.toLocaleString())}`);
    console.log(`  ${chalk.hex(t.text)('Context:')}   ${chalk.white(contextStats.usedTokens.toLocaleString())}/${chalk.white(contextStats.maxTokens.toLocaleString())} (${contextStats.percent}%)`);
    console.log(`  ${chalk.hex(t.text)('Cost:')}      ${chalk.yellow('$' + (clientStats.totalCost || 0).toFixed(4))}`);
    console.log(`  ${chalk.hex(t.text)('Tools:')}     ${chalk.white(stats.toolExecutions)} calls`);
    console.log(`  ${chalk.hex(t.text)('Iterations:')} ${chalk.white(stats.iterations)}`);
    console.log(`  ${chalk.hex(t.text)('Time:')}      ${chalk.white(elapsedStr)}`);
    console.log(`  ${chalk.hex(t.text)('Messages:')}  ${chalk.white(stats.totalMessages)}`);
    console.log(`  ${chalk.hex(t.text)('Theme:')}     ${chalk.hex(t.accent)(t.name)}`);
    console.log('');
  }

  /**
   * Enhanced task summary with better formatting - Visual card style
   */
  printEnhancedTaskSummary(result, duration) {
    const seconds = (duration / 1000).toFixed(1);
    const modelId = this.session.agent.model;
    const modelShort = modelId.split('/').pop();
    this.syncSessionModelState(modelId);
    const contextStats = this.session.agent.getContextStats();
    const contextUsed = contextStats.usedTokens;
    const contextMax = contextStats.maxTokens;
    const contextPct = contextStats.percent;
    const t = this.theme;
    const contextColor = contextPct > 70 ? chalk.hex(t.error) : contextPct > 40 ? chalk.hex(t.warning) : chalk.hex(t.success);

    const formatCtx = (n) => {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
      return n.toString();
    };

    // Get tool usage breakdown
    const toolUsage = {};
    if (result.stats?.toolExecutionsByName) {
      Object.entries(result.stats.toolExecutionsByName).forEach(([tool, count]) => {
        toolUsage[tool] = count;
      });
    }

    // Build the summary card
    const dividerLine = chalk.dim('━'.repeat(50));
    
    console.log('');
    console.log(dividerLine);
    console.log(chalk.hex(t.success)('  ✅ Task complete'));
    console.log('');
    
    // Model and context info
    console.log(`  ${chalk.hex(t.tool)('🤖')} ${chalk.white(modelShort)} • ${contextColor(`${formatCtx(contextUsed)}/${formatCtx(contextMax)} ctx (${contextPct}%)`)}`);
    console.log(`  ${chalk.hex(t.tool)('⏱')} ${chalk.white(seconds + 's')} • ${chalk.white(result.iterations + ' iter')} • ${chalk.white(result.stats.toolExecutions + ' tool calls')}`);
    
    // Tools used breakdown
    if (Object.keys(toolUsage).length > 0) {
      console.log('');
      console.log(`  ${chalk.hex(t.tool)('🔧 Tools used:')}`);
      const toolParts = Object.entries(toolUsage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([tool, cnt]) => `${tool} ×${cnt}`);
      console.log(`    ${toolParts.join('  ')}`);
    }
    
    // Performance metrics
    if (result.performance) {
      const avgIteration = result.iterations > 0 ? (duration / result.iterations / 1000).toFixed(1) + 's' : 'N/A';
      const retries = result.performance.totalRetries || 0;
      console.log('');
      console.log(`  ${chalk.hex(t.accent)('📊 Performance:')}`);
      console.log(`    ${chalk.hex(t.muted)('Avg iteration:')} ${chalk.white(avgIteration)} • ${chalk.hex(t.muted)('Retries:')} ${retries > 0 ? chalk.hex(t.warning)(retries) : chalk.hex(t.success)('0')}`);
    }
    
    console.log(dividerLine);
  }
}

export async function runCLI(options = {}) {
  const cli = new CLI({
    workingDir: process.cwd(),
    autoSave: true,
    ...options,
  });

  // Set up signal handlers for graceful shutdown
  const signalHandler = async (signal) => {
    console.log(chalk.yellow(`\n⚠ Received ${signal}. Cleaning up...`));
    await cli.gracefulShutdown();
    process.exit(0);
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  await cli.start();
}

const __filename = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

// Resolve symlinks so npm link / global installs work correctly
let resolvedFilename = __filename;
let resolvedArgv = argvPath;
try {
  if (fs.existsSync(__filename)) resolvedFilename = fs.realpathSync(__filename);
} catch {}
try {
  if (argvPath && fs.existsSync(argvPath)) resolvedArgv = fs.realpathSync(argvPath);
} catch {}
// Check for --ui flag or 'ui' command
const args = process.argv.slice(2);
const useUI = args.includes('--ui') || args.includes('ui');
const allowFullAccess = args.includes('--full-access') || process.env.OPENAGENT_FULL_ACCESS === 'true';
const permissions = { allowFileDelete: true, allowFullAccess };
const modelIndex = args.indexOf('--model');
const model = modelIndex !== -1 && args[modelIndex + 1] ? args[modelIndex + 1] : undefined;
const themeIndex = args.indexOf('--theme');
const theme = themeIndex !== -1 && args[themeIndex + 1] ? args[themeIndex + 1] : undefined;

if (useUI) {
  // Start Ink UI
  startInkUI({ model, theme, allowFullAccess, permissions }).catch((error) => {
    console.error('Fatal error starting Ink UI:', error.message);
    process.exit(1);
  });
} else if (resolvedArgv && resolvedFilename === resolvedArgv) {
  // Start traditional CLI
  runCLI({ allowFullAccess, permissions }).catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}

export default CLI;
