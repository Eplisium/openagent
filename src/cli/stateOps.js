/**
 * 🗄️ State Operations
 * Persistent local state management for CLI preferences and history.
 */

import chalk from '../utils/chalk-compat.js';
import fs from '../utils/fs-compat.js';
import { VERSION, STATE_DIR, STATE_FILE, normalizeState } from './state.js';
import { getTheme } from './themes.js';

function applyPreferences(cli) {
  cli.prefs = {
    ...cli.prefs,
    ...(cli.state?.preferences || {}),
  };
  cli.streaming = cli.prefs.streaming !== false;
  cli.verbose = cli.prefs.verbose !== false;
  cli.currentTheme = cli.prefs.theme || cli.currentTheme || 'catppuccin';
  cli.theme = getTheme(cli.currentTheme);
  cli.autoSave = cli.prefs.autoSave !== false;
  if (cli.screen) {
    cli.screen = {
      ...cli.screen,
      ...(cli.state?.screen || {}),
      blocks: [],
    };
    cli.screen.autoClearOnTask = cli.prefs.autoClearOnNewTask !== false;
    cli.screen.compactMode = cli.prefs.compactMode === true;
  }
}

/**
 * Load persistent state from disk
 */
export async function loadState(cli) {
  try {
    await fs.ensureDir(STATE_DIR);

    if (await fs.pathExists(STATE_FILE)) {
      const saved = await fs.readJson(STATE_FILE);
      cli.state = normalizeState({
        ...saved,
        version: VERSION,
        lastUsed: new Date().toISOString(),
      });
      cli.history = Array.isArray(cli.state.history) ? cli.state.history.slice(-cli.maxHistorySize) : [];
      applyPreferences(cli);

      if (cli.verbose) {
        console.log(chalk.dim('  loaded local state'));
      }
    } else {
      // First run
      cli.state = normalizeState({
        firstRun: true,
        lastUsed: new Date().toISOString(),
      });
      applyPreferences(cli);
    }
  } catch (error) {
    cli.state = normalizeState({
      firstRun: true,
    });
    applyPreferences(cli);
    if (cli.verbose) {
      console.log(chalk.hex(cli.theme?.warning || '#f9e2af')(`  state load failed: ${error.message}`));
    }
  }
}

/**
 * Save persistent state to disk
 */
export async function saveState(cli) {
  try {
    await fs.ensureDir(STATE_DIR);
    cli.state = normalizeState(cli.state || {});
    cli.state.lastUsed = new Date().toISOString();
    cli.state.history = cli.history.slice(-50); // Keep last 50 entries
    cli.state.preferences = {
      ...cli.state.preferences,
      ...(cli.prefs || {}),
      streaming: cli.streaming,
      verbose: cli.verbose,
      theme: cli.currentTheme,
      compactMode: cli.screen?.compactMode ?? cli.prefs?.compactMode ?? false,
      autoClearOnNewTask: cli.screen?.autoClearOnTask ?? cli.prefs?.autoClearOnNewTask ?? true,
    };
    if (cli.snapshotSessionState) {
      cli.state.session = cli.snapshotSessionState();
    }
    await fs.writeJson(STATE_FILE, cli.state, { spaces: 2 });
  } catch (error) {
    if (cli.verbose) {
      console.log(chalk.hex(cli.theme?.warning || '#f9e2af')(`  state save failed: ${error.message}`));
    }
  }
}
