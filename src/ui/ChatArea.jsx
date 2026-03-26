/**
 * 💬 OpenAgent Ink UI - Chat Area Component
 * Full chat interface with real input, message display, tool call visualization, and streaming
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';

/**
 * Chat area — the main conversational view
 */
export default function ChatArea({
  theme,
  messages = [],
  setMessages,
  isProcessing = false,
  processMessage,
  model = '',
  activeToolCalls = [],
  currentIteration = 0,
  inputHistory = [],
}) {
  const { exit } = useApp();
  const [inputValue, setInputValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    setScrollOffset(0);
  }, [messages.length]);

  // Handle submission
  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isProcessing) return;

    setInputValue('');
    setHistoryIndex(-1);
    processMessage(trimmed);
  }, [inputValue, isProcessing, processMessage]);

  // Handle up/down arrow for history
  useInput((input, key) => {
    if (key.upArrow && inputHistory.length > 0) {
      if (historyIndex === -1) {
        setTempInput(inputValue);
        const newIndex = 0;
        setHistoryIndex(newIndex);
        setInputValue(inputHistory[newIndex] || '');
      } else if (historyIndex < inputHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInputValue(inputHistory[newIndex] || '');
      }
    }
    if (key.downArrow && historyIndex !== -1) {
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInputValue(inputHistory[newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInputValue(tempInput);
      }
    }
  });

  // Format timestamp
  const formatTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Render a single message
  const renderMessage = (msg, index) => {
    const isUser = msg.role === 'user';
    const isError = msg.isError;

    return (
      <Box key={index} flexDirection="column" marginBottom={1} paddingX={1}>
        {/* Message header */}
        <Box>
          <Text color={isUser ? theme.primary : isError ? theme.error : theme.secondary} bold>
            {isUser ? '▸ You' : '🤖 Agent'}
          </Text>
          {msg.timestamp && (
            <Text color={theme.textDim}>  {formatTime(msg.timestamp)}</Text>
          )}
        </Box>
        {/* Message body */}
        <Box marginTop={0} paddingLeft={1}>
          <Box flexDirection="column" width="100%">
            {renderContent(msg.content, theme)}
          </Box>
        </Box>
      </Box>
    );
  };

  // Render message content with markdown-like formatting
  const renderContent = (content, theme) => {
    if (!content) return null;
    const lines = content.split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeLines = [];
    let codeLang = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block toggle
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          elements.push(
            <Box key={`code-${i}`} flexDirection="column" marginY={1}>
              <Box backgroundColor={theme.codeBackground} borderColor={theme.codeBorder} borderStyle="round" paddingX={1}>
                <Text color={theme.textMuted}>{codeLang || 'code'}</Text>
              </Box>
              <Box backgroundColor={theme.backgroundSecondary} borderColor={theme.codeBorder} borderStyle="round" paddingX={1} paddingY={0} flexDirection="column">
                {codeLines.map((cl, ci) => (
                  <Text key={ci} color={theme.syntaxKeyword}>{cl}</Text>
                ))}
              </Box>
            </Box>
          );
          codeLines = [];
          codeLang = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        elements.push(<Text key={`empty-${i}`}>{' '}</Text>);
        continue;
      }

      // Headings
      if (line.startsWith('# ')) {
        elements.push(
          <Text key={`h-${i}`} color={theme.primary} bold>{line.slice(2)}</Text>
        );
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <Text key={`h2-${i}`} color={theme.secondary} bold>{line.slice(3)}</Text>
        );
        continue;
      }

      // Bullet points
      if (line.match(/^[\s]*[-*•]\s/)) {
        const indent = line.match(/^(\s*)/)[1].length;
        const text = line.replace(/^[\s]*[-*•]\s/, '');
        elements.push(
          <Text key={`li-${i}`} color={theme.text}>
            {' '.repeat(indent)}<Text color={theme.accent}>•</Text> {text}
          </Text>
        );
        continue;
      }

      // Table rows
      if (line.includes('|') && line.trim().startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        // Skip separator rows
        if (cells.every(c => c.match(/^[-:]+$/))) continue;
        elements.push(
          <Text key={`tr-${i}`} color={theme.textDim}>{cells.join('  │  ')}</Text>
        );
        continue;
      }

      // Regular text — apply inline formatting
      elements.push(
        <Text key={`p-${i}`} color={theme.text}>{formatInline(line, theme)}</Text>
      );
    }

    return elements;
  };

  // Inline formatting (bold, code, etc.)
  const formatInline = (text, theme) => {
    // For Ink, we just return the text — inline formatting is limited
    // Strip markdown bold/italic markers for cleaner display
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1');
  };

  // Render active tool calls
  const renderToolCalls = () => {
    if (activeToolCalls.length === 0) return null;

    return (
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        {activeToolCalls.map((tool, idx) => (
          <Box key={tool.id || idx} flexDirection="column" marginBottom={0}>
            <Box>
              <Text color={tool.status === 'running' ? theme.warning : tool.status === 'success' ? theme.success : theme.error}>
                {tool.status === 'running' ? '⚙' : tool.status === 'success' ? '✓' : '✗'}
              </Text>
              <Text color={theme.textMuted}> {tool.name}</Text>
              {tool.args?.path && <Text color={theme.textDim}> — {tool.args.path}</Text>}
              {tool.args?.command && <Text color={theme.textDim}> — {String(tool.args.command).substring(0, 40)}</Text>}
              {tool.duration && <Text color={theme.textDim}> ({tool.duration}ms)</Text>}
            </Box>
          </Box>
        ))}
      </Box>
    );
  };

  // Processing indicator
  const renderProcessing = () => {
    if (!isProcessing) return null;

    return (
      <Box flexDirection="column" marginBottom={1} paddingX={1}>
        <Box>
          <Text color={theme.warning}>⏳</Text>
          <Text color={theme.textMuted}> Working</Text>
          {currentIteration > 0 && (
            <Text color={theme.textDim}> (iteration {currentIteration})</Text>
          )}
          <Text color={theme.textDim}>...</Text>
        </Box>
      </Box>
    );
  };

  // Welcome message for empty chat
  const renderWelcome = () => {
    if (messages.length > 0) return null;

    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flex={1} padding={2}>
        <Text color={theme.primary} bold>🚀 OpenAgent</Text>
        <Box marginTop={1}>
          <Text color={theme.textMuted}>AI-Powered Agentic Assistant</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.textDim}>Model: {model || 'Not set'}</Text>
        </Box>
        <Box marginTop={2} flexDirection="column" alignItems="center">
          <Text color={theme.textDim}>Type a message to start an agentic task</Text>
          <Text color={theme.textDim}>Type /help for commands</Text>
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box
        borderStyle="single"
        borderColor={theme.border}
        borderBottom={true}
        paddingX={2}
        paddingY={0}
      >
        <Text color={theme.primary} bold>💬 Chat</Text>
        {isProcessing && (
          <Text color={theme.warning}>  ● Processing</Text>
        )}
        {model && (
          <Text color={theme.textDim}>  — {model}</Text>
        )}
      </Box>

      {/* Messages area */}
      <Box flexDirection="column" flex={1} overflow="hidden" paddingX={1} paddingY={1}>
        {messages.length === 0 ? (
          renderWelcome()
        ) : (
          <Box flexDirection="column">
            {messages.map((msg, idx) => renderMessage(msg, idx))}
            {renderToolCalls()}
            {renderProcessing()}
          </Box>
        )}
      </Box>

      {/* Input area */}
      <Box
        borderStyle="round"
        borderColor={isProcessing ? theme.warning : theme.primary}
        paddingX={1}
        paddingY={0}
        flexDirection="column"
      >
        <Box>
          <Text color={theme.accent}>{'❯ '}</Text>
          <Box flex={1}>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder={isProcessing ? 'Waiting for response...' : 'Type a message... (Enter sends)'}
              focus={!isProcessing}
            />
          </Box>
        </Box>
        <Box justifyContent="space-between">
          <Text color={theme.textDim}>
            Enter: send | Up/Down: history | /help: commands
          </Text>
          <Text color={theme.textDim}>
            {inputValue.length > 0 ? `${inputValue.length} chars` : ''}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
