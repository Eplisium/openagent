#!/usr/bin/env node
/**
 * 🎨 OpenAgent Ink CLI Entry Point
 * Renders the Ink-based React UI for interactive terminal interface
 */

import React from 'react';
import { render } from 'ink';
import App from './ui/App.jsx';
import { CONFIG } from './config.js';
import { loadState, saveState } from './cli/state.js';
import { getTheme } from './cli/themes.js';

// Error boundary for graceful error handling
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('OpenAgent UI Error:', error);
    console.error('Error Info:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return React.createElement('div', { 
        style: { 
          color: 'red', 
          padding: '10px',
          fontFamily: 'monospace'
        } 
      }, 
        '⚠️  OpenAgent UI encountered an error.\n',
        'Error: ', this.state.error?.message || 'Unknown error',
        '\n\nFalling back to traditional CLI...'
      );
    }
    return this.props.children;
  }
}

// Main function to start the Ink UI
export async function startInkUI(options = {}) {
  try {
    // Load configuration and state
    const state = await loadState();
    const theme = await getTheme();
    
    const config = {
      ...CONFIG,
      ...state,
      theme: theme || 'dark',
      defaultModel: options.model || state.defaultModel || 'gpt-4',
      ...options
    };
    
    // Create root element
    const root = React.createElement(ErrorBoundary, {},
      React.createElement(App, { config })
    );
    
    // Render the application
    const { unmount } = render(root, { 
      exitOnCtrlC: false, // We handle Ctrl+C ourselves
      patchConsole: false // Don't patch console
    });
    
    // Handle graceful shutdown
    const cleanup = async () => {
      try {
        // Save any state changes
        await saveState({
          lastTheme: config.theme,
          lastModel: config.defaultModel
        });
        unmount();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    };
    
    // Handle process signals
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
    return { unmount, cleanup };
    
  } catch (error) {
    console.error('Failed to start Ink UI:', error);
    throw error;
  }
}

// CLI runner when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  // Parse simple command line arguments
  const options = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--model':
      case '-m':
        options.model = args[++i];
        break;
      case '--theme':
      case '-t':
        options.theme = args[++i];
        break;
      case '--no-splash':
        options.showSplash = false;
        break;
      case '--help':
      case '-h':
        console.log(`
OpenAgent Ink UI

Usage: openagent [options]

Options:
  --model, -m <model>    Set default model (e.g., gpt-4, claude-3-opus)
  --theme, -t <theme>    Set theme (dark, light, high-contrast)
  --no-splash            Disable splash screen
  --help, -h             Show this help message

Keyboard Shortcuts:
  Ctrl+Q                Quit
  Ctrl+P                Command palette
  Ctrl+N                New chat
  Ctrl+S                Save session
  Ctrl+K                Clear chat
  Ctrl+B                Toggle sidebar
  Ctrl+T                Cycle themes
  Ctrl+/                Show help
  Esc                   Close modals
`);
        process.exit(0);
        break;
    }
  }
  
  startInkUI(options).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default startInkUI;
