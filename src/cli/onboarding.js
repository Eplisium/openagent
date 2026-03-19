/**
 * First-run onboarding wizard for OpenAgent CLI
 */

import chalk from 'chalk';
import boxen from 'boxen';
import { box } from './ui.js';

/**
 * Run the first-run onboarding wizard.
 * Shows a welcome message with quick-start tips.
 * @param {object} state - Mutable state object (will set firstRun = false)
 * @param {Function} saveState - Async function to persist state
 */
export async function runOnboarding(state, saveState) {
  console.log(boxen(
    `${chalk.bold('🎉 Welcome to OpenAgent!')}\n\n` +
    `${chalk.cyan('OpenAgent')} is an AI-powered coding assistant with 400+ models.\n\n` +
    `${chalk.bold('Quick Start:')}` +
    `\n${chalk.green('•')} Type any message to run as an agentic task` +
    `\n${chalk.green('•')} Use /chat for simple conversations` +
    `\n${chalk.green('•')} Use /templates for common workflows` +
    `\n${chalk.green('•')} Type /help for all commands\n\n` +
    `${chalk.dim('This message will only show once.')}`,
    { ...box.default, title: '🚀 Getting Started', titleAlignment: 'center' }
  ));

  // Mark first run as complete
  if (state) {
    state.firstRun = false;
    await saveState();
  }
}
