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
  getRelativeTime,
  deduplicateResponse,
  responsesAreSimilar,
  normalizeResponseText,
  formatTokens,
  formatCost
} from './formatting.js';
import { thinkingSpinner, respondingIndicator } from '../utils/spinners.js';
import { VERSION } from './state.js';
import { CONFIG } from '../config.js';
import { getActiveSkin, getSkinTheme } from './themes.js';

const TOOL_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEFAULT_THEME = {
  accent: '#89b4fa',
  muted: '#6c7086',
  text: '#cdd6f4',
  success: '#a6e3a1',
  warning: '#f9e2af',
  error: '#f38ba8',
  tool: '#cba6f7',
  user: '#89b4fa',
  assistant: '#cdd6f4',
  header: '#cba6f7',
};

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
  const t = cli?.theme || DEFAULT_THEME;
  return chalk.hex(t.accent || DEFAULT_THEME.accent)(text);
}

function muted(cli, text) {
  const t = cli?.theme || DEFAULT_THEME;
  return chalk.hex(t.muted || DEFAULT_THEME.muted)(text);
}

function lineRows(text) {
  return String(text || '').split('\n');
}

function renderWithLeftBar(cli, content) {
  const t = cli.theme;
  const bar = chalk.hex(t.assistant || t.accent)('│');
  const body = lineRows(content).map(line => `  ${bar} ${line}`).join('\n');
  return body;
}

function renderWithRoleBar(cli, content, { role = 'assistant', prefix = '│' } = {}) {
  const t = cli.theme || DEFAULT_THEME;
  const color = t[role] || t.assistant || t.accent || DEFAULT_THEME.accent;
  const marker = chalk.hex(color)(prefix);
  return lineRows(content).map(line => `  ${marker} ${line}`).join('\n');
}

function getToolStore(cli) {
  if (!cli._toolLineStates) cli._toolLineStates = [];
  return cli._toolLineStates;
}

function activeToolStates(store) {
  return store.filter(state => !state.done);
}

function clearInline(width = 120) {
  process.stdout.write('\r' + ' '.repeat(width) + '\r');
}

function visibleLen(str) {
  return String(str || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').length;
}

function markContentRendered(cli, content, { intermediate = false } = {}) {
  const text = String(content || '').trim();
  if (!text) return;
  const key = normalizeResponseText(text);
  cli._lastRenderedContent = text;
  cli._lastRenderedContentKey = key;
  cli._renderedContentHistory ||= [];
  if (!cli._renderedContentHistory.some(entry => entry.key === key)) {
    cli._renderedContentHistory.push({
      content: text,
      key,
      intermediate,
      at: Date.now(),
    });
    cli._renderedContentHistory = cli._renderedContentHistory.slice(-12);
  }
  if (intermediate) {
    cli._lastIntermediateContent = text;
    cli._lastIntermediateContentKey = key;
  }
}

function getRenderedContentCandidates(cli) {
  const candidates = [];
  const seen = new Set();
  const add = (content) => {
    const text = String(content || '').trim();
    if (!text) return;
    const key = normalizeResponseText(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(text);
  };

  add(cli._lastRenderedContent);
  add(cli._lastIntermediateContent);
  for (const entry of [...(cli._renderedContentHistory || [])].reverse()) {
    add(entry?.content);
  }

  return candidates;
}

export function contentWasAlreadyRendered(cli, content) {
  const text = String(content || '').trim();
  if (!text) return false;
  for (const candidate of getRenderedContentCandidates(cli)) {
    if (responsesAreSimilar(candidate, text)) return true;
  }
  return false;
}

function normalizeForMatchWithMap(value) {
  const source = String(value || '');
  let text = '';
  const map = [];
  let pendingSpace = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (/\s/.test(char)) {
      if (text.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(index);
      pendingSpace = false;
    }
    text += char.toLowerCase();
    map.push(index);
  }

  return { text, map };
}

function stripRenderedCandidate(content, renderedContent) {
  const source = String(content || '').trim();
  const rendered = String(renderedContent || '').trim();
  if (!source || !rendered) return source;

  if (source.startsWith(rendered)) {
    return source.slice(rendered.length).trimStart();
  }

  const exactIndex = source.indexOf(rendered);
  if (exactIndex >= 0) {
    return source.slice(exactIndex + rendered.length).trimStart();
  }

  const normalizedSource = normalizeForMatchWithMap(source);
  const normalizedRendered = normalizeResponseText(rendered);
  if (normalizedRendered.length < 30) return source;

  const normalizedIndex = normalizedSource.text.indexOf(normalizedRendered);
  if (normalizedIndex < 0) return source;

  const normalizedEnd = normalizedIndex + normalizedRendered.length - 1;
  const originalEnd = normalizedSource.map[normalizedEnd];
  if (originalEnd == null) return source;
  return source.slice(originalEnd + 1).trimStart();
}

export function stripAlreadyRenderedPrefix(cli, content) {
  const text = String(content || '').trim();
  if (!text) return '';

  for (const candidate of getRenderedContentCandidates(cli)) {
    const stripped = stripRenderedCandidate(text, candidate);
    if (stripped !== text) {
      return stripped;
    }
  }

  if (contentWasAlreadyRendered(cli, text)) return '';
  return text;
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

function contextBar(percent = 0, length = 8, theme = DEFAULT_THEME) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((pct / 100) * length);
  const color = pct > 70 ? theme.error : pct > 40 ? theme.warning : theme.success;
  return chalk.hex(color || DEFAULT_THEME.success)('█'.repeat(filled)) +
    chalk.hex(theme.muted || DEFAULT_THEME.muted)('░'.repeat(Math.max(0, length - filled)));
}

function formatContextParts(cli) {
  const contextStats = cli.session?.agent?.getContextStats?.();
  const percent = contextStats?.percent || 0;
  const pctColor = percent > 70 ? chalk.hex(cli.theme.error) : percent > 40 ? chalk.hex(cli.theme.warning) : chalk.hex(cli.theme.success);
  return { contextStats, percent, pctColor };
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 Banner & Status Line
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the emoji for a tool from the active skin.
 */
export function getToolEmoji(toolName) {
  const skin = getActiveSkin();
  const emojis = skin.toolEmojis || {};
  return emojis[toolName] || '⚡';
}

/**
 * Print the OpenAgent startup banner
 */
export function printBanner() {
  const skin = getActiveSkin();
  const t = getSkinTheme();
  const agentName = CONFIG.AGENT_NAME || skin.branding.agentName || 'Luna';
  const version = VERSION;

  const moonArt = [
    '  ██╗   ██╗██╗     ██╗   ██╗',
    '  ██║   ██║██║     ╚██╗ ██╔╝',
    '  ██║   ██║██║      ╚████╔╝ ',
    '  ╚██╗ ██╔╝██║       ██╔╝  ',
    '   ╚████╔╝ ███████╗  ██║   ',
    '    ╚═══╝  ╚══════╝  ╚═╝   ',
  ];

  const width = Math.min(process.stdout.columns || 80, 72);
  const topBorder = chalk.hex(t.accent)(`  ╭${'─'.repeat(width)}╮`);
  const bottomBorder = chalk.hex(t.accent)(`  ╰${'─'.repeat(width)}╯`);

  console.log('');
  console.log(topBorder);

  for (const line of moonArt) {
    const pad = Math.max(0, width - line.length - 2);
    console.log(`${chalk.hex(t.accent)('  │')}${chalk.hex(t.header || t.accent)(line)}${' '.repeat(pad)}${chalk.hex(t.accent)('│')}`);
  }

  // Separator line
  const sepLine = chalk.hex(t.muted)('─'.repeat(width - 2));
  console.log(`${chalk.hex(t.accent)('  ├')}${sepLine}${chalk.hex(t.accent)('┤')}`);

  // Agent name + version + model
  const infoLine = `  ${agentName} v${version}`;
  const modelLabel = chalk.hex(t.muted)(`  │`) + chalk.hex(t.text)(infoLine) +
    chalk.hex(t.muted)(' '.repeat(Math.max(0, width - infoLine.length - 2))) +
    chalk.hex(t.accent)('│');
  console.log(modelLabel);

  // Tips line
  const tip = `Type ${chalk.hex(t.accent)('/help')} for commands`;
  const tipPad = Math.max(0, width - visibleLen(`  ${tip}`) - 2);
  console.log(`${chalk.hex(t.accent)('  │')}${chalk.hex(t.muted)('  ')}${tip}${' '.repeat(tipPad)}${chalk.hex(t.accent)('│')}`);

  console.log(bottomBorder);
}

/**
 * Format command list for display
 */
export function formatCommandList(entries = COMMAND_ENTRIES, theme = DEFAULT_THEME) {
  const t = theme || DEFAULT_THEME;
  const commandWidth = entries.reduce((max, [command]) => Math.max(max, command.length), 0);
  return entries
    .map(([command, description]) =>
      `${chalk.hex(t.accent || DEFAULT_THEME.accent)(command.padEnd(commandWidth + 2))}${chalk.hex(t.muted || DEFAULT_THEME.muted)(description)}`
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
  const skin = getActiveSkin();
  const agentName = CONFIG.AGENT_NAME || skin.branding.agentName || 'Luna';
  parts.push(chalk.hex(t.accent)(`${agentName} · ${modelShort}`));

  // Context usage
  if (cli.session?.agent) {
    const { percent, pctColor } = formatContextParts(cli);
    parts.push(`${contextBar(percent, 8, t)} ${pctColor(`${percent}% ctx`)}`);
  }

  // Task count
  parts.push(chalk.hex(t.muted)(`${cli.taskCount || 0} tasks`));

  const workspaceDir = cli.session?.activeWorkspace?.workspaceDir;
  if (workspaceDir) {
    const workspaceLabel = workspaceDir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || workspaceDir;
    parts.push(chalk.hex(t.muted)(`▸ ${workspaceLabel}`));
  }

  return parts.join(chalk.hex(t.muted)(' │ '));
}

export function printUserMessage(cli, content) {
  if (!content || !String(content).trim()) return false;
  const skin = getActiveSkin();
  const promptSym = skin.branding?.promptSymbol || '▸';
  console.log('');
  console.log(renderWithRoleBar(cli, String(content), { role: 'user', prefix: promptSym }));
  return true;
}

/**
 * Print an iteration label between agent loops (like Hermes's "── iteration 3 ──")
 */
export function printIterationLabel(cli, iterationNum) {
  const t = cli.theme || DEFAULT_THEME;
  const raw = String(iterationNum || '').trim();
  const label = raw.startsWith('iteration') ? raw : `iteration ${raw}`;
  console.log('');
  console.log(
    chalk.hex(t.muted)('  ── ') +
    chalk.hex(t.accent || DEFAULT_THEME.accent)(label) +
    chalk.hex(t.muted)(' ──')
  );
}

export function printSystemMessage(cli, content) {
  if (!content || !String(content).trim()) return false;
  console.log(renderWithRoleBar(cli, String(content), { role: 'muted', prefix: '○' }));
  return true;
}

export function printAssistantHeader(cli, { durationMs = null, toolCount = 0, usage = null } = {}) {
  const t = cli.theme || DEFAULT_THEME;
  if (cli._assistantHeaderPrintedForTask === cli.taskStartTime) return;
  cli._assistantHeaderPrintedForTask = cli.taskStartTime || Date.now();
  const model = shortenModelLabel(cli.session?.agent?.model || 'assistant');
  const { contextStats, percent } = formatContextParts(cli);
  const used = contextStats ? formatCompactNumber(contextStats.usedTokens) : '0';
  const max = contextStats ? formatCompactNumber(contextStats.maxTokens) : '?';
  const elapsed = durationMs == null && cli.taskStartTime ? Date.now() - cli.taskStartTime : durationMs;
  const stats = [
    elapsed != null ? formatDuration(elapsed) : null,
    `${toolCount || 0} tools`,
    `${used}/${max} ctx`,
    `${percent}%`,
  ].filter(Boolean);
  // Add cost and token counts if available from usage
  if (usage) {
    const cost = usage.cost;
    if (cost != null && cost > 0) {
      stats.push(formatCompactCost(cost));
    }
    const inputT = usage.prompt_tokens || 0;
    const outputT = usage.completion_tokens || 0;
    if (inputT > 0 || outputT > 0) {
      stats.push(`${formatCompactNumber(inputT)}→${formatCompactNumber(outputT)} tok`);
    }
  }
  const statsStr = stats.join(' · ');
  const skin = getActiveSkin();
  const label = skin.branding?.responseLabel || ` ${model} `;
  const inner = ` ${chalk.hex(t.header || t.accent || DEFAULT_THEME.accent)(label)} ${chalk.hex(t.muted || DEFAULT_THEME.muted)(statsStr)} `;
  const width = Math.min(Math.max(visibleLen(inner), 24), termWidth(96));
  const pad = Math.max(0, width - visibleLen(inner));
  const top = chalk.hex(t.accent || DEFAULT_THEME.accent)(`  ╭${'─'.repeat(width)}╮`);
  const mid = `  ${chalk.hex(t.accent || DEFAULT_THEME.accent)('│')}${inner}${' '.repeat(pad)}${chalk.hex(t.accent || DEFAULT_THEME.accent)('│')}`;
  const bottom = chalk.hex(t.accent || DEFAULT_THEME.accent)(`  ╰${'─'.repeat(width)}╯`);
  console.log(`\n${top}\n${mid}\n${bottom}`);
}

// ═══════════════════════════════════════════════════════════════════
// 💬 AI Response & Spinners
// ═══════════════════════════════════════════════════════════════════

/**
 * Print AI response with a subtle left accent bar.
 */
export function printAIResponse(cli, content, usage = null) {
  const displayContent = deduplicateResponse(String(content || ''));
  if (!displayContent || !displayContent.trim()) return false;
  if (cli._streamRenderer?.active) {
    const result = cli._streamRenderer.finish(displayContent, usage);
    cli._streamRenderer = null;
    return result === true || result === 'rendered' || result === 'already-rendered';
  }
  const unrenderedContent = stripAlreadyRenderedPrefix(cli, displayContent);
  if (!unrenderedContent.trim()) return true;
  printAssistantHeader(cli, {
    durationMs: cli.taskStartTime ? Date.now() - cli.taskStartTime : null,
    toolCount: cli._toolLineStates?.length || 0,
    usage,
  });
  const rendered = cli.isMarkdownEnabled() ? renderMarkdown(unrenderedContent, cli.theme) : unrenderedContent;
  console.log('');
  console.log(renderWithLeftBar(cli, rendered));
  markContentRendered(cli, displayContent);
  return true;
}

/**
 * Print intermediate model thinking (dimmed, compact)
 * Shown when the model produces text alongside tool calls or when
 * the no-action trap catches a response — keeps the user informed
 * without treating it as the final answer.
 */
export function printIntermediateContent(cli, content) {
  const displayContent = deduplicateResponse(String(content || ''));
  if (!displayContent || !displayContent.trim()) return false;
  const unrenderedContent = stripAlreadyRenderedPrefix(cli, displayContent);
  if (!unrenderedContent.trim()) return true;
  markContentRendered(cli, displayContent, { intermediate: true });
  // Truncate long intermediate content to keep the display clean
  const maxLen = 500;
  const truncated = unrenderedContent.length > maxLen
  ? unrenderedContent.substring(0, maxLen) + chalk.dim(' [...]')
  : unrenderedContent;
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
export function showRespondingIndicator(cli = null) {
  return respondingIndicator(cli?.theme);
}

export function createStreamingRenderer(cli) {
  const cursor = '▌';
  let active = false;
  let content = '';
  let renderedLines = [];
  let renderedLineCount = 0;
  let scheduled = null;
  let fallback = false;
  let rendered = false;
  let lastWidth = process.stdout.columns || 80;

  const begin = () => {
    if (active) return;
    active = true;
    printAssistantHeader(cli, {
      durationMs: cli.taskStartTime ? Date.now() - cli.taskStartTime : null,
      toolCount: cli._toolLineStates?.length || 0,
    });
  };

  const clearFromLine = (lineIndex = 0) => {
    if (renderedLineCount <= 0) return;
    const bounded = Math.max(0, Math.min(lineIndex, renderedLineCount - 1));
    const up = renderedLineCount - 1 - bounded;
    if (up > 0) process.stdout.write(`\x1b[${up}A`);
    process.stdout.write('\r\x1b[J');
  };

  const addCursor = (lines) => {
    if (lines.length === 0) return [chalk.hex(cli.theme?.accent || DEFAULT_THEME.accent)(cursor)];
    const next = [...lines];
    const cursorColor = chalk.hex(cli.theme?.accent || DEFAULT_THEME.accent);
    next[next.length - 1] = `${next[next.length - 1]}${cursorColor(cursor)}`;
    return next;
  };

  const renderFrame = (final = false) => {
    if (!active && !final) return;
    const started = performance.now?.() || Date.now();
    try {
      const source = content;
      const currentWidth = process.stdout.columns || 80;
      const widthChanged = currentWidth !== lastWidth;
      const renderedOutput = cli.isMarkdownEnabled() ? renderMarkdown(source, cli.theme) : source;
      let frame = renderWithLeftBar(cli, renderedOutput || '').split('\n');
      if (!final) {
        // Add progress indicator showing character count and line count
        const charCount = content.length;
        const lineCount = (content.match(/\n/g) || []).length + 1;
        const progressText = chalk.hex(cli.theme?.muted || DEFAULT_THEME.muted)(
          `  ╌╌ ${formatTokens(charCount)} chars · ${lineCount} lines ╌╌`
        );
        frame.push(progressText);
        frame = addCursor(frame);
      }

      const commonLength = Math.min(renderedLineCount, frame.length);
      let firstDiff = commonLength;
      for (let i = 0; i < commonLength; i++) {
        if (frame[i] !== renderedLines[i]) {
          firstDiff = i;
          break;
        }
      }
      if (frame.length < renderedLineCount && firstDiff === frame.length) {
        firstDiff = Math.max(0, frame.length - 1);
      }
      if (widthChanged) firstDiff = 0;

      if (firstDiff === renderedLineCount && firstDiff === frame.length) return;

      if (renderedLineCount > 0) clearFromLine(firstDiff);
      process.stdout.write(frame.slice(firstDiff).join('\n'));
      renderedLines = frame;
      renderedLineCount = frame.length;
      lastWidth = currentWidth;
      cli._lastStreamRenderMs = (performance.now?.() || Date.now()) - started;
      if (cli._lastStreamRenderMs > 5) {
        cli._streamRenderSlowFrames = (cli._streamRenderSlowFrames || 0) + 1;
      }
    } catch {
      fallback = true;
      const plain = renderWithLeftBar(cli, content).split('\n');
      const frame = addCursor(plain);
      if (renderedLineCount > 0) clearFromLine(0);
      process.stdout.write(frame.join('\n'));
      renderedLines = frame;
      renderedLineCount = frame.length;
    }
  };
  const scheduleRender = () => {
    if (scheduled || fallback) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      renderFrame(false);
    }, content.length > 5000 ? 48 : 24);
    scheduled.unref?.();
  };

  return {
    get active() { return active; },
    get _rendered() { return rendered; },
    write(delta) {
      if (!delta) return;
      begin();
      content += delta;
      if (fallback) {
        const frame = addCursor(renderWithLeftBar(cli, content).split('\n'));
        if (renderedLineCount > 0) clearFromLine(0);
        process.stdout.write(frame.join('\n'));
        renderedLines = frame;
        renderedLineCount = frame.length;
        lastWidth = process.stdout.columns || 80;
        return;
      }
      scheduleRender();
    },
    commitIntermediate(intermediateContent = content) {
      if (!active) return false;
      if (scheduled) clearTimeout(scheduled);
      scheduled = null;
      if (renderedLineCount > 0) clearFromLine(0);
      if (intermediateContent && String(intermediateContent).trim()) {
        content = deduplicateResponse(String(intermediateContent));
      }
      const didRender = printIntermediateContent(cli, content);
      rendered = didRender || rendered;
      active = false;
      content = '';
      renderedLineCount = 0;
      renderedLines = [];
      fallback = false;
      lastWidth = process.stdout.columns || 80;
      return didRender;
    },
    finish(finalContent = content, usage = null) {
      if (scheduled) clearTimeout(scheduled);
      scheduled = null;
      const displayContent = deduplicateResponse(String(finalContent || content || ''));
      if (!active) {
        if (!displayContent || !displayContent.trim()) {
          return rendered ? 'already-rendered' : 'empty';
        }
        const unrenderedContent = stripAlreadyRenderedPrefix(cli, displayContent);
        if (!unrenderedContent.trim()) {
          rendered = true;
          return 'already-rendered';
        }
        rendered = printAIResponse(cli, displayContent, usage) || rendered;
        return rendered ? 'rendered' : 'empty';
      }
      content = displayContent;
      renderFrame(true);
      active = false;
      rendered = true;
      markContentRendered(cli, content);
      process.stdout.write('\n');
      // Show compact inline usage summary after stream completes
      if (usage) {
        const t = cli.theme || DEFAULT_THEME;
        const parts = [];
        const cost = usage.cost;
        if (cost != null && cost > 0) parts.push(formatCompactCost(cost));
        const inT = usage.prompt_tokens || 0;
        const outT = usage.completion_tokens || 0;
        if (inT > 0 || outT > 0) parts.push(`${formatCompactNumber(inT)}→${formatCompactNumber(outT)} tok`);
        const cached = usage.prompt_tokens_details?.cached_tokens || 0;
        if (cached > 0) parts.push(`${formatCompactNumber(cached)} cached`);
        if (parts.length > 0) {
          console.log(chalk.hex(t.muted)(`  └─ ${parts.join(' · ')}`));
        }
      }
      return 'rendered';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 🔧 Tool Call Visualization
// ═══════════════════════════════════════════════════════════════════

/**
 * Format tool arguments for compact display
 */
export function formatToolArgs(toolName, args, theme = DEFAULT_THEME) {
  const t = theme || DEFAULT_THEME;
  const dim = chalk.hex(t.muted || DEFAULT_THEME.muted);
  if (!args || Object.keys(args).length === 0) return '';

  const width = Math.max(36, (process.stdout.columns || 100) - 24);
  const smart = (value, max = width) => dim(smartTruncate(String(value || ''), max));

  if (args.path) return smart(args.path);
  if (args.filePath) return smart(args.filePath);
  if (args.command) return smart(args.command, Math.max(60, width));
  if (args.query) return dim(`"${smartTruncate(args.query, Math.min(80, width))}"`);
  if (args.url) return smart(args.url, Math.min(96, width));
  if (args.file) return smart(args.file);

  const firstKey = Object.keys(args)[0];
  const firstVal = typeof args[firstKey] === 'string'
    ? args[firstKey]
    : JSON.stringify(args[firstKey]);
  return dim(`${firstKey}: ${smartTruncate(firstVal, Math.min(80, width))}`);
}

function smartTruncate(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const pathMatch = text.match(/(?:[A-Za-z]:)?[./\\]?[\w .-]+(?:[\\/][\w .-]+)+/);
  if (pathMatch && pathMatch[0].length < max - 8) {
    const before = text.slice(0, pathMatch.index).trim();
    const after = text.slice((pathMatch.index || 0) + pathMatch[0].length).trim();
    const remaining = max - pathMatch[0].length - 5;
    return `${before ? smartTruncate(before, Math.floor(remaining / 2)) + ' ' : ''}${pathMatch[0]}${after ? ' ' + smartTruncate(after, Math.ceil(remaining / 2)) : ''}`;
  }
  const head = Math.ceil((max - 1) * 0.65);
  const tail = Math.floor((max - 1) * 0.35);
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function stopToolVisual(store, clear = true) {
  if (store.visualState?.interval) clearInterval(store.visualState.interval);
  if (clear && store.visualState) clearInline(store.visualState.width || 120);
  if (store.visualState) store.visualState.interval = null;
  store.visualState = null;
}

function renderToolState(cli, store, state) {
  const t = cli.theme;
  stopToolVisual(store);
  store.visualState = state;
  const render = () => {
    const elapsedStr = formatDuration(Date.now() - state.startedAt);
    const frame = TOOL_FRAMES[state.frame % TOOL_FRAMES.length];
    const emoji = getToolEmoji(state.toolName);
    state.frame++;
    state.text = `  ${chalk.hex(t.tool)(frame)} ${emoji} ${chalk.hex(t.tool)(state.toolName)}${state.argPreview ? ` ${state.argPreview}` : ''}${chalk.hex(t.muted)(` [${elapsedStr}]`)}`;
    clearInline(state.width);
    process.stdout.write(state.text);
  };
  render();
  state.interval = setInterval(render, 80);
  state.interval.unref?.();
}

function stopBatchVisual(store) {
  if (store.batchInterval) clearInterval(store.batchInterval);
  store.batchInterval = null;
  if (store.batchMode) {
    if (store.batchRows > 1) process.stdout.write(`\x1b[${store.batchRows - 1}A`);
    process.stdout.write('\r\x1b[J');
  }
  store.batchRows = 0;
}

function renderToolBatch(cli, store) {
  const t = cli.theme;
  const active = activeToolStates(store);
  if (active.length === 0) return;
  const startedAt = Math.min(...active.map(state => state.startedAt));
  const elapsedStr = formatDuration(Date.now() - startedAt);
  const frame = TOOL_FRAMES[store.batchFrame % TOOL_FRAMES.length];
  store.batchFrame++;
  store.batchWidth = process.stdout.columns || 120;
  if (store.batchRows) {
    if (store.batchRows > 1) process.stdout.write(`\x1b[${store.batchRows - 1}A`);
    process.stdout.write('\r\x1b[J');
  } else {
    clearInline(store.batchWidth);
  }
  const lines = [
    `  ${chalk.hex(t.tool)(frame)} ${active.length} tools running... ${chalk.hex(t.muted)(elapsedStr)}`,
    ...active.slice(0, 6).map(state => `    ${getToolEmoji(state.toolName)} ${chalk.hex(t.tool)(state.toolName)}${state.argPreview ? ` ${state.argPreview}` : ''}`),
  ];
  process.stdout.write(lines.join('\n'));
  store.batchRows = lines.length;
}

function enterToolBatch(cli, store) {
  stopToolVisual(store);
  if (!store.batchMode) {
    store.batchMode = true;
    store.batchFrame = 0;
  }
  if (store.batchInterval) clearInterval(store.batchInterval);
  renderToolBatch(cli, store);
  store.batchInterval = setInterval(() => renderToolBatch(cli, store), 80);
  store.batchInterval.unref?.();
}

function buildToolResultLine(cli, state, toolName, result, taskStartTime) {
  const t = cli.theme;
  const resultData = result.result || result;
  const elapsed = state ? Date.now() - state.startedAt : Date.now() - taskStartTime;
  const elapsedStr = formatDuration(elapsed);
  const argPreview = formatToolArgs(toolName, state?.args || {}, cli.theme);
  const ok = result.success !== false;
  const status = ok ? chalk.hex(t.success)('✓') : chalk.hex(t.error)('✗');
  const summary = ok ? summarizeToolResult(cli, toolName, resultData) : summarizeToolError(result, resultData);
  const emoji = getToolEmoji(toolName);
  if (state) state.detailLines = buildToolDetailLines(cli, toolName, result, resultData);
  return `  ${status} ${emoji} ${chalk.hex(t.tool)(toolName)}${argPreview ? ` ${argPreview}` : ''}${summary ? ` ${summary}` : ''}${chalk.hex(t.muted)(` [${elapsedStr}]`)}`;
}

function printPendingToolResults(store) {
  for (const state of store.filter(s => s.done && !s.resultPrinted && s.resultLine)) {
    console.log(state.resultLine);
    printToolDetails(state);
    state.resultPrinted = true;
  }
}

function printToolDetails(state) {
  if (!state?.detailLines?.length) return;
  for (const line of state.detailLines.slice(0, 3)) console.log(line);
}

function exitToolBatch(cli, store) {
  stopBatchVisual(store);
  store.batchMode = false;
  printPendingToolResults(store);
  const active = activeToolStates(store);
  if (active.length > 0) renderToolState(cli, store, active[active.length - 1]);
}

/**
 * Print enhanced tool call start with timing and context
 */
export function printEnhancedToolCallStart(cli, toolName, args, count, _taskStartTime) {
  cli._streamRenderer?.commitIntermediate();
  const argPreview = formatToolArgs(toolName, args, cli.theme);
  const startedAt = Date.now();
  const store = getToolStore(cli);
  const state = {
    id: count,
    toolName,
    args,
    argPreview,
    startedAt,
    frame: 0,
    done: false,
    width: process.stdout.columns || 120,
    text: '',
    resultLine: '',
    resultPrinted: false,
    detailLines: [],
  };
  store.push(state);

  if (activeToolStates(store).length >= 3) {
    enterToolBatch(cli, store);
    return;
  }

  if (!store.batchMode) renderToolState(cli, store, state);
}

/**
 * Enhanced tool call end with rich result display
 */
export function printEnhancedToolCallEnd(cli, toolName, result, taskStartTime, _count) {
  const store = getToolStore(cli);
  const state = store.find(s => !s.done && s.toolName === toolName) || store.find(s => !s.done);
  if (state?.interval) clearInterval(state.interval);
  if (state) state.done = true;
  const resultLine = buildToolResultLine(cli, state, toolName, result, taskStartTime);
  if (state) state.resultLine = resultLine;

  if (store.batchMode) {
    const active = activeToolStates(store);
    if (active.length >= 3) {
      renderToolBatch(cli, store);
      return;
    }
    exitToolBatch(cli, store);
    return;
  }

  if (store.visualState === state) {
    stopToolVisual(store);
    console.log(resultLine);
    printToolDetails(state);
    if (state) state.resultPrinted = true;
    const active = activeToolStates(store);
    if (active.length > 0) renderToolState(cli, store, active[active.length - 1]);
    return;
  }

  stopToolVisual(store);
  console.log(resultLine);
  printToolDetails(state);
  if (state) state.resultPrinted = true;
  const active = activeToolStates(store);
  if (active.length > 0) renderToolState(cli, store, active[active.length - 1]);
  return;
}

function buildToolDetailLines(cli, toolName, result, resultData) {
  const t = cli.theme;
  const dim = chalk.hex(t.muted);
  const lines = [];
  const ok = result.success !== false;
  if ((toolName === 'exec' || toolName === 'shell_exec') && (!ok || resultData?.stderr)) {
    const stderr = String(resultData?.stderr || result.error || resultData?.error || '').trim();
    const tail = stderr.split('\n').filter(Boolean).slice(-3);
    for (const line of tail) lines.push(dim(`    └─ ${truncateInline(line, 110)}`));
  } else if (toolName === 'read_file' && resultData?.content) {
    const preview = String(resultData.content).split('\n').slice(0, 3).filter(Boolean);
    for (const line of preview) lines.push(dim(`    └─ ${truncateInline(line, 110)}`));
  } else if (!ok) {
    const error = result.error || resultData?.error || resultData?.message;
    if (error) lines.push(dim(`    └─ ${truncateInline(String(error), 110)}`));
  } else if (resultData?.stdout && String(resultData.stdout).trim()) {
    const notable = String(resultData.stdout).trim().split('\n').slice(-2);
    for (const line of notable) lines.push(dim(`    └─ ${truncateInline(line, 110)}`));
  }
  return lines;
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
  const t = cli.theme;
  const seconds = (duration / 1000).toFixed(1);
  const modelId = cli.session.agent.model;
  const modelShort = shortenModelLabel(modelId);
  cli.syncSessionModelState(modelId);
  const contextStats = cli.session.agent.getContextStats();
  const contextUsed = contextStats.usedTokens;
  const contextMax = contextStats.maxTokens;
  const contextPct = contextStats.percent;
  const contextColor = contextPct > 70 ? chalk.hex(t.error) : contextPct > 40 ? chalk.hex(t.warning) : chalk.hex(t.success);

  if (result.performance) {
    cli.totalTokens += result.performance.totalToolCalls * 1000;
  }

  console.log('');
  console.log(chalk.hex(t.muted)(`  ── `) +
    chalk.hex(t.tool)(modelShort) + chalk.hex(t.muted)(' • ') +
    contextBar(contextPct, 8, t) + chalk.hex(t.muted)(' ') +
    contextColor(`${formatCompactNumber(contextUsed)}/${formatCompactNumber(contextMax)} ctx est (${contextPct}%)`) + chalk.hex(t.muted)(' • ') +
    chalk.hex(t.text)(`${result.iterations} iter`) + chalk.hex(t.muted)(' • ') +
    chalk.hex(t.text)(`${result.stats.toolExecutions} tools`) + chalk.hex(t.muted)(' • ') +
    chalk.hex(t.text)(`${seconds}s`) +
    chalk.hex(t.muted)(' ──'));

  if (result.performance && result.performance.totalRetries > 0) {
    console.log(chalk.hex(t.muted)(`  └─ ${result.performance.totalRetries} retries`));
  }
  if (result.stopReason && result.stopReason !== 'completed') {
    console.log(chalk.hex(t.muted)(`  └─ stop reason: ${result.stopReason}`));
  }
  if (result.workspace?.workspaceDir) {
    console.log(chalk.hex(t.muted)(`  └─ workspace: ${result.workspace.workspaceDir}`));
  }
}

/**
 * Enhanced task summary with visual card style
 */
export async function printEnhancedTaskSummary(cli, result, duration) {
  const modelId = cli.session.agent.model;
  const modelShort = shortenModelLabel(modelId);
  cli.syncSessionModelState(modelId);
  const contextStats = cli.session.agent.getContextStats();
  const contextUsed = contextStats.usedTokens;
  const contextMax = contextStats.maxTokens;
  const contextPct = contextStats.percent;
  const t = cli.theme;
  const contextColor = contextPct > 70 ? chalk.hex(t.error) : contextPct > 40 ? chalk.hex(t.warning) : chalk.hex(t.success);

  // Get per-task cost from client (snapshot-based diff)
  const clientStats = cli.session?.agent?.client?.getStats?.();
  const costAtStart = cli._taskCostStart || 0;
  const currentTotal = clientStats?.totalCost || 0;
  const taskCost = currentTotal - costAtStart;

  const failed = result.success === false || result.error;
  const statusIcon = failed ? chalk.hex(t.error)('✗') : chalk.hex(t.success)('✓');
  const statusLabel = failed ? 'Task failed' : 'Task complete';

  const width = Math.min(process.stdout.columns || 80, 60);
  const innerWidth = width - 4;

  const row = (label, value) => {
    const l = chalk.hex(t.muted)(label.padEnd(14));
    const line = `  ${l}${value}`;
    const pad = Math.max(0, innerWidth - visibleLen(line) + 2);
    return `${chalk.hex(t.accent)('  │')}${line}${' '.repeat(pad)}${chalk.hex(t.accent)('│')}`;
  };

  console.log('');
  console.log(chalk.hex(t.accent)(`  ╭${'─'.repeat(width)}╮`));
  console.log(chalk.hex(t.accent)('  │') + `  ${statusIcon} ${chalk.bold(statusLabel)}`.padEnd(width + visibleLen(`  ${statusIcon} ${statusLabel}`) - 1) + chalk.hex(t.accent)('│'));
  console.log(chalk.hex(t.accent)(`  ├${'─'.repeat(width)}┤`));
  console.log(row('Model', chalk.hex(t.tool)(modelShort)));
  console.log(row('Duration', chalk.hex(t.text)(formatDuration(duration))));
  console.log(row('Iterations', chalk.hex(t.text)(`${result.iterations || 0}`)));
  console.log(row('Tools called', chalk.hex(t.text)(`${result.stats?.toolExecutions || 0}`)));
  if (taskCost > 0) {
    console.log(row('Cost', chalk.hex(t.warning)(formatCost(taskCost))));
  }
  if (formatTokens(contextUsed) !== '0') {
    console.log(row('Tokens used', chalk.hex(t.text)(formatTokens(contextUsed))));
  }
  console.log(row('Context', contextColor(`${formatCompactNumber(contextUsed)}/${formatCompactNumber(contextMax)} (${contextPct}%)`)));
  if (result.performance && result.performance.totalRetries > 0) {
    console.log(row('Retries', chalk.hex(t.warning)(`${result.performance.totalRetries}`)));
  }
  console.log(chalk.hex(t.accent)(`  ╰${'─'.repeat(width)}╯`));
}

/**
 * Print goodbye message
 */
export async function printGoodbye(cli, stats = {}) {
  cli.stopAutoSave();
  if (cli.sessionSaveInFlight) {
    await cli.sessionSaveInFlight.catch(() => {});
  }

  const elapsedMs = Date.now() - cli.sessionStartTime;
  const taskCount = stats.taskCount ?? cli.taskCount ?? 0;
  // Reconcile from client for accurate cost
  const clientStats = cli.session?.agent?.client?.getStats?.();
  const cost = stats.cost ?? clientStats?.totalCost ?? cli.totalCost ?? 0;
  const skin = getActiveSkin();
  const t = cli.theme || DEFAULT_THEME;
  const goodbye = skin.branding?.goodbye || 'Goodbye!';
  const elapsed = stats.elapsedMs > 0 ? formatDuration(stats.elapsedMs) : formatElapsedTime(elapsedMs);
  const costStr = cost > 0 ? formatSmartMoney(cost) : '';
  const parts = [goodbye];
  if (taskCount > 0) parts.push(`${taskCount} tasks`);
  if (elapsed) parts.push(elapsed);
  if (costStr) parts.push(costStr);

  console.log('');
  console.log(chalk.hex(t.muted)(`  ${parts.join(' · ')}`));

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
    ? miniBar(stats.completedTasks, stats.totalTasks, 12, cli.theme)
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
export function miniBar(current, total, length = 12, theme = DEFAULT_THEME) {
  const t = theme || DEFAULT_THEME;
  if (total === 0) return chalk.hex(t.muted)('░'.repeat(length));
  const filled = Math.round((current / total) * length);
  return chalk.hex(t.success)('█'.repeat(filled)) + chalk.hex(t.muted)('░'.repeat(length - filled));
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
  const skin = getActiveSkin();
  const helpHeader = skin.branding?.helpHeader || 'help';
  console.log('');
  console.log(divider(cli, helpHeader));
  console.log(formatCommandList([...COMMAND_ENTRIES.slice(0, -1), ['/reset', 'Alias for /new'], COMMAND_ENTRIES.at(-1)], cli.theme)
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
  const t = cli.theme;

  const subagentCost = subagentStats.totalCost || 0;
  const teamCost = autoGenStats.totalTeamCost || 0;
  const mainCost = clientStats.totalCost || 0;
  const totalCost = mainCost + subagentCost + teamCost;
  const field = (name) => label(cli, name.padEnd(12));
  const budgetLimit = clientStats.budgetLimit ?? 0;
  const budgetRemaining = clientStats.budgetRemaining ?? (budgetLimit - (clientStats.budgetUsed || 0));
  console.log('');
  console.log(divider(cli, 'cost'));
  console.log(`  ${field('Duration')}${sessionMinutes} minutes`);
  console.log(`  ${field('Main')}${formatSmartMoney(mainCost)} ${muted(cli, ' · ')}${label(cli, 'Subagents')} ${formatSmartMoney(subagentCost)} ${muted(cli, ' · ')}${label(cli, 'Team')} ${formatSmartMoney(teamCost)}`);
  console.log(`  ${field('Total')}${chalk.hex(t.warning)(formatSmartMoney(totalCost))}`);
  console.log(`  ${field('Budget')}${formatSmartMoney(clientStats.budgetUsed)} / ${formatSmartMoney(budgetLimit)} ${muted(cli, ' · ')}${label(cli, 'Remaining')} ${formatSmartMoney(budgetRemaining)}`);
  console.log(`  ${field('Requests')}${clientStats.requestCount} ${muted(cli, ' · ')}${label(cli, 'Avg Duration')} ${clientStats.avgDuration} ${muted(cli, ' · ')}${label(cli, 'Cache')} ${clientStats.cacheSize}`);

  // Token summary
  const totalTokens = clientStats.totalTokens || (clientStats.totalInputTokens + clientStats.totalOutputTokens);
  if (totalTokens > 0) {
    console.log(`  ${field('Tokens')}${formatCompactNumber(clientStats.totalInputTokens)} in ${muted(cli, '·')} ${formatCompactNumber(clientStats.totalOutputTokens)} out ${muted(cli, '·')} ${formatCompactNumber(totalTokens)} total`);
    const cpt = clientStats.costPerThousandTokens || 0;
    if (cpt > 0) {
      console.log(`  ${field('Cost/1K tok')}${formatSmartMoney(cpt)}`);
    }
  }

  // Cache hit rate
  if (clientStats.totalCachedTokens > 0) {
    console.log(`  ${field('Cached')}${formatCompactNumber(clientStats.totalCachedTokens)} tokens ${muted(cli, '·')} ${label(cli, 'Hit rate')} ${clientStats.cacheHitRate}%`);
  }

  // Data source note
  if (clientStats.hasActualCost) {
    console.log(`  ${muted(cli, '  (costs from OpenRouter API)')}`);
  } else {
    console.log(`  ${chalk.hex(t.warning)('  (using estimated costs — actual API cost unavailable)')}`);
  }

  // Per-model breakdown
  const modelEntries = Object.entries(clientStats.costByModel || {});
  if (modelEntries.length > 1) {
    console.log('');
    console.log(chalk.hex(t.muted)(`  ── per-model ${'─'.repeat(Math.max(1, termWidth() - 13))}`));
    for (const [model, stats] of modelEntries) {
      const modelLabel = shortenModelLabel(model);
      const pct = mainCost > 0 ? Math.round((stats.cost / mainCost) * 100) : 0;
      console.log(`  ${chalk.hex(t.tool)(modelLabel.padEnd(30))} ${formatSmartMoney(stats.cost)} ${muted(cli, '·')} ${stats.requests} req ${muted(cli, '·')} ${formatCompactNumber(stats.inputTokens + stats.outputTokens)} tok ${muted(cli, '·')} ${pct}%`);
    }
  }

  // Upstream cost (provider's actual charge vs OpenRouter markup)
  if (clientStats.totalUpstreamCost > 0) {
    console.log(`  ${field('Upstream')}${formatSmartMoney(clientStats.totalUpstreamCost)} ${muted(cli, '(provider cost)')}`);
  }

  console.log(divider(cli));
  return;
}

/**
 * Show context usage statistics
 */
export function showContext(cli) {
  const contextStats = cli.session.agent.getContextStats();
  const t = cli.theme;

  const contextColor = contextStats.percent > 70 ? chalk.hex(t.error) :
                       contextStats.percent > 40 ? chalk.hex(t.warning) : chalk.hex(t.success);
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
