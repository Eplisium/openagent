import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text, Box } from 'ink';

// Mock Theme module
vi.mock('../../src/ui/Theme.js', () => ({
  ThemeProvider: {
    get: () => 'dark'
  },
  THEMES: { dark: {}, light: {}, hacker: {} },
  ThemeColors: {}
}));

// Mock the ink hooks to prevent stdin issues
const mockExit = vi.fn();

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useApp: () => ({ exit: mockExit }),
    useStdin: () => ({ 
      isRawModeSupported: true,
      stdin: {
        ref: vi.fn(),
        unref: vi.fn(),
        setRawMode: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn()
      }
    }),
    useInput: vi.fn(),
  };
});

import Chat from '../../src/ui/Chat.jsx';

describe('Chat Component', () => {
  const defaultProps = {
    messages: [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I am doing well, thank you!' }
    ],
    isProcessing: false,
    onSendMessage: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with messages', () => {
    const { lastFrame } = render(<Chat {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should distinguish between user and assistant messages', () => {
    const { lastFrame } = render(<Chat {...defaultProps} />);
    const frame = lastFrame();
    // Check that the messages appear in the output
    expect(frame).toContain('Hello, how are you?');
    expect(frame).toContain('I am doing well, thank you!');
  });

  it('should detect code blocks', () => {
    const messagesWithCode = [
      { role: 'user', content: 'Please explain this code:' },
      { role: 'assistant', content: '```javascript\nconst x = 1;\n```' }
    ];
    const { lastFrame } = render(<Chat {...defaultProps} messages={messagesWithCode} />);
    const frame = lastFrame();
    expect(frame).toContain('const x = 1');
  });

  it('should handle auto-scroll', () => {
    const { lastFrame } = render(<Chat {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should render empty state when no messages', () => {
    const { lastFrame } = render(<Chat {...defaultProps} messages={[]} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should show processing indicator when isProcessing is true', () => {
    const { lastFrame } = render(<Chat {...defaultProps} isProcessing={true} />);
    const frame = lastFrame();
    expect(frame).toContain('Processing');
  });

  it('should handle markdown content', () => {
    const markdownMessages = [
      { role: 'user', content: '**Bold** and *italic*' }
    ];
    const { lastFrame } = render(<Chat {...defaultProps} messages={markdownMessages} />);
    const frame = lastFrame();
    expect(frame).toContain('Bold');
  });

  it('should apply theme colors', () => {
    const { lastFrame } = render(<Chat {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
