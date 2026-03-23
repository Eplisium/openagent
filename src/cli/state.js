/**
 * State management constants for OpenAgent CLI
 */

import path from 'path';
import os from 'os';

const VERSION = '4.1.0';

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
