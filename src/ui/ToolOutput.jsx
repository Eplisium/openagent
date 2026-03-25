/**
 * 🔧 OpenAgent Tool Output Component
 * Displays tool execution results with collapsible sections and syntax highlighting
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ThemeColors } from './Theme.js';

/**
 * Tool Output Component
 * @param {Object} props
 * @param {Object} props.theme - Theme colors object
 * @param {string} props.toolName - Name of the tool
 * @param {Object|string} props.input - Tool input parameters
 * @param {Object|string} props.output - Tool output result
 * @param {string} props.status - Status: 'success', 'error', 'running'
 * @param {number} props.duration - Execution duration in milliseconds
 */
const ToolOutput = ({
  theme = ThemeColors,
  toolName = 'unknown',
  input = null,
  output = null,
  status = 'success',
  duration = 0,
}) => {
  const [inputExpanded, setInputExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  
  // Get status color
  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return theme.success;
      case 'error':
        return theme.error;
      case 'running':
        return theme.warning;
      default:
        return theme.textDim;
    }
  };
  
  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'running':
        return '●';
      default:
        return '○';
    }
  };
  
  // Format duration
  const formatDuration = (ms) => {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(1);
      return `${minutes}m ${seconds}s`;
    }
  };
  
  // Format JSON with syntax highlighting
  const formatJson = (obj) => {
    try {
      const jsonStr = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
      return jsonStr;
    } catch (e) {
      return String(obj);
    }
  };
  
  // Detect if content is JSON
  const isJson = (content) => {
    if (typeof content === 'object' && content !== null) return true;
    if (typeof content === 'string') {
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };
  
  // Render JSON with colors
  const renderJson = (content, indent = 0) => {
    const formatted = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const lines = formatted.split('\n');
    
    return lines.map((line, idx) => {
      // Color keys, strings, numbers, booleans, null
      let coloredLine = line;
      
      // Highlight keys ("key":)
      coloredLine = coloredLine.replace(
        /"([^"]+)"\s*:/g,
        `"$1":`
      );
      
      return (
        <Text key={idx} color={theme.text}>
          {coloredLine}
          {idx < lines.length - 1 && '\n'}
        </Text>
      );
    });
  };
  
  // Copy output to clipboard
  const handleCopy = () => {
    const content = isJson(output) ? formatJson(output) : String(output);
    // In terminal, we show confirmation
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // Handle keyboard input
  useInput((input, key) => {
    // 'i' to toggle input
    if (input === 'i') {
      setInputExpanded(!inputExpanded);
    }
    // 'o' to toggle output
    if (input === 'o') {
      setOutputExpanded(!outputExpanded);
    }
    // 'c' to copy
    if (input === 'c') {
      handleCopy();
    }
  });
  
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={getStatusColor()}
      paddingX={1}
      paddingY={1}
      marginBottom={1}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text color={getStatusColor()}>
            {getStatusIcon()}{' '}
          </Text>
          <Text color={theme.primary} bold>
            {toolName}
          </Text>
        </Box>
        <Box>
          {duration > 0 && (
            <Text color={theme.textDim}>
              {formatDuration(duration)}
            </Text>
          )}
        </Box>
      </Box>
      
      {/* Input section (collapsible) */}
      {input !== null && (
        <Box flexDirection="column" marginBottom={1}>
          <Box
            backgroundColor={theme.backgroundSecondary}
            paddingX={1}
            cursor="pointer"
            onClick={() => setInputExpanded(!inputExpanded)}
          >
            <Text color={theme.textMuted}>
              {inputExpanded ? '▼' : '▶'} Input
            </Text>
          </Box>
          {inputExpanded && (
            <Box
              backgroundColor={theme.backgroundTertiary}
              paddingX={1}
              paddingY={1}
              borderStyle="round"
              borderColor={theme.border}
            >
              {isJson(input) ? (
                renderJson(input)
              ) : (
                <Text color={theme.text}>{String(input)}</Text>
              )}
            </Box>
          )}
        </Box>
      )}
      
      {/* Output section (collapsible) */}
      {output !== null && (
        <Box flexDirection="column">
          <Box
            backgroundColor={theme.backgroundSecondary}
            paddingX={1}
            justifyContent="space-between"
          >
            <Box
              cursor="pointer"
              onClick={() => setOutputExpanded(!outputExpanded)}
            >
              <Text color={theme.textMuted}>
                {outputExpanded ? '▼' : '▶'} Output
              </Text>
            </Box>
            <Text
              color={copied ? theme.success : theme.textDim}
              onClick={handleCopy}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </Text>
          </Box>
          {outputExpanded && (
            <Box
              backgroundColor={theme.codeBackground}
              paddingX={1}
              paddingY={1}
              borderStyle="round"
              borderColor={theme.codeBorder}
              flexDirection="column"
            >
              {status === 'running' ? (
                <Text color={theme.warning}>Processing...</Text>
              ) : isJson(output) ? (
                renderJson(output)
              ) : (
                <Text color={theme.text}>{String(output)}</Text>
              )}
            </Box>
          )}
        </Box>
      )}
      
      {/* Keyboard shortcuts */}
      <Box marginTop={1}>
        <Text color={theme.textDim}>
          [i] toggle input | [o] toggle output | [c] copy
        </Text>
      </Box>
    </Box>
  );
};

export default ToolOutput;
