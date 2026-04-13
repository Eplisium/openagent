/**
 * 🎯 Modern Prompts Module
 * Uses @clack/prompts for beautiful, modern CLI prompts.
 * Drop-in replacement for inquirer in onboarding and model selection.
 */

import * as clack from '@clack/prompts';
import chalk from './chalk-compat.js';

// Re-export clack's built-in utilities
export const { intro, outro, note, cancel, isCancel, log } = clack;

/**
 * Prompt for text input
 * @param {string} message - Prompt message
 * @param {object} options
 * @param {string} options.placeholder - Placeholder text
 * @param {string} options.defaultValue - Default value
 * @param {Function} options.validate - Validation function (returns error string or undefined)
 * @returns {Promise<string>} User input
 */
export async function text(message, { placeholder, defaultValue, validate } = {}) {
  const result = await clack.text({
    message,
    placeholder,
    defaultValue,
    validate,
  });
  if (isCancel(result)) throw new Error('Prompt cancelled');
  return result;
}

/**
 * Prompt for password/secret input
 * @param {string} message - Prompt message
 * @param {object} options
 * @param {string} options.placeholder - Placeholder text
 * @param {string} options.mask - Mask character (default: '•')
 * @returns {Promise<string>} User input
 */
export async function password(message, { placeholder, mask } = {}) {
  const result = await clack.password({
    message,
    placeholder,
    mask,
  });
  if (isCancel(result)) throw new Error('Prompt cancelled');
  return result;
}

/**
 * Prompt for confirmation (yes/no)
 * @param {string} message - Prompt message
 * @param {object} options
 * @param {boolean} options.defaultValue - Default value (default: true)
 * @returns {Promise<boolean>} User choice
 */
export async function confirm(message, { defaultValue = true } = {}) {
  const result = await clack.confirm({
    message,
    initialValue: defaultValue,
  });
  if (isCancel(result)) throw new Error('Prompt cancelled');
  return result;
}

/**
 * Prompt for single selection from a list
 * @param {string} message - Prompt message
 * @param {Array<{value: string, label: string, hint?: string}>} options - Choices
 * @param {object} config
 * @param {string} config.defaultValue - Default selected value
 * @param {string} config.placeholder - Placeholder when no selection
 * @returns {Promise<string>} Selected value
 */
export async function select(message, options, { defaultValue, placeholder } = {}) {
  const choices = options.map(opt => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return {
      value: opt.value,
      label: opt.label || opt.name || opt.value,
      hint: opt.hint || opt.description,
    };
  });

  const result = await clack.select({
    message,
    options: choices,
    initialValue: defaultValue,
    placeholder,
  });
  if (isCancel(result)) throw new Error('Prompt cancelled');
  return result;
}

/**
 * Prompt for multiple selection
 * @param {string} message - Prompt message
 * @param {Array<{value: string, label: string, hint?: string}>} options - Choices
 * @param {object} config
 * @param {string[]} config.defaultValues - Default selected values
 * @param {string} config.placeholder - Placeholder text
 * @returns {Promise<string[]>} Selected values
 */
export async function multiselect(message, options, { defaultValues, placeholder } = {}) {
  const choices = options.map(opt => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return {
      value: opt.value,
      label: opt.label || opt.name || opt.value,
      hint: opt.hint || opt.description,
    };
  });

  const result = await clack.multiselect({
    message,
    options: choices,
    initialValues: defaultValues,
    placeholder,
  });
  if (isCancel(result)) throw new Error('Prompt cancelled');
  return result;
}

/**
 * Show a spinner while an async operation runs
 * @param {string} text - Spinner text
 * @param {Function} fn - Async function to run
 * @returns {Promise<*>} Result of fn
 */
export async function withSpinner(text, fn) {
  const s = clack.spinner();
  s.start(text);
  try {
    const result = await fn();
    s.stop();
    return result;
  } catch (error) {
    s.stop(chalk.red(`Failed: ${error.message}`));
    throw error;
  }
}

/**
 * Show a grouped set of prompts with intro/outro
 * @param {string} title - Group title
 * @param {Function} fn - Async function that runs prompts
 * @returns {Promise<*>} Result of fn
 */
export async function promptGroup(title, fn) {
  intro(chalk.cyan(`◆ ${title}`));
  try {
    const result = await fn();
    return result;
  } finally {
    // outro is optional — caller can add it
  }
}

/**
 * Show a success note
 * @param {string} message - Success message
 */
export function success(message) {
  note(message, '✅');
}

/**
 * Show a warning note
 * @param {string} message - Warning message
 */
export function warning(message) {
  note(message, '⚠️');
}

/**
 * Show an info note
 * @param {string} message - Info message
 */
export function info(message) {
  note(message, 'ℹ️');
}

export default {
  intro, outro, note, cancel, isCancel, log,
  text, password, confirm, select, multiselect,
  withSpinner, promptGroup, success, warning, info,
};
