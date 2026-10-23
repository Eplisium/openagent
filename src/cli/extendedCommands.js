/**
 * 🧩 Extended slash commands: checkpoints/rewind, markdown custom commands, markdown agents.
 *
 * ┌──────────────────────────── CONTRACT (for cli.js) ────────────────────────────┐
 * │ handleExtendedCommand(name, argsString, ctx) → Promise<false | true | {prompt}> │
 * │                                                                                │
 * │   name        command name WITHOUT the leading "/" (e.g. "rewind", "git:commit")│
 * │   argsString  raw text after the command name                                  │
 * │   ctx         { session, cli, print }                                          │
 * │                 print(text) writes a line to the terminal (defaults to         │
 * │                 console.log); session = AgentSession; cli = OpenAgentCLI.      │
 * │                                                                                │
 * │ Return values:                                                                 │
 * │   false             → not an extended command; caller continues its own         │
 * │                       handling (e.g. prints "Unknown command").                 │
 * │   true              → fully handled; nothing else to do.                        │
 * │   { prompt, model?, allowedTools?, command }                                    │
 * │                     → a custom markdown command expanded into a prompt. The    │
 * │                       caller MUST send `prompt` to the agent as if the user had │
 * │                       typed it. `model` / `allowedTools` are optional hints     │
 * │                       from frontmatter (caller may ignore them).               │
 * │                                                                                │
 * │ Call this BEFORE printing "Unknown command". Built-ins handled here:            │
 * │   /rewind [list | <turnId> | last] [--dry-run]   /checkpoints                   │
 * │   /commands                                       /agents  (markdown + built-in)│
 * │ If cli.js already handles /agents itself, it can keep doing so; this module     │
 * │ only sees names cli.js forwards to it.                                          │
 * │                                                                                │
 * │ listExtendedCommands() → [{ name, description, source }]  (for /help, completion)│
 * └────────────────────────────────────────────────────────────────────────────────┘
 */

import path from 'path';
import * as checkpointer from '../agent/TurnCheckpointer.js';
import { loadCustomCommands, expandCommand } from '../commands/markdownLoader.js';
import { SubagentManager } from '../agent/SubagentManager.js';

const BUILTINS = [
  { name: 'rewind', description: 'Rewind files to before a turn: /rewind [list|<turn>|last] [--dry-run]', source: 'builtin' },
  { name: 'checkpoints', description: 'List automatic per-turn file checkpoints', source: 'builtin' },
  { name: 'commands', description: 'List custom markdown commands', source: 'builtin' },
  { name: 'agents', description: 'List subagents (built-in + markdown)', source: 'builtin' },
];

function getCwd(ctx) {
  return path.resolve(ctx?.cli?.workingDir || ctx?.session?.workingDir || process.cwd());
}

function getPrint(ctx) {
  return typeof ctx?.print === 'function' ? ctx.print : (text) => console.log(text);
}

function rel(cwd, p) {
  const r = path.relative(cwd, p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

/** Format checkpoint turns as text. */
export function formatTurns(turns, cwd) {
  const withFiles = turns.filter((t) => t.files.length > 0);
  if (withFiles.length === 0) {
    return 'No checkpoints yet. File changes made by OpenAgent tools are checkpointed automatically per turn.';
  }
  const lines = ['Checkpoints (oldest → newest):'];
  for (const t of withFiles) {
    const label = t.label ? ` "${t.label.slice(0, 60)}${t.label.length > 60 ? '…' : ''}"` : '';
    lines.push(`  #${t.id}  ${formatTime(t.createdAt)}${label}${t.current ? '  (current)' : ''}`);
    for (const f of t.files.slice(0, 10)) {
      const flag = f.status === 'created' ? '+' : '~';
      const note = f.restorable ? '' : `  [not restorable: ${f.skipped}]`;
      lines.push(`      ${flag} ${rel(cwd, f.path)}${note}`);
    }
    if (t.files.length > 10) lines.push(`      … ${t.files.length - 10} more`);
  }
  lines.push('', 'Use /rewind <id> to restore files to their state before that turn (later turns are undone too).');
  return lines.join('\n');
}

function formatRewindResult(result, cwd) {
  if (!result.success && result.error) return `✗ ${result.error}`;
  const lines = [];
  const verb = result.dryRun ? 'Would rewind' : 'Rewound';
  lines.push(`${result.success ? '✓' : '⚠'} ${verb} turn(s) ${result.turnsRewound.map((id) => `#${id}`).join(', ')}`);
  for (const p of result.restored) lines.push(`  ↺ ${result.dryRun ? 'restore' : 'restored'} ${rel(cwd, p)}`);
  for (const p of result.deleted) lines.push(`  ✗ ${result.dryRun ? 'delete' : 'deleted'} ${rel(cwd, p)}`);
  for (const s of result.skipped) lines.push(`  ! skipped ${rel(cwd, s.path)} (${s.reason})`);
  for (const e of result.errors) lines.push(`  ✗ error ${rel(cwd, e.path)}: ${e.error}`);
  if (!result.restored.length && !result.deleted.length && !result.skipped.length) lines.push('  (no files needed changes)');
  if (!result.dryRun) lines.push('  Note: conversation history is unchanged; changes made by shell commands are not reverted.');
  return lines.join('\n');
}

async function handleRewind(argsString, ctx) {
  const print = getPrint(ctx);
  const cwd = getCwd(ctx);
  const tokens = String(argsString || '').trim().split(/\s+/).filter(Boolean);
  const dryRun = tokens.includes('--dry-run') || tokens.includes('-n');
  const arg = tokens.find((t) => !t.startsWith('-'));

  const turns = await checkpointer.listTurns();
  const withFiles = turns.filter((t) => t.files.length > 0);

  if (!arg || arg === 'list') {
    print(formatTurns(turns, cwd));
    return true;
  }

  let target;
  if (arg === 'last') {
    target = withFiles[withFiles.length - 1];
  } else if (/^#?\d+$/.test(arg)) {
    const id = Number(arg.replace('#', ''));
    target = withFiles.find((t) => t.id === id);
    if (!target) {
      print(`✗ Unknown checkpoint #${id}. Run /rewind list to see available turns.`);
      return true;
    }
  } else if (/^-?\d+$/.test(arg) || /^~\d+$/.test(arg)) {
    // "~2" → two turns back (rewind the last 2 turns with changes)
    const n = Number(arg.replace(/[~-]/, ''));
    target = withFiles[withFiles.length - n];
  } else {
    print('Usage: /rewind [list | <turnId> | last | ~N] [--dry-run]');
    return true;
  }

  if (!target) {
    print('✗ No checkpoints with file changes to rewind.');
    return true;
  }

  const result = await checkpointer.rewind(target.id, { code: !dryRun });
  print(formatRewindResult(result, cwd));
  return true;
}

async function handleCheckpoints(argsString, ctx) {
  const print = getPrint(ctx);
  const cwd = getCwd(ctx);
  const arg = String(argsString || '').trim();
  if (/^#?\d+$/.test(arg)) {
    const summary = await checkpointer.diffSummary(Number(arg.replace('#', '')));
    if (!summary.success) {
      print(`✗ ${summary.error}`);
      return true;
    }
    const lines = [`Checkpoint #${summary.turnId}${summary.label ? ` "${summary.label}"` : ''} — changes since (vs. current files):`];
    for (const f of summary.files) {
      lines.push(`  ${f.status.padEnd(9)} ${rel(cwd, f.path)}  +${f.added} -${f.removed}${f.reason ? ` (${f.reason})` : ''}`);
    }
    print(lines.join('\n'));
    return true;
  }
  const turns = await checkpointer.listTurns();
  const stats = await checkpointer.getStorageStats();
  print(`${formatTurns(turns, cwd)}\n\nStore: ${stats.storeDir} (${(stats.bytes / 1024).toFixed(1)} KB, ${stats.blobs} blobs)\nTip: /checkpoints <id> shows a per-file diff summary.`);
  return true;
}

function handleCommandsList(ctx) {
  const print = getPrint(ctx);
  const commands = [...loadCustomCommands({ cwd: getCwd(ctx) }).values()];
  if (commands.length === 0) {
    print('No custom commands. Add markdown files to .openagent/commands/ (project), ~/.openagent/commands/ (user), or .claude/commands/.');
    return true;
  }
  const lines = ['Custom commands:'];
  for (const c of commands.sort((a, b) => a.name.localeCompare(b.name))) {
    const hint = c.argumentHint ? ` ${c.argumentHint}` : '';
    lines.push(`  /${c.name}${hint}  — ${c.description}  [${c.source}]`);
  }
  print(lines.join('\n'));
  return true;
}

function handleAgentsList(ctx) {
  const print = getPrint(ctx);
  const specs = SubagentManager.listSpecializations({ cwd: getCwd(ctx) });
  const lines = ['Subagents (use with delegate_task specialization):'];
  for (const s of specs) {
    const tools = s.tools ? `  tools: ${s.tools.join(', ')}` : '';
    const model = s.model ? `  model: ${s.model}` : '';
    lines.push(`  ${s.id.padEnd(16)} ${s.description}  [${s.source}]${tools}${model}`);
  }
  lines.push('', 'Add your own in .openagent/agents/*.md, ~/.openagent/agents/*.md, or .claude/agents/*.md.');
  print(lines.join('\n'));
  return true;
}

/**
 * Handle an extended slash command. See the contract at the top of this file.
 * @param {string} name
 * @param {string} argsString
 * @param {{session?: any, cli?: any, print?: (text: string) => void}} ctx
 * @returns {Promise<boolean | {prompt: string, model?: string|null, allowedTools?: string[]|null, command: string}>}
 */
export async function handleExtendedCommand(name, argsString = '', ctx = {}) {
  const cmd = String(name || '').replace(/^\//, '').trim().toLowerCase();
  if (!cmd) return false;
  try {
    switch (cmd) {
      case 'rewind': return await handleRewind(argsString, ctx);
      case 'checkpoints': return await handleCheckpoints(argsString, ctx);
      case 'commands': return handleCommandsList(ctx);
      case 'agents': return handleAgentsList(ctx);
      default: break;
    }
    const custom = loadCustomCommands({ cwd: getCwd(ctx) }).get(cmd);
    if (!custom) return false;
    const prompt = await expandCommand(custom, argsString, { cwd: getCwd(ctx) });
    return {
      prompt,
      model: custom.model,
      allowedTools: custom.allowedTools,
      command: custom.name,
    };
  } catch (error) {
    getPrint(ctx)(`✗ /${cmd} failed: ${error.message}`);
    return true;
  }
}

/**
 * List built-in extended commands plus custom markdown commands.
 * @param {{cwd?: string}} [options]
 * @returns {Array<{name: string, description: string, source: string}>}
 */
export function listExtendedCommands(options = {}) {
  let custom = [];
  try {
    custom = [...loadCustomCommands({ cwd: options.cwd }).values()].map((c) => ({
      name: c.name,
      description: c.argumentHint ? `${c.description} ${c.argumentHint}` : c.description,
      source: c.source,
    }));
  } catch {
    custom = [];
  }
  const builtinNames = new Set(BUILTINS.map((b) => b.name));
  return [...BUILTINS, ...custom.filter((c) => !builtinNames.has(c.name))];
}

export default { handleExtendedCommand, listExtendedCommands };
