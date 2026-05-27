/**
 * 🔄 Modern Spinner Module
 * Uses nanospinner + cli-spinners for beautiful, lightweight spinners.
 * Drop-in replacement for ora with compatible API (.start(), .succeed(), .fail(), .stop()).
 */

import { createSpinner as nsCreate } from 'nanospinner';
import cliSpinners from 'cli-spinners';
import chalk from './chalk-compat.js';

const FALLBACK_THEME = {
  accent: '#89b4fa',
  muted: '#6c7086',
  text: '#cdd6f4',
  tool: '#cba6f7',
  header: '#cba6f7',
};

const FALLBACK_SKIN = {
  spinner: {
    waitingFaces: null,
    thinkingFaces: null,
    thinkingVerbs: null,
    wings: null,
  },
};

let getActiveSkinSafe = () => FALLBACK_SKIN;
let getSkinThemeSafe = () => FALLBACK_THEME;

try {
  const themeModule = await import('../cli/themes.js');
  getActiveSkinSafe = themeModule.getActiveSkin || getActiveSkinSafe;
  getSkinThemeSafe = themeModule.getSkinTheme || getSkinThemeSafe;
} catch {
  // Keep spinners usable even if theme loading fails.
}

function clearCurrentLine() {
  process.stdout.write('\r\x1b[2K');
}

function fitInline(text) {
  const width = Math.max(20, process.stdout.columns || 80);
  const plain = String(text || '');
  return plain.length > width - 1 ? plain.slice(0, width - 2) + '…' : plain;
}

function formatSpinnerElapsed(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

/**
 * KawaiiSpinner: Hermes-style animated spinner with kawaii faces and wings.
 * Shows: ⟪☽ (◕‿◕) pondering ☽⟫
 * Falls back to braille dots if the skin has no faces.
 */
export class KawaiiSpinner {
  constructor(label = 'Thinking', opts = {}) {
    this.skin = opts.skin || getActiveSkinSafe();
    this.theme = opts.theme || getSkinThemeSafe();
    this.label = label;
    this.active = false;
    this.frame = 0;
    this.interval = null;
    this.startTime = null;

    const faces = this.skin.spinner?.waitingFaces || this.skin.spinner?.thinkingFaces;
    this.faces = faces && faces.length > 0 ? faces : null;
    this.verbs = this.skin.spinner?.thinkingVerbs || null;
    this.wings = this.skin.spinner?.wings || null;
  }

  start() {
    if (this.active) return this;
    this.active = true;
    this.startTime = Date.now();
    this.frame = 0;
    this._render();
    this.interval = setInterval(() => {
      this.frame++;
      this._render();
    }, 200);
    this.interval.unref?.();
    return this;
  }

  stop(finalText) {
    if (!this.active) return this;
    this.active = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1b[K');
    if (finalText) {
      process.stdout.write(finalText + '\n');
    }
    return this;
  }

  setMessage(message) {
    this.label = message;
    return this;
  }

  _render() {
    const t = this.theme || FALLBACK_THEME;
    const elapsed = this.startTime ? formatDuration(Date.now() - this.startTime) : '';
    let display;

    if (this.faces) {
      const face = this.faces[this.frame % this.faces.length];
      const verb = this.verbs ? this.verbs[this.frame % this.verbs.length] : this.label;
      const wing = this.wings ? this.wings[this.frame % this.wings.length] : null;
      const faceColor = chalk.hex(t.accent || FALLBACK_THEME.accent);
      const verbColor = chalk.hex(t.muted || FALLBACK_THEME.muted);
      const wingColor = chalk.hex(t.header || t.accent || FALLBACK_THEME.header);

      if (wing) {
        display = `${wingColor(wing[0])} ${faceColor(face)} ${verbColor(verb)} ${wingColor(wing[1])} ${chalk.hex(t.muted || FALLBACK_THEME.muted)(`[${elapsed}]`)}`;
      } else {
        display = `${faceColor(face)} ${verbColor(verb)} ${chalk.hex(t.muted || FALLBACK_THEME.muted)(`[${elapsed}]`)}`;
      }
    } else {
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      const frame = frames[this.frame % frames.length];
      display = `${chalk.hex(t.accent || FALLBACK_THEME.accent)(frame)} ${chalk.hex(t.muted || FALLBACK_THEME.muted)(this.label)} ${chalk.hex(t.muted || FALLBACK_THEME.muted)(`[${elapsed}]`)}`;
    }

    process.stdout.write('\r\x1b[K' + fitInline(display));
  }
}

/**
 * Create and return a kawaii spinner. Drop-in replacement for thinkingSpinner.
 */
export function createKawaiiSpinner(label = 'Thinking') {
  return new KawaiiSpinner(label);
}

/**
 * Create a styled spinner with ora-compatible API
 * @param {string} text - Spinner text
 * @param {object} options - Options
 * @param {string} options.color - Color name for chalk (default: 'cyan')
 * @param {string} options.spinner - Spinner style name from cli-spinners (default: 'dots')
 * @returns {object} Spinner instance with start(), succeed(), fail(), stop(), update()
 */
export function spinner(text, { color = 'cyan', spinner: spinnerName = 'dots' } = {}) {
  const s = nsCreate(text, {
    color,
    stream: process.stdout,
    frames: cliSpinners[spinnerName]?.frames || cliSpinners.dots.frames,
    interval: cliSpinners[spinnerName]?.interval || cliSpinners.dots.interval,
  });

  // Wrap with ora-compatible API
  return {
    start() { s.start(); return this; },
    stop(finalText) { s.stop({ text: finalText }); return this; },
    succeed(finalText) { s.success({ text: finalText || text }); return this; },
    fail(finalText) { s.error({ text: finalText || text }); return this; },
    success(finalText) { s.success({ text: finalText || text }); return this; },
    error(finalText) { s.error({ text: finalText || text }); return this; },
    update(newText) { s.update({ text: newText }); return this; },
  };
}

/**
 * Create a thinking spinner for LLM response waiting.
 * @param {string} [message] - Optional message to display (default: 'Thinking')
 * @param {object} [theme] - Active CLI theme
 * @returns {{ stop: Function, setMessage: Function }}
 */
export function thinkingSpinner(message = 'Thinking', theme = null) {
  if (!theme) {
    return createKawaiiSpinner(message).start();
  }

  const skin = getActiveSkinSafe();
  if (skin?.spinner?.waitingFaces?.length || skin?.spinner?.thinkingFaces?.length) {
    return new KawaiiSpinner(message, { skin, theme }).start();
  }

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let currentMessage = message;
  let elapsed = 0;
  const startTime = Date.now();
  const color = chalk.hex(theme?.muted || '#6c7086');

  const interval = setInterval(() => {
    elapsed = formatSpinnerElapsed(Date.now() - startTime);
    clearCurrentLine();
    process.stdout.write(fitInline(`  ${color(frames[frame])} ${color(currentMessage + '…')} ${color(elapsed)} `));
    frame = (frame + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      clearCurrentLine();
    },
    setMessage: (msg) => { currentMessage = msg; },
  };
}

/**
 * Create a contextual progress spinner with elapsed time
 * @param {string} message - Initial message (e.g., 'Working...', 'Reading file...')
 * @returns {{ stop: Function, setMessage: Function, getElapsed: Function }}
 */
export function contextualSpinner(message = 'Working...', theme = null) {
  let currentMessage = message;
  let elapsed = 0;
  const startTime = Date.now();
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  const toolColor = chalk.hex(theme?.tool || '#cba6f7');
  const mutedColor = chalk.hex(theme?.muted || '#6c7086');
  const textColor = chalk.hex(theme?.text || '#cdd6f4');

  const interval = setInterval(() => {
    elapsed = formatSpinnerElapsed(Date.now() - startTime);
    clearCurrentLine();
    process.stdout.write(fitInline(`  ${toolColor(frames[frame])} ${mutedColor(currentMessage)} ${textColor(elapsed)}  `));
    frame = (frame + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      clearCurrentLine();
    },
    setMessage: (msg) => { currentMessage = msg; },
    getElapsed: () => elapsed,
  };
}

/**
 * Create an AI responding indicator
 * @returns {{ clear: Function }}
 */
export function respondingIndicator(theme = null, message = 'Thinking') {
  const spinner = thinkingSpinner(message, theme);

  return {
    clear: () => spinner.stop(),
    stop: () => spinner.stop(),
    setMessage: (msg) => spinner.setMessage(msg),
  };
}

/**
 * Get spinner frames for a given style (for inline use in tool call display)
 * @param {string} style - Spinner style name
 * @returns {string[]} Array of frame strings
 */
export function getSpinnerFrames(style = 'dots') {
  return cliSpinners[style]?.frames || cliSpinners.dots.frames;
}

/**
 * Get a single frame by index (for inline spinner display in tool calls)
 * @param {number} index - Frame index
 * @param {string} style - Spinner style name
 * @returns {string} The frame character
 */
export function getSpinnerFrame(index, style = 'dots') {
  const frames = getSpinnerFrames(style);
  return frames[index % frames.length];
}

/**
 * Available spinner style names
 */
export const SPINNER_STYLES = Object.keys(cliSpinners);

export default { spinner, thinkingSpinner, contextualSpinner, respondingIndicator, createKawaiiSpinner, KawaiiSpinner, getSpinnerFrames, getSpinnerFrame, SPINNER_STYLES };
