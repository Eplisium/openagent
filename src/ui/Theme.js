/**
 * 🎨 OpenAgent Ink UI Theme System
 * Supports light/dark modes, custom color schemes, and accessibility options
 */

export const ThemeColors = {
  // Primary palette
  primary: '#00D9FF',
  secondary: '#7C3AED',
  accent: '#F59E0B',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  
  // Text colors
  text: '#E5E7EB',
  textMuted: '#9CA3AF',
  textDim: '#6B7280',
  
  // Background colors
  background: '#0F172A',
  backgroundSecondary: '#1E293B',
  backgroundTertiary: '#334155',
  
  // Border colors
  border: '#374151',
  borderLight: '#4B5563',
  
  // UI element colors
  sidebar: '#1E293B',
  header: '#0F172A',
  input: '#1E293B',
  hover: '#334155',
  
  // Code/syntax colors
  codeBackground: '#1E293B',
  codeBorder: '#374151',
  syntaxKeyword: '#C084FC',
  syntaxString: '#34D399',
  syntaxNumber: '#FCD34D',
  syntaxComment: '#6B7280',
  syntaxFunction: '#60A5FA',
};

export const LightThemeColors = {
  ...ThemeColors,
  text: '#1F2937',
  textMuted: '#6B7280',
  textDim: '#9CA3AF',
  background: '#FFFFFF',
  backgroundSecondary: '#F3F4F6',
  backgroundTertiary: '#E5E7EB',
  border: '#D1D5DB',
  borderLight: '#E5E7EB',
  sidebar: '#F9FAFB',
  header: '#FFFFFF',
  input: '#F3F4F6',
  hover: '#E5E7EB',
  codeBackground: '#F3F4F6',
  codeBorder: '#D1D5DB',
};

export const HighContrastTheme = {
  ...ThemeColors,
  text: '#FFFFFF',
  textMuted: '#E5E7EB',
  background: '#000000',
  backgroundSecondary: '#1A1A1A',
  border: '#FFFFFF',
  primary: '#00FFFF',
  error: '#FF6B6B',
  success: '#4ADE80',
};

export const THEMES = {
  dark: ThemeColors,
  light: LightThemeColors,
  'high-contrast': HighContrastTheme,
};

export const THEME_NAMES = Object.keys(THEMES);

export const ThemeProvider = {
  current: 'dark',
  
  get() {
    return THEMES[this.current] || ThemeColors;
  },
  
  set(themeName) {
    if (THEMES[themeName]) {
      this.current = themeName;
      return true;
    }
    return false;
  },
  
  list() {
    return THEME_NAMES;
  },
  
  next() {
    const idx = THEME_NAMES.indexOf(this.current);
    this.current = THEME_NAMES[(idx + 1) % THEME_NAMES.length];
    return this.current;
  }
};

export default ThemeProvider;
