/**
 * 🎨 OpenAgent Ink UI - Sidebar Component (Polished)
 * Navigation with visual hierarchy, active states, real stats, and smooth layout.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

export default function Sidebar({
  theme,
  currentView,
  setCurrentView,
  collapsed = false,
  onToggle,
  messageCount = 0,
  model = 'gpt-4',
  modelCount = 0,
  modelsLoaded = false,
}) {
  const [hoveredItem, setHoveredItem] = useState(null);

  const navItems = useMemo(() => [
    { id: 'chat',    icon: '💬', label: 'Chat',    shortcut: '1' },
    { id: 'skills',  icon: '📦', label: 'Skills',  shortcut: '2' },
    { id: 'memory',  icon: '🧠', label: 'Memory',  shortcut: '3' },
    { id: 'models',  icon: '🤖', label: 'Models',  shortcut: '4' },
    { id: 'settings',icon: '⚙️', label: 'Settings', shortcut: '5' },
  ], []);

  // Keyboard shortcuts for nav
  useInput((input, key) => {
    if (key.ctrl) {
      const item = navItems.find(n => n.shortcut === input);
      if (item) setCurrentView(item.id);
    }
  });

  // ─── Collapsed view ─────────────────────────────────────────────
  if (collapsed) {
    return (
      <Box
        width={4}
        flexDirection="column"
        backgroundColor={theme.sidebar}
        borderStyle="single"
        borderColor={theme.border}
        borderRight={true}
      >
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <Box
              key={item.id}
              paddingX={0}
              paddingY={1}
              justifyContent="center"
              backgroundColor={isActive ? theme.active : 'transparent'}
              borderLeftStyle={isActive ? 'thick' : undefined}
              borderLeftColor={isActive ? theme.primary : undefined}
            >
              <Text color={isActive ? theme.primary : theme.textMuted} bold={isActive}>
                {item.icon}
              </Text>
            </Box>
          );
        })}

        {/* Spacer */}
        <Box flex={1} />

        {/* Collapse toggle */}
        <Box paddingY={1} justifyContent="center" onClick={onToggle}>
          <Text color={theme.textMuted}>▶</Text>
        </Box>
      </Box>
    );
  }

  // ─── Expanded view ──────────────────────────────────────────────
  const modelDisplay = model && model.length > 22
    ? model.slice(0, 20) + '...'
    : (model || 'No model');
  const modelProvider = model ? model.split('/')[0] : '';

  return (
    <Box
      width={28}
      flexDirection="column"
      backgroundColor={theme.sidebar}
      borderStyle="single"
      borderColor={theme.border}
      borderRight={true}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <Box
        paddingX={2}
        paddingY={1}
        borderBottomStyle="single"
        borderBottomColor={theme.border}
      >
        <Text color={theme.primary} bold>⬡ OpenAgent</Text>
      </Box>

      {/* ── Navigation ──────────────────────────────────────────── */}
      <Box flexDirection="column" paddingY={1}>
        <Box paddingX={2} marginBottom={0}>
          <Text color={theme.textDim} bold>NAVIGATION</Text>
        </Box>
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <Box
              key={item.id}
              paddingX={2}
              paddingY={0}
              backgroundColor={isActive ? theme.active : 'transparent'}
              borderLeftStyle={isActive ? 'thick' : undefined}
              borderLeftColor={isActive ? theme.primary : undefined}
              onClick={() => setCurrentView(item.id)}
            >
              <Text color={isActive ? theme.primary : theme.textMuted} bold={isActive}>
                {isActive ? '▸ ' : '  '}
              </Text>
              <Text color={isActive ? theme.primary : theme.text} bold={isActive}>
                {item.icon} {item.label}
              </Text>
              <Box flexGrow={1} />
              <Text color={theme.textDim}>^ {item.shortcut}</Text>
            </Box>
          );
        })}
      </Box>

      {/* ── Spacer ──────────────────────────────────────────────── */}
      <Box flex={1} />

      {/* ── Current Model ───────────────────────────────────────── */}
      <Box
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        borderTopStyle="single"
        borderTopColor={theme.border}
      >
        <Text color={theme.textDim} bold>MODEL</Text>
        <Box marginTop={0}>
          <Text color={theme.accent} wrap="truncate">
            {modelDisplay}
          </Text>
        </Box>
        {modelProvider && (
          <Text color={theme.textDim}>
            Provider: {modelProvider}
          </Text>
        )}
      </Box>

      {/* ── Stats ────────────────────────────────────────────────── */}
      <Box
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        borderTopStyle="single"
        borderTopColor={theme.border}
      >
        <Text color={theme.textDim} bold>SESSION</Text>
        <Box justifyContent="space-between">
          <Text color={theme.textMuted}>Messages</Text>
          <Text color={theme.text}>{messageCount}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={theme.textMuted}>Models</Text>
          <Text color={theme.text}>
            {modelsLoaded ? modelCount : '...'}
          </Text>
        </Box>
      </Box>

      {/* ── Collapse toggle ──────────────────────────────────────── */}
      <Box
        paddingX={2}
        paddingY={1}
        justifyContent="center"
        borderTopStyle="single"
        borderTopColor={theme.border}
        onClick={onToggle}
      >
        <Text color={theme.textDim}>◀ Collapse (Ctrl+B)</Text>
      </Box>
    </Box>
  );
}
