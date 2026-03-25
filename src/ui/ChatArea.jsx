/**
 * 📝 OpenAgent Ink UI - Chat Area Component
 * Displays chat messages and handles input
 */

import React from 'react';
import { Box, Text } from 'ink';

/**
 * Chat area component - displays messages and input
 * @param {Object} props - Component props
 */
export default function ChatArea({
  theme,
  messages = [],
  isProcessing = false,
  onSendMessage
}) {
  return (
    <Box flexDirection="column" flex={1} padding={1}>
      <Box flexDirection="column" flex={1} overflow="hidden">
        {messages.length === 0 ? (
          <Box alignItems="center" justifyContent="center" flex={1}>
            <Text color={theme.textDim}>No messages yet. Start a conversation!</Text>
          </Box>
        ) : (
          messages.map((msg, index) => (
            <Box key={index} marginBottom={1}>
              <Text color={msg.role === 'user' ? theme.primary : theme.text}>
                {msg.role === 'user' ? '> ' : '← '}{msg.content}
              </Text>
            </Box>
          ))
        )}
      </Box>
      
      {isProcessing && (
        <Box marginTop={1}>
          <Text color={theme.warning}>Processing...</Text>
        </Box>
      )}
    </Box>
  );
}
