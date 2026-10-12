import chalk from '../utils/chalk-compat.js';
import { clipLine, termColumns } from './layout.js';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const FRAME_MS = 80;

export const isInteractive = () => Boolean(process.stdout.isTTY);

// Frames come from the wall clock so every animator stays in phase and a busy event loop skips frames instead of slowing the spinner.
export function frameAt(now = Date.now(), frames = SPINNER_FRAMES, interval = FRAME_MS) {
  return frames[Math.floor(now / interval) % frames.length];
}

export function formatLiveElapsed(ms) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 1) return '';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`;
}

let cursorHolds = 0;
let exitHooked = false;

export function restoreCursor() {
  cursorHolds = 0;
  if (isInteractive()) process.stdout.write('\x1b[?25h');
}

export function hideCursor() {
  if (!isInteractive()) return () => {};
  if (!exitHooked) {
    exitHooked = true;
    process.once('exit', restoreCursor);
  }
  if (cursorHolds++ === 0) process.stdout.write('\x1b[?25l');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    cursorHolds = Math.max(0, cursorHolds - 1);
    if (cursorHolds === 0 && isInteractive()) process.stdout.write('\x1b[?25h');
  };
}

// Overwrite in place then erase the tail, so there is never a blank frame between redraws.
export function drawLine(text) {
  process.stdout.write(`\r${clipLine(text, termColumns() - 1)}\x1b[K`);
}

export function eraseLine() {
  process.stdout.write('\r\x1b[2K');
}

// Synchronized-output markers (DEC 2026) stop terminals painting a half-drawn multi-line frame; unsupported terminals ignore them.
export function syncFrame(write) {
  if (!isInteractive()) { write(); return; }
  process.stdout.write('\x1b[?2026h');
  try { write(); } finally { process.stdout.write('\x1b[?2026l'); }
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map(i => Number.parseInt(full.slice(i, i + 2), 16));
}

// A soft highlight sweeps across the label; plain colour when the terminal should stay monochrome.
export function shimmer(text, baseHex, highlightHex, now = Date.now()) {
  const base = hexToRgb(baseHex);
  const high = hexToRgb(highlightHex);
  if (!text || !base || !high || process.env.NO_COLOR) return chalk.hex(baseHex)(text);
  const chars = [...text];
  const period = chars.length + 10;
  const center = ((now / 60) % period) - 5;
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const k = Math.max(0, 1 - Math.abs(i - center) / 4);
    const mix = base.map((b, n) => Math.round(b + (high[n] - b) * k * k));
    out += chalk.rgb(mix[0], mix[1], mix[2])(chars[i]);
  }
  return out;
}

/**
 * Single "the agent is working" line shown while nothing else is drawing
 * (waiting for the first token, between tools). Pause it whenever another
 * animator takes the line; resume once that one is finished.
 */
export function createActivityIndicator(cli, { label = 'Thinking' } = {}) {
  let timer = null;
  let releaseCursor = null;
  let startedAt = Date.now();
  let currentLabel = label;
  let disposed = false;

  const draw = () => {
    const t = cli.theme;
    const elapsed = formatLiveElapsed(Date.now() - startedAt);
    const text = shimmer(`${currentLabel}…`, t.muted, t.text || t.accent);
    drawLine(`  ${chalk.hex(t.accent)(frameAt())} ${text}${elapsed ? ` ${chalk.hex(t.muted)(elapsed)}` : ''}`);
  };

  const pause = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    eraseLine();
    releaseCursor?.();
    releaseCursor = null;
  };

  const resume = (nextLabel, resetClock = true) => {
    if (disposed || timer || !isInteractive()) return;
    if (nextLabel) currentLabel = nextLabel;
    if (resetClock) startedAt = Date.now();
    releaseCursor = hideCursor();
    draw();
    timer = setInterval(draw, FRAME_MS);
    timer.unref?.();
  };

  return {
    get running() { return Boolean(timer); },
    resume,
    pause,
    setLabel(next) { currentLabel = next; },
    // Run a print while the line is cleared, then pick the animation back up.
    around(fn) {
      const wasRunning = Boolean(timer);
      pause();
      try { fn(); } finally { if (wasRunning) resume(undefined, false); }
    },
    dispose() {
      pause();
      disposed = true;
    },
  };
}
