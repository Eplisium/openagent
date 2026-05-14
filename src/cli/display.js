/**
 * Display Module
 * All visual output: banners, tool call visualization, task summaries,
 * help panels, stats panels, and UI components.
 */

import chalk from '../utils/chalk-compat.js';
import { renderMarkdown } from './markdown.js';
import { COMMAND_ENTRIES, SHORTCUT_ENTRIES, INPUT_SHORTCUT_ENTRIES } from './constants.js';
import {
  formatCompactNumber,
  formatDuration,
  formatElapsedTime,
  truncateInline,
  shortenModelLabel,
  getRelativeTime
} from './formatting.js';
import { thinkingSpinner, respondingIndicator } from '../utils/spinners.js';
import { VERSION } from './state.js';

const TOOL_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function termWidth(max = 72) {
  return Math.min(process.stdout.columns || 80, max);
}

function divider(cli, label = '') {
  const t = cli?.theme || {};
  const line = '─'.repeat(termWidth());
  if (!label) return chalk.hex(t.muted || '#6c7086')(`  ${line}`);
  return chalk.hex(t.muted || '#6c7086')(`  ${label} ${'─'.repeat(Math.max(1, termWidth() - label.length - 1))}`);
}

function label(cli, text) {
  const t = cli?.theme || {};
  return chalk.hex(t.accent || '#89b4fa')(text);
}

function muted(cli, text) {
  const t = cli?.theme || {};
  return chalk.hex(t.muted || '#6c7086')(text);
}

function lineRows(text) {
  return String(text || '').split('\n');
}

function renderWithLeftBar(cli, content) {
  const t = cli.theme;
  const bar = chalk.hex(t.accent)('│');
  const body = lineRows(content).map(line => `  ${bar} ${line}`).join('\n');
  return body;
}

function getToolStore(cli) {
  if (!cli._toolLineStates) cli._toolLineStates = [];
  return cli._toolLineStates;
}

function clearInline(width = 120) {
  process.stdout.write('\r' + ' '.repeat(width) + '\r');
}

function visibleLen(str) {
  return String(str || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').length;
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 Banner & Status Line
// ═══════════════════════════════════════════════════════════════════

/**
 * Print the OpenAgent startup banner
 */
export function printBanner() {
  const t = { muted: '#6c7086' };
  console.log('');
  console.log(chalk.hex(t.muted)(`  openagent v${VERSION}`));
  console.log(chalk.hex(t.muted)(`  ${'─'.repeat(termWidth())}`));
}

/**
 * Format command list for display
 */
export function formatCommandList(entries = COMMAND_ENTRIES) {
  const commandWidth = entries.reduce((max, [command]) => Math.max(max, command.length), 0);
  return entries
    .map(([command, description]) =>
      `${chalk.cyan(command.padEnd(commandWidth + 2))}${chalk.gray(description)}`
    )
    .join('\n');
}

/**
 * Get shortcut summary string
 */
export function getShortcutSummary() {
  return SHORTCUT_ENTRIES.join('  ');
}

/**
 * Get input shortcut summary string
 */
export function getInputShortcutSummary() {
  return INPUT_SHORTCUT_ENTRIES.join('  •  ');
}

/**
 * Build the prompt status line showing model, context, etc.
 */
export function buildPromptStatusLine(cli) {
  const t = cli.theme;
  const parts = [];

  // Model name
  const modelShort = shortenModelLabel(cli.session?.agent?.model);
  parts.push(chalk.hex(t.accent)(modelShort));

  // Context usage
  if (cli.session?.agent) {
    const contextStats = cli.session.agent.getContextStats();
    const pct = contextStats.percent;
    const pctColor = pct > 70 ? chalk.hex(t.error) : pct > 40 ? chalk.hex(t.warning) : chalk.hex(t.success);
    parts.push(pctColor(`${pct}%`));
  }

  // Task count
  if (cli.taskCount > 0) {
    parts.push(chalk.hex(t.muted)(`${cli.taskCount} tasks`));
  }

  // Theme
  parts.push(chalk.hex(t.muted)(t.name));

  return parts.join(chalk.dim(' │ '));
}

// ═══════════════════════════════════════════════════════════════════
// 💬 AI Response & Spinners
// ═══════════════════════════════════════════════════════════════════

/**
 * Print AI response with a subtle left accent bar.
 */
export function printAIResponse(cli, content) {
  if (!content || !content.trim()) return false;
  if (cli._streamRenderer?.active) {
    cli._streamRenderer.finish(content);
    cli._streamRenderer = null;
    return true;
  }
  const rendered = cli.isMarkdownEnabled() ? renderMarkdown(content, cli.theme) : content;
  console.log('');
  console.log(renderWithLeftBar(cli, rendered));
  return true;
}

/**
 * Print intermediate model thinking (dimmed, compact)
 * Shown when the model produces text alongside tool calls or when
 * the no-action trap catches a response — keeps the user informed
 * without treating it as the final answer.
 */
export function printIntermediateContent(cli, content) {
  if (!content || !content.trim()) return false;
  // Truncate long intermediate content to keep the display clean
  const maxLen = 500;
  const truncated = content.length > maxLen
    ? content.substring(0, maxLen) + chalk.dim('…')
    : content;
  console.log(muted(cli, `  │ ${truncated.trim()}`));
  return true;
}

/**
 * Show thinking spinner during LLM response time
 */
export function showThinkingSpinner(cli) {
  return thinkingSpinner('Thinking', cli?.theme);
}

/**
 * Show AI responding indicator
 */
export function showRespondingIndicator() {
  return respondingIndicator();
}

/**
 * Create a streaming renderer for model deltas. It writes plain text with
 * the same left accent bar used by final markdown, then replaces the raw
 * stream region with rendered markdown when the final response arrives.
 */
export function createStreamingRenderer(cli) {
  const t = cli.theme;
  const bar = chalk.hex(t.accent)('│');
  const cursor = chalk.hex(t.accent)('▌');
  const prefix = `  ${bar} `;
  const continuation = `  ${bar} `;
  const width = Math.max(24, (process.stdout.columns || 80) - visibleLen(prefix) - 1);

  let active = false;
  let content = '';
  let currentCol = 0;
  let rowCount = 1;
  let cursorVisible = false;
  let blink = null;

  const writeCursor = () => {
    if (!active || cursorVisible) return;
    process.stdout.write(cursor);
    cursorVisible = true;
  };
  const clearCursor = () => {
    if (!active || !cursorVisible) return;
    process.stdout.write('\b \b');
    cursorVisible = false;
  };
  const startBlink = () => {
    if (blink) return;
    blink = setInterval(() => {
      if (!active) return;
      if (cursorVisible) clearCursor();
      else writeCursor();
    }, 450);
    blink.unref?.();
  };
  const stopBlink = () => {
    if (blink) clearInterval(blink);
    blink = null;
    clearCursor();
  };
  const begin = () => {
    if (active) return;
    active = true;
    process.stdout.write(`\n${prefix}`);
    startBlink();
  };
  const newline = () => {
    process.stdout.write(`\n${continuation}`);
    rowCount++;
    currentCol = 0;
  };
  const writeText = (text) => {
    for (const ch of text) {
      if (ch === '\r') continue;
      if (ch === '\n') {
        newline();
        continue;
      }
      process.stdout.write(ch);
      currentCol++;
      if (currentCol >= width) newline();
    }
  };
  const clearRegion = () => {
    stopBlink();
    if (rowCount > 1) process.stdout.write(`\x1b[${rowCount - 1}A`);
    process.stdout.write('\r\x1b[J');
  };

  return {
    get active() { return active; },
    write(delta) {
      if (!delta) return;
      begin();
      clearCursor();
      content += delta;
      writeText(delta);
      writeCursor();
    },
    commitIntermediate() {
      if (!active) return;
      stopBlink();
      process.stdout.write('\n');
      active = false;
      content = '';
      currentCol = 0;
      rowCount = 1;
    },
    finish(finalContent = content) {
      if (!active) {
        if (finalContent && finalContent.trim()) printAIResponse(cli, finalContent);
        return;
      }
      clearRegion();
      active = false;
      const rendered = cli.isMarkdownEnabled() ? renderMarkdown(finalContent, cli.theme) : finalContent;
      if (rendered && rendered.trim()) console.log(renderWithLeftBar(cli, rendered));
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 🔧 Tool Call Visualization
// ═══════════════════════════════════════════════════════════════════

/**
 * Format tool arguments for compact display
 */
export function formatToolArgs(toolName, args) {
  if (!args || Object.keys(args).length === 0) return '';

  if (args.path) return chalk.dim(args.path);
  if (args.command) return chalk.dim(args.command.substring(0, 50) + (args.command.length > 50 ? '...' : ''));
  if (args.query) return chalk.dim(`"${args.query.substring(0, 40)}${args.query.length > 40 ? '...' : ''}"`);
  if (args.url) return chalk.dim(args.url.substring(0, 50));
  if (args.file) return chalk.dim(args.file);

  const firstKey = Object.keys(args)[0];
  const firstVal = typeof args[firstKey] === 'string'
    ? args[firstKey].substring(0, 40)
    : JSON.stringify(args[firstKey]).substring(0, 40);
  return chalk.dim(`${firstKey}: ${firstVal}${firstVal.length >= 40 ? '...' : ''}`);
}

/**
 * Print enhanced tool call start with timing and context
 */
export function printEnhancedToolCallStart(cli, toolName, args, count, _taskStartTime) {
  const t = cli.theme;
  cli._streamRenderer?.commitIntermediate();
  const argPreview = formatToolArgs(toolName, args);
  const startedAt = Date.now();
  const store = getToolStore(cli);
  for (const activeState of store.filter(s => !s.done && !s.frozen)) {
    if (activeState.interval) clearInterval(activeState.interval);
    activeState.frozen = true;
    clearInline(activeState.width || 120);
    if (activeState.text) console.log(activeState.text);
  }
  const state = {
    id: count,
    toolName,
    args,
    startedAt,
    frame: 0,
    done: false,
    width: process.stdout.columns || 120,
    text: '',
  };

  const render = () => {
    const elapsedStr = formatDuration(Date.now() - startedAt);
    const frame = TOOL_FRAMES[state.frame % TOOL_FRAMES.length];
    state.frame++;
    state.text = `  ${chalk.hex(t.tool)(frame)} ${chalk.hex(t.tool)(toolName)}${argPreview ? ` ${argPreview}` : ''}${chalk.dim(` [${elapsedStr}]`)}`;
    clearInline(state.width);
    process.stdout.write(state.text);
  };

  render();
  state.interval = setInterval(render, 80);
  state.interval.unref?.();
  store.push(state);
}

/**
 * Enhanced tool call end with rich result display
 */
export function printEnhancedToolCallEnd(cli, toolName, result, taskStartTime, _count) {
  const t = cli.theme;
  const resultData = result.result || result;
  const store = getToolStore(cli);
  const state = store.find(s => !s.done && s.toolName === toolName) || store.find(s => !s.done);
  if (state?.interval) clearInterval(state.interval);
  if (state) state.done = true;

  const elapsed = state ? Date.now() - state.startedAt : Date.now() - taskStartTime;
  const elapsedStr = formatDuration(elapsed);
  const argPreview = formatToolArgs(toolName, state?.args || {});
  const ok = result.success !== false;
  const status = ok ? chalk.hex(t.success)('✓') : chalk.hex(t.error)('✗');
  const summary = ok ? summarizeToolResult(cli, toolName, resultData) : summarizeToolError(result, resultData);
  if (!state?.frozen) clearInline(state?.width || 120);
  console.log(`  ${chalk.hex(t.tool)('▸')} ${chalk.hex(t.tool)(toolName)}${argPreview ? ` ${argPreview}` : ''} ${status}${summary ? ` ${summary}` : ''}${chalk.dim(` [${elapsedStr}]`)}`);
  return;
}

function summarizeToolResult(cli, toolName, resultData) {
  const t = cli.theme;
  const dim = chalk.hex(t.muted);
  switch (toolName) {
    case 'read_file': {
      const content = resultData?.content || '';
      const filePath = resultData?.path || resultData?.file;
      if (filePath && content) cli.fileContentCache.set(filePath, content);
      const lineCount = content ? content.split('\n').length : 0;
      const sizeStr = content.length > 1024 ? `${(content.length / 1024).toFixed(1)}KB` : `${content.length}B`;
      return dim(`${lineCount} lines · ${sizeStr}`);
    }
    case 'write_file':
    case 'edit_file': {
      const filePath = resultData?.path || resultData?.file || '';
      const cached = filePath ? cli.fileContentCache.get(filePath) : undefined;
      const next = resultData?.content;
      let additions = resultData?.linesWritten || resultData?.linesModified || 0;
      let deletions = resultData?.linesDeleted || 0;
      if (cached !== undefined && next !== undefined) {
        const stats = countLineDiff(cached, next);
        additions = stats.additions;
        deletions = stats.deletions;
      } else if (next !== undefined && !additions) {
        additions = next.split('\n').length;
      }
      if (filePath && next !== undefined) cli.fileContentCache.set(filePath, next);
      const parts = [];
      if (additions) parts.push(chalk.hex(t.success)(`+${additions}`));
      if (deletions) parts.push(chalk.hex(t.error)(`-${deletions}`));
      return parts.length ? parts.join(' ') : dim('updated');
    }
    case 'exec':
    case 'shell_exec': {
      const exitCode = resultData?.exitCode ?? 0;
      return exitCode === 0 ? chalk.hex(t.success)(`exit:${exitCode}`) : chalk.hex(t.error)(`exit:${exitCode}`);
    }
    case 'web_search': {
      const count = resultData?.results?.length || 0;
      return dim(`${count} result${count === 1 ? '' : 's'}`);
    }
    case 'list_directory': {
      const entries = resultData?.entries || resultData?.files || [];
      return dim(`${entries.length} item${entries.length === 1 ? '' : 's'}`);
    }
    case 'git_status': {
      const status = resultData?.status || {};
      const files = Object.keys(status).length;
      return dim(files ? `${files} file${files === 1 ? '' : 's'} changed` : 'clean');
    }
    case 'read_webpage':
    case 'fetch_url': {
      const preview = [
        resultData?.status ? `HTTP ${resultData.status}` : null,
        resultData?.title || resultData?.statusText || null,
      ].filter(Boolean).join(' · ');
      return preview ? dim(truncateInline(preview, 70)) : '';
    }
    default: {
      if (resultData?.summary?.total) return dim(`${resultData.summary.total} tasks`);
      if (resultData?.stdout) return dim(truncateInline(resultData.stdout.replace(/\s+/g, ' '), 70));
      return '';
    }
  }
}

function summarizeToolError(result, resultData) {
  const statusSummary = resultData?.status ? `HTTP ${resultData.status}` : null;
  const errorMsg = result.error || result.result?.error || statusSummary || 'failed';
  return truncateInline(String(errorMsg).replace(/\s+/g, ' '), 90);
}

function countLineDiff(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  let additions = 0;
  let deletions = 0;
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    if (oldLines[i] === newLines[i]) continue;
    if (i >= oldLines.length) additions++;
    else if (i >= newLines.length) deletions++;
    else {
      additions++;
      deletions++;
    }
  }
  return { additions, deletions };
}

// ═══════════════════════════════════════════════════════════════════
// 📊 Task Summaries & Stats Panels
// ═══════════════════════════════════════════════════════════════════

/**
 * Print task summary (compact)
 */
export function printTaskSummary(cli, result, duration) {
  const seconds = (duration / 1000).toFixed(1);
  const modelId = cli.session.agent.model;
  const modelShort = shortenModelLabel(modelId);
  cli.syncSessionModelState(modelId);
  const contextStats = cli.session.agent.getContextStats();
  const contextUsed = contextStats.usedTokens;
  const contextMax = contextStats.maxTokens;
  const contextPct = contextStats.percent;
  const contextColor = contextPct > 70 ? chalk.red : contextPct > 40 ? chalk.yellow : chalk.green;

  if (result.performance) {
    cli.totalTokens += result.performance.totalToolCalls * 1000;
  }

  console.log('');
  console.log(chalk.dim(`  ── `) +
    chalk.cyan(modelShort) + chalk.dim(' • ') +
    contextColor(`${formatCompactNumber(contextUsed)}/${formatCompactNumber(contextMax)} ctx est (${contextPct}%)`) + chalk.dim(' • ') +
    chalk.white(`${result.iterations} iter`) + chalk.dim(' • ') +
    chalk.white(`${result.stats.toolExecutions} tools`) + chalk.dim(' • ') +
    chalk.white(`${seconds}s`) +
    chalk.dim(' ──'));

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

/**
 * Enhanced task summary with visual card style
 */
export function printEnhancedTaskSummary(cli, result, duration) {
  const seconds = (duration / 1000).toFixed(1);
  const modelId = cli.session.agent.model;
  const modelShort = shortenModelLabel(modelId);
  cli.syncSessionModelState(modelId);
  const contextStats = cli.session.agent.getContextStats();
  const contextUsed = contextStats.usedTokens;
  const contextMax = contextStats.maxTokens;
  const contextPct = contextStats.percent;
  const t = cli.theme;
  const contextColor = contextPct > 70 ? chalk.hex(t.error) : contextPct > 40 ? chalk.hex(t.warning) : chalk.hex(t.success);

  const summaryParts = [
    chalk.hex(t.tool)(modelShort),
    chalk.white(`${seconds}s`),
    chalk.white(`${result.iterations} iter`),
    chalk.white(`${result.stats.toolExecutions} tools`),
    contextColor(`${formatCompactNumber(contextUsed)}/${formatCompactNumber(contextMax)} ctx (${contextPct}%)`),
  ];
  let line = `  ${chalk.hex(t.success)('✓')} ${summaryParts.join(chalk.dim(' · '))}`;
  if (result.performance && result.performance.totalRetries > 0) {
    line += chalk.hex(t.warning)(` · ↻ ${result.performance.totalRetries} retries`);
  }
  console.log('');
  console.log(line);
}

/**
 * Print session stats inline (triggered by Ctrl+P)
 */
export function printSessionStats(cli) {
  if (!cli.session?.agent) {
    console.log(chalk.gray('  No active session'));
    return;
  }
  const stats = cli.session.agent.getStats();
  const contextStats = cli.session.agent.getContextStats();
  const clientStats = cli.session.agent.client.getStats();
  const subagentStats = cli.session.subagentManager?.getStats() || {};
  const autoGenStats = cli.session.autoGenBridge?.getStats?.() || {};
  const elapsedMs = Date.now() - cli.sessionStartTime;
  const elapsedStr = formatElapsedTime(elapsedMs);
  const t = cli.theme;

  const subagentCost = subagentStats.totalCost || 0;
  const teamCost = autoGenStats.totalTeamCost || 0;
  const totalCost = (clientStats.totalCost || 0) + subagentCost + teamCost;

  console.log('');
  console.log(divider(cli, 'stats'));
  console.log(`  ${chalk.hex(t.text)('Tokens:')}   ${chalk.white(stats.totalTokensUsed.toLocaleString())}`);
  console.log(`  ${chalk.hex(t.text)('Context:')}   ${chalk.white(contextStats.usedTokens.toLocaleString())}/${chalk.white(contextStats.maxTokens.toLocaleString())} (${contextStats.percent}%)`);
  console.log(`  ${chalk.hex(t.text)('Cost:')}      ${chalk.yellow('$' + totalCost.toFixed(4))}`);
  if (subagentCost > 0 || teamCost > 0) {
    console.log(`  ${chalk.hex(t.muted)('├─ Main:')}    ${chalk.hex(t.muted)('$' + (clientStats.totalCost || 0).toFixed(4))}`);
    if (subagentCost > 0) {
      console.log(`  ${chalk.hex(t.muted)('├─ Sub:')}     ${chalk.hex(t.muted)('$' + subagentCost.toFixed(4))}`);
    }
    if (teamCost > 0) {
      console.log(`  ${chalk.hex(t.muted)('└─ Team:')}    ${chalk.hex(t.muted)('$' + teamCost.toFixed(4))}`);
    }
  }
  const budgetRemaining = (clientStats.budgetLimit || 0) - (clientStats.budgetUsed || 0);
  console.log(`  ${chalk.hex(t.text)('Budget:')}    ${chalk.yellow('$' + (clientStats.budgetUsed || 0).toFixed(4))} used / ${chalk.green('$' + budgetRemaining.toFixed(4))} remaining`);
  console.log(`  ${chalk.hex(t.text)('Tools:')}     ${chalk.white(stats.toolExecutions)} calls`);
  console.log(`  ${chalk.hex(t.text)('Iterations:')} ${chalk.white(stats.iterations)}`);
  console.log(`  ${chalk.hex(t.text)('Time:')}      ${chalk.white(elapsedStr)}`);
  console.log(`  ${chalk.hex(t.text)('Messages:')}  ${chalk.white(stats.totalMessages)}`);
  console.log(`  ${chalk.hex(t.text)('Theme:')}     ${chalk.hex(t.accent)(t.name)}`);
  console.log(divider(cli));
}

/**
 * Print goodbye message
 */
export async function printGoodbye(cli) {
  cli.stopAutoSave();
  if (cli.sessionSaveInFlight) {
    await cli.sessionSaveInFlight.catch(() => {});
  }

  const elapsedMs = Date.now() - cli.sessionStartTime;
  const elapsedStr = formatElapsedTime(elapsedMs);
  const taskCount = cli.taskCount || 0;
  const cost = cli.totalCost || 0;
  const costStr = cost > 0 ? `$${cost.toFixed(4)}` : '$0.00';

  console.log('');
  console.log(muted(cli, `  session complete · ${taskCount} tasks · ${elapsedStr} · ${costStr}`));

  if (cli.state) {
    cli.state.totalSessions = (cli.state.totalSessions || 0) + 1;
    await cli.saveState();
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📋 Panels: Tools, Stats, Agents, History, Help, Cost, Context
// ═══════════════════════════════════════════════════════════════════

/**
 * Show available tools
 */
export function showTools(cli) {
  const tools = cli.session.toolRegistry.list();
  console.log('');
  console.log(divider(cli, `tools ${tools.length}`));
  for (const tool of tools) {
    const mark = tool.enabled ? chalk.hex(cli.theme.success)('●') : chalk.hex(cli.theme.error)('○');
    console.log(`  ${mark} ${label(cli, tool.name)} ${muted(cli, `[${tool.category}]`)} ${muted(cli, truncateInline(tool.description, 72))}`);
  }
  console.log(divider(cli));
  return;
}

/**
 * Show session statistics
 */
export function showStats(cli) {
  const stats = cli.session.agent.getStats();
  const contextStats = cli.session.agent.getContextStats();
  const toolStats = cli.session.toolRegistry.getStats();
  const subagentStats = cli.session.subagentManager?.getStats() || {};
  const t = cli.theme;
  console.log('');
  console.log(divider(cli, 'stats'));
  console.log(`  ${label(cli, 'Messages')} ${stats.totalMessages} ${muted(cli, '·')} ${label(cli, 'Iterations')} ${stats.iterations} ${muted(cli, '·')} ${label(cli, 'Tokens')} ${stats.totalTokensUsed.toLocaleString()}`);
  console.log(`  ${label(cli, 'Context')} ${formatCompactNumber(contextStats.usedTokens)}/${formatCompactNumber(contextStats.maxTokens)} (${contextStats.percent}%) ${muted(cli, '·')} ${label(cli, 'Compactions')} ${contextStats.compactions}`);
  console.log(`  ${label(cli, 'Tools')} ${stats.toolExecutions} calls ${muted(cli, '·')} ${label(cli, 'Used')} ${muted(cli, stats.toolsUsed.join(', ') || 'none')}`);
  console.log(`  ${label(cli, 'Registry')} ${toolStats.totalExecutions} exec ${muted(cli, '·')} ${toolStats.successRate} success ${muted(cli, '·')} ${toolStats.avgDuration} avg`);
  if (subagentStats.totalTasks > 0) {
    console.log(`  ${chalk.hex(t.tool)('Subagents')} ${subagentStats.totalTasks} total ${muted(cli, '·')} ${chalk.hex(t.success)(subagentStats.completedTasks)} done ${muted(cli, '·')} ${chalk.hex(t.error)(subagentStats.failedTasks)} failed`);
  }
  console.log(divider(cli));
  return;
}

/**
 * Show subagent system status
 */
export function showAgents(cli) {
  const subagentManager = cli.session.subagentManager;
  if (!subagentManager) {
    console.log(muted(cli, '  subagent system not available'));
    return;
  }

  const stats = subagentManager.getStats();
  const tasks = subagentManager.getAllTasksStatus();
  const specializations = subagentManager.constructor.listSpecializations();
  const t = cli.theme;
  const agentSuccessBar = stats.totalTasks > 0
    ? miniBar(stats.completedTasks, stats.totalTasks)
    : muted(cli, 'no tasks yet');

  console.log('');
  console.log(divider(cli, 'agents'));
  console.log(`  ${label(cli, 'Tasks')} ${stats.totalTasks} total ${muted(cli, '·')} ${chalk.hex(t.success)(stats.completedTasks)} done ${muted(cli, '·')} ${chalk.hex(t.error)(stats.failedTasks)} failed ${muted(cli, '·')} ${chalk.hex(t.tool)(stats.runningTasks)} running`);
  console.log(`  ${label(cli, 'Rate')} ${agentSuccessBar} ${stats.successRate} ${muted(cli, '·')} ${label(cli, 'Avg')} ${stats.avgDuration}`);
  if (stats.bySpecialization && Object.keys(stats.bySpecialization).length > 0) {
    console.log(muted(cli, '  by specialization'));
    for (const [specId, specStats] of Object.entries(stats.bySpecialization)) {
      console.log(`  ${chalk.hex(t.tool)('▸')} ${label(cli, specId.padEnd(14))} ${specStats.total} tasks ${muted(cli, '·')} ${chalk.hex(t.success)(specStats.completed)} ok ${muted(cli, '·')} ${chalk.hex(t.error)(specStats.failed)} fail`);
    }
  }
  if (tasks.length > 0) {
    console.log(muted(cli, '  recent'));
    for (const task of tasks.slice(-6)) {
      const stateIcon = {
        queued: chalk.hex(t.muted)('○'),
        pending: chalk.hex(t.warning)('◔'),
        running: chalk.hex(t.tool)('◑'),
        completed: chalk.hex(t.success)('●'),
        failed: chalk.hex(t.error)('●'),
        cancelled: chalk.hex(t.muted)('⊘'),
        retrying: chalk.hex(t.warning)('↻'),
      }[task.state] || chalk.hex(t.muted)('?');
      const dur = task.duration > 0 ? muted(cli, ` ${(task.duration / 1000).toFixed(1)}s`) : '';
      const retry = task.retryCount > 0 ? chalk.hex(t.warning)(` ↻${task.retryCount}`) : '';
      console.log(`  ${stateIcon} ${label(cli, task.specialization.padEnd(12))} ${muted(cli, truncateInline(task.task, 70))}${dur}${retry}`);
    }
  }
  console.log(muted(cli, `  specializations ${specializations.map(s => s.name).join(', ')}`));
  console.log(divider(cli));
  return;
}

/**
 * Create a mini progress bar
 */
export function miniBar(current, total, length = 12) {
  if (total === 0) return chalk.dim('░'.repeat(length));
  const filled = Math.round((current / total) * length);
  return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(length - filled));
}

/**
 * Show command history
 */
export function showHistory(cli) {
  if (cli.history.length === 0) {
    console.log(muted(cli, '  no history yet'));
    return;
  }

  const entries = cli.history.slice(-10).reverse();
  console.log('');
  console.log(divider(cli, 'history'));
  for (const [index, entry] of entries.entries()) {
    const duration = entry.duration || 0;
    const durationStr = formatDuration(duration);
    const timestamp = entry.timestamp ? getRelativeTime(new Date(entry.timestamp)) : '';
    const meta = [
      entry.iterations !== undefined ? `${entry.iterations} iter` : null,
      entry.toolsUsed !== undefined ? `${entry.toolsUsed} tools` : null,
      durationStr,
      timestamp,
    ].filter(Boolean).join(' · ');
    const typeColor = entry.type === 'agent' ? chalk.hex(cli.theme.tool) : entry.type === 'chat' ? chalk.hex(cli.theme.accent) : chalk.hex(cli.theme.warning);
    console.log(`  ${muted(cli, `${index + 1}.`)} ${typeColor(entry.type)} ${truncateInline(entry.task || '', 72)}`);
    console.log(muted(cli, `     ${meta}`));
  }
  console.log(divider(cli));
  return;
}

/**
 * Show help panel
 */
export function showHelp(_cli) {
  const cli = _cli;
  console.log('');
  console.log(divider(cli, 'help'));
  console.log(formatCommandList([...COMMAND_ENTRIES.slice(0, -1), ['/reset', 'Alias for /new'], COMMAND_ENTRIES.at(-1)])
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n'));
  console.log('');
  console.log(`  ${label(cli, 'Aliases')} ${SHORTCUT_ENTRIES.map((entry) => {
    const [alias, target] = entry.split('=');
    return `${chalk.hex(cli.theme.accent)(alias)}=${target}`;
  }).join(' ')}`);
  console.log(`  ${label(cli, 'Input')} ${muted(cli, getInputShortcutSummary())}`);
  console.log(`  ${chalk.hex(cli.theme.accent)('! <cmd>')} ${muted(cli, 'Run shell command')}`);
  console.log(divider(cli));
  return;
}

/**
 * Show cost breakdown
 */
export function showCost(cli) {
  const clientStats = cli.session.agent.client.getStats();
  const subagentStats = cli.session.subagentManager?.getStats() || {};
  const autoGenStats = cli.session.autoGenBridge?.getStats?.() || {};
  const sessionDuration = Date.now() - cli.sessionStartTime;
  const sessionMinutes = Math.floor(sessionDuration / 60000);

  const subagentCost = subagentStats.totalCost || 0;
  const teamCost = autoGenStats.totalTeamCost || 0;
  const totalCost = clientStats.totalCost + subagentCost + teamCost;
  console.log('');
  console.log(divider(cli, 'cost'));
  console.log(`  ${label(cli, 'Duration')} ${sessionMinutes} minutes`);
  console.log(`  ${label(cli, 'Main')} $${clientStats.totalCost.toFixed(6)} ${muted(cli, '·')} ${label(cli, 'Subagents')} $${subagentCost.toFixed(6)} ${muted(cli, '·')} ${label(cli, 'Team')} $${teamCost.toFixed(6)}`);
  console.log(`  ${label(cli, 'Total')} ${chalk.hex(cli.theme.warning)('$' + totalCost.toFixed(6))}`);
  console.log(`  ${label(cli, 'Budget')} $${clientStats.budgetUsed.toFixed(6)} / $${clientStats.budgetLimit} ${muted(cli, '·')} ${label(cli, 'Remaining')} $${clientStats.budgetRemaining.toFixed(6)}`);
  console.log(`  ${label(cli, 'Requests')} ${clientStats.requestCount} ${muted(cli, '·')} ${label(cli, 'Avg')} ${clientStats.avgDuration} ${muted(cli, '·')} ${label(cli, 'Cache')} ${clientStats.cacheSize}`);
  console.log(divider(cli));
  return;
}

/**
 * Show context usage statistics
 */
export function showContext(cli) {
  const contextStats = cli.session.agent.getContextStats();

  const contextColor = contextStats.percent > 70 ? chalk.red :
                       contextStats.percent > 40 ? chalk.yellow : chalk.green;
  console.log('');
  console.log(divider(cli, 'context'));
  console.log(`  ${label(cli, 'Used')} ${formatCompactNumber(contextStats.usedTokens)} / ${formatCompactNumber(contextStats.maxTokens)} ${muted(cli, '·')} ${label(cli, 'Usage')} ${contextColor(contextStats.percent + '%')}`);
  console.log(`  ${label(cli, 'Compactions')} ${contextStats.compactions} ${muted(cli, '·')} ${label(cli, 'Last')} ${formatCompactNumber(contextStats.lastPromptTokens)} in / ${formatCompactNumber(contextStats.lastCompletionTokens)} out`);
  console.log(`  ${label(cli, 'Messages')} ${cli.session.agent.messages.length} ${muted(cli, '·')} ${label(cli, 'History')} ${cli.session.agent.history.length}`);
  console.log(divider(cli));
  return;
}

/**
 * Show smart suggestions based on usage patterns
 */
export function showSmartSuggestions() {
  const suggestions = [
    'Try /templates for common workflows',
    'Use /doctor to check your environment',
    'Type /help to see all commands',
    'Use /stream to toggle streaming mode',
  ];
  const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
  console.log(chalk.dim(`  ${suggestion}`));
}

/**
 * Get project memory label
 */
export function getProjectMemoryLabel(cli) {
  const mem = cli.session?.projectMemory;
  if (!mem) return 'none';
  if (typeof mem === 'string') return truncateInline(mem, 40);
  return 'active';
}

/**
 * Get workspace label
 */
export function getWorkspaceLabel(cli) {
  const dir = cli.session?.activeWorkspace?.workspaceDir;
  if (!dir) return 'none';
  return truncateInline(dir, 40);
}

/**
 * Get session label
 */
export function getSessionLabel(cli) {
  const id = cli.session?.sessionId;
  if (!id) return 'none';
  return id;
}
