/**
 * 💾 Session Operations
 * Save, load, export, undo, diff, checkpoints, and session management.
 */

import chalk from '../utils/chalk-compat.js';
import boxen from 'boxen';
import fs from '../utils/fs-compat.js';
import path from 'path';
import { spinner } from '../utils/spinners.js';
import { AgentSession } from '../agent/AgentSession.js';
import { boxStyles } from '../utils.js';
import { promptWithTerminalReset } from './terminal.js';
import { truncateInline, shortenModelLabel } from './formatting.js';

const box = boxStyles;

// ═══════════════════════════════════════════════════════════════════
// 💾 Save & Load
// ═══════════════════════════════════════════════════════════════════

/**
 * Save the current session
 */
export async function saveSession(cli) {
  // Sync CLI-level cost/session state before saving
  if (cli._syncSessionCostMeta) cli._syncSessionCostMeta();
  const result = await cli.session.save();
  if (result.success) {
    cli.lastSaveTime = Date.now();
    console.log(chalk.green(`✓ Saved to ${result.path}`));
  } else {
    console.log(chalk.red('✗ Save failed'));
  }
}

/**
 * Load a saved session (interactive picker)
 */
export async function loadSession(cli) {
  const sessions = await AgentSession.listSessions(undefined, {
    workingDir: cli.workingDir,
  });

  if (sessions.length === 0) {
    console.log(chalk.gray('No saved sessions'));
    return;
  }

  const choices = sessions.map(s => ({
    name: [
      s.sessionId,
      s.model ? shortenModelLabel(s.model) : null,
      s.iterations ? `${s.iterations} iter` : null,
      s.lastTask ? truncateInline(s.lastTask, 42) : null,
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
    workingDir: cli.workingDir,
    permissions: cli.permissions,
    allowFullAccess: cli.allowFullAccess,
  });

  if (loaded) {
    cli.session = loaded;
    cli.syncSessionModelState(cli.session.agent.model);

    // Restore CLI-level session tracking from loaded session
    if (loaded._cliSessionMeta) {
      const meta = loaded._cliSessionMeta;
      if (meta.sessionStartTime) cli.sessionStartTime = meta.sessionStartTime;
      if (meta.totalCost != null) cli.totalCost = meta.totalCost;
      if (meta.totalTokens != null) cli.totalTokens = meta.totalTokens;
      if (meta.taskCount != null) cli.taskCount = meta.taskCount;
    }

    console.log(chalk.green(`✓ Loaded ${sessionId}`));
    console.log(chalk.gray(`  Model: ${chalk.cyan(cli.session.agent.model)}`));
    if (cli.session.activeWorkspace?.workspaceDir) {
      console.log(chalk.gray(`  Workspace: ${truncateInline(cli.session.activeWorkspace.workspaceDir, 40)}`));
    }
    if (cli.session.metadata?.lastTask) {
      console.log(chalk.gray(`  Last task: ${truncateInline(cli.session.metadata.lastTask, 80)}`));
    }
  } else {
    console.log(chalk.red('✗ Load failed'));
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📋 Session Checkpoints
// ═══════════════════════════════════════════════════════════════════

/**
 * Handle session subcommands: save, restore, list
 */
export async function handleSessionCommand(cli, args) {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();
  const subArgs = parts.slice(1).join(' ');

  switch (subcommand) {
    case 'save':
    case '':
      await sessionSaveWithName(cli, subArgs);
      break;

    case 'restore':
      if (!subArgs) {
        console.log(chalk.gray('Usage: /session restore <checkpoint-id>'));
        console.log(chalk.gray('Use /session list to see available checkpoints'));
      } else {
        await sessionRestoreCheckpoint(cli, subArgs);
      }
      break;

    case 'list':
      await sessionListCheckpoints(cli);
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
async function sessionSaveWithName(cli, name) {
  const label = name || `manual_${Date.now()}`;
  const checkpointId = cli.session.createCheckpoint(label);
  console.log(chalk.green(`✓ Checkpoint created: ${chalk.cyan(checkpointId)}`));

  // Sync CLI-level cost/session state before saving
  if (cli._syncSessionCostMeta) cli._syncSessionCostMeta();
  await cli.session.save();
  console.log(chalk.green(`✓ Session saved`));
}

/**
 * Restore a session checkpoint
 */
async function sessionRestoreCheckpoint(cli, checkpointId) {
  const result = cli.session.restoreCheckpoint(checkpointId);
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
async function sessionListCheckpoints(cli) {
  const checkpoints = cli.session.listCheckpoints();

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

// ═══════════════════════════════════════════════════════════════════
// ↩️ Undo & Diff
// ═══════════════════════════════════════════════════════════════════

/**
 * Undo last file change by restoring a .bak file
 */
export async function handleUndo(cli) {
  const bakFiles = await findBakFiles(cli);

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
    console.log(chalk.green(`✓ Restored ${path.relative(cli.workingDir, originalPath)}`));
  } catch (error) {
    console.log(chalk.red(`✗ Restore failed: ${error.message}`));
  }
}

/**
 * Find all .bak files in the working directory recursively
 */
async function findBakFiles(cli) {
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
            relative: path.relative(cli.workingDir, fullPath),
            mtime: stat.mtime,
          });
        }
      }
    } catch { /* skip unreadable directories during walk */ }
  };
  await walk(cli.workingDir);
  return results.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Show line-by-line diffs for .bak files vs current
 */
export async function handleDiff(cli) {
  const bakFiles = await findBakFiles(cli);

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

// ═══════════════════════════════════════════════════════════════════
// 📤 Export
// ═══════════════════════════════════════════════════════════════════

/**
 * Export conversation as markdown to .openagent/exports/
 */
export async function handleExport(cli) {
  const messages = cli.session?.agent?.messages || [];

  if (messages.length === 0) {
    console.log(chalk.gray('No conversation to export'));
    return;
  }

  const exportDir = path.join(cli.workingDir, '.openagent', 'exports');
  await fs.ensureDir(exportDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `conversation-${timestamp}.md`;
  const exportPath = path.join(exportDir, filename);

  let markdown = `# OpenAgent Conversation Export\n\n`;
  markdown += `**Date:** ${new Date().toLocaleString()}\n`;
  markdown += `**Model:** ${cli.session?.agent?.model || 'unknown'}\n`;
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
  console.log(chalk.green(`✓ Exported ${messages.length} messages to ${path.relative(cli.workingDir, exportPath)}`));
}

// ═══════════════════════════════════════════════════════════════════
// 🔄 Reset
// ═══════════════════════════════════════════════════════════════════

/**
 * Reset session
 */
export async function resetSession(cli) {
  const { confirm } = await promptWithTerminalReset([{
    type: 'confirm',
    name: 'confirm',
    message: 'Reset session? This will start a brand-new session and clear the current conversation/task state.',
    default: false,
  }]);

  if (confirm) {
    const currentModel = cli.session?.agent?.model || cli.session?.model;
    const saveDir = cli.session?.saveDir;
    const taskDir = cli.session?.taskManager?.taskDir;
    const openAgentDir = cli.session?.workspaceManager?.openAgentDir;

    await cli.session?.taskManager?.reset();
    cli.createSession({
      modelId: currentModel,
      activeWorkspace: null,
      saveDir,
      taskDir,
      openAgentDir,
    });

    cli.taskCount = 0;
    cli.history = [];
    cli.sessionStartTime = Date.now();
    cli.totalCost = 0;
    cli.totalTokens = 0;
    cli.currentTask = null;
    cli.taskStartTime = null;
    console.log(chalk.green(`✓ Started new session ${chalk.cyan(cli.session.sessionId)}`));
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🩺 Shell & Doctor
// ═══════════════════════════════════════════════════════════════════

/**
 * Run a shell command and display results
 */
export async function runShellCommand(cli, command) {
  const s = spinner(chalk.gray(`Running: ${command}`));

  try {
    const result = await cli.session.toolRegistry.execute('exec', { command });
    s.stop();

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
    s.error(chalk.red(`Error: ${error.message}`));
  }
}
