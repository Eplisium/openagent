/**
 * 🎨 Theme System for OpenAgent CLI
 *
 * Provides color themes for consistent, beautiful terminal output.
 * Themes define semantic color roles (success, error, accent, etc.)
 * that can be applied throughout the UI.
 */

export const themes = {
  catppuccin: {
    name: 'Catppuccin Mocha',
    bg: '', // terminal default
    text: '#cdd6f4',
    accent: '#89b4fa',
    success: '#a6e3a1',
    error: '#f38ba8',
    warning: '#f9e2af',
    muted: '#6c7086',
    tool: '#94e2d5',
    user: '#89b4fa',
    assistant: '#cdd6f4',
    header: '#cba6f7',
  },
  nord: {
    name: 'Nord',
    text: '#eceff4',
    accent: '#88c0d0',
    success: '#a3be8c',
    error: '#bf616a',
    warning: '#ebcb8b',
    muted: '#4c566a',
    tool: '#8fbcbb',
    user: '#88c0d0',
    assistant: '#eceff4',
    header: '#b48ead',
  },
  dracula: {
    name: 'Dracula',
    text: '#f8f8f2',
    accent: '#bd93f9',
    success: '#50fa7b',
    error: '#ff5555',
    warning: '#f1fa8c',
    muted: '#6272a4',
    tool: '#8be9fd',
    user: '#bd93f9',
    assistant: '#f8f8f2',
    header: '#ff79c6',
  },
  monokai: {
    name: 'Monokai',
    text: '#f8f8f2',
    accent: '#66d9ef',
    success: '#a6e22e',
    error: '#f92672',
    warning: '#e6db74',
    muted: '#75715e',
    tool: '#ae81ff',
    user: '#66d9ef',
    assistant: '#f8f8f2',
    header: '#f92672',
  },
  gruvbox: {
    name: 'Gruvbox',
    text: '#ebdbb2',
    accent: '#83a598',
    success: '#b8bb26',
    error: '#fb4934',
    warning: '#fabd2f',
    muted: '#928374',
    tool: '#8ec07c',
    user: '#83a598',
    assistant: '#ebdbb2',
    header: '#d3869b',
  },
  light: {
    name: 'Light',
    text: '#333333',
    accent: '#0066cc',
    success: '#22863a',
    error: '#d73a49',
    warning: '#b08800',
    muted: '#6a737d',
    tool: '#6f42c1',
    user: '#0066cc',
    assistant: '#333333',
    header: '#005cc5',
  },
};

/**
 * Get a theme by name, falling back to catppuccin.
 * @param {string} name - Theme key
 * @returns {object} Theme color map
 */
export function getTheme(name) {
  return themes[name] || themes.catppuccin;
}

/**
 * List all available themes.
 * @returns {Array<{id: string, name: string}>}
 */
export function listThemes() {
  return Object.keys(themes).map(k => ({ id: k, name: themes[k].name }));
}

/**
 * Ordered array of theme keys for cycling.
 */
export const THEME_ORDER = ['catppuccin', 'nord', 'dracula', 'monokai', 'gruvbox', 'light'];

/**
 * Get the next theme in the cycle.
 * @param {string} current - Current theme key
 * @returns {string} Next theme key
 */
export function nextTheme(current) {
  const idx = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
}
