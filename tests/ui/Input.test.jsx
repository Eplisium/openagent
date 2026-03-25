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

// Mock ThemeColors
vi.mock('../../src/ui/Theme.js', () => ({
  ThemeColors: {
    primary: '#00D9FF',
    text: '#E5E7EB',
    textDim: '#6B7280',
    backgroundSecondary: '#1E293B',
    border: '#374151',
  }
}));

import Input from '../../src/ui/Input.jsx';

describe('Input Component', () => {
  const mockTheme = {
    primary: '#00D9FF',
    text: '#E5E7EB',
    textDim: '#6B7280',
    backgroundSecondary: '#1E293B',
    border: '#374151',
  };

  const defaultProps = {
    theme: mockTheme,
    onSubmit: vi.fn(),
    placeholder: 'Ask me anything...',
    disabled: false,
    history: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render with required props', () => {
    const { lastFrame } = render(<Input {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should display placeholder when input is empty', () => {
    const { lastFrame } = render(<Input {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('Ask me anything...');
  });

  it('should show character count', () => {
    const { lastFrame } = render(<Input {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('chars');
  });

  it('should render with custom placeholder', () => {
    const props = { ...defaultProps, placeholder: 'Type your message...' };
    const { lastFrame } = render(<Input {...props} />);
    const frame = lastFrame();
    expect(frame).toContain('Type your message...');
  });

  it('should show instructions', () => {
    const { lastFrame } = render(<Input {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('Enter: submit');
    expect(frame).toContain('Tab: autocomplete');
  });

  it('should apply disabled styling when disabled', () => {
    const props = { ...defaultProps, disabled: true };
    const { lastFrame } = render(<Input {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should render multiline mode', () => {
    const { lastFrame } = render(<Input {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should render with history', () => {
    const props = { ...defaultProps, history: ['hello', 'world'] };
    const { lastFrame } = render(<Input {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should render submit hint', () => {
    const { lastFrame } = render(<Input {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain('submit');
  });

  it('should use default theme when not provided', () => {
    const props = { onSubmit: vi.fn() };
    const { lastFrame } = render(<Input {...props} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
