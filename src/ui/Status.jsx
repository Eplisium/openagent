/**
 * OpenAgent Ink UI - Status Component
 * Real-time status bar showing model, processing state, and stats
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export default function Status({
  theme,
  model = 'gpt-4',
  isProcessing = false,
  messageCount = 0,
  cost = 0,
  tokens = 0
}) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => {
      setSpinnerFrame(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [isProcessing]);

  const formatCost = (v) => typeof v === 'number' ? `$${v.toFixed(4)}` : '$0.0000';
  const formatTokens = (v) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toString();
  const formatTime = (d) => d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <Box
      backgroundColor={theme?.backgroundSecondary}
      borderStyle="single"
      borderColor={theme?.border}
      borderTop={true}
      paddingX={2}
      paddingY={1}
      justifyContent="space-between"
    >
      <Box alignItems="center">
        <Box marginRight={2}>
          <Text color={theme?.primary} bold>🤖 {model}</Text>
        </Box>
        {isProcessing ? (
          <Box marginRight={2}>
            <Text color={theme?.warning}>{SPINNER_FRAMES[spinnerFrame]} Processing...</Text>
          </Box>
        ) : (
          <Box marginRight={2}>
            <Text color={theme?.success}>✓ Ready</Text>
          </Box>
        )}
      </Box>
      <Box alignItems="center">
        <Text color={theme?.textMuted}>📨 {messageCount} msgs</Text>
        <Text color={theme?.textMuted}>  💰 {formatCost(cost)}</Text>
        <Text color={theme?.textMuted}>  🔢 {formatTokens(tokens)} tok</Text>
      </Box>
      <Box alignItems="center">
        <Text color={theme?.textDim}>🕒 {formatTime(currentTime)}</Text>
      </Box>
    </Box>
  );
}
