/**
 * 🔄 Modern Spinner Module
 * Uses nanospinner + cli-spinners for beautiful, lightweight spinners.
 * Drop-in replacement for ora with compatible API (.start(), .succeed(), .fail(), .stop()).
 */

import { createSpinner as nsCreate } from 'nanospinner';
import cliSpinners from 'cli-spinners';
import chalk from './chalk-compat.js';

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
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let currentMessage = message;
  let elapsed = 0;
  const startTime = Date.now();
  const color = theme?.muted ? chalk.hex(theme.muted) : chalk.gray;

  const interval = setInterval(() => {
    elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  ${color(frames[frame])} ${color(currentMessage + '…')} ${color(elapsed + 's')} `);
    frame = (frame + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
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
  const toolColor = theme?.tool ? chalk.hex(theme.tool) : chalk.yellow;
  const mutedColor = theme?.muted ? chalk.hex(theme.muted) : chalk.gray;
  const textColor = theme?.text ? chalk.hex(theme.text) : chalk.white;

  const interval = setInterval(() => {
    elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  ${toolColor(frames[frame])} ${mutedColor(currentMessage)} ${textColor(elapsed + 's')}  `);
    frame = (frame + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
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

export default { spinner, thinkingSpinner, contextualSpinner, respondingIndicator, getSpinnerFrames, getSpinnerFrame, SPINNER_STYLES };
