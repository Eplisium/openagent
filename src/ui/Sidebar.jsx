/**
 * 🎨 OpenAgent Ink UI - Sidebar Component
 * Navigation with skills, memory, models, settings
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

/**
 * Sidebar navigation component
 * @param {Object} props - Component props
 * @param {Object} props.theme - Theme color object
 * @param {string} props.currentView - Current active view
 * @param {Function} props.setCurrentView - Function to set current view
 * @param {boolean} props.collapsed - Whether sidebar is collapsed
 * @param {Function} props.onToggle - Function to toggle sidebar
 * @param {number} props.messageCount - Number of messages in chat
 * @param {string} props.model - Current model name
 */
export default function Sidebar({
  theme,
  currentView,
  setCurrentView,
  collapsed = false,
  onToggle,
  messageCount = 0,
  model = 'gpt-4'
}) {
  // Mock data for stats - in real app would come from props or context
  const [stats, setStats] = useState({
    skills: 12,
    memoryEntries: 42,
    models: 8
  });

  // Navigation items configuration
  const navItems = useMemo(() => [
    {
      id: 'chat',
      label: '💬 Chat',
      description: 'Main conversation',
      icon: '💬',
      shortcut: 'Ctrl+1'
    },
    {
      id: 'skills',
      label: '📦 Skills',
      description: `${stats.skills} installed`,
      icon: '📦',
      shortcut: 'Ctrl+2'
    },
    {
      id: 'memory',
      label: '🧠 Memory',
      description: `${stats.memoryEntries} entries`,
      icon: '🧠',
      shortcut: 'Ctrl+3'
    },
    {
      id: 'models',
      label: '🤖 Models',
      description: model,
      icon: '🤖',
      shortcut: 'Ctrl+4'
    },
    {
      id: 'settings',
      label: '⚙️ Settings',
      description: 'Preferences',
      icon: '⚙️',
      shortcut: 'Ctrl+5'
    }
  ], [stats, model]);

  // Handle keyboard shortcuts for navigation
  useInput((input, key) => {
    if (key.ctrl) {
      switch (input) {
        case '1':
          setCurrentView('chat');
          break;
        case '2':
          setCurrentView('skills');
          break;
        case '3':
          setCurrentView('memory');
          break;
        case '4':
          setCurrentView('models');
          break;
        case '5':
          setCurrentView('settings');
          break;
      }
    }
  });

  // Handle navigation item selection
  const handleSelect = (item) => {
    if (item && item.value) {
      setCurrentView(item.value);
    }
  };

  // Render collapsed sidebar (icon only)
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
        {navItems.map((item) => (
          <Box
            key={item.id}
            paddingX={1}
            paddingY={1}
            backgroundColor={currentView === item.id ? theme.hover : 'transparent'}
            justifyContent="center"
          >
            <Text color={currentView === item.id ? theme.primary : theme.textMuted}>
              {item.icon}
            </Text>
          </Box>
        ))}
        
        {/* Toggle button at bottom */}
        <Box
          marginTop="auto"
          paddingX={1}
          paddingY={1}
          justifyContent="center"
          onClick={onToggle}
        >
          <Text color={theme.textMuted}>◀</Text>
        </Box>
      </Box>
    );
  }

  // Render expanded sidebar
  return (
    <Box
      width={30}
      flexDirection="column"
      backgroundColor={theme.sidebar}
      borderStyle="single"
      borderColor={theme.border}
      borderRight={true}
    >
      {/* Header */}
      <Box
        paddingX={2}
        paddingY={1}
        borderBottomStyle="single"
        borderBottomColor={theme.border}
      >
        <Text color={theme.primary} bold>OpenAgent</Text>
      </Box>

      {/* Navigation items */}
      <Box flexDirection="column" flex={1}>
        <SelectInput
          items={navItems.map(item => ({
            label: `${item.icon} ${item.id.charAt(0).toUpperCase() + item.id.slice(1)}`,
            value: item.id,
            description: item.description
          }))}
          onSelect={handleSelect}
          initialIndex={navItems.findIndex(item => item.id === currentView)}
          indicatorComponent={({ isSelected }) => (
            <Text color={isSelected ? theme.primary : 'transparent'}>
              {isSelected ? '▸' : ' '}
            </Text>
          )}
          itemComponent={({ isSelected, label }) => (
            <Box>
              <Text color={isSelected ? theme.primary : theme.text}>
                {label}
              </Text>
            </Box>
          )}
        />
      </Box>

      {/* Stats section */}
      <Box
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        borderTopStyle="single"
        borderTopColor={theme.border}
      >
        <Text color={theme.textMuted} fontSize={1}>
          📊 Stats
        </Text>
        <Text color={theme.textDim} fontSize={1}>
          • Messages: {messageCount}
        </Text>
        <Text color={theme.textDim} fontSize={1}>
          • Skills: {stats.skills}
        </Text>
        <Text color={theme.textDim} fontSize={1}>
          • Memory: {stats.memoryEntries}
        </Text>
      </Box>

      {/* Collapse button */}
      <Box
        paddingX={2}
        paddingY={1}
        justifyContent="center"
        borderTopStyle="single"
        borderTopColor={theme.border}
        onClick={onToggle}
      >
        <Text color={theme.textMuted}>◀ Collapse</Text>
      </Box>
    </Box>
  );
}
