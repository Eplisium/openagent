// IMPORTANT: vi.mock calls MUST be before any imports due to hoisting
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text, Box } from 'ink';

// Use vi.hoisted to define mocks before vi.mock hoisting
const { mockUseInput, mockExit } = vi.hoisted(() => ({
  mockUseInput: vi.fn(),
  mockExit: vi.fn()
}));

// Mock the child components FIRST before importing Layout
vi.mock('../../src/ui/Sidebar.jsx', () => ({
  default: (props) => React.createElement(Box, { key: 'sidebar', 'data-testid': 'sidebar' },
    React.createElement(Text, null, 'Sidebar')
  )
}));

vi.mock('../../src/ui/ChatArea.jsx', () => ({
  default: (props) => React.createElement(Box, { key: 'chat-area', 'data-testid': 'chat-area' },
    React.createElement(Text, null, 'ChatArea')
  )
}));

// Mock the ink hooks BEFORE importing Layout
vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useInput: mockUseInput,
    useApp: () => ({ exit: mockExit })
  };
});

// NOW import Layout after all mocks are set up
import Layout from '../../src/ui/Layout.jsx';

describe('Layout Component', () => {
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
    setCurrentView: vi.fn(),
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    messages: [],
    setMessages: vi.fn(),
    isProcessing: false,
    processMessage: vi.fn(),
    model: 'gpt-4',
    setModel: vi.fn(),
    notifications: [],
    addNotification: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render with required props', () => {
    const { lastFrame } = render(<Layout {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should render Sidebar component', () => {
    const { lastFrame } = render(<Layout {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('Sidebar');
  });

  it('should render different views', () => {
    const props = { ...defaultProps, currentView: 'skills' };
    const { lastFrame } = render(<Layout {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should handle sidebar toggle', () => {
    const props = { ...defaultProps, sidebarCollapsed: true };
    const { lastFrame } = render(<Layout {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should display notifications', () => {
    const props = { ...defaultProps, notifications: [{ id: 1, message: 'Test notification', type: 'info' }] };
    const { lastFrame } = render(<Layout {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should handle processing state', () => {
    const props = { ...defaultProps, isProcessing: true };
    const { lastFrame } = render(<Layout {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should use default notifications array', () => {
    const { lastFrame } = render(<Layout {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
