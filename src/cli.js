/**
 * 💻 OpenAgent CLI v3.0
 * Beautiful interactive terminal with real-time streaming & tool visualization
 * 
 * New features:
 * - Enhanced progress indicators
 * - Cost tracking display
 * - Session statistics
 * - Command aliases
 * - Auto-save sessions
 * - Better error handling
 */

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import gradient from 'gradient-string';
import inquirer from 'inquirer';
import { AgentSession } from './agent/AgentSession.js';
import { CONFIG } from './config.js';
import { ModelBrowser } from './ModelBrowser.js';

const VERSION = '3.0.0';

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
    
    // Command aliases
    this.aliases = {
      'q': 'exit',
      'quit': 'exit',
      'c': 'chat',
      'a': 'agent',
      'm': 'model',
      's': 'stats',
      'h': 'help',
      't': 'tools',
      'cl': 'clear',
      'st': 'stream',
      'v': 'verbose',
    };
  }

  async start() {
    console.clear();
    this.printBanner();

    if (!CONFIG.API_KEY) {
      console.log(boxen(
        `${chalk.red('❌ No API Key Found')}\n\n` +
        `${chalk.gray('Set your OpenRouter API key in .env:')}\n` +
        `${chalk.cyan('  OPENROUTER_API_KEY=your_key_here')}\n\n` +
        `${chalk.gray('Get your key at:')} ${chalk.underline('https://openrouter.ai/keys')}`,
        box.error
      ));
      process.exit(1);
    }

    console.log(chalk.green('✓ API Key configured'));
    console.log(chalk.gray(`  Working directory: ${this.workingDir}`));

    const spinner = ora({ text: chalk.gray('Initializing session...'), spinner: 'dots', color: 'cyan' }).start();
    
    try {
      this.session = new AgentSession({
        workingDir: this.workingDir,
        model: CONFIG.DEFAULT_MODEL,
        verbose: this.verbose,
        streaming: this.streaming,
      });
      spinner.succeed(chalk.green('Session initialized'));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to initialize session: ${error.message}`));
      process.exit(1);
    }

    // Initialize model browser
    this.modelBrowser = new ModelBrowser(this.session.agent.client);
    const modelSpinner = ora({ text: chalk.gray('Loading models from OpenRouter...'), spinner: 'dots', color: 'cyan' }).start();
    try {
      await this.modelBrowser.init();
      modelSpinner.succeed(chalk.green(`Loaded ${this.modelBrowser.models.length} models`));
    } catch (e) {
      modelSpinner.warn(chalk.yellow('Could not load models, using defaults'));
    }

    console.log(chalk.gray(`  Model: ${chalk.cyan(this.session.agent.model)}`));

    // Start auto-save timer
    if (this.autoSave) {
      this.startAutoSave();
    }

    console.log(boxen(
      `${chalk.bold('Commands:')}\n\n` +
      `${chalk.cyan('/agent <task>')}  ${chalk.gray('- Run agentic task (with tools)')}\n` +
      `${chalk.cyan('/chat <msg>')}   ${chalk.gray('- Simple chat (no tools)')}\n` +
      `${chalk.cyan('/model')}        ${chalk.gray('- Change AI model')}\n` +
      `${chalk.cyan('/stream')}       ${chalk.gray('- Toggle streaming')}\n` +
      `${chalk.cyan('/verbose')}      ${chalk.gray('- Toggle verbose mode')}\n` +
      `${chalk.cyan('/tools')}        ${chalk.gray('- List available tools')}\n` +
      `${chalk.cyan('/agents')}       ${chalk.gray('- Show subagent status')}\n` +
      `${chalk.cyan('/stats')}        ${chalk.gray('- Show statistics')}\n` +
      `${chalk.cyan('/clear')}        ${chalk.gray('- Clear conversation')}\n` +
      `${chalk.cyan('/save')}         ${chalk.gray('- Save session')}\n` +
      `${chalk.cyan('/load')}         ${chalk.gray('- Load session')}\n` +
      `${chalk.cyan('/history')}      ${chalk.gray('- Show command history')}\n` +
      `${chalk.cyan('/paste')}        ${chalk.gray('- Paste large text')}\n` +
      `${chalk.cyan('/cost')}         ${chalk.gray('- Show cost breakdown')}\n` +
      `${chalk.cyan('/help')}         ${chalk.gray('- Show all commands')}\n` +
      `${chalk.cyan('/exit')}         ${chalk.gray('- Exit')}\n\n` +
      `${chalk.dim('Shortcuts:')} ${chalk.gray('q=exit, c=chat, a=agent, m=model, s=stats, h=help')}\n` +
      `${chalk.dim('Tip: Just type a message to run as an agentic task')}`,
      { ...box.default, title: '🤖 OpenAgent', titleAlignment: 'center' }
    ));

    await this.mainLoop();
  }
  
  /**
   * Start auto-save timer
   */
  startAutoSave() {
    setInterval(async () => {
      if (Date.now() - this.lastSaveTime > this.autoSaveInterval) {
        try {
          await this.session.save();
          this.lastSaveTime = Date.now();
          if (this.verbose) {
            console.log(chalk.dim('\n💾 Auto-saved session'));
          }
        } catch (error) {
          // Silently fail auto-save
        }
      }
    }, this.autoSaveInterval);
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
      
      // Show context usage in prompt
      const contextPct = this.getContextUsage();
      const contextColor = contextPct > 70 ? chalk.red : contextPct > 40 ? chalk.yellow : chalk.green;
      const prompt = `${chalk.cyan('❯')} ${contextColor(`[${contextPct}%]`)}`;
      
      const { input } = await inquirer.prompt([{
        type: 'input',
        name: 'input',
        message: prompt,
        prefix: '',
      }]);

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

    this.printGoodbye();
  }
  
  /**
   * Get current context usage percentage
   */
  getContextUsage() {
    if (!this.session?.agent) return 0;
    const estimated = this.session.agent.estimateTokens();
    const max = this.session.agent.maxContextTokens;
    return Math.min(100, Math.round((estimated / max) * 100));
  }

  // ═══════════════════════════════════════════════════════════════
  // 🤖 Agent Task with Real-Time Tool Visualization
  // ═══════════════════════════════════════════════════════════════

  async runAgentTask(task) {
    const startTime = Date.now();
    let toolCallCount = 0;
    let iterationCount = 0;

    // Set up visual callbacks
    this.session.agent.onToolStart = (toolName, args) => {
      toolCallCount++;
      this.printToolCallStart(toolName, args, toolCallCount);
    };

    this.session.agent.onToolEnd = (toolName, result) => {
      this.printToolCallEnd(toolName, result);
    };

    this.session.agent.onResponse = (content) => {
      this.printAIResponse(content);
    };

    try {
      const result = await this.session.run(task);
      const duration = Date.now() - startTime;

      // If no onResponse callback fired, print the response
      if (result.response && !this.session.agent.onResponse) {
        this.printAIResponse(result.response);
      }

      // Print summary stats
      this.printTaskSummary(result, duration);

      this.history.push({
        type: 'agent',
        task,
        iterations: result.iterations,
        toolsUsed: result.stats.toolExecutions,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      console.log(boxen(
        `${chalk.red('✗ Error')}\n\n${error.message}`,
        box.error
      ));
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
            if (chunk.usage) {
              this.session.agent.totalTokensUsed += chunk.usage.total_tokens || 0;
            }
          }
        }

        console.log(''); // New line
        this.session.agent.messages.push({ role: 'user', content: message });
        this.session.agent.messages.push({ role: 'assistant', content: fullContent });

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

        if (result.usage) {
          this.session.agent.totalTokensUsed += result.usage.total_tokens || 0;
        }
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

  printToolCallStart(toolName, args, count) {
    console.log('');
    console.log(`${g.tool('🔧 TOOL')} ${chalk.yellow.bold(toolName)} ${chalk.dim(`(#${count})`)}`);

    if (args && Object.keys(args).length > 0) {
      const argLines = Object.entries(args)
        .map(([key, value]) => {
          const displayValue = typeof value === 'string' && value.length > 60
            ? value.substring(0, 57) + '...'
            : JSON.stringify(value);
          return `  ${chalk.gray(key)}: ${chalk.white(displayValue)}`;
        })
        .join('\n');
      console.log(argLines);
    }
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
    const contextUsed = this.session.agent.estimateTokens();
    const contextMax = this.modelBrowser?.getContextLength(modelId) || 128000;
    const contextPct = Math.min(100, Math.round((contextUsed / contextMax) * 100));
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
      contextColor(`${formatCtx(contextUsed)}/${formatCtx(contextMax)} ctx (${contextPct}%)`) + chalk.dim(' • ') +
      chalk.white(`${result.iterations} iter`) + chalk.dim(' • ') +
      chalk.white(`${result.stats.toolExecutions} tools`) + chalk.dim(' • ') +
      chalk.white(`${seconds}s`) +
      chalk.dim(' ──'));
    
    // Show performance metrics if available
    if (result.performance && result.performance.totalRetries > 0) {
      console.log(chalk.dim(`  └─ ${result.performance.totalRetries} retries`));
    }
  }

  printGoodbye() {
    console.log(`
${g.title('╔═══════════════════════════════════════════════════════════════╗')}
${g.title('║')}                                                               ${g.title('║')}
${g.title('║')}   ${g.success('👋 Session Complete')}                                         ${g.title('║')}
${g.title('║')}                                                               ${g.title('║')}
${g.title('╚═══════════════════════════════════════════════════════════════╝')}
`);
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
        if (this.autoSave) {
          try {
            await this.session.save();
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
        console.log(chalk.green(`✓ Streaming ${this.streaming ? 'enabled' : 'disabled'}`));
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

      case 'reset':
        this.resetSession();
        break;

      case 'help':
        this.showHelp();
        break;

      default:
        console.log(chalk.yellow(`⚠ Unknown: /${command}. Type /help`));
    }

    return true;
  }

  async changeModel() {
    const modelId = await this.modelBrowser.pickModel({
      currentModel: this.session.agent.model,
    });

    if (modelId) {
      this.session.agent.model = modelId;
      await this.modelBrowser.addRecent(modelId);
      console.log(chalk.green(`✓ Model: ${chalk.cyan(modelId)}`));
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
    const toolStats = this.session.toolRegistry.getStats();
    const subagentStats = this.session.subagentManager?.getStats() || {};

    let content = `${chalk.bold('Session')}\n\n` +
      `${chalk.cyan('Messages:')} ${stats.totalMessages}\n` +
      `${chalk.cyan('Iterations:')} ${stats.iterations}\n` +
      `${chalk.cyan('Tokens:')} ${stats.totalTokensUsed.toLocaleString()}\n` +
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

    let content = `${chalk.bold('Subagent System')}\n\n` +
      `${chalk.cyan('Max Concurrent:')} ${subagentManager.maxConcurrent}\n` +
      `${chalk.cyan('Total Tasks:')} ${stats.totalTasks}\n` +
      `${chalk.cyan('Running:')} ${stats.runningTasks}\n` +
      `${chalk.cyan('Pending:')} ${stats.pendingTasks}\n` +
      `${chalk.cyan('Completed:')} ${stats.completedTasks}\n` +
      `${chalk.cyan('Failed:')} ${stats.failedTasks}\n` +
      `${chalk.cyan('Success Rate:')} ${stats.successRate}\n` +
      `${chalk.cyan('Avg Duration:')} ${stats.avgDuration}`;

    if (tasks.length > 0) {
      content += `\n\n${chalk.bold('Recent Tasks')}\n`;
      const recentTasks = tasks.slice(-5);
      for (const task of recentTasks) {
        const stateIcon = {
          pending: chalk.yellow('⏳'),
          running: chalk.cyan('🔄'),
          completed: chalk.green('✓'),
          failed: chalk.red('✗'),
          cancelled: chalk.gray('⊘'),
        }[task.state] || '?';

        content += `\n${stateIcon} ${chalk.white(task.specialization)}: ${task.task}`;
        if (task.duration > 0) {
          content += chalk.dim(` (${(task.duration / 1000).toFixed(1)}s)`);
        }
      }
    }

    content += `\n\n${chalk.bold('Available Specializations')}\n`;
    for (const spec of specializations) {
      content += `\n${chalk.cyan(spec.id)}: ${spec.name} - ${chalk.gray(spec.description)}`;
    }

    console.log(boxen(content, { ...box.info, title: '🤝 Subagents' }));
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
      console.log(chalk.green(`✓ Saved to ${result.path}`));
    } else {
      console.log(chalk.red('✗ Save failed'));
    }
  }

  async loadSession() {
    const sessions = await AgentSession.listSessions();

    if (sessions.length === 0) {
      console.log(chalk.gray('No saved sessions'));
      return;
    }

    const choices = sessions.map(s => ({
      name: `${s.sessionId} (${new Date(s.updated).toLocaleString()})`,
      value: s.sessionId,
    }));

    const { sessionId } = await inquirer.prompt([{
      type: 'list',
      name: 'sessionId',
      message: 'Load session:',
      choices,
    }]);

    const loaded = await AgentSession.load(sessionId);
    if (loaded) {
      this.session = loaded;
      console.log(chalk.green(`✓ Loaded ${sessionId}`));
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

  showHelp() {
    console.log(boxen(
      `${chalk.bold('Commands')}\n\n` +
      `${chalk.cyan('/agent <task>')}  - Run agentic task (with tools)\n` +
      `${chalk.cyan('/chat <msg>')}   - Simple chat (no tools)\n` +
      `${chalk.cyan('/model')}        - Change AI model\n` +
      `${chalk.cyan('/stream')}       - Toggle streaming\n` +
      `${chalk.cyan('/verbose')}      - Toggle verbose mode\n` +
      `${chalk.cyan('/tools')}        - List available tools\n` +
      `${chalk.cyan('/agents')}       - Show subagent status\n` +
      `${chalk.cyan('/stats')}        - Show statistics\n` +
      `${chalk.cyan('/cost')}         - Show cost breakdown\n` +
      `${chalk.cyan('/clear')}        - Clear conversation\n` +
      `${chalk.cyan('/save')}         - Save session\n` +
      `${chalk.cyan('/load')}         - Load session\n` +
      `${chalk.cyan('/history')}      - Show command history\n` +
      `${chalk.cyan('/paste')}        - Paste large text\n` +
      `${chalk.cyan('/reset')}        - Reset session\n` +
      `${chalk.cyan('/help')}         - Show this help\n` +
      `${chalk.cyan('/exit')}         - Exit\n\n` +
      `${chalk.bold('Aliases')}\n\n` +
      `${chalk.cyan('q')}=exit ${chalk.cyan('c')}=chat ${chalk.cyan('a')}=agent ${chalk.cyan('m')}=model ${chalk.cyan('s')}=stats ${chalk.cyan('h')}=help\n\n` +
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
      `${chalk.cyan('Total Cost:')} $${clientStats.estimatedTotalCost}\n` +
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
      message: 'Reset session? This will clear all conversation history.',
      default: false,
    }]);
    
    if (confirm) {
      this.session.agent.clear();
      this.session.agent.client.clearHistory();
      this.taskCount = 0;
      console.log(chalk.green('✓ Session reset'));
    }
  }
}

export default CLI;
