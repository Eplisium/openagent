import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text, Box } from 'ink';

// Mock the ink hooks and Spinner component
const mockExit = vi.fn();

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useApp: () => ({ exit: mockExit }),
    useInput: vi.fn(),
    // Spinner mock that returns proper Ink element with Text
    Spinner: (props) => React.createElement(Box, { 'data-testid': 'spinner' },
      React.createElement(Text, null, '...')
    )
  };
});

import Status from '../../src/ui/Status.jsx';

describe('Status Component', () => {
  const mockTheme = {
    primary: '#00D9FF',
    warning: '#F59E0B',
    success: '#10B981',
    textMuted: '#9CA3AF',
    textDim: '#6B7280',
    backgroundSecondary: '#1E293B',
    border: '#374151',
  };

  const defaultProps = {
    theme: mockTheme,
    model: 'gpt-4',
    isProcessing: false,
    messageCount: 10,
    cost: 0.0123,
    tokens: 1500,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render with required props', () => {
    const { lastFrame } = render(<Status {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
    expect(frame).toContain('gpt-4');
  });

  it('should display model name', () => {
    const { lastFrame } = render(<Status {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('gpt-4');
  });

  it('should format cost correctly', () => {
    const { lastFrame } = render(<Status {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('$0.0123');
  });

  it('should format large token counts with K suffix', () => {
    const props = { ...defaultProps, tokens: 1500 };
    const { lastFrame } = render(<Status {...props} />);
    const frame = lastFrame();
    expect(frame).toContain('1.5K');
  });

  it('should format very large token counts with M suffix', () => {
    const props = { ...defaultProps, tokens: 1500000 };
    const { lastFrame } = render(<Status {...props} />);
    const frame = lastFrame();
    expect(frame).toContain('1.5M');
  });

  it('should display processing indicator when isProcessing is true', () => {
    const props = { ...defaultProps, isProcessing: true };
    const { lastFrame } = render(<Status {...props} />);
    const frame = lastFrame();
    expect(frame).toContain('Working');
  });

  it('should display ready indicator when isProcessing is false', () => {
    const props = { ...defaultProps, isProcessing: false };
    const { lastFrame } = render(<Status {...props} />);
    const frame = lastFrame();
    expect(frame).toContain('Ready');
  });

  it('should display message count', () => {
    const { lastFrame } = render(<Status {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('10');
    expect(frame).toContain('💬');
  });

  it('should use default values when props are not provided', () => {
    const minimalProps = { theme: mockTheme };
    const { lastFrame } = render(<Status {...minimalProps} />);
    const frame = lastFrame();
    expect(frame).toContain('gpt-4');
    expect(frame).toContain('0');
  });

  it('should format cost with leading zero for small values', () => {
    const props = { ...defaultProps, cost: 0.0001 };
    const { lastFrame } = render(<Status {...props} />);
    const frame = lastFrame();
    expect(frame).toContain('$0.0001');
  });
});
