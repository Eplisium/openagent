/**
 * State management constants and functions for OpenAgent CLI
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../../package.json');

// ═══════════════════════════════════════════════════════════════════
// 🏠 Local State Management
// ═══════════════════════════════════════════════════════════════════

export const STATE_DIR = path.join(os.homedir(), '.openagent');
export const STATE_FILE = path.join(STATE_DIR, 'state.json');

export const DEFAULT_STATE = {
  version: VERSION,
  firstRun: true,
  lastUsed: null,
  totalSessions: 0,
  preferences: {
    showTips: true,
    autoSuggest: true,
    verboseErrors: true,
    renderMarkdown: true,
    streaming: true,
    showTokenUsage: true,
    defaultModel: null,
  },
  stats: {
    totalTasks: 0,
    totalTokens: 0,
    totalCost: 0,
    favoriteCommands: {},
  }
};

export { VERSION };

// ═══════════════════════════════════════════════════════════════════
// 🔄 State Persistence Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Load state from disk, or return default state
 * @returns {Promise<Object>} The loaded state
 */
export async function loadState() {
  try {
    // Ensure state directory exists
    await fs.mkdir(STATE_DIR, { recursive: true });
    
    // Try to read state file
    try {
      const data = await fs.readFile(STATE_FILE, 'utf8');
      const parsed = JSON.parse(data);
      
      // Validate structure
      if (typeof parsed === 'object' && parsed !== null) {
        return { ...DEFAULT_STATE, ...parsed };
      }
    } catch (readError) {
      // File doesn't exist or is invalid, return default
      if (readError.code !== 'ENOENT') {
        console.warn('Warning: Failed to parse state file:', readError.message);
      }
    }
  } catch (error) {
    console.warn('Warning: Failed to load state:', error.message);
  }
  
  return { ...DEFAULT_STATE };
}

/**
 * Save state to disk
 * @param {Object} state - The state to save
 * @returns {Promise<void>}
 */
export async function saveState(state) {
  try {
    // Ensure state directory exists
    await fs.mkdir(STATE_DIR, { recursive: true });
    
    // Save state file
    const data = JSON.stringify(state, null, 2);
    await fs.writeFile(STATE_FILE, data, 'utf8');
  } catch (error) {
    console.warn('Warning: Failed to save state:', error.message);
    throw error; // Re-throw so caller knows it failed
  }
}

/**
 * Get the state directory path
 * @returns {string}
 */
export function getStateDir() {
  return STATE_DIR;
}

/**
 * Get the state file path
 * @returns {string}
 */
export function getStateFile() {
  return STATE_FILE;
}

/**
 * Update state with partial changes
 * @param {Object} updates - Partial state to merge
 * @returns {Promise<Object>} Updated state
 */
export async function updateState(updates) {
  const currentState = await loadState();
  const newState = { ...currentState, ...updates };
  await saveState(newState);
  return newState;
}

/**
 * Reset state to defaults
 * @returns {Promise<Object>} Default state
 */
export async function resetState() {
  const defaultState = { ...DEFAULT_STATE };
  await saveState(defaultState);
  return defaultState;
}
