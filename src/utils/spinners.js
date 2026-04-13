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
 * Create a thinking spinner (emoji-based, for LLM response waiting)
 * @returns {{ stop: Function }}
 */
export function thinkingSpinner() {
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
 * Create an AI responding indicator
 * @returns {{ clear: Function }}
 */
export function respondingIndicator() {
  const indicator = chalk.cyan('💬 ') + chalk.gray('AI responding...');
  process.stdout.write(indicator + ' ');

  return {
    clear: () => {
      process.stdout.write('\r' + ' '.repeat(indicator.length + 5) + '\r');
    }
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

export default { spinner, thinkingSpinner, respondingIndicator, getSpinnerFrames, getSpinnerFrame, SPINNER_STYLES };
