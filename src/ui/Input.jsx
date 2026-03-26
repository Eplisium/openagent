/**
 * ✏️ OpenAgent Input Component (Polished)
 * Multi-line input with autocomplete, command history, keyboard shortcuts,
 * slash command hints, and visual feedback.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

const Input = ({
  theme,
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
  history = [],
}) => {
  const { exit } = useApp();
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  // Reset history index when value changes
  useEffect(() => {
    if (value === '') setHistoryIndex(-1);
  }, [value]);

  // Update suggestions based on input
  useEffect(() => {
    if (value.trim() === '') {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const inputWords = value.split(' ');
    const lastWord = inputWords[inputWords.length - 1];
    if (lastWord.length > 0) {
      const filtered = history
        .filter(item => item.toLowerCase().startsWith(lastWord.toLowerCase()))
        .slice(0, 5);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedSuggestion(0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [value, history]);

  // Submission flash feedback
  const triggerSubmitFeedback = useCallback(() => {
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 200);
  }, []);

  // Handle keyboard input
  useInput((input, key) => {
    if (disabled) return;

    // Ctrl+C to exit
    if (key.ctrl && input === 'c') {
      exit();
    }

    // Tab for autocomplete
    if (key.tab && showSuggestions && suggestions.length > 0) {
      const inputWords = value.split(' ');
      inputWords[inputWords.length - 1] = suggestions[selectedSuggestion];
      setValue(inputWords.join(' '));
      setShowSuggestions(false);
      return;
    }

    // Enter to submit (without shift)
    if (key.return && !key.shift) {
      if (showSuggestions && suggestions.length > 0) {
        const inputWords = value.split(' ');
        inputWords[inputWords.length - 1] = suggestions[selectedSuggestion];
        setValue(inputWords.join(' '));
        setShowSuggestions(false);
      } else if (value.trim()) {
        onSubmit(value);
        triggerSubmitFeedback();
        setValue('');
        setCursor(0);
      }
      return;
    }

    // Up arrow for history navigation
    if (key.upArrow && history.length > 0) {
      if (historyIndex === -1) {
        setTempInput(value);
        setHistoryIndex(history.length - 1);
        setValue(history[history.length - 1]);
      } else if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        setValue(history[historyIndex - 1]);
      }
      return;
    }

    // Down arrow for history navigation
    if (key.downArrow && history.length > 0) {
      if (historyIndex < history.length - 1) {
        setHistoryIndex(historyIndex + 1);
        setValue(history[historyIndex + 1]);
      } else if (historyIndex === history.length - 1) {
        setHistoryIndex(-1);
        setValue(tempInput);
      }
      return;
    }

    // Left/Right arrows for cursor movement
    if (key.leftArrow && cursor > 0) {
      setCursor(cursor - 1);
    }
    if (key.rightArrow && cursor < value.length) {
      setCursor(cursor + 1);
    }

    // Backspace
    if (key.backspace && cursor > 0) {
      const newValue = value.slice(0, cursor - 1) + value.slice(cursor);
      setValue(newValue);
      setCursor(cursor - 1);
    }

    // Delete
    if (key.delete && cursor < value.length) {
      const newValue = value.slice(0, cursor) + value.slice(cursor + 1);
      setValue(newValue);
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && !key.alt) {
      const newValue = value.slice(0, cursor) + input + value.slice(cursor);
      setValue(newValue);
      setCursor(cursor + input.length);
    }
  });

  // ─── Render cursor with blinking block ─────────────────────────
  const renderCursor = () => {
    const before = value.slice(0, cursor);
    const atCursor = value[cursor] || ' ';
    const after = value.slice(cursor + 1);
    return (
      <>
        <Text color={theme?.text}>{before}</Text>
        <Text backgroundColor={submitted ? theme?.success : theme?.primary} color={theme?.background}>
          {atCursor}
        </Text>
        <Text color={theme?.text}>{after}</Text>
      </>
    );
  };

  // ─── Slash command hints ───────────────────────────────────────
  const isSlash = value.startsWith('/');
  const borderColor = submitted
    ? theme?.success
    : disabled
      ? theme?.border
      : isSlash
        ? theme?.accent
        : theme?.primary;

  return (
    <Box flexDirection="column" width="100%">
      {/* Autocomplete suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <Box
          borderStyle="round"
          borderColor={theme?.border}
          backgroundColor={theme?.backgroundSecondary}
          flexDirection="column"
          paddingX={1}
          marginBottom={1}
        >
          {suggestions.map((suggestion, index) => (
            <Text
              key={suggestion}
              color={index === selectedSuggestion ? theme?.background : theme?.text}
              backgroundColor={index === selectedSuggestion ? theme?.primary : undefined}
            >
              {index === selectedSuggestion ? '▸ ' : '  '}{suggestion}
            </Text>
          ))}
        </Box>
      )}

      {/* Input box */}
      <Box
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        paddingY={0}
        width="100%"
      >
        <Box flexDirection="column" width="100%">
          {/* Prompt + input */}
          <Box>
            <Text color={isSlash ? theme?.accent : theme?.textDim} bold>
              {isSlash ? '/ ' : '> '}
            </Text>
            {value === '' ? (
              <Text color={theme?.textDim}>{placeholder}</Text>
            ) : (
              renderCursor()
            )}
          </Box>

          {/* Character count + hints */}
          <Box justifyContent="space-between">
            <Text color={theme?.textDim}>
              {value.length > 0 ? `${value.length} chars` : ''}
            </Text>
            <Text color={theme?.textDim}>
              ↵ send  ⇧↵ newline  ↕ history
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Input;
