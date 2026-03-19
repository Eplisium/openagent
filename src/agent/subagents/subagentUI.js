/**
 * 🎨 Subagent UI Helpers
 * Clean visual output formatting for subagent execution.
 */

import chalk from 'chalk';

/** Strip ANSI codes for length calculation */
function stripAnsi(str) {
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

const UI = {
  SUBAGENT_PREFIX: chalk.dim('  │ '),
  SUBAGENT_START: chalk.dim('  ┌─'),
  SUBAGENT_END: chalk.dim('  └─'),
  SUBAGENT_DIVIDER: chalk.dim('  ├' + '─'.repeat(50)),
  
  header(specName, taskPreview) {
    const lines = [];
    lines.push('');
    lines.push(chalk.dim('  ┌' + '─'.repeat(58) + '┐'));
    lines.push(chalk.dim('  │ ') + chalk.cyan.bold(`⚡ Subagent: ${specName}`) + chalk.dim(' '.repeat(Math.max(0, 43 - specName.length)) + '│'));
    if (taskPreview) {
      const preview = taskPreview.length > 52 ? taskPreview.substring(0, 49) + '...' : taskPreview;
      lines.push(chalk.dim('  │ ') + chalk.gray(preview) + chalk.dim(' '.repeat(Math.max(0, 55 - preview.length)) + '│'));
    }
    lines.push(chalk.dim('  ├' + '─'.repeat(58) + '┤'));
    return lines.join('\n');
  },
  
  footer(success, duration, iterations) {
    const status = success 
      ? chalk.green.bold('✓ Complete')
      : chalk.red.bold('✗ Failed');
    const time = chalk.gray(`${(duration / 1000).toFixed(1)}s`);
    const iters = iterations ? chalk.gray(`${iterations} iterations`) : '';
    const line = `${status} ${time}${iters ? ' • ' + iters : ''}`;
    const lines = [];
    lines.push(chalk.dim('  ├' + '─'.repeat(58) + '┤'));
    lines.push(chalk.dim('  │ ') + line + chalk.dim(' '.repeat(Math.max(0, 55 - stripAnsi(line).length)) + '│'));
    lines.push(chalk.dim('  └' + '─'.repeat(58) + '┘'));
    lines.push('');
    return lines.join('\n');
  },
  
  progress(message) {
    return chalk.dim('  │ ') + chalk.gray(`  ${message}`);
  },
  
  parallelHeader(taskCount, maxConcurrent) {
    const lines = [];
    lines.push('');
    lines.push(chalk.dim('  ╔' + '═'.repeat(58) + '╗'));
    lines.push(chalk.dim('  ║ ') + chalk.cyan.bold(`🚀 Parallel Execution: ${taskCount} tasks`) + chalk.gray(` (max ${maxConcurrent} concurrent)`) + chalk.dim(' '.repeat(Math.max(0, 30 - String(taskCount).length - String(maxConcurrent).length)) + '║'));
    lines.push(chalk.dim('  ╠' + '═'.repeat(58) + '╣'));
    return lines.join('\n');
  },
  
  parallelFooter(results) {
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalDuration = Math.max(...results.map(r => r.duration || 0));
    
    const lines = [];
    lines.push(chalk.dim('  ╠' + '═'.repeat(58) + '╣'));
    const summary = `${chalk.green(`✓ ${success} passed`)}${failed > 0 ? chalk.red(` • ✗ ${failed} failed`) : ''} ${chalk.gray(`• ${(totalDuration / 1000).toFixed(1)}s total`)}`;
    lines.push(chalk.dim('  ║ ') + summary + chalk.dim(' '.repeat(Math.max(0, 55 - stripAnsi(summary).length)) + '║'));
    lines.push(chalk.dim('  ╚' + '═'.repeat(58) + '╝'));
    lines.push('');
    return lines.join('\n');
  },

  taskRow(index, specName, status, preview) {
    const icons = {
      'queued': chalk.gray('○'),
      'pending': chalk.yellow('◔'),
      'running': chalk.cyan('◑'),
      'completed': chalk.green('●'),
      'failed': chalk.red('●'),
      'retrying': chalk.yellow('↻'),
    };
    const icon = icons[status] || chalk.gray('?');
    const shortPreview = preview.length > 40 ? preview.substring(0, 37) + '...' : preview;
    return chalk.dim('  ║ ') + `  ${icon} ${chalk.white(`#${index + 1}`)} ${chalk.cyan(specName.padEnd(12))} ${chalk.gray(shortPreview)}`;
  },
};

export { UI, stripAnsi };
export default UI;
