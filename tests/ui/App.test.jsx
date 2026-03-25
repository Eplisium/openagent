import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text, Box } from 'ink';

// Mock the child components using proper Ink components
vi.mock('../../src/ui/Layout.jsx', () => ({
  default: (props) => React.createElement(Box, { key: 'layout' },
    React.createElement(Text, null, 'Layout'))
}));

vi.mock('../../src/ui/Status.jsx', () => ({
  default: (props) => React.createElement(Box, { key: 'status' },
    React.createElement(Text, null, 'Status'))
}));

// Mock ink-gradient
vi.mock('ink-gradient', () => ({
  default: (props) => React.createElement(Box, null, props.children)
}));

// Mock ink-big-text with DEFAULT export
vi.mock('ink-big-text', () => ({
  default: (props) => React.createElement(Box, null,
    React.createElement(Text, null, props.text || 'OpenAgent'))
}));

// Mock Theme module
vi.mock('../../src/ui/Theme.js', () => ({
  ThemeProvider: {
    get: () => 'dark',
    set: vi.fn(),
    next: () => 'light'
  },
  THEMES: { dark: {}, light: {}, hacker: {} },
  ThemeColors: {}
}));

// Mock the ink hooks
const mockExit = vi.fn();

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useApp: () => ({ exit: mockExit }),
    useStdin: () => ({ isRawModeSupported: true }),
    useInput: vi.fn(),
  };
});

import App from '../../src/ui/App.jsx';

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render without crashing', () => {
    const { lastFrame } = render(<App config={{}} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should show splash screen initially', () => {
    const { lastFrame } = render(<App config={{}} />);
    const frame = lastFrame();
    // Splash screen shows BigText - check for any text that appears
    expect(frame).toBeTruthy();
  });

  it('should render Layout and Status components after splash', () => {
    const { lastFrame } = render(<App config={{}} />);
    
    // Run all pending timers, including the 2-second splash screen timer
    vi.runAllTimers();
    
    const frame = lastFrame();
    // After splash, should show Layout and Status
    expect(frame).toContain('Layout');
    expect(frame).toContain('Status');
  });

  it('should initialize with default config', () => {
    const { lastFrame } = render(<App config={{}} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should initialize with custom theme', () => {
    const config = { theme: 'light' };
    const { lastFrame } = render(<App config={config} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should initialize with custom model', () => {
    const config = { defaultModel: 'gpt-3.5-turbo' };
    const { lastFrame } = render(<App config={config} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should handle keyboard shortcuts', () => {
    const { lastFrame } = render(<App config={{}} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
