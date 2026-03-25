/**
 * 💬 OpenAgent Chat Component
 * Chat interface with message history, code highlighting, and auto-scroll
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ThemeColors } from './Theme.js';

/**
 * Chat Interface Component
 * @param {Object} props
 * @param {Object} props.theme - Theme colors object
 * @param {Array} props.messages - Array of message objects {id, role, content, timestamp}
 * @param {Function} props.setMessages - Function to update messages
 * @param {boolean} props.isProcessing - Whether agent is processing
 * @param {Function} props.processMessage - Function to process a message
 */
const Chat = ({
  theme = ThemeColors,
  messages = [],
  setMessages,
  isProcessing = false,
  processMessage,
}) => {
  const { exit } = useApp();
  const chatRef = useRef(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.height;
    }
  }, [messages]);
  
  // Handle keyboard input
  useInput((input, key) => {
    // Ctrl+C to exit
    if (key.ctrl && input === 'c') {
      exit();
    }
    // Ctrl+L to clear chat
    if (key.ctrl && input === 'l') {
      setMessages([]);
    }
  });
  
  // Detect code blocks in content
  const detectCodeBlocks = (content) => {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: content.substring(lastIndex, match.index)
        });
      }
      
      // Add code block
      parts.push({
        type: 'code',
        language: match[1] || 'plaintext',
        content: match[2]
      });
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < content.length) {
      parts.push({
        type: 'text',
        content: content.substring(lastIndex)
      });
    }
    
    return parts;
  };
  
  // Format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  // Copy code to clipboard
  const copyCode = async (code, index) => {
    // In terminal environment, we can't use navigator.clipboard
    // Instead, we'll show a notification
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };
  
  // Render message content
  const renderContent = (content, msgIndex) => {
    const parts = detectCodeBlocks(content);
    
    return parts.map((part, partIndex) => {
      if (part.type === 'code') {
        const codeIndex = `${msgIndex}-${partIndex}`;
        const isCopied = copiedIndex === codeIndex;
        
        return (
          <Box key={codeIndex} flexDirection="column" marginY={1}>
            <Box
              backgroundColor={theme.codeBackground}
              borderColor={theme.codeBorder}
              borderStyle="round"
              paddingX={1}
              paddingY={0}
            >
              <Box justifyContent="space-between" width="100%">
                <Text color={theme.textMuted}>{part.language}</Text>
                <Text
                  color={isCopied ? theme.success : theme.textMuted}
                  onClick={() => copyCode(part.content, codeIndex)}
                >
                  {isCopied ? '✓ Copied' : 'Copy'}
                </Text>
              </Box>
            </Box>
            <Box
              backgroundColor={theme.backgroundSecondary}
              borderColor={theme.codeBorder}
              borderStyle="round"
              paddingX={1}
              paddingY={1}
            >
              <Text color={theme.syntaxKeyword}>
                {part.content.split('\n').map((line, lineIdx) => (
                  <React.Fragment key={lineIdx}>
                    {line}
                    {lineIdx < part.content.split('\n').length - 1 && '\n'}
                  </React.Fragment>
                ))}
              </Text>
            </Box>
          </Box>
        );
      }
      
      // Regular text
      return (
        <Text key={`${msgIndex}-${partIndex}`} color={theme.text}>
          {part.content}
        </Text>
      );
    });
  };
  
  return (
    <Box
      ref={chatRef}
      flexDirection="column"
      height="100%"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      paddingY={1}
    >
      {/* Chat header */}
      <Box
        borderBottom={true}
        borderColor={theme.border}
        paddingBottom={1}
        marginBottom={1}
      >
        <Text color={theme.primary} bold>Chat</Text>
        {isProcessing && (
          <Text color={theme.accent} marginLeft={2}>
            ● Processing...
          </Text>
        )}
      </Box>
      
      {/* Messages container */}
      <Box flexDirection="column" flexGrow={1} overflowY="auto">
        {messages.map((message, index) => (
          <Box
            key={message.id || index}
            flexDirection="column"
            marginBottom={1}
            paddingX={1}
            borderStyle="round"
            borderColor={message.role === 'user' ? theme.primary : theme.secondary}
          >
            {/* Message header */}
            <Box justifyContent="space-between" marginBottom={1}>
              <Box>
                <Text
                  color={message.role === 'user' ? theme.primary : theme.secondary}
                  bold
                >
                  {message.role === 'user' ? 'You' : 'Agent'}
                </Text>
                {message.timestamp && (
                  <Text color={theme.textDim} marginLeft={2}>
                    {formatTimestamp(message.timestamp)}
                  </Text>
                )}
              </Box>
            </Box>
            
            {/* Message content */}
            <Box>
              {renderContent(message.content, index)}
            </Box>
          </Box>
        ))}
        
        {/* Empty state */}
        {messages.length === 0 && (
          <Box
            justifyContent="center"
            alignItems="center"
            flexGrow={1}
          >
            <Text color={theme.textDim}>
              Start a conversation by typing a message below...
            </Text>
          </Box>
        )}
      </Box>
      
      {/* Streaming indicator */}
      {isProcessing && (
        <Box marginTop={1}>
          <Text color={theme.accent}>
            ● Agent is responding...
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default Chat;
