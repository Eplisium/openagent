import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeProvider, ThemeColors, LightThemeColors, HighContrastTheme, THEMES, THEME_NAMES } from '../../src/ui/Theme.js';

// Mock dependencies
vi.mock('../../src/ui/Theme.js', async () => {
  const actual = await vi.importActual('../../src/ui/Theme.js');
  return {
    ...actual,
    ThemeProvider: {
      ...actual.ThemeProvider,
      current: 'dark',
    }
  };
});

describe('Theme System', () => {
  beforeEach(() => {
    // Reset ThemeProvider state before each test
    ThemeProvider.current = 'dark';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ThemeColors', () => {
    it('should have primary colors defined', () => {
      expect(ThemeColors).toHaveProperty('primary', '#00D9FF');
      expect(ThemeColors).toHaveProperty('secondary', '#7C3AED');
      expect(ThemeColors).toHaveProperty('accent', '#F59E0B');
    });

    it('should have text colors defined', () => {
      expect(ThemeColors).toHaveProperty('text', '#E5E7EB');
      expect(ThemeColors).toHaveProperty('textMuted', '#9CA3AF');
      expect(ThemeColors).toHaveProperty('textDim', '#6B7280');
    });

    it('should have background colors defined', () => {
      expect(ThemeColors).toHaveProperty('background', '#0F172A');
      expect(ThemeColors).toHaveProperty('backgroundSecondary', '#1E293B');
      expect(ThemeColors).toHaveProperty('backgroundTertiary', '#334155');
    });
  });

  describe('LightThemeColors', () => {
    it('should contain all keys from ThemeColors', () => {
      // LightThemeColors should have at least the same keys as ThemeColors
      const themeKeys = Object.keys(ThemeColors);
      const lightKeys = Object.keys(LightThemeColors);
      themeKeys.forEach(key => {
        expect(lightKeys).toContain(key);
      });
    });

    it('should have different text colors than ThemeColors', () => {
      expect(LightThemeColors.text).not.toBe(ThemeColors.text);
      expect(LightThemeColors.textMuted).not.toBe(ThemeColors.textMuted);
      expect(LightThemeColors.textDim).not.toBe(ThemeColors.textDim);
    });

    it('should have light background colors', () => {
      expect(LightThemeColors.background).toBe('#FFFFFF');
      expect(LightThemeColors.backgroundSecondary).toBe('#F3F4F6');
    });
  });

  describe('HighContrastTheme', () => {
    it('should contain all keys from ThemeColors', () => {
      // HighContrastTheme should have at least the same keys as ThemeColors
      const themeKeys = Object.keys(ThemeColors);
      const highContrastKeys = Object.keys(HighContrastTheme);
      themeKeys.forEach(key => {
        expect(highContrastKeys).toContain(key);
      });
    });

    it('should have higher contrast colors', () => {
      expect(HighContrastTheme.text).toBe('#FFFFFF');
      expect(HighContrastTheme.background).toBe('#000000');
    });
  });

  describe('THEMES', () => {
    it('should contain dark, light, and high-contrast themes', () => {
      expect(THEMES).toHaveProperty('dark', ThemeColors);
      expect(THEMES).toHaveProperty('light', LightThemeColors);
      expect(THEMES).toHaveProperty('high-contrast', HighContrastTheme);
    });
  });

  describe('THEME_NAMES', () => {
    it('should be an array of theme names', () => {
      expect(THEME_NAMES).toEqual(['dark', 'light', 'high-contrast']);
    });
  });

  describe('ThemeProvider', () => {
    describe('get()', () => {
      it('should return dark theme by default', () => {
        expect(ThemeProvider.get()).toBe(ThemeColors);
      });

      it('should return light theme when set to light', () => {
        ThemeProvider.set('light');
        expect(ThemeProvider.get()).toBe(LightThemeColors);
      });

      it('should return high-contrast theme when set to high-contrast', () => {
        ThemeProvider.set('high-contrast');
        expect(ThemeProvider.get()).toBe(HighContrastTheme);
      });
    });

    describe('set()', () => {
      it('should change theme to valid theme name', () => {
        const result = ThemeProvider.set('light');
        expect(result).toBe(true);
        expect(ThemeProvider.current).toBe('light');
      });

      it('should return false for invalid theme name', () => {
        const result = ThemeProvider.set('invalid-theme');
        expect(result).toBe(false);
        expect(ThemeProvider.current).toBe('dark'); // Should remain unchanged
      });
    });

    describe('list()', () => {
      it('should return array of theme names', () => {
        const list = ThemeProvider.list();
        expect(list).toEqual(['dark', 'light', 'high-contrast']);
      });
    });

    describe('next()', () => {
      it('should cycle to next theme in order', () => {
        expect(ThemeProvider.current).toBe('dark');
        const nextTheme = ThemeProvider.next();
        expect(nextTheme).toBe('light');
        expect(ThemeProvider.current).toBe('light');
      });

      it('should cycle back to first theme after last', () => {
        ThemeProvider.set('high-contrast');
        const nextTheme = ThemeProvider.next();
        expect(nextTheme).toBe('dark');
        expect(ThemeProvider.current).toBe('dark');
      });
    });
  });
});
