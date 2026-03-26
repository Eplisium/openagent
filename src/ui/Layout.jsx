/**
 * 🎨 OpenAgent Ink UI - Layout Component
 * Main layout with sidebar and content area — wired to real backend
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Sidebar from './Sidebar.jsx';
import ChatArea from './ChatArea.jsx';
import ModelSelector from './ModelSelector.jsx';

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
  addNotification,
  // Real backend data
  activeToolCalls = [],
  currentIteration = 0,
  modelsLoaded = false,
  availableModels = [],
  modelBrowser = null,
  inputHistory = [],
}) {
  const { exit } = useApp();
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
    }
  }, [setCurrentView]);

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
              activeToolCalls={activeToolCalls}
              currentIteration={currentIteration}
              inputHistory={inputHistory}
            />
          );
        case 'models':
          return (
            <ModelSelector
              theme={theme}
              model={model}
              setModel={setModel}
              modelsLoaded={modelsLoaded}
              availableModels={availableModels}
              modelBrowser={modelBrowser}
              addNotification={addNotification}
            />
          );
        case 'skills':
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.primary} bold>📦 Skills Management</Text>
              <Text color={theme.textMuted}>Browse and manage installed skills</Text>
              <Box marginTop={1}>
                <Text color={theme.textDim}>Skills panel coming soon. Use /tools to see available tools.</Text>
              </Box>
            </Box>
          );
        case 'memory':
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.primary} bold>🧠 Memory Browser</Text>
              <Text color={theme.textMuted}>View and search memory entries</Text>
              <Box marginTop={1}>
                <Text color={theme.textDim}>Memory panel coming soon.</Text>
              </Box>
            </Box>
          );
        case 'settings':
          return (
            <Box flexDirection="column" padding={2}>
              <Text color={theme.primary} bold>⚙️ Settings</Text>
              <Text color={theme.textMuted}>Configure OpenAgent preferences</Text>
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.textDim}>• Theme: Ctrl+T to cycle</Text>
                <Text color={theme.textDim}>• Streaming: /stream to toggle</Text>
                <Text color={theme.textDim}>• Verbose: /verbose to toggle</Text>
              </Box>
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
      error: theme.error,
    };

    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌',
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
          onToggle={() => setSidebarCollapsed(prev => !prev)}
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
