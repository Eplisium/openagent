/**
 * 🗄️ State Operations
 * Persistent local state management for CLI preferences and history.
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import { VERSION, STATE_DIR, STATE_FILE, DEFAULT_STATE } from './state.js';

/**
 * Load persistent state from disk
 */
export async function loadState(cli) {
  try {
    await fs.ensureDir(STATE_DIR);

    if (await fs.pathExists(STATE_FILE)) {
      const saved = await fs.readJson(STATE_FILE);
      cli.state = {
        ...DEFAULT_STATE,
        ...saved,
        version: VERSION,
        lastUsed: new Date().toISOString(),
      };
      cli.history = cli.state.history || [];

      if (cli.verbose) {
        console.log(chalk.dim('📂 Loaded local state'));
      }
    } else {
      // First run
      cli.state = {
        ...DEFAULT_STATE,
        firstRun: true,
        lastUsed: new Date().toISOString(),
      };
    }
  } catch (error) {
    cli.state = {
      ...DEFAULT_STATE,
      firstRun: true,
    };
    if (cli.verbose) {
      console.log(chalk.yellow('⚠️ Could not load state, using defaults'));
    }
  }
}

/**
 * Save persistent state to disk
 */
export async function saveState(cli) {
  try {
    await fs.ensureDir(STATE_DIR);
    cli.state.lastUsed = new Date().toISOString();
    cli.state.history = cli.history.slice(-50); // Keep last 50 entries
    await fs.writeJson(STATE_FILE, cli.state, { spaces: 2 });
  } catch (error) {
    if (cli.verbose) {
      console.log(chalk.dim(`⚠️ Could not save state: ${error.message}`));
    }
  }
}
