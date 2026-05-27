/**
 * 🎨 Theme System for OpenAgent CLI
 *
 * Provides color themes for consistent, beautiful terminal output.
 * Themes define semantic color roles (success, error, accent, etc.)
 * that can be applied throughout the UI.
 */

const syntaxPalettes = {
  catppuccin: {
    syntaxKeyword: '#cba6f7',
    syntaxString: '#a6e3a1',
    syntaxNumber: '#fab387',
    syntaxComment: '#6c7086',
    syntaxFunction: '#f9e2af',
    syntaxType: '#89b4fa',
    syntaxProperty: '#89b4fa',
    syntaxOperator: '#cdd6f4',
    syntaxPunctuation: '#9399b2',
  },
  nord: {
    syntaxKeyword: '#b48ead',
    syntaxString: '#a3be8c',
    syntaxNumber: '#d08770',
    syntaxComment: '#4c566a',
    syntaxFunction: '#ebcb8b',
    syntaxType: '#81a1c1',
    syntaxProperty: '#8fbcbb',
    syntaxOperator: '#eceff4',
    syntaxPunctuation: '#d8dee9',
  },
  dracula: {
    syntaxKeyword: '#ff79c6',
    syntaxString: '#f1fa8c',
    syntaxNumber: '#bd93f9',
    syntaxComment: '#6272a4',
    syntaxFunction: '#50fa7b',
    syntaxType: '#8be9fd',
    syntaxProperty: '#8be9fd',
    syntaxOperator: '#ff79c6',
    syntaxPunctuation: '#f8f8f2',
  },
  monokai: {
    syntaxKeyword: '#f92672',
    syntaxString: '#e6db74',
    syntaxNumber: '#ae81ff',
    syntaxComment: '#75715e',
    syntaxFunction: '#a6e22e',
    syntaxType: '#66d9ef',
    syntaxProperty: '#66d9ef',
    syntaxOperator: '#f92672',
    syntaxPunctuation: '#f8f8f2',
  },
  gruvbox: {
    syntaxKeyword: '#fb4934',
    syntaxString: '#b8bb26',
    syntaxNumber: '#d3869b',
    syntaxComment: '#928374',
    syntaxFunction: '#fabd2f',
    syntaxType: '#83a598',
    syntaxProperty: '#8ec07c',
    syntaxOperator: '#fe8019',
    syntaxPunctuation: '#ebdbb2',
  },
  light: {
    syntaxKeyword: '#d73a49',
    syntaxString: '#22863a',
    syntaxNumber: '#005cc5',
    syntaxComment: '#6a737d',
    syntaxFunction: '#6f42c1',
    syntaxType: '#005cc5',
    syntaxProperty: '#032f62',
    syntaxOperator: '#d73a49',
    syntaxPunctuation: '#24292e',
  },
  tokyonight: {
    syntaxKeyword: '#bb9af7',
    syntaxString: '#9ece6a',
    syntaxNumber: '#ff9e64',
    syntaxComment: '#565f89',
    syntaxFunction: '#e0af68',
    syntaxType: '#7dcfff',
    syntaxProperty: '#7aa2f7',
    syntaxOperator: '#89ddff',
    syntaxPunctuation: '#c0caf5',
  },
  solarized: {
    syntaxKeyword: '#859900',
    syntaxString: '#2aa198',
    syntaxNumber: '#d33682',
    syntaxComment: '#586e75',
    syntaxFunction: '#b58900',
    syntaxType: '#268bd2',
    syntaxProperty: '#6c71c4',
    syntaxOperator: '#cb4b16',
    syntaxPunctuation: '#93a1a1',
  },
  luna: {
    syntaxKeyword: '#c4a7e7',
    syntaxString: '#a6e3a1',
    syntaxNumber: '#fab387',
    syntaxComment: '#6c7086',
    syntaxFunction: '#f9e2af',
    syntaxType: '#89b4fa',
    syntaxProperty: '#7aa2f7',
    syntaxOperator: '#cdd6f4',
    syntaxPunctuation: '#9399b2',
  },
};

function withSyntax(id, theme) {
  return { ...theme, ...syntaxPalettes[id] };
}

export const themes = {
  catppuccin: withSyntax('catppuccin', {
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
  }),
  nord: withSyntax('nord', {
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
  }),
  dracula: withSyntax('dracula', {
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
  }),
  monokai: withSyntax('monokai', {
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
  }),
  gruvbox: withSyntax('gruvbox', {
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
  }),
  light: withSyntax('light', {
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
  }),
  tokyonight: withSyntax('tokyonight', {
    name: 'Tokyo Night',
    text: '#c0caf5',
    accent: '#7aa2f7',
    success: '#9ece6a',
    error: '#f7768e',
    warning: '#e0af68',
    muted: '#565f89',
    tool: '#7dcfff',
    user: '#7aa2f7',
    assistant: '#c0caf5',
    header: '#bb9af7',
  }),
  solarized: withSyntax('solarized', {
    name: 'Solarized Dark',
    text: '#839496',
    accent: '#268bd2',
    success: '#859900',
    error: '#dc322f',
    warning: '#b58900',
    muted: '#586e75',
    tool: '#2aa198',
    user: '#268bd2',
    assistant: '#93a1a1',
    header: '#6c71c4',
  }),
  luna: withSyntax('luna', {
    name: 'Luna',
    text: '#cdd6f4',
    accent: '#c4a7e7',
    success: '#a6e3a1',
    error: '#f38ba8',
    warning: '#f9e2af',
    muted: '#6c7086',
    tool: '#94e2d5',
    user: '#c4a7e7',
    assistant: '#cdd6f4',
    header: '#cba6f7',
  }),
};

/**
 * Get a theme by name, falling back to luna.
 * @param {string} name - Theme key
 * @returns {object} Theme color map
 */
export function getTheme(name) {
  return themes[name] || themes.luna;
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
export const THEME_ORDER = ['luna', 'catppuccin', 'tokyonight', 'nord', 'dracula', 'monokai', 'gruvbox', 'solarized', 'light'];

/**
 * Get the next theme in the cycle.
 * @param {string} current - Current theme key
 * @returns {string} Next theme key
 */
export function nextTheme(current) {
  const idx = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
}

// ═══════════════════════════════════════════════════════════════════
// 🌙 Skin Engine
// ═══════════════════════════════════════════════════════════════════

/**
 * A skin wraps a theme with additional visual metadata:
 * branding strings, spinner faces, tool emojis, prompt symbol, etc.
 * This is the OpenAgent equivalent of Hermes's skin engine.
 */
export const SKINS = {
  luna: {
    theme: 'luna',
    branding: {
      agentName: 'Luna',
      welcome: "Hey! I'm Luna. Type your message or /help for commands.",
      goodbye: 'Goodnight! 🌙',
      responseLabel: ' 🌙 Luna ',
      promptSymbol: '❯',
      helpHeader: '(◕‿◕)? Commands',
    },
    spinner: {
      waitingFaces: ['(◕‿◕)', '(⊙‿⊙)', '(◉‿◉)', '(✿‿✿)', '(◠‿◠)', '(◕◡◕)'],
      thinkingFaces: ['(⌁)', '(<> )', '(•̀ᴗ•́)', '( ◡ )', '(◕‿◕)'],
      thinkingVerbs: [
        'pondering', 'musing', 'contemplating', 'mulling it over',
        'thinking carefully', 'connecting dots', 'crafting a plan',
      ],
      wings: [
        ['⟪☽', '☾⟫'],
        ['⟪✧', '✧⟫'],
        ['⟪⋆', '⋆⟫'],
        ['⟪◉', '◉⟫'],
      ],
    },
    toolPrefix: '┊',
    toolEmojis: {
      read_file: '📄',
      write_file: '✏️',
      edit_file: '🔧',
      search_in_files: '🔍',
      list_directory: '📁',
      exec: '⚔',
      exec_background: '⚡',
      web_search: '🔮',
      read_webpage: '🌐',
      fetch_url: '🔗',
      git_status: '📊',
      git_log: '📜',
      git_diff: '🔀',
      delegate_task: '🤝',
      delegate_parallel: '🤝',
      save_memory: '🧠',
      use_skill: '📚',
      browser_navigate: '🌍',
      browser_click: '👆',
    },
    banner: {
      style: 'rich',
      showTools: true,
      showSkills: false,
    },
  },

  catppuccin: {
    theme: 'catppuccin',
    branding: {
      agentName: 'OpenAgent',
      welcome: 'Welcome to OpenAgent! Type your message or /help for commands.',
      goodbye: 'Goodbye!',
      responseLabel: ' Agent ',
      promptSymbol: '❯',
      helpHeader: 'Commands',
    },
    spinner: {
      waitingFaces: null,
      thinkingFaces: null,
      thinkingVerbs: null,
      wings: null,
    },
    toolPrefix: '│',
    toolEmojis: {},
    banner: { style: 'minimal', showTools: false, showSkills: false },
  },
};

let _activeSkin = 'luna';

export function getActiveSkin() {
  return SKINS[_activeSkin] || SKINS.luna;
}

export function setActiveSkin(name) {
  if (SKINS[name]) _activeSkin = name;
}

export function getSkinTheme() {
  const skin = getActiveSkin();
  return getTheme(skin.theme);
}
