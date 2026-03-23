/**
 * Command aliases and registry for OpenAgent CLI
 */

// ═══════════════════════════════════════════════════════════════════
// 🔤 Command Aliases
// ═══════════════════════════════════════════════════════════════════

export const COMMAND_ALIASES = {
  'q': 'exit',
  'quit': 'exit',
  'c': 'chat',
  'a': 'agent',
  'n': 'new',
  'm': 'model',
  's': 'stats',
  'h': 'help',
  't': 'tools',
  'cl': 'clear',
  'st': 'stream',
  'v': 'verbose',
  'tmp': 'templates',
  'doc': 'doctor',
  'u': 'undo',
  'd': 'diff',
  'ex': 'export',
  'co': 'cost',
  'ctx': 'context',
  'ct': 'context',
  'ss': 'session',
};

// ═══════════════════════════════════════════════════════════════════
// 🔀 Command Resolution
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a command alias to its full command name.
 * Returns the input unchanged if it's not an alias.
 * @param {string} input - Raw user input (e.g., "/q", "/agent foo")
 * @returns {string} Resolved command string
 */
export function resolveCommand(input) {
  if (!input.startsWith('/')) return input;

  const cmd = input.slice(1).split(' ')[0].toLowerCase();
  const rest = input.slice(cmd.length + 1);
  const resolved = COMMAND_ALIASES[cmd] || cmd;

  return '/' + resolved + rest;
}

/**
 * Parse a slash command into its name and arguments.
 * @param {string} command - Full command string (e.g., "/agent do something")
 * @returns {{ name: string, args: string }}
 */
export function parseCommand(command) {
  const parts = command.slice(1).split(' ');
  const name = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  return { name, args };
}
