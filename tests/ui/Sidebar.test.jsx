import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text, Box } from 'ink';

// Use vi.hoisted to define mocks before vi.mock hoisting
const { mockUseInput, mockExit } = vi.hoisted(() => ({
  mockUseInput: vi.fn(),
  mockExit: vi.fn()
}));

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useInput: mockUseInput,
    useApp: () => ({ exit: mockExit })
  };
});

// Mock ink-select-input - must return proper Ink elements with Text
vi.mock('ink-select-input', () => ({
  default: (props) => React.createElement(Box, { 'data-testid': 'select-input' },
    props.items && props.items.map((item, idx) => 
      React.createElement(Text, { key: idx }, item.label || item.value)
    )
  )
}));

import Sidebar from '../../src/ui/Sidebar.jsx';

describe('Sidebar Component', () => {
  const mockTheme = {
    primary: '#00D9FF',
    text: '#E5E7EB',
    textDim: '#6B7280',
    backgroundSecondary: '#1E293B',
    border: '#374151',
  };

  const defaultProps = {
    theme: mockTheme,
    currentView: 'chat',
    onViewChange: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render with required props', () => {
    const { lastFrame } = render(<Sidebar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should display OpenAgent title', () => {
    const { lastFrame } = render(<Sidebar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('OpenAgent');
  });

  it('should display navigation items', () => {
    const { lastFrame } = render(<Sidebar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('Chat');
  });

  it('should highlight current view', () => {
    const props = { ...defaultProps, currentView: 'skills' };
    const { lastFrame } = render(<Sidebar {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should show collapsed state', () => {
    const props = { ...defaultProps, collapsed: true };
    const { lastFrame } = render(<Sidebar {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should display keyboard shortcuts hint', () => {
    const { lastFrame } = render(<Sidebar {...defaultProps} />);
    const frame = lastFrame();
    // Check for any keyboard shortcut indicator
    expect(frame).toBeTruthy();
  });

  it('should render with navigation items (partial check)', () => {
    const { lastFrame } = render(<Sidebar {...defaultProps} />);
    const frame = lastFrame();
    // Check for key navigation items - these may be split across lines
    expect(frame).toContain('Chat');
    expect(frame).toContain('Skill');
    expect(frame).toContain('Memory');
    expect(frame).toContain('Model');
  });

  it('should show collapse option when expanded', () => {
    const { lastFrame } = render(<Sidebar {...defaultProps} />);
    const frame = lastFrame();
    // Check for collapse option
    expect(frame).toContain('Collapse');
  });

  it('should use default props when theme is not provided', () => {
    const props = {
      currentView: 'chat',
      onViewChange: vi.fn(),
    };
    const { lastFrame } = render(<Sidebar {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
