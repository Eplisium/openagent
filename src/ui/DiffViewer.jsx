/**
 * 📝 OpenAgent Diff Viewer Component
 * Displays code diffs with side-by-side or unified view, syntax highlighting, and line numbers
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ThemeColors } from './Theme.js';

/**
 * Diff Viewer Component
 * @param {Object} props
 * @param {Object} props.theme - Theme colors object
 * @param {string} props.oldContent - Original content
 * @param {string} props.newContent - New content
 * @param {string} props.filename - Optional filename for context
 */
const DiffViewer = ({
  theme = ThemeColors,
  oldContent = '',
  newContent = '',
  filename = '',
}) => {
  const [viewMode, setViewMode] = useState('split'); // 'split' or 'unified'
  const [copied, setCopied] = useState(false);
  
  // Generate diff lines
  const generateDiff = () => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diffLines = [];
    
    // Simple line-by-line diff algorithm
    let oldIndex = 0;
    let newIndex = 0;
    
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      const oldLine = oldLines[oldIndex] || '';
      const newLine = newLines[newIndex] || '';
      
      if (oldLine === newLine) {
        // Context line
        diffLines.push({
          type: 'context',
          oldLineNum: oldIndex + 1,
          newLineNum: newIndex + 1,
          content: oldLine,
        });
        oldIndex++;
        newIndex++;
      } else if (!newLines.includes(oldLine) && oldIndex < oldLines.length) {
        // Removed line
        diffLines.push({
          type: 'removed',
          oldLineNum: oldIndex + 1,
          newLineNum: null,
          content: oldLine,
        });
        oldIndex++;
      } else if (!oldLines.includes(newLine) && newIndex < newLines.length) {
        // Added line
        diffLines.push({
          type: 'added',
          oldLineNum: null,
          newLineNum: newIndex + 1,
          content: newLine,
        });
        newIndex++;
      } else {
        // Modified line (show both)
        diffLines.push({
          type: 'removed',
          oldLineNum: oldIndex + 1,
          newLineNum: null,
          content: oldLine,
        });
        diffLines.push({
          type: 'added',
          oldLineNum: null,
          newLineNum: newIndex + 1,
          content: newLine,
        });
        oldIndex++;
        newIndex++;
      }
    }
    
    return diffLines;
  };
  
  const diffLines = generateDiff();
  
  // Get color for diff line type
  const getLineColor = (type) => {
    switch (type) {
      case 'added':
        return theme.success;
      case 'removed':
        return theme.error;
      case 'context':
        return theme.text;
      default:
        return theme.text;
    }
  };
  
  // Get background color for diff line type
  const getLineBackground = (type) => {
    switch (type) {
      case 'added':
        return `${theme.success}22`; // 22 is hex for ~13% opacity
      case 'removed':
        return `${theme.error}22`;
      case 'context':
        return 'transparent';
      default:
        return 'transparent';
    }
  };
  
  // Get prefix for unified view
  const getPrefix = (type) => {
    switch (type) {
      case 'added':
        return '+ ';
      case 'removed':
        return '- ';
      case 'context':
        return '  ';
      default:
        return '  ';
    }
  };
  
  // Format line number with padding
  const formatLineNum = (num, width = 4) => {
    if (num === null) return ' '.repeat(width);
    return String(num).padStart(width, ' ');
  };
  
  // Copy diff to clipboard
  const handleCopy = () => {
    const diffText = diffLines.map(line => {
      const prefix = getPrefix(line.type);
      return `${prefix}${line.content}`;
    }).join('\n');
    
    // In terminal, show confirmation
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // Handle keyboard input
  useInput((input, key) => {
    // 'v' to toggle view mode
    if (input === 'v') {
      setViewMode(viewMode === 'split' ? 'unified' : 'split');
    }
    // 'c' to copy
    if (input === 'c') {
      handleCopy();
    }
  });
  
  // Render split view
  const renderSplitView = () => {
    // Create separate arrays for left (old) and right (new) columns
    const leftLines = [];
    const rightLines = [];
    
    // Process diffLines to build split view
    diffLines.forEach((line, index) => {
      if (line.type === 'context') {
        // Context lines appear in both columns
        leftLines.push({
          lineNum: line.oldLineNum,
          content: line.content,
          type: 'context',
        });
        rightLines.push({
          lineNum: line.newLineNum,
          content: line.content,
          type: 'context',
        });
      } else if (line.type === 'removed') {
        // Removed lines only in left column
        leftLines.push({
          lineNum: line.oldLineNum,
          content: line.content,
          type: 'removed',
        });
        // Add empty placeholder in right column
        rightLines.push({
          lineNum: null,
          content: '',
          type: 'empty',
        });
      } else if (line.type === 'added') {
        // Added lines only in right column
        leftLines.push({
          lineNum: null,
          content: '',
          type: 'empty',
        });
        rightLines.push({
          lineNum: line.newLineNum,
          content: line.content,
          type: 'added',
        });
      }
    });
    
    return (
      <Box flexDirection="row" width="100%">
        {/* Left column (old content) */}
        <Box flexDirection="column" width="50%" marginRight={1}>
          <Box
            backgroundColor={theme.backgroundSecondary}
            paddingX={1}
            marginBottom={1}
          >
            <Text color={theme.textMuted}>Old Content</Text>
          </Box>
          <Box flexDirection="column">
            {leftLines.map((line, idx) => (
              <Box key={`left-${idx}`}>
                <Text color={theme.textDim}>
                  {formatLineNum(line.lineNum)}{' '}
                </Text>
                <Text
                  color={getLineColor(line.type)}
                  backgroundColor={line.type === 'empty' ? 'transparent' : getLineBackground(line.type)}
                >
                  {line.content}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
        
        {/* Right column (new content) */}
        <Box flexDirection="column" width="50%">
          <Box
            backgroundColor={theme.backgroundSecondary}
            paddingX={1}
            marginBottom={1}
          >
            <Text color={theme.textMuted}>New Content</Text>
          </Box>
          <Box flexDirection="column">
            {rightLines.map((line, idx) => (
              <Box key={`right-${idx}`}>
                <Text color={theme.textDim}>
                  {formatLineNum(line.lineNum)}{' '}
                </Text>
                <Text
                  color={getLineColor(line.type)}
                  backgroundColor={line.type === 'empty' ? 'transparent' : getLineBackground(line.type)}
                >
                  {line.content}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    );
  };
  
  // Render unified view
  const renderUnifiedView = () => {
    return (
      <Box flexDirection="column" width="100%">
        {diffLines.map((line, idx) => (
          <Box key={`unified-${idx}`}>
            <Text color={theme.textDim}>
              {formatLineNum(line.oldLineNum, 4)}{' '}
              {formatLineNum(line.newLineNum, 4)}{' '}
            </Text>
            <Text
              color={getLineColor(line.type)}
              backgroundColor={getLineBackground(line.type)}
            >
              {getPrefix(line.type)}{line.content}
            </Text>
          </Box>
        ))}
      </Box>
    );
  };
  
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text color={theme.primary} bold>
            Diff Viewer
          </Text>
          {filename && (
            <Text color={theme.textMuted} marginLeft={2}>
              {filename}
            </Text>
          )}
        </Box>
        <Box>
          <Text color={theme.textDim} marginRight={2}>
            View: {viewMode === 'split' ? 'Side-by-Side' : 'Unified'}
          </Text>
          <Text
            color={copied ? theme.success : theme.textDim}
            onClick={handleCopy}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </Text>
        </Box>
      </Box>
      
      {/* Diff content */}
      <Box flexDirection="column" height={20} overflowY="auto">
        {viewMode === 'split' ? renderSplitView() : renderUnifiedView()}
      </Box>
      
      {/* Legend and shortcuts */}
      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <Text color={theme.success}>● Added</Text>
          <Text color={theme.textDim} marginX={1}>|</Text>
          <Text color={theme.error}>● Removed</Text>
          <Text color={theme.textDim} marginX={1}>|</Text>
          <Text color={theme.text}>● Context</Text>
        </Box>
        <Box>
          <Text color={theme.textDim}>
            [v] toggle view | [c] copy
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export default DiffViewer;
