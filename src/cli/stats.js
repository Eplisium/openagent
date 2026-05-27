/**
 * Session stats and cost display for OpenAgent CLI
 */

import chalk from '../utils/chalk-compat.js';
import { formatCompactNumber } from './formatting.js';
import { miniBar } from './display.js';

function printPanel(label, lines) {
  const width = Math.min(process.stdout.columns || 80, 72);
  console.log('');
  console.log(chalk.dim(`  ── ${label} ${'─'.repeat(Math.max(1, width - label.length - 4))}`));
  for (const line of lines) console.log(`  ${line}`);
  console.log(chalk.dim(`  ${'─'.repeat(width)}`));
}

/**
 * Smart money formatting: more decimal places for small costs, fewer for large.
 */
function formatSmartMoney(value) {
  const v = Number(value || 0);
  if (v === 0) return '$0.00';
  if (v < 0.01) return '$' + v.toFixed(6);
  if (v < 1) return '$' + v.toFixed(4);
  return '$' + v.toFixed(2);
}

/**
 * Format compact cost (single-line, minimal)
 */
function formatCompactCost(value) {
  const v = Number(value || 0);
  if (v === 0) return '$0.00';
  if (v < 0.001) return '$' + v.toFixed(6);
  if (v < 0.01) return '$' + v.toFixed(4);
  if (v < 1) return '$' + v.toFixed(3);
  return '$' + v.toFixed(2);
}

/**
 * Show session statistics (agent stats, tool stats, subagent stats).
 * @param {object} session - The current AgentSession
 */
export function showStats(session) {
  const stats = session.agent.getStats();
  const contextStats = session.agent.getContextStats();
  const toolStats = session.toolRegistry.getStats();
  const subagentStats = session.subagentManager?.getStats() || {};
  const clientStats = session.agent.client?.getStats?.() || {};

  const lines = [
    `${chalk.bold('Session')}`,
    `${chalk.cyan('Messages:')} ${stats.totalMessages}`,
    `${chalk.cyan('Iterations:')} ${stats.iterations}`,
    `${chalk.cyan('Tokens:')} ${stats.totalTokensUsed.toLocaleString()}`,
    `${chalk.cyan('Context Est:')} ${formatCompactNumber(contextStats.usedTokens)}/${formatCompactNumber(contextStats.maxTokens)} (${contextStats.percent}%)`,
    `${chalk.cyan('Compactions:')} ${contextStats.compactions}`,
    `${chalk.cyan('Tool Calls:')} ${stats.toolExecutions}`,
    `${chalk.cyan('Tools Used:')} ${stats.toolsUsed.join(', ') || 'None'}`,
    `${chalk.cyan('Total Cost:')} ${formatSmartMoney(clientStats.totalCost || 0)}${clientStats.hasActualCost ? '' : chalk.yellow(' (est)')}`,
    '',
    `${chalk.bold('Registry')}`,
    `${chalk.cyan('Executions:')} ${toolStats.totalExecutions}`,
    `${chalk.cyan('Success Rate:')} ${toolStats.successRate}`,
    `${chalk.cyan('Avg Duration:')} ${toolStats.avgDuration}`,
  ];

  if (subagentStats.totalTasks > 0) {
    lines.push(
      '',
      `${chalk.bold('Subagents')}`,
      `${chalk.cyan('Total Tasks:')} ${subagentStats.totalTasks}`,
      `${chalk.cyan('Completed:')} ${subagentStats.completedTasks}`,
      `${chalk.cyan('Failed:')} ${subagentStats.failedTasks}`,
      `${chalk.cyan('Success Rate:')} ${subagentStats.successRate}`,
      `${chalk.cyan('Avg Duration:')} ${subagentStats.avgDuration}`,
    );
    if (subagentStats.totalCost > 0) lines.push(`${chalk.cyan('Subagent Cost:')} $${subagentStats.totalCost.toFixed(6)}`);
  }

  printPanel('stats', lines);
}

/**
 * Show cost breakdown for the current session.
 * @param {object} session - The current AgentSession
 * @param {number} sessionStartTime - Timestamp when session started
 * @param {number} taskCount - Number of tasks completed
 */
export function showCost(session, sessionStartTime, taskCount) {
  const clientStats = session.agent.client.getStats();
  const subagentStats = session.subagentManager?.getStats() || {};
  const sessionDuration = Date.now() - sessionStartTime;
  const sessionMinutes = Math.floor(sessionDuration / 60000);

  const subagentCost = subagentStats.totalCost || 0;
  const totalCost = clientStats.totalCost + subagentCost;
  const totalTokens = clientStats.totalTokens || (clientStats.totalInputTokens + clientStats.totalOutputTokens);

  const lines = [
    `${chalk.bold('Session Cost')}`,
    `${chalk.cyan('Session Duration:')} ${sessionMinutes} minutes`,
    `${chalk.cyan('Main Agent Cost:')} ${formatSmartMoney(clientStats.totalCost)}`,
  ];

  if (subagentCost > 0) {
    lines.push(`${chalk.cyan('Subagent Cost:')} ${formatSmartMoney(subagentCost)}`);
  }

  lines.push(
    `${chalk.bold('Total Cost:')} ${formatSmartMoney(totalCost)}`,
    `${chalk.cyan('Budget Used:')} ${formatSmartMoney(clientStats.budgetUsed)} / ${formatSmartMoney(clientStats.budgetLimit)}`,
    `${chalk.cyan('Budget Remaining:')} ${formatSmartMoney(clientStats.budgetRemaining)}`,
    `${chalk.cyan('Total Requests:')} ${clientStats.requestCount}`,
    `${chalk.cyan('Avg Duration:')} ${clientStats.avgDuration}`,
    `${chalk.cyan('Cache Size:')} ${clientStats.cacheSize} entries`,
    `${chalk.cyan('Tasks Completed:')} ${taskCount}`,
  );

  // Token breakdown and cost-per-token
  if (totalTokens > 0) {
    lines.push(
      `${chalk.cyan('Tokens:')} ${clientStats.totalInputTokens.toLocaleString()} in / ${clientStats.totalOutputTokens.toLocaleString()} out / ${totalTokens.toLocaleString()} total`,
      `${chalk.cyan('Cost/1K tok:')} ${formatSmartMoney(clientStats.costPerThousandTokens || 0)}`,
    );
  }

  // Cache hit rate
  if (clientStats.totalCachedTokens > 0) {
    lines.push(
      `${chalk.cyan('Cached Tokens:')} ${clientStats.totalCachedTokens.toLocaleString()} (${clientStats.cacheHitRate}% hit rate)`,
    );
  }

  // Cost source note
  lines.push(
    clientStats.hasActualCost
      ? `${chalk.dim('Costs from OpenRouter API')}`
      : `${chalk.yellow('Using estimated costs — actual API cost unavailable')}`,
  );

  // Per-model breakdown
  const modelEntries = Object.entries(clientStats.costByModel || {});
  if (modelEntries.length > 1) {
    lines.push('');
    lines.push(`${chalk.bold('Per-Model Breakdown')}`);
    for (const [model, stats] of modelEntries) {
      const modelTokens = stats.inputTokens + stats.outputTokens;
      const pct = clientStats.totalCost > 0 ? Math.round((stats.cost / clientStats.totalCost) * 100) : 0;
      lines.push(`${chalk.cyan(model + ':')} ${formatSmartMoney(stats.cost)} · ${stats.requests} req · ${modelTokens.toLocaleString()} tok · ${pct}%`);
    }
  }

  // Upstream cost if available
  if (clientStats.totalUpstreamCost > 0) {
    lines.push(`${chalk.cyan('Upstream Cost:')} ${formatSmartMoney(clientStats.totalUpstreamCost)} (provider)`);
  }

  printPanel('cost', lines);
}

/**
 * Show subagent system status.
 * @param {object} session - The current AgentSession
 */
export function showAgents(session) {
  const subagentManager = session.subagentManager;
  if (!subagentManager) {
    console.log(chalk.gray('Subagent system not available'));
    return;
  }

  const stats = subagentManager.getStats();
  const tasks = subagentManager.getAllTasksStatus();
  const specializations = subagentManager.constructor.listSpecializations();

  // Stats section
  const successBar = stats.totalTasks > 0
    ? miniBar(stats.completedTasks, stats.totalTasks)
    : chalk.dim('no tasks yet');
  let content = `${chalk.bold.white('📊 Stats')}` +
    `\n  Tasks: ${chalk.white(stats.totalTasks)} total ${chalk.dim('│')} ${chalk.green(stats.completedTasks)} done ${chalk.dim('│')} ${chalk.red(stats.failedTasks)} failed ${chalk.dim('│')} ${chalk.cyan(stats.runningTasks)} running` +
    `\n  Rate:  ${successBar}  ${chalk.white(stats.successRate)}` +
    `\n  Speed: ${chalk.white(stats.avgDuration)} avg ${stats.totalRetries > 0 ? chalk.dim(`│ ${stats.totalRetries} retries`) : ''}` +
    (stats.totalCost > 0 ? `\n  Cost:  ${chalk.white(formatSmartMoney(stats.totalCost))} total` : '');

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

  printPanel('agents', content.split('\n'));
}
