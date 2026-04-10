#!/usr/bin/env node
/**
 * 💻 OpenAgent CLI v0.1.20
 * Interactive terminal with real-time streaming & tool visualization
 *
 * Architecture:
 *   cli.js (orchestrator) → delegates to:
 *     cli/constants.js   — templates, commands, health checks
 *     cli/formatting.js  — number/text/duration formatting
 *     cli/display.js     — all visual output & panels
 *     cli/sessionOps.js  — save/load/export/undo/diff
 *     cli/stateOps.js    — persistent local state
 *     cli/errorUtils.js  — error categorization & suggestions
 */

import chalk from 'chalk';
import { parseXmlToolCalls, hasXmlToolCalls } from './tools/xmlToolParser.js';
import ora from 'ora';
import boxen from 'boxen';
import gradient from 'gradient-string';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
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
import { getTheme, nextTheme } from './cli/themes.js';
import { VERSION } from './cli/state.js';

// ── Extracted modules ──────────────────────────────────────────
import {
  WORKFLOW_TEMPLATES,
  HEALTH_CHECKS,
} from './cli/constants.js';

import {
  formatCompactNumber,
  formatDuration,
  formatElapsedTime,
  shortenModelLabel,
  deduplicateResponse,
} from './cli/formatting.js';

import {
  formatCommandList,
  getShortcutSummary,
  getInputShortcutSummary,
  printAIResponse,
  printEnhancedToolCallStart,
  printEnhancedToolCallEnd,
  printEnhancedTaskSummary,
  printSessionStats,
  printGoodbye,
  showTools,
  showStats,
  showAgents,
  showHistory,
  showHelp,
  showCost,
  showContext,
  getWorkspaceLabel,
} from './cli/display.js';

import {
  saveSession,
  loadSession,
  handleSessionCommand,
  handleUndo,
  handleDiff,
  handleExport,
  resetSession,
  runShellCommand,
} from './cli/sessionOps.js';

import { loadState, saveState } from './cli/stateOps.js';
import { handleSkillsCommand, handleShellSkillsCommand } from './cli/skills-handler.js';

import {
  showSmartError,
  generateErrorSuggestions,
} from './cli/errorUtils.js';

// ═══════════════════════════════════════════════════════════════════
// 🎨 Aliases
// ═══════════════════════════════════════════════════════════════════

const g = gradients;
const box = boxStyles;

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
    this.allowFullAccess = options.allowFullAccess === true || options.permissions?.allowFullAccess === true;
    this.permissions = {
      allowFileDelete: true,
      ...options.permissions,
      allowFullAccess: this.allowFullAccess,
    };
    this.history = [];
    this.mode = 'agent';

    this.maxHistorySize = 100;

    // Session tracking
    this.sessionStartTime = Date.now();
    this.totalCost = 0;
    this.totalTokens = 0;
    this.taskCount = 0;

    // Auto-save settings
    this.autoSave = options.autoSave !== false;
    this.autoSaveInterval = options.autoSaveInterval || 5 * 60 * 1000;
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

  // ── Lifecycle ────────────────────────────────────────────────

  async start() {
    console.clear();
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

    // Initialize model browser
    this.modelBrowser = new ModelBrowser();
    const modelSpinner = ora({ text: chalk.gray('Loading models from OpenRouter...'), spinner: 'dots', color: 'cyan' }).start();
    try {
      await this.modelBrowser.init();
      const sourceSuffix = this.modelBrowser.lastLoadSource === 'cache' || this.modelBrowser.lastLoadSource === 'stale-cache'
        ? ' from cache' : '';
      modelSpinner.succeed(chalk.green(`Loaded ${this.modelBrowser.models.length} models${sourceSuffix}`));
    } catch (e) {
      modelSpinner.fail(chalk.red(`Failed to load models: ${e.message}`));
      console.log(chalk.yellow('⚠️ Cannot continue without models. Check your API key and internet connection.'));
      process.exit(1);
    }

    // First-run onboarding
    if (this.state.firstRun) {
      await runOnboarding(this.state, () => this.saveState(), this.modelBrowser);
    }

    const selectedModel = await this.selectModel();
    const spinner = ora({ text: chalk.gray('Initializing session...'), spinner: 'dots', color: 'cyan' }).start();
    try {
      this.createSession({ modelId: selectedModel });
      spinner.succeed(chalk.green('Session initialized'));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to initialize session: ${error.message}`));
      process.exit(1);
    }

    // Session info
    const modelInfo = this.modelBrowser.getModel(selectedModel);
    const contextLength = modelInfo?.contextLength || CONFIG.MAX_CONTEXT_TOKENS;
    const toolCount = this.session.toolRegistry?.list()?.length || 0;

    console.log(boxen(
      `${chalk.bold('🚀 OpenAgent')} ${chalk.gray(`v${VERSION}`)}\n\n` +
      `${chalk.bold('Model:')} ${chalk.cyan(this.session.agent.model)}\n` +
      `${chalk.bold('Context:')} ${formatCompactNumber(contextLength)}\n` +
      `${chalk.bold('Tools:')} ${toolCount} available\n` +
      `${chalk.bold('Dir:')} ${chalk.gray(this.workingDir)}`,
      { ...box.info, title: '📋 Session Info', titleAlignment: 'center' }
    ));

    // Installation directory warning
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

    if (this.autoSave) this.startAutoSave();

    console.log(boxen(
      `${chalk.bold('Commands:')}\n\n` +
      `${formatCommandList()}\n\n` +
      `${chalk.dim('Shortcuts:')} ${chalk.gray(getShortcutSummary())}\n` +
      `${chalk.dim('Input:')} ${chalk.gray(getInputShortcutSummary())}\n` +
      `${chalk.dim('Tip: Just type a message to run as an agentic task')}`,
      { ...box.default, title: '🤖 OpenAgent', titleAlignment: 'center' }
    ));

    await this.mainLoop();
  }

  // ── Main Loop ────────────────────────────────────────────────

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

      if (input === MultilineInput.CANCEL) break;

      if (input === MultilineInput.CLEAR_SCREEN) { console.clear(); continue; }
      if (input === MultilineInput.CYCLE_THEME) {
        this.currentTheme = nextTheme(this.currentTheme);
        this.theme = getTheme(this.currentTheme);
        console.log(chalk.hex(this.theme.accent)(`🎨 Theme: ${this.theme.name}`));
        continue;
      }
      if (input === MultilineInput.SHOW_STATS) {
        printSessionStats(this);
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
          } catch { /* skip unreadable dropped files */ }
        }
        const contextText = formatDroppedContent(dropResults);
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

      const command = trimmed.startsWith('/') ? resolveCommand(trimmed) : trimmed;

      if (command.startsWith('/')) {
        const shouldContinue = await this.handleCommand(command);
        if (!shouldContinue) break;
        continue;
      }

      if (command.startsWith('!')) {
        await runShellCommand(this, command.slice(1));
        continue;
      }

      this.taskCount++;
      await this.runAgentTask(trimmed);
    }

    await printGoodbye(this);
  }

  // ── Paste Mode ───────────────────────────────────────────────

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
        if (line.trim() === 'END') { rl.close(); resolve(); }
        else { lines.push(line); }
      });
    });

    const pastedText = lines.join('\n');
    if (!pastedText.trim()) { console.log(chalk.gray('No content provided.')); return; }

    const charCount = pastedText.length;
    const lineCount = lines.length;

    console.log(chalk.yellow(`\n📋 Content captured (${lineCount} lines, ${charCount.toLocaleString()} chars):`));
    console.log(chalk.dim('─'.repeat(60)));
    for (const line of lines.slice(0, 10)) { console.log(chalk.gray(line)); }
    if (lines.length > 10) { console.log(chalk.dim(`... (${lines.length - 10} more lines)`)); }
    console.log(chalk.dim('─'.repeat(60)));

    const { action } = await promptWithTerminalReset([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '✓ Send this content', value: 'send' },
        { name: '✗ Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') { console.log(chalk.gray('Cancelled.')); return; }

    console.log(chalk.green('✓ Sending content...'));
    this.taskCount++;
    await this.runAgentTask(pastedText);
  }

  // ── Auto-Save ────────────────────────────────────────────────

  startAutoSave() {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(async () => {
      if (!this.session || this.sessionSaveInFlight) return;
      if (Date.now() - this.lastSaveTime < this.autoSaveInterval) return;
      try {
        this.sessionSaveInFlight = this.session.save();
        await this.sessionSaveInFlight;
        this.lastSaveTime = Date.now();
        if (this.verbose && !this.promptActive) {
          console.log(chalk.dim('\n💾 Auto-saved session'));
        }
      } catch { /* auto-save failure is non-fatal */ } finally {
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

  // ── Banner & Status ──────────────────────────────────────────

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

  buildPromptStatusLine() {
    if (!this.session?.agent) return chalk.dim('─ ready');

    const context = this.session.agent.getContextStats();

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

    const stats = this.session.agent.getStats();
    const clientStats = this.session.agent.client.getStats();
    const costStr = clientStats.totalCost > 0
      ? chalk.yellow(`$${clientStats.totalCost.toFixed(2)}`)
      : chalk.dim('$0.00');

    const elapsedMs = Date.now() - this.sessionStartTime;
    const elapsedStr = formatElapsedTime(elapsedMs);

    const toolCount = stats.toolExecutions || 0;
    const toolStr = toolCount > 0 ? chalk.white(`${toolCount} tools`) : chalk.dim('0 tools');

    const dirParts = this.workingDir.replace(/\\/g, '/').split('/');
    const shortDir = dirParts.length > 2 ? '…/' + dirParts.slice(-2).join('/') : this.workingDir;

    const segments = [
      `${chalk.dim('🤖')} ${chalk.cyan(shortenModelLabel(this.session.agent.model))}`,
      `${chalk.dim('[')}${contextBar}${chalk.dim(']')} ${contextColor(context.percent + '%')}`,
      costStr,
      toolStr,
      `${chalk.dim(elapsedStr)}`,
      `${chalk.gray(shortDir)}`,
    ];

    const workspaceLabel = getWorkspaceLabel(this);
    if (workspaceLabel !== 'none') {
      segments.splice(5, 0, `${chalk.dim('ws')} ${chalk.gray(workspaceLabel)}`);
    }

    return `${chalk.dim('─ ')}${segments.join(chalk.dim(' │ '))}`;
  }

  // ── Session Management ───────────────────────────────────────

  getContextUsage() {
    if (!this.session?.agent) return 0;
    return this.session.agent.getContextStats().percent;
  }

  syncSessionModelState(modelId = this.session?.agent?.model) {
    if (!this.session?.agent || !modelId) return null;
    this.session.model = modelId;
    this.session.agent.model = modelId;
    const model = this.modelBrowser?.getModel(modelId) || null;
    const contextLength = this.modelBrowser?.getContextLength(modelId) || CONFIG.MAX_CONTEXT_TOKENS;
    const maxOutput = model?.maxOutput || CONFIG.DEFAULT_PARAMS.max_tokens;
    this.session.agent.setMaxContextTokens(contextLength);
    this.session.agent.setMaxOutputTokens(maxOutput);
    return { model, contextLength };
  }

  createSession({
    modelId = this.session?.agent?.model || this.session?.model,
    sessionId,
    activeWorkspace = null,
    openAgentDir = this.session?.workspaceManager?.openAgentDir,
    saveDir = this.session?.saveDir,
    taskDir = this.session?.taskManager?.taskDir,
  } = {}) {
    if (!modelId) throw new Error('Model must be selected before creating a session.');

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

  isMarkdownEnabled() {
    return this.state?.preferences?.renderMarkdown !== false;
  }

  getProjectMemoryLabel() {
    const memoryPath = this.session?.memoryManager?.paths?.projectMemory;
    if (!memoryPath) return 'openagent:memory/MEMORY.md';
    const relativePath = path.relative(this.workingDir, memoryPath);
    if (!relativePath || relativePath.startsWith('..')) return memoryPath;
    return relativePath;
  }

  // ── Agent Tasks ──────────────────────────────────────────────

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

    console.log(chalk.dim('──────────────────────'));

    this.session.agent.onIterationStart = (_iteration) => {
      const iterationLabel = this.session.agent.formatIterationLabel();
      console.log(chalk.dim(`\n── ${iterationLabel} ──`));
    };

    this.session.agent.onToolStart = (toolName, args) => {
      toolCallCount++;
      printEnhancedToolCallStart(this, toolName, args, toolCallCount, startTime);
    };

    this.session.agent.onToolEnd = (toolName, result) => {
      printEnhancedToolCallEnd(this, toolName, result, startTime, toolCallCount);
    };

    this.session.agent.onResponse = (content) => {
      if (!responsePrinted) {
        printAIResponse(this, deduplicateResponse(content));
        responsePrinted = true;
      }
    };

    this.session.agent.onStatus = ({ type, message }) => {
      const formatter = type === 'compaction' ? chalk.cyan : type === 'retry' ? chalk.yellow : chalk.dim;
      console.log(formatter(`   ${message}`));
    };

    // Progress indicator for long-running tasks
    let progressInterval = null;
    const startProgressIndicator = () => {
      let elapsed = 0;
      progressInterval = setInterval(() => {
        elapsed += 1;
        process.stdout.write(`\r  ${chalk.yellow('⏳')} ${chalk.gray('Working...')} ${chalk.white(elapsed.toFixed(1) + 's')}  `);
      }, 1000);
    };
    const stopProgressIndicator = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
      }
    };
    const progressTimeout = setTimeout(startProgressIndicator, 5000);

    try {
      const result = await this.session.run(task);
      const duration = Date.now() - startTime;

      if (result.response && !responsePrinted) {
        printAIResponse(this, deduplicateResponse(result.response));
        responsePrinted = true;
      }

      printEnhancedTaskSummary(this, result, duration);
      console.log(chalk.dim(`\n✨ Done in ${formatDuration(duration)}`));

      if (this.state?.stats) {
        this.state.stats.totalTasks++;
        this.state.stats.totalTokens += result.stats?.totalTokensUsed || 0;
        this.state.stats.totalCost += result.performance?.totalCost || 0;
      }
      this.history.push({
        type: 'agent', task,
        iterations: result.iterations,
        toolsUsed: result.stats.toolExecutions,
        timestamp: new Date().toISOString(),
        duration,
      });
      await this.saveState();

    } catch (error) {
      showSmartError('task_execution', {
        message: error.message,
        task,
        suggestions: generateErrorSuggestions(error, task),
        errorData: error.details || error.stack || null,
      });
    } finally {
      clearTimeout(progressTimeout);
      stopProgressIndicator();
      Object.assign(this.session.agent, previousCallbacks);
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

    console.log(chalk.dim('──────────────────────'));

    this.session.agent.onIterationStart = () => {
      console.log(chalk.dim(`\n── ${this.session.agent.formatIterationLabel()} ──`));
    };
    this.session.agent.onToolStart = (toolName, args) => {
      toolCallCount++;
      printEnhancedToolCallStart(this, toolName, args, toolCallCount, startTime);
    };
    this.session.agent.onToolEnd = (toolName, result) => {
      printEnhancedToolCallEnd(this, toolName, result, startTime, toolCallCount);
    };
    this.session.agent.onResponse = (content) => {
      if (!responsePrinted) {
        printAIResponse(this, deduplicateResponse(content));
        responsePrinted = true;
      }
    };
    this.session.agent.onStatus = ({ type, message }) => {
      const f = type === 'compaction' ? chalk.cyan : type === 'retry' ? chalk.yellow : chalk.dim;
      console.log(f(`   ${message}`));
    };

    try {
      this.session.agent.pushMessage(multimodalMsg);
      const result = await this.session.agent.run();
      const duration = Date.now() - startTime;

      if (result.response && !responsePrinted) {
        printAIResponse(this, deduplicateResponse(result.response));
        responsePrinted = true;
      }
      printEnhancedTaskSummary(this, result, duration);
      console.log(chalk.dim(`\n✨ Done in ${formatDuration(duration)}`));

      if (this.state?.stats) {
        this.state.stats.totalTasks++;
        this.state.stats.totalTokens += result.stats?.totalTokensUsed || 0;
        this.state.stats.totalCost += result.performance?.totalCost || 0;
      }
      this.history.push({
        type: 'agent', task: this.currentTask,
        iterations: result.iterations,
        toolsUsed: result.stats.toolExecutions,
        timestamp: new Date().toISOString(),
        duration,
      });
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(-this.maxHistorySize);
      }
      await this.saveState();
    } catch (error) {
      showSmartError('task_execution', {
        message: error.message,
        task: this.currentTask,
        suggestions: generateErrorSuggestions(error, this.currentTask),
        errorData: error.details || error.stack || null,
      });
    } finally {
      Object.assign(this.session.agent, previousCallbacks);
      this.currentTask = null;
      this.taskStartTime = null;
    }
  }

  // ── Simple Chat (No Tools) ───────────────────────────────────

  async runChat(message) {
    const startTime = Date.now();
    let succeeded = false;

    if (this.streaming) {
      process.stdout.write(`\n${g.ai('🤖 AI')} `);
      try {
        const stream = this.session.agent.client.chatStream(
          this.session.agent.messages.concat([{ role: 'user', content: message }]),
          { model: this.session.agent.model }
        );

        let fullContent = '';
        let sawToolCalls = false;
        for await (const chunk of stream) {
          if (chunk.type === 'content') { fullContent += chunk.content; }
          else if (chunk.type === 'tool_calls') { sawToolCalls = true; }
          else if (chunk.type === 'done') { this.session.agent.updateUsageStats(chunk.usage); }
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
        console.log('');
        this.session.agent.pushMessage({ role: 'user', content: message });
        this.session.agent.pushMessage({ role: 'assistant', content: displayContent });
        succeeded = true;
      } catch (error) {
        console.log(chalk.red(`\n✗ ${error.message}`));
      }
    } else {
      const spinner = ora({ text: chalk.gray('Thinking...'), spinner: 'dots', color: 'cyan' }).start();
      try {
        const result = await this.session.agent.chat(message);
        spinner.stop();
        printAIResponse(this, result.content);
        succeeded = true;
      } catch (error) {
        spinner.fail(chalk.red(`Error: ${error.message}`));
      }
    }

    const duration = Date.now() - startTime;
    if (succeeded) {
      this.history.push({ type: 'chat', task: message, timestamp: new Date().toISOString(), duration });
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(-this.maxHistorySize);
      }
      await this.saveState();
    }
    console.log(chalk.dim(`  └─ ${duration}ms`));
  }

  // ── Command Handler ──────────────────────────────────────────

  async handleCommand(cmd) {
    const { name: command, args: argStr } = parseCommand(cmd);

    switch (command) {
      case 'exit': case 'quit': case 'q':
        this.stopAutoSave();
        if (this.autoSave) {
          try { await this.session.save(); this.lastSaveTime = Date.now(); console.log(chalk.dim('💾 Session auto-saved')); } catch { /* save on exit is best-effort */ }
        }
        return false;

      case 'agent':
        if (argStr) { this.taskCount++; await this.runAgentTask(argStr); }
        else { console.log(chalk.gray('Usage: /agent <task>')); }
        break;

      case 'chat':
        if (argStr) { await this.runChat(argStr); }
        else { console.log(chalk.gray('Usage: /chat <message>')); }
        break;

      case 'model':
        if (argStr) {
          const modelInfo = this.modelBrowser?.getModel(argStr);
          if (!modelInfo) {
            console.log(chalk.yellow(`⚠ Model not found: ${argStr}`));
            console.log(chalk.gray('  Use /model (no args) to browse available models.'));
          } else {
            const synced = this.syncSessionModelState(argStr);
            await this.modelBrowser.addRecent(argStr);
            console.log(chalk.green(`✓ Model: ${chalk.cyan(argStr)} ${chalk.gray(`(${formatCompactNumber(synced.contextLength || 0)} ctx)`)}`));
          }
        } else { await this.changeModel(); }
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

      case 'tools': showTools(this); break;
      case 'stats': showStats(this); break;
      case 'agents': showAgents(this); break;
      case 'clear': this.session.agent.clear(); console.log(chalk.green('✓ Conversation cleared')); break;
      case 'new': case 'reset': await resetSession(this); break;
      case 'save': await saveSession(this); break;
      case 'load': await loadSession(this); break;
      case 'history': showHistory(this); break;
      case 'cost': showCost(this); break;
      case 'context': showContext(this); break;
      case 'session': await handleSessionCommand(this, argStr); break;
      case 'undo': await handleUndo(this); break;
      case 'diff': await handleDiff(this); break;
      case 'export': await handleExport(this); break;
      case 'paste': await this.handlePaste(); break;
      case 'doctor': await this.runDoctor(); break;
      case 'templates': await this.showTemplates(); break;
      case 'help': showHelp(this); break;
      case 'skills': await handleSkillsCommand(this.workingDir, argStr); break;
      default:
        console.log(chalk.yellow(`⚠ Unknown: /${command}. Type /help`));
    }

    return true;
  }

  // ── Model Selection ──────────────────────────────────────────

  async selectModel() {
    console.log('');

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
        if (useRecent) return recentModel;
      }
    }

    const modelId = await this.modelBrowser.pickModel();
    if (modelId) {
      await this.modelBrowser.addRecent(modelId);
      return modelId;
    }

    if (this.modelBrowser.models.length > 0) {
      const fallback = this.modelBrowser.models[0].id;
      console.log(chalk.yellow(`⚠️ No model selected, using: ${fallback}`));
      return fallback;
    }

    throw new Error('No models available. Check your API key and internet connection.');
  }

  async changeModel() {
    const modelId = await this.modelBrowser.pickModel({ currentModel: this.session.agent.model });
    if (modelId) {
      const synced = this.syncSessionModelState(modelId);
      await this.modelBrowser.addRecent(modelId);
      const modelInfo = this.modelBrowser.getModel(modelId);
      const contextLength = synced?.contextLength || modelInfo?.contextLength || 0;
      const inputCost = modelInfo?.inputPrice || 0;
      const outputCost = modelInfo?.outputPrice || 0;

      console.log(boxen(
        `${chalk.green('✓ Model switched')}\n\n` +
        `${chalk.bold('🔄 Switched to:')} ${chalk.cyan(modelId.split('/').pop())}\n` +
        `${chalk.gray('Context:')} ${formatCompactNumber(contextLength)}\n` +
        `${chalk.gray('Pricing:')} $${inputCost.toFixed(2)}/M input · $${outputCost.toFixed(2)}/M output`,
        { ...box.success, title: '🤖 Model', titleAlignment: 'center' }
      ));
    }
  }

  // ── Doctor & Templates ───────────────────────────────────────

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
        if (result.details) console.log(chalk.dim(`  └─ ${result.details}`));
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

  async showTemplates() {
    const choices = Object.entries(WORKFLOW_TEMPLATES).map(([key, tmpl]) => ({
      name: `${tmpl.name} - ${chalk.gray(tmpl.description)}`,
      value: key,
    }));
    choices.push({ name: chalk.gray('Cancel'), value: null });

    const { template } = await promptWithTerminalReset([{
      type: 'list', name: 'template',
      message: 'Select a workflow template:', choices,
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
      type: 'confirm', name: 'shouldRun',
      message: `Run ${tmpl.name} now?`, default: true,
    }]);

    if (!shouldRun) { console.log(chalk.gray('Cancelled.')); return; }
    await this.runAgentTask(tmpl.prompt);
  }

  async gracefulShutdown() {
    this.stopAutoSave();

    if (this.sessionSaveInFlight) {
      try {
        await this.sessionSaveInFlight;
      } catch {
        // Ignore pending auto-save failures during shutdown.
      } finally {
        this.sessionSaveInFlight = null;
      }
    }

    if (this.session) {
      try {
        await this.session.save();
      } catch {
        // Ignore best-effort save failures during shutdown.
      }

      try {
        await this.session.agent?.client?.close?.();
      } catch {
        // Ignore cleanup failures during shutdown.
      }
    }
  }

  // ── State Delegation ─────────────────────────────────────────

  async loadState() { await loadState(this); }
  async saveState() { await saveState(this); }
  showSmartError(errorType, details) { showSmartError(errorType, details); }
  generateErrorSuggestions(error, task) { return generateErrorSuggestions(error, task); }
  deduplicateResponse(content) { return deduplicateResponse(content); }
}

// ═══════════════════════════════════════════════════════════════════
// 🚀 Entry Point
// ═══════════════════════════════════════════════════════════════════

export async function runCLI(options = {}) {
  const cli = new CLI({
    workingDir: process.cwd(),
    autoSave: true,
    ...options,
  });

  const signalHandler = async (signal) => {
    console.log(chalk.yellow(`\n⚠ Received ${signal}. Cleaning up...`));
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    await cli.gracefulShutdown();
    process.exit(0);
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  try {
    await cli.start();
  } finally {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    await cli.gracefulShutdown();
  }
}

const __filename = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

let resolvedFilename = __filename;
let resolvedArgv = argvPath;
try { if (fs.existsSync(__filename)) resolvedFilename = fs.realpathSync(__filename); } catch { /* realpath may fail on broken symlinks */ }
try { if (argvPath && fs.existsSync(argvPath)) resolvedArgv = fs.realpathSync(argvPath); } catch { /* realpath may fail on broken symlinks */ }

const args = process.argv.slice(2);
const allowFullAccess = args.includes('--full-access') || process.env.OPENAGENT_FULL_ACCESS === 'true';
const permissions = { allowFileDelete: true, allowFullAccess };

if (resolvedArgv && resolvedFilename === resolvedArgv) {
  // Handle shell subcommands (e.g., openagent skills list)
  if (args[0] === 'skills') {
    handleShellSkillsCommand(process.cwd(), args.slice(1)).catch((error) => {
      console.error('Fatal error:', error.message);
      process.exit(1);
    });
  } else {
    runCLI({ allowFullAccess, permissions }).catch((error) => {
      console.error('Fatal error:', error.message);
      process.exit(1);
    });
  }
}

export default CLI;
