/**
 * 🎨 Display Module
 * All visual output: banners, tool call visualization, task summaries,
 * help panels, stats panels, and UI components.
 */

import chalk from 'chalk';
import boxen from 'boxen';
import { gradients, boxStyles } from '../utils.js';
import { renderMarkdown } from './markdown.js';
import { renderDiff } from './diffViewer.js';
import { COMMAND_ENTRIES, SHORTCUT_ENTRIES, INPUT_SHORTCUT_ENTRIES } from './constants.js';
import {
  formatCompactNumber,
  formatDuration,
  formatElapsedTime,
  truncateInline,
  shortenModelLabel,
  getRelativeTime
} from './formatting.js';

const g = gradients;
const box = boxStyles;

// ═══════════════════════════════════════════════════════════════════
// 🎯 Banner & Status Line
// ═══════════════════════════════════════════════════════════════════

/**
 * Print the OpenAgent startup banner
 */
export function printBanner() {
  console.log(g.title(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ${g.ai('🚀 OpenAgent')}                                          ║
║   ${g.subtitle('AI Agent • 400+ Models • Cross-Platform')}             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`));
}

/**
 * Format command list for display
 */
export function formatCommandList(entries = COMMAND_ENTRIES) {
  const commandWidth = entries.reduce((max, [command]) => Math.max(max, command.length), 0);
  return entries
    .map(([command, description]) =>
      `${chalk.cyan(command.padEnd(commandWidth + 2))}${chalk.gray(`- ${description}`)}`
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
 * Print AI response in a box
 */
export function printAIResponse(cli, content) {
  if (!content) return;
  const rendered = cli.isMarkdownEnabled() ? renderMarkdown(content) : content;
  console.log('');
  console.log(boxen(
    `${g.ai('🤖 AI')}\n\n${rendered}`,
    box.response
  ));
}

/**
 * Show thinking spinner during LLM response time
 */
export function showThinkingSpinner() {
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
export function showRespondingIndicator() {
  const indicator = chalk.cyan('💬 ') + chalk.gray('AI responding...');
  process.stdout.write(indicator + ' ');

  return {
    clear: () => {
      process.stdout.write('\r' + ' '.repeat(indicator.length + 5) + '\r');
    }
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
export function printEnhancedToolCallStart(cli, toolName, args, count, taskStartTime) {
  const elapsed = Date.now() - taskStartTime;
  const elapsedStr = formatDuration(elapsed);
  const t = cli.theme;

  const isSubagentTool = toolName.startsWith('delegate_') || toolName === 'subagent_status';

  if (isSubagentTool) {
    console.log('');
    console.log(`${chalk.hex(t.tool)('⚡')} ${chalk.hex(t.tool).bold(toolName)} ${chalk.dim(`[${elapsedStr}]`)}`);
    return;
  }

  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const frame = spinnerFrames[count % spinnerFrames.length];

  const argPreview = formatToolArgs(toolName, args);

  let extraInfo = '';
  if (toolName === 'edit_file' && args) {
    const findPreview = args.find ? args.find.substring(0, 60) : '';
    const replacePreview = args.replace ? args.replace.substring(0, 60) : '';
    if (findPreview) {
      extraInfo = `\n  ${chalk.dim('├─')} ${chalk.red('- ' + findPreview)}${chalk.dim(' → ')} ${chalk.green('+ ' + replacePreview)}`;
    }
  } else if (toolName === 'exec' && args?.command) {
    extraInfo = `\n  ${chalk.dim('├─')} ${chalk.hex(t.muted)('$ ' + args.command.substring(0, 80))}`;
  } else if (toolName === 'read_file' && args?.path) {
    extraInfo = `\n  ${chalk.dim('├─')} ${chalk.hex(t.muted)(args.path)}`;
  }

  process.stdout.write(`  ${chalk.hex(t.tool)(frame)} ${chalk.hex(t.tool)(toolName)} ${argPreview}${chalk.dim(` [${elapsedStr}]`)}${extraInfo}`);
}

/**
 * Enhanced tool call end with rich result display
 */
export function printEnhancedToolCallEnd(cli, toolName, result, taskStartTime, _count) {
  const t = cli.theme;
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
  const elapsedStr = formatDuration(elapsed);

  if (result.success !== false) {
    console.log(chalk.hex(t.success)(`    ✓`) + chalk.dim(` ${elapsedStr}`));

    switch (toolName) {
      case 'read_file': {
        const content = resultData?.content || '';
        const lines = content.split('\n');
        const lineCount = lines.length;
        const sizeStr = content.length > 1024
          ? `${(content.length / 1024).toFixed(1)}KB`
          : `${content.length}B`;
        const cachePath = resultData?.path || resultData?.file;
        if (cachePath && content) {
          cli.fileContentCache.set(cachePath, content);
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

        const cachedContent = cli.fileContentCache.get(filePath);
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
            cli.fileContentCache.set(filePath, newContent);
          } catch { /* diff rendering failure is non-critical */ }
        } else if (newContent !== undefined) {
          const lineCount = newContent.split('\n').length;
          console.log(chalk.hex(t.muted)(`    │ ${lineCount} lines`));
          cli.fileContentCache.set(filePath, newContent);
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
          resultData.title ? truncateInline(resultData.title, 90) : null,
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

  const toolUsage = {};
  if (result.stats?.toolExecutionsByName) {
    Object.entries(result.stats.toolExecutionsByName).forEach(([tool, count]) => {
      toolUsage[tool] = count;
    });
  }

  const dividerLine = chalk.dim('━'.repeat(50));

  console.log('');
  console.log(dividerLine);
  console.log(chalk.hex(t.success)('  ✅ Task complete'));
  console.log('');
  console.log(`  ${chalk.hex(t.tool)('🤖')} ${chalk.white(modelShort)} • ${contextColor(`${formatCompactNumber(contextUsed)}/${formatCompactNumber(contextMax)} ctx (${contextPct}%)`)}`);
  console.log(`  ${chalk.hex(t.tool)('⏱')} ${chalk.white(seconds + 's')} • ${chalk.white(result.iterations + ' iter')} • ${chalk.white(result.stats.toolExecutions + ' tool calls')}`);

  if (Object.keys(toolUsage).length > 0) {
    console.log('');
    console.log(`  ${chalk.hex(t.tool)('🔧 Tools used:')}`);
    const toolParts = Object.entries(toolUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tool, cnt]) => `${tool} ×${cnt}`);
    console.log(`    ${toolParts.join('  ')}`);
  }

  if (result.performance) {
    const avgIteration = result.iterations > 0 ? (duration / result.iterations / 1000).toFixed(1) + 's' : 'N/A';
    const retries = result.performance.totalRetries || 0;
    console.log('');
    console.log(`  ${chalk.hex(t.accent)('📊 Performance:')}`);
    console.log(`    ${chalk.hex(t.muted)('Avg iteration:')} ${chalk.white(avgIteration)} • ${chalk.hex(t.muted)('Retries:')} ${retries > 0 ? chalk.hex(t.warning)(retries) : chalk.hex(t.success)('0')}`);
  }

  console.log(dividerLine);
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
  console.log(chalk.hex(t.header)(`  ══ Session Stats ══`));
  console.log(`  ${chalk.hex(t.text)('Tokens:')}   ${chalk.white(stats.totalTokensUsed.toLocaleString())}`);
  console.log(`  ${chalk.hex(t.text)('Context:')}   ${chalk.white(contextStats.usedTokens.toLocaleString())}/${chalk.white(contextStats.maxTokens.toLocaleString())} (${contextStats.percent}%)`);
  console.log(`  ${chalk.hex(t.text)('Cost:')}      ${chalk.yellow('$' + totalCost.toFixed(4))}`);
  console.log(`  ${chalk.hex(t.text)('Tools:')}     ${chalk.white(stats.toolExecutions)} calls`);
  console.log(`  ${chalk.hex(t.text)('Iterations:')} ${chalk.white(stats.iterations)}`);
  console.log(`  ${chalk.hex(t.text)('Time:')}      ${chalk.white(elapsedStr)}`);
  console.log(`  ${chalk.hex(t.text)('Messages:')}  ${chalk.white(stats.totalMessages)}`);
  console.log(`  ${chalk.hex(t.text)('Theme:')}     ${chalk.hex(t.accent)(t.name)}`);
  console.log('');
}

/**
 * Print goodbye message
 */
export async function printGoodbye(cli) {
  cli.stopAutoSave();
  if (cli.sessionSaveInFlight) {
    await cli.sessionSaveInFlight.catch(() => {});
  }

  console.log(`
${g.title('╔═══════════════════════════════════════════════════════════════╗')}
${g.title('║')}                                                               ${g.title('║')}
${g.title('║')}   ${g.success('👋 Session Complete')}                                         ${g.title('║')}
${g.title('║')}                                                               ${g.title('║')}
${g.title('╚═══════════════════════════════════════════════════════════════╝')}
`);

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

  console.log(boxen(
    `${chalk.bold('Available Tools')} (${tools.length})\n\n` +
    tools.map(t =>
      `${t.enabled ? chalk.green('●') : chalk.red('○')} ${chalk.cyan(t.name)} ${chalk.gray(`[${t.category}]`)}\n  ${chalk.gray(t.description.substring(0, 60))}`
    ).join('\n'),
    { ...box.info, title: '🛠️ Tools' }
  ));
}

/**
 * Show session statistics
 */
export function showStats(cli) {
  const stats = cli.session.agent.getStats();
  const contextStats = cli.session.agent.getContextStats();
  const toolStats = cli.session.toolRegistry.getStats();
  const subagentStats = cli.session.subagentManager?.getStats() || {};

  let content = `${chalk.bold('Session')}\n\n` +
    `${chalk.cyan('Messages:')} ${stats.totalMessages}\n` +
    `${chalk.cyan('Iterations:')} ${stats.iterations}\n` +
    `${chalk.cyan('Tokens:')} ${stats.totalTokensUsed.toLocaleString()}\n` +
    `${chalk.cyan('Context Est:')} ${formatCompactNumber(contextStats.usedTokens)}/${formatCompactNumber(contextStats.maxTokens)} (${contextStats.percent}%)\n` +
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

/**
 * Show subagent system status
 */
export function showAgents(cli) {
  const subagentManager = cli.session.subagentManager;
  if (!subagentManager) {
    console.log(chalk.gray('Subagent system not available'));
    return;
  }

  const stats = subagentManager.getStats();
  const tasks = subagentManager.getAllTasksStatus();
  const specializations = subagentManager.constructor.listSpecializations();

  const successBar = stats.totalTasks > 0
    ? miniBar(stats.completedTasks, stats.totalTasks)
    : chalk.dim('no tasks yet');

  let content = `${chalk.bold.white('📊 Stats')}` +
    `\n  Tasks: ${chalk.white(stats.totalTasks)} total ${chalk.dim('│')} ${chalk.green(stats.completedTasks)} done ${chalk.dim('│')} ${chalk.red(stats.failedTasks)} failed ${chalk.dim('│')} ${chalk.cyan(stats.runningTasks)} running` +
    `\n  Rate:  ${successBar}  ${chalk.white(stats.successRate)}` +
    `\n  Speed: ${chalk.white(stats.avgDuration)} avg ${stats.totalRetries > 0 ? chalk.dim(`│ ${stats.totalRetries} retries`) : ''}`;

  if (stats.bySpecialization && Object.keys(stats.bySpecialization).length > 0) {
    content += `\n\n${chalk.bold.white('📈 By Specialization')}`;
    for (const [specId, specStats] of Object.entries(stats.bySpecialization)) {
      const spec = specializations.find(s => s.id === specId);
      const icon = spec?.name?.charAt(0) || '🤖';
      content += `\n  ${icon} ${chalk.cyan(specId.padEnd(14))} ${chalk.white(specStats.total)} tasks ${chalk.dim('│')} ${chalk.green(specStats.completed)} ok ${chalk.dim('│')} ${chalk.red(specStats.failed)} fail`;
    }
  }

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

  content += `\n\n${chalk.bold.white('🎯 Specializations')}`;
  for (const spec of specializations) {
    content += `\n  ${spec.name.padEnd(16)} ${chalk.gray(spec.description)}`;
  }

  console.log(boxen(content, { ...box.info, title: '🤝 Subagent System', titleAlignment: 'center' }));
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
    console.log(chalk.gray('No history yet'));
    return;
  }

  const entries = cli.history.slice(-10).reverse();
  let totalDuration = 0;
  let totalTools = 0;
  let agentCount = 0;
  let chatCount = 0;

  const content = entries.map((entry, index) => {
    totalDuration += entry.duration || 0;
    totalTools += entry.toolsUsed || 0;
    if (entry.type === 'agent') agentCount++;
    if (entry.type === 'chat') chatCount++;

    const typeIcon = entry.type === 'agent' ? '🤖' : entry.type === 'chat' ? '💬' : '📁';
    const typeColor = entry.type === 'agent' ? chalk.cyan : entry.type === 'chat' ? chalk.magenta : chalk.yellow;

    let durationColor;
    const duration = entry.duration || 0;
    if (duration < 5000) durationColor = chalk.green;
    else if (duration < 30000) durationColor = chalk.yellow;
    else durationColor = chalk.red;

    const durationStr = durationColor(formatDuration(duration));
    const timestamp = entry.timestamp ? getRelativeTime(new Date(entry.timestamp)) : '';

    const summaryParts = [];
    if (entry.iterations !== undefined) summaryParts.push(`${entry.iterations} iter`);
    if (entry.toolsUsed !== undefined) summaryParts.push(`${entry.toolsUsed} tools`);
    summaryParts.push(durationStr);
    if (timestamp) summaryParts.push(timestamp);

    const summary = summaryParts.join(chalk.dim(' • '));

    return `${chalk.gray(`${index + 1}.`)} ${typeIcon} ${typeColor(entry.type)}: ${truncateInline(entry.task || '', 60)}\n   ${chalk.dim(summary)}`;
  }).join('\n\n');

  const summaryContent = [
    `${chalk.bold('Summary:')}`,
    `  ${chalk.cyan('🤖 Agent tasks:')} ${agentCount}`,
    `  ${chalk.magenta('💬 Chat messages:')} ${chatCount}`,
    `  ${chalk.white('⏱️ Total time:')} ${formatDuration(totalDuration)}`,
    `  ${chalk.yellow('🔧 Total tools:')} ${totalTools}`,
  ].join('\n');

  console.log(boxen(
    content + '\n\n' + chalk.dim('─'.repeat(40)) + '\n\n' + summaryContent,
    { ...box.info, title: '📜 History' }
  ));
}

/**
 * Show help panel
 */
export function showHelp(_cli) {
  console.log(boxen(
    `${chalk.bold('Commands')}\n\n` +
    `${formatCommandList([...COMMAND_ENTRIES.slice(0, -1), ['/reset', 'Alias for /new'], COMMAND_ENTRIES.at(-1)])}\n\n` +
    `${chalk.bold('Aliases')}\n\n` +
    `${SHORTCUT_ENTRIES.map((entry) => {
      const [alias, target] = entry.split('=');
      return `${chalk.cyan(alias)}=${target}`;
    }).join(' ')}\n\n` +
    `${chalk.bold('Input')}\n\n` +
    `${chalk.gray(getInputShortcutSummary())}\n\n` +
    `${chalk.bold('Shortcuts')}\n\n` +
    `${chalk.cyan('! <cmd>')}       - Run shell command\n` +
    `${chalk.cyan('plain text')}    - Run as agentic task`,
    { ...box.info, title: '📖 Help' }
  ));
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

  let content = `${chalk.bold('Session Cost')}\n\n` +
    `${chalk.cyan('Session Duration:')} ${sessionMinutes} minutes\n` +
    `${chalk.cyan('Main Agent Cost:')} $${clientStats.totalCost.toFixed(6)}\n`;

  if (subagentCost > 0) {
    content += `${chalk.cyan('Subagent Cost:')} $${subagentCost.toFixed(6)}\n`;
  }
  if (teamCost > 0) {
    content += `${chalk.cyan('Team Cost:')} $${teamCost.toFixed(6)}\n`;
  }

  content += `${chalk.bold('Total Cost:')} $${totalCost.toFixed(6)}\n` +
    `${chalk.cyan('Budget Used:')} $${clientStats.budgetUsed.toFixed(6)} / $${clientStats.budgetLimit}\n` +
    `${chalk.cyan('Budget Remaining:')} $${clientStats.budgetRemaining.toFixed(6)}\n` +
    `${chalk.cyan('Total Requests:')} ${clientStats.requestCount}\n` +
    `${chalk.cyan('Avg Duration:')} ${clientStats.avgDuration}\n` +
    `${chalk.cyan('Cache Size:')} ${clientStats.cacheSize} entries\n` +
    `${chalk.cyan('Tasks Completed:')} ${cli.taskCount}`;

  console.log(boxen(content, { ...box.stats, title: '💰 Cost' }));
}

/**
 * Show context usage statistics
 */
export function showContext(cli) {
  const contextStats = cli.session.agent.getContextStats();

  const contextColor = contextStats.percent > 70 ? chalk.red :
                       contextStats.percent > 40 ? chalk.yellow : chalk.green;

  console.log(boxen(
    `${chalk.bold('Context Usage')}\n\n` +
    `${chalk.cyan('Used Tokens:')} ${formatCompactNumber(contextStats.usedTokens)} / ${formatCompactNumber(contextStats.maxTokens)}\n` +
    `${chalk.cyan('Usage:')} ${contextColor(contextStats.percent + '%')}\n` +
    `${chalk.cyan('Compactions:')} ${contextStats.compactions}\n` +
    `${chalk.cyan('Last Prompt:')} ${formatCompactNumber(contextStats.lastPromptTokens)} tokens\n` +
    `${chalk.cyan('Last Completion:')} ${formatCompactNumber(contextStats.lastCompletionTokens)} tokens\n` +
    `${chalk.cyan('Total Messages:')} ${cli.session.agent.messages.length}\n` +
    `${chalk.cyan('History Items:')} ${cli.session.agent.history.length}`,
    { ...box.stats, title: '📊 Context' }
  ));
}

/**
 * Show smart suggestions based on usage patterns
 */
export function showSmartSuggestions() {
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
