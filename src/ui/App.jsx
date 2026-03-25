/**
 * 🎯 OpenAgent Ink UI - Main Application Component
 * Handles global state, keyboard shortcuts, and theme
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { ThemeProvider, THEMES } from './Theme.js';
import Layout from './Layout.jsx';
import Status from './Status.jsx';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';

export default function App({ config = {} }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  
  // Theme state
  const [theme, setTheme] = useState(config.theme || 'dark');
  const [themeColors, setThemeColors] = useState(THEMES[theme] || THEMES.dark);
  
  // Application state
  const [currentView, setCurrentView] = useState('chat'); // chat, skills, models, memory, settings
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputHistory, setInputHistory] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [model, setModel] = useState(config.defaultModel || 'gpt-4');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifications, setNotifications] = useState([]);
  
  // Update theme colors when theme changes
  useEffect(() => {
    setThemeColors(THEMES[theme] || THEMES.dark);
  }, [theme]);
  
  // Keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl) {
      switch (input.toLowerCase()) {
        case 'q':
          exit();
          break;
        case 'p':
          setShowCommandPalette(prev => !prev);
          break;
        case '/':
          setShowHelp(prev => !prev);
          break;
        case 'n':
          // New chat
          setMessages([]);
          break;
        case 's':
          // Save session
          addNotification('Session saved (simulated)', 'success');
          break;
        case 'k':
          // Clear chat
          setMessages([]);
          break;
        case 'b':
          // Toggle sidebar
          setSidebarCollapsed(prev => !prev);
          break;
        case 't':
          // Cycle themes
          const themeNames = Object.keys(THEMES);
          const currentIndex = themeNames.indexOf(theme);
          const nextTheme = themeNames[(currentIndex + 1) % themeNames.length];
          setTheme(nextTheme);
          addNotification(`Theme changed to ${nextTheme}`, 'info');
          break;
      }
    }
    
    // Escape to close modals
    if (key.escape) {
      setShowCommandPalette(false);
      setShowHelp(false);
    }
  });
  
  // Add notification
  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  }, []);
  
  // Simulated processing
  const processMessage = useCallback((content) => {
    setIsProcessing(true);
    // Simulate streaming response
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        { role: 'user', content },
        { role: 'assistant', content: `Processing: ${content}` }
      ]);
      setIsProcessing(false);
    }, 1000);
  }, []);
  
  // Show splash screen on first load
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, []);
  
  if (showSplash) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
        <Gradient colors={['#00D9FF', '#7C3AED', '#F59E0B']}>
          <BigText text="OpenAgent" font="block" />
        </Gradient>
        <Box marginTop={1}>
          <Status theme={themeColors} message="Loading..." />
        </Box>
      </Box>
    );
  }
  
  // Help modal content
  const HelpModal = () => (
    <Box 
      position="absolute" 
      top={0} 
      left={0} 
      right={0} 
      bottom={0} 
      backgroundColor="rgba(0,0,0,0.8)"
      alignItems="center"
      justifyContent="center"
      zIndex={100}
    >
      <Box 
        borderStyle="round" 
        borderColor={themeColors.primary}
        padding={2}
        backgroundColor={themeColors.backgroundSecondary}
        minWidth={60}
        flexDirection="column"
      >
        <BigText text="Keyboard Shortcuts" font="chrome" />
        <Box marginTop={1} flexDirection="column">
          <Text color={themeColors.primary}>Ctrl+Q</Text><Text>: Quit</Text>
          <Text color={themeColors.primary}>Ctrl+P</Text><Text>: Command Palette</Text>
          <Text color={themeColors.primary}>Ctrl+N</Text><Text>: New Chat</Text>
          <Text color={themeColors.primary}>Ctrl+S</Text><Text>: Save Session</Text>
          <Text color={themeColors.primary}>Ctrl+K</Text><Text>: Clear Chat</Text>
          <Text color={themeColors.primary}>Ctrl+B</Text><Text>: Toggle Sidebar</Text>
          <Text color={themeColors.primary}>Ctrl+T</Text><Text>: Cycle Themes</Text>
          <Text color={themeColors.primary}>Ctrl+/</Text><Text>: Help</Text>
          <Text color={themeColors.primary}>Esc</Text><Text>: Close Modals</Text>
        </Box>
        <Box marginTop={1} justifyContent="center">
          <Text color={themeColors.textMuted}>Press any key to close</Text>
        </Box>
      </Box>
    </Box>
  );
  
  return (
    <Box flexDirection="column" height="100%" backgroundColor={themeColors.background}>
      {showHelp && <HelpModal />}
      
      <Layout
        theme={themeColors}
        currentView={currentView}
        setCurrentView={setCurrentView}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        messages={messages}
        setMessages={setMessages}
        isProcessing={isProcessing}
        processMessage={processMessage}
        model={model}
        setModel={setModel}
        notifications={notifications}
        addNotification={addNotification}
      />
      
      <Status 
        theme={themeColors}
        model={model}
        isProcessing={isProcessing}
        messageCount={messages.length}
      />
      
      {/* Command palette would be rendered here */}
    </Box>
  );
}
