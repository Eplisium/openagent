/**
 * 🛡️ Interactive tool-approval prompt
 *
 * Wired into AgentSession as `onApprovalRequest(req) → 'allow' | 'deny' | 'always'`.
 *   y / Enter → allow once
 *   a         → always allow (session-scoped rule)
 *   n / Esc   → deny
 *   Ctrl+C    → deny
 *
 * Works with raw-mode TTYs and falls back to line input otherwise. Non-TTY
 * stdin denies automatically (never blocks).
 */

import chalk from '../utils/chalk-compat.js';

export const PERMISSION_MODE_CYCLE = Object.freeze(['ask', 'accept-edits', 'plan', 'read-only', 'auto']);

const MODE_DESCRIPTIONS = Object.freeze({
  'read-only': 'read-only tools only',
  plan: 'plan only — no edits or commands',
  ask: 'ask before risky tools',
  'accept-edits': 'auto-approve file edits, ask for commands',
  auto: 'auto-approve everything (full access)',
});

export function describePermissionMode(mode) {
  return MODE_DESCRIPTIONS[mode] || 'unknown mode';
}

/** Next mode in the Shift+Tab / `/mode` cycle. */
export function nextPermissionMode(current) {
  const idx = PERMISSION_MODE_CYCLE.indexOf(current);
  return PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
}

/** Map a single keypress / typed answer to a decision. Returns null for "unrecognised". */
export function decisionForKey(key) {
  const k = String(key ?? '').trim().toLowerCase();
  if (k === '' || k === 'y' || k === 'yes' || k === '\r' || k === '\n') return 'allow';
  if (k === 'a' || k === 'always') return 'always';
  if (k === 'n' || k === 'no' || k === '\u001b' || k === '\u0003') return 'deny';
  return null;
}

function summarizeArgs(args, max = 160) {
  if (args == null) return '';
  if (typeof args === 'string') return args.length > max ? `${args.slice(0, max)}…` : args;
  const primary = args.command ?? args.path ?? args.file ?? args.filePath ?? args.url ?? args.query ?? args.pattern;
  let text;
  if (primary !== undefined) text = String(primary);
  else {
    try { text = JSON.stringify(args); } catch { text = String(args); }
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Build the prompt text block shown to the user. */
export function formatApprovalRequest(req = {}, theme = {}) {
  const accent = theme.accent ? chalk.hex(theme.accent) : chalk.cyan;
  const warn = theme.warning ? chalk.hex(theme.warning) : chalk.yellow;
  const muted = theme.muted ? chalk.hex(theme.muted) : chalk.gray;
  const lines = [
    '',
    `  ${warn('⚠ approval needed')} ${accent(req.toolName || 'tool')}`,
  ];
  const argText = summarizeArgs(req.args);
  if (argText) lines.push(`  ${muted('args')}   ${argText}`);
  if (req.reason) lines.push(`  ${muted('why')}    ${req.reason}`);
  if (req.rule) lines.push(`  ${muted('rule')}   ${req.rule}`);
  lines.push(`  ${accent('[y]')} allow  ${accent('[a]')} always  ${accent('[n]')} deny ${muted('›')} `);
  return lines.join('\n');
}

/**
 * Ask the user to approve a tool call.
 * @param {{toolName?: string, args?: any, reason?: string, rule?: string}} req
 * @param {{ input?: NodeJS.ReadStream, output?: NodeJS.WriteStream, theme?: object,
 *           beforePrompt?: () => void, afterPrompt?: () => void, timeoutMs?: number }} [opts]
 * @returns {Promise<'allow'|'deny'|'always'>}
 */
export function promptForApproval(req = {}, opts = {}) {
  const {
    input = process.stdin,
    output = process.stdout,
    theme = {},
    beforePrompt,
    afterPrompt,
    timeoutMs = 0,
  } = opts;

  if (!input || !input.isTTY) return Promise.resolve('deny');

  try { beforePrompt?.(); } catch { /* UI hook must not break approvals */ }
  output.write(formatApprovalRequest(req, theme));

  return new Promise((resolve) => {
    const canRaw = typeof input.setRawMode === 'function';
    const wasRaw = Boolean(input.isRaw);
    let buffer = '';
    let timer = null;
    let done = false;

    const finish = (decision) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      input.off('data', onData);
      if (canRaw && !wasRaw) {
        try { input.setRawMode(false); } catch { /* terminal already restored */ }
      }
      const label = decision === 'always' ? chalk.green('always') : decision === 'allow' ? chalk.green('allowed') : chalk.red('denied');
      output.write(`${label}\n`);
      try { afterPrompt?.(decision); } catch { /* UI hook must not break approvals */ }
      resolve(decision);
    };

    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      if (canRaw) {
        // Raw mode: decide on the first meaningful key.
        for (const ch of text) {
          const decision = decisionForKey(ch);
          if (decision) return finish(decision);
        }
        return;
      }
      buffer += text;
      const nl = buffer.search(/\r?\n/);
      if (nl === -1) return;
      finish(decisionForKey(buffer.slice(0, nl)) || 'deny');
    };

    if (canRaw && !wasRaw) {
      try { input.setRawMode(true); } catch { /* fall back to line mode */ }
    }
    input.on('data', onData);
    input.resume?.();

    if (timeoutMs > 0) {
      timer = setTimeout(() => finish('deny'), timeoutMs);
      timer.unref?.();
    }
  });
}

/**
 * Factory used by cli.js. Pauses spinners / the task-abort stdin listener while
 * the prompt is up, and serializes concurrent requests (parallel tool calls).
 * @param {object} cli - CLI instance (uses cli.theme, cli._activity, cli._streamRenderer)
 */
export function createApprovalHandler(cli) {
  let queue = Promise.resolve();
  return (req) => {
    const run = async () => {
      const abortState = cli?._suspendTaskAbortHandler?.();
      try {
        return await promptForApproval(req, {
          theme: cli?.theme || {},
          beforePrompt: () => {
            cli?._activity?.pause?.();
            cli?._streamRenderer?.clearLive?.();
          },
          afterPrompt: () => {
            if (cli?.currentTask) cli?._activity?.resume?.('Working');
          },
        });
      } finally {
        cli?._resumeTaskAbortHandler?.(abortState);
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => 'deny');
    return next;
  };
}
