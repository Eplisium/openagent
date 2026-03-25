/**
 * 🎨 OpenAgent Ink UI - Layout Component
 * Main layout with sidebar and content area
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Sidebar from './Sidebar.jsx';
import ChatArea from './ChatArea.jsx';

/**
 * Layout component - Main application layout with sidebar and content area
 * @param {Object} props - Component props
 * @param {Object} props.theme - Theme color object
 * @param {string} props.currentView - Current active view
 * @param {Function} props.setCurrentView - Function to set current view
 * @param {boolean} props.sidebarCollapsed - Whether sidebar is collapsed
 * @param {Function} props.setSidebarCollapsed - Function to toggle sidebar
 * @param {Array} props.messages - Chat messages array
 * @param {Function} props.setMessages - Function to set messages
 * @param {boolean} props.isProcessing - Whether processing is active
 * @param {Function} props.processMessage - Function to process a message
 * @param {string} props.model - Current model name
 * @param {Function} props.setModel - Function to set model
 * @param {Array} props.notifications - Active notifications
 * @param {Function} props.addNotification - Function to add notification
 */
export default function Layout({
  theme,
  currentView,
  setCurrentView,
  sidebarCollapsed,
  setSidebarCollapsed,
  messages,
  setMessages,
  isProcessing,
  processMessage,
  model,
  setModel,
  notifications = [],
  addNotification
}) {
  const { exit } = useApp();
  const [inputValue, setInputValue] = useState('');
  const [notification, setNotification] = useState(null);

  // Handle notification display
  useEffect(() => {
    if (notifications && notifications.length > 0) {
      const latest = notifications[notifications.length - 1];
      setNotification(latest);
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notifications]);

  // Keyboard shortcut for sidebar toggle
  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === 'b') {
      setSidebarCollapsed(prev => !prev);
    }
  });

  // Handle view change with validation
  const handleViewChange = useCallback((view) => {
    const validViews = ['chat', 'skills', 'memory', 'models', 'settings'];
    if (validViews.includes(view)) {
      setCurrentView(view);
      if (addNotification) {
        addNotification(`Switched to ${view} view`, 'info');
      }
    } else {
      console.error(`Invalid view: ${view}`);
      if (addNotification) {
        addNotification(`Invalid view: ${view}`, 'error');
      }
    }
  }, [setCurrentView, addNotification]);

  // Handle sidebar toggle
  const handleSidebarToggle = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, [setSidebarCollapsed]);

  // Render main content based on current view
  const renderContent = () => {
    try {
      switch (currentView) {
        case 'chat':
          return (
            <ChatArea
              theme={theme}
              messages={messages}
              setMessages={setMessages}
              isProcessing={isProcessing}
              processMessage={processMessage}
              model={model}
            />
          );
        case 'skills':
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.primary} bold>📦 Skills Management</Text>
              <Text color={theme.textMuted}>Browse and manage installed skills</Text>
            </Box>
          );
        case 'memory':
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.primary} bold>🧠 Memory Browser</Text>
              <Text color={theme.textMuted}>View and search memory entries</Text>
            </Box>
          );
        case 'models':
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.primary} bold>🤖 Model Selector</Text>
              <Text color={theme.textMuted}>Current: {model}</Text>
            </Box>
          );
        case 'settings':
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.primary} bold>⚙️ Settings</Text>
              <Text color={theme.textMuted}>Configure OpenAgent preferences</Text>
            </Box>
          );
        default:
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.warning}>⚠️ Unknown view: {currentView}</Text>
            </Box>
          );
      }
    } catch (error) {
      console.error('Error rendering content:', error);
      return (
        <Box flexDirection="column" padding={2}>
          <Text color={theme.error}>❌ Error rendering view</Text>
          <Text color={theme.textMuted}>{error.message}</Text>
        </Box>
      );
    }
  };

  // Render notification toast
  const renderNotification = () => {
    if (!notification) return null;
    
    const colors = {
      info: theme.info,
      success: theme.success,
      warning: theme.warning,
      error: theme.error
    };
    
    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };
    
    return (
      <Box
        position="absolute"
        bottom={2}
        right={2}
        backgroundColor={theme.backgroundSecondary}
        borderStyle="round"
        borderColor={colors[notification.type] || theme.border}
        paddingX={2}
        paddingY={1}
      >
        <Text color={colors[notification.type] || theme.text}>
          {icons[notification.type] || '•'} {notification.message}
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%" backgroundColor={theme.background}>
      {/* Main content area with sidebar */}
      <Box flex={1} flexDirection="row">
        {/* Sidebar */}
        <Sidebar
          theme={theme}
          currentView={currentView}
          setCurrentView={handleViewChange}
          collapsed={sidebarCollapsed}
          onToggle={handleSidebarToggle}
          messageCount={messages?.length || 0}
          model={model}
        />
        
        {/* Main content */}
        <Box
          flexDirection="column"
          flex={1}
          borderStyle="single"
          borderColor={theme.border}
          borderLeft={true}
          marginLeft={0}
        >
          {renderContent()}
        </Box>
      </Box>
      
      {/* Notification overlay */}
      {renderNotification()}
    </Box>
  );
}
