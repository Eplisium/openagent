/**
 * 🎨 OpenAgent Ink UI - Status Component
 * Real-time status bar showing model, processing state, and stats
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, Spinner } from 'ink';
import PropTypes from 'prop-types';

/**
 * Status bar component showing real-time metrics
 * @param {Object} props - Component props
 * @param {Object} props.theme - Theme color object
 * @param {string} props.model - Current model name
 * @param {boolean} props.isProcessing - Whether processing is active
 * @param {number} props.messageCount - Number of messages in conversation
 * @param {number} props.cost - Cost in dollars (default: 0)
 * @param {number} props.tokens - Token usage (default: 0)
 */
export default function Status({
  theme,
  model = 'gpt-4',
  isProcessing = false,
  messageCount = 0,
  cost = 0,
  tokens = 0
}) {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);
  
  // Format cost to 4 decimal places
  const formatCost = (value) => {
    return typeof value === 'number' ? `$${value.toFixed(4)}` : '$0.0000';
  };
  
  // Format token count with K/M suffixes
  const formatTokens = (value) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  };
  
  // Format time as HH:MM:SS
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };
  
  return (
    <Box
      backgroundColor={theme.backgroundSecondary}
      borderStyle="single"
      borderColor={theme.border}
      borderTop={true}
      paddingX={2}
      paddingY={1}
      justifyContent="space-between"
    >
      {/* Left section: Model and processing status */}
      <Box alignItems="center">
        <Box marginRight={2}>
          <Text color={theme.primary} bold>
            🤖 {model}
          </Text>
        </Box>
        
        {isProcessing && (
          <Box marginRight={2}>
            <Spinner type="dots" />
            <Text color={theme.warning} marginLeft={1}>
              Processing...
            </Text>
          </Box>
        )}
        
        {!isProcessing && (
          <Box marginRight={2}>
            <Text color={theme.success}>
              ✓ Ready
            </Text>
          </Box>
        )}
      </Box>
      
      {/* Middle section: Stats */}
      <Box alignItems="center">
        <Box marginRight={3}>
          <Text color={theme.textMuted}>
            📨 {messageCount} messages
          </Text>
        </Box>
        
        <Box marginRight={3}>
          <Text color={theme.textMuted}>
            💰 {formatCost(cost)}
          </Text>
        </Box>
        
        <Box marginRight={3}>
          <Text color={theme.textMuted}>
            🔢 {formatTokens(tokens)} tokens
          </Text>
        </Box>
      </Box>
      
      {/* Right section: Time */}
      <Box alignItems="center">
        <Text color={theme.textDim}>
          🕒 {formatTime(currentTime)}
        </Text>
      </Box>
    </Box>
  );
}

// PropTypes for type checking
Status.propTypes = {
  theme: PropTypes.shape({
    primary: PropTypes.string.isRequired,
    warning: PropTypes.string.isRequired,
    success: PropTypes.string.isRequired,
    textMuted: PropTypes.string.isRequired,
    textDim: PropTypes.string.isRequired,
    backgroundSecondary: PropTypes.string.isRequired,
    border: PropTypes.string.isRequired
  }).isRequired,
  model: PropTypes.string,
  isProcessing: PropTypes.bool,
  messageCount: PropTypes.number,
  cost: PropTypes.number,
  tokens: PropTypes.number
};

// Default props
Status.defaultProps = {
  model: 'gpt-4',
  isProcessing: false,
  messageCount: 0,
  cost: 0,
  tokens: 0
};
