/**
 * 🎯 OpenAgent Ink UI - Main Application Component
 * Real backend integration with AgentSession, ModelBrowser, streaming, and tool calling
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [currentView, setCurrentView] = useState('chat');
  const [showHelp, setShowHelp] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputHistory, setInputHistory] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [model, setModel] = useState(config.model || config.defaultModel || '');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifications, setNotifications] = useState([]);

  // Backend state
  const [session, setSession] = useState(null);
  const [modelBrowser, setModelBrowser] = useState(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsCount, setModelsCount] = useState(0);
  const [availableModels, setAvailableModels] = useState([]);
  const [initError, setInitError] = useState(null);
  const [initStatus, setInitStatus] = useState('Initializing...');

  // Live stats
  const [totalCost, setTotalCost] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [toolCount, setToolCount] = useState(0);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [activeToolCalls, setActiveToolCalls] = useState([]);

  // Session info
  const [sessionId, setSessionId] = useState(null);
  const [workingDir, setWorkingDir] = useState(config.workingDir || process.cwd());

  // Refs for async callbacks
  const messagesRef = useRef([]);
  const processingRef = useRef(false);

  // Keep ref in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { processingRef.current = isProcessing; }, [isProcessing]);

  // Update theme colors when theme changes
  useEffect(() => {
    setThemeColors(THEMES[theme] || THEMES.dark);
  }, [theme]);

  // ─── Initialize Backend ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        // Dynamic imports for backend modules
        const { AgentSession } = await import('../agent/AgentSession.js');
        const { ModelBrowser } = await import('../ModelBrowser.js');
        const { CONFIG } = await import('../config.js');

        if (cancelled) return;

        // Check API key
        if (!CONFIG.API_KEY) {
          setInitError('No API Key found. Set OPENROUTER_API_KEY in your .env file.');
          return;
        }

        setInitStatus('Loading models from OpenRouter...');

        // Initialize model browser
        const browser = new ModelBrowser();
        await browser.init();

        if (cancelled) return;

        setModelBrowser(browser);
        setModelsCount(browser.models.length);
        setAvailableModels(browser.models.slice(0, 100).map(m => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          contextLength: m.contextLength,
          supportsTools: m.supportsTools,
          inputPrice: m.inputPrice,
        })));
        setModelsLoaded(true);

        // Determine model to use
        let selectedModel = config.model;
        if (!selectedModel && browser.recents.length > 0) {
          const recentModel = browser.recents[0];
          if (browser.getModel(recentModel)) {
            selectedModel = recentModel;
          }
        }
        if (!selectedModel && browser.models.length > 0) {
          // Pick a good default — prefer a capable model
          const preferred = browser.models.find(m =>
            m.id.includes('claude-sonnet') || m.id.includes('gpt-4') || m.id.includes('gemini')
          );
          selectedModel = preferred?.id || browser.models[0].id;
        }

        if (!selectedModel) {
          setInitError('No models available. Check your API key and internet connection.');
          return;
        }

        setInitStatus(`Creating session with ${selectedModel}...`);

        // Create agent session
        const allowFullAccess = config.allowFullAccess === true || config.permissions?.allowFullAccess === true;
        const permissions = {
          allowFileDelete: true,
          ...config.permissions,
          allowFullAccess,
        };
        const newSession = new AgentSession({
          workingDir: workingDir,
          model: selectedModel,
          verbose: true,
          streaming: true,
          permissions,
          allowFullAccess,
        });

        if (cancelled) return;

        setSession(newSession);
        setModel(selectedModel);
        setSessionId(newSession.sessionId);
        setToolCount(newSession.toolRegistry?.list()?.length || 0);
        setInitStatus('');

        addNotification(`Ready — ${browser.models.length} models loaded`, 'success');

      } catch (error) {
        if (!cancelled) {
          setInitError(`Initialization failed: ${error.message}`);
        }
      }
    }

    initialize();
    return () => { cancelled = true; };
  }, []);

  // ─── Notification System ────────────────────────────────────────
  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  }, []);

  // ─── Process Message (Real Backend) ─────────────────────────────
  const processMessage = useCallback(async (content) => {
    if (!session || isProcessing || !content.trim()) return;

    const userMessage = content.trim();

    // Add user message to display
    const userMsg = { role: 'user', content: userMessage, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInputHistory(prev => [userMessage, ...prev.slice(0, 99)]);

    // Check for slash commands
    if (userMessage.startsWith('/')) {
      await handleSlashCommand(userMessage);
      return;
    }

    setIsProcessing(true);
    setCurrentIteration(0);
    setActiveToolCalls([]);

    const startTime = Date.now();
    let responsePrinted = false;

    // Save original callbacks
    const agent = session.agent;
    const prev = {
      onToolStart: agent.onToolStart,
      onToolEnd: agent.onToolEnd,
      onResponse: agent.onResponse,
      onIterationStart: agent.onIterationStart,
      onStatus: agent.onStatus,
    };

    // Set up live callbacks
    agent.onIterationStart = (iteration) => {
      setCurrentIteration(iteration);
    };

    agent.onToolStart = (toolName, args) => {
      const toolId = `${toolName}_${Date.now()}`;
      setActiveToolCalls(prev => [...prev, {
        id: toolId,
        name: toolName,
        args: args,
        status: 'running',
        startTime: Date.now(),
      }]);
    };

    agent.onToolEnd = (toolName, result) => {
      setActiveToolCalls(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(t => t.name === toolName && t.status === 'running');
        if (idx !== -1) {
          updated[idx] = {
            ...updated[idx],
            status: result?.error ? 'error' : 'success',
            output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            duration: Date.now() - updated[idx].startTime,
          };
        }
        return updated;
      });
    };

    agent.onResponse = (content) => {
      if (!responsePrinted && content) {
        responsePrinted = true;
        const aiMsg = { role: 'assistant', content: content, timestamp: Date.now() };
        setMessages(prev => [...prev, aiMsg]);
      }
    };

    agent.onStatus = ({ type, message }) => {
      // Status updates (compaction, retry, etc.) — show as notification
      if (type === 'compaction') {
        addNotification(message, 'info');
      }
    };

    try {
      const result = await session.run(userMessage);

      // If onResponse didn't fire, add the response now
      if (result.response && !responsePrinted) {
        const aiMsg = { role: 'assistant', content: result.response, timestamp: Date.now() };
        setMessages(prev => [...prev, aiMsg]);
      }

      // Update stats
      const stats = result.stats || {};
      setTotalCost(prev => prev + (stats.totalCost || 0));
      setTotalTokens(prev => prev + (stats.totalTokensUsed || 0));

    } catch (error) {
      const errorMsg = {
        role: 'assistant',
        content: `❌ Error: ${error.message}`,
        timestamp: Date.now(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      // Restore callbacks
      agent.onToolStart = prev.onToolStart;
      agent.onToolEnd = prev.onToolEnd;
      agent.onResponse = prev.onResponse;
      agent.onIterationStart = prev.onIterationStart;
      agent.onStatus = prev.onStatus;

      setIsProcessing(false);
      setActiveToolCalls([]);
      setCurrentIteration(0);
    }
  }, [session, isProcessing, addNotification]);

  // ─── Slash Command Handler ──────────────────────────────────────
  const handleSlashCommand = useCallback(async (input) => {
    const parts = input.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case 'clear':
      case 'cl':
        if (session) session.agent.clear();
        setMessages([]);
        addNotification('Conversation cleared', 'success');
        break;

      case 'new':
      case 'n':
      case 'reset':
        if (session) {
          session.agent.clear();
          setMessages([]);
          setTotalCost(0);
          setTotalTokens(0);
          addNotification('New session started', 'success');
        }
        break;

      case 'model':
      case 'm':
        if (args) {
          // Direct model switch
          const modelInfo = modelBrowser?.getModel(args);
          if (modelInfo) {
            setModel(args);
            if (session) {
              session.model = args;
              session.agent.model = args;
            }
            if (modelBrowser) await modelBrowser.addRecent(args);
            addNotification(`Model: ${args}`, 'success');
          } else {
            addNotification(`Model not found: ${args}`, 'warning');
          }
        } else {
          setCurrentView('models');
          addNotification('Browse models in the Models panel', 'info');
        }
        break;

      case 'save':
        if (session) {
          try {
            await session.save();
            addNotification('Session saved', 'success');
          } catch (err) {
            addNotification(`Save failed: ${err.message}`, 'error');
          }
        }
        break;

      case 'stats':
      case 's':
        setCurrentView('chat');
        const statsMsg = `📊 **Session Stats**\n\n- Messages: ${messages.length}\n- Total Cost: $${totalCost.toFixed(4)}\n- Total Tokens: ${totalTokens.toLocaleString()}\n- Model: ${model}\n- Tools: ${toolCount} available`;
        setMessages(prev => [...prev, { role: 'assistant', content: statsMsg, timestamp: Date.now() }]);
        break;

      case 'cost':
      case 'co':
        const costMsg = `💰 **Cost Summary**\n\n- Session Cost: $${totalCost.toFixed(4)}\n- Total Tokens: ${totalTokens.toLocaleString()}`;
        setMessages(prev => [...prev, { role: 'assistant', content: costMsg, timestamp: Date.now() }]);
        break;

      case 'help':
      case 'h':
        const helpMsg = `🤖 **OpenAgent Commands**

**Chat:** Just type a message to run as an agentic task
**Commands:** Type / before a command

| Command | Description |
|---------|-------------|
| /model [id] | Switch model or browse |
| /clear | Clear conversation |
| /new | New session |
| /save | Save session |
| /stats | Show session stats |
| /cost | Show cost summary |
| /stream | Toggle streaming |
| /help | Show this help |

**Shortcuts:**
- Ctrl+Q: Quit
- Ctrl+N: New chat
- Ctrl+K: Clear chat
- Ctrl+B: Toggle sidebar
- Ctrl+T: Cycle themes
- Ctrl+/: Help`;
        setMessages(prev => [...prev, { role: 'assistant', content: helpMsg, timestamp: Date.now() }]);
        break;

      case 'stream':
      case 'st':
        if (session) {
          session.agent.streaming = !session.agent.streaming;
          addNotification(`Streaming ${session.agent.streaming ? 'enabled' : 'disabled'}`, 'info');
        }
        break;

      case 'verbose':
      case 'v':
        if (session) {
          session.agent.verbose = !session.agent.verbose;
          addNotification(`Verbose ${session.agent.verbose ? 'enabled' : 'disabled'}`, 'info');
        }
        break;

      case 'tools':
      case 't':
        if (session) {
          const tools = session.toolRegistry.list();
          const toolsMsg = `🔧 **Available Tools** (${tools.length})\n\n${tools.map(t => `- \`${t.name}\`: ${t.description || 'No description'}`).join('\n')}`;
          setMessages(prev => [...prev, { role: 'assistant', content: toolsMsg, timestamp: Date.now() }]);
        }
        break;

      case 'exit':
      case 'quit':
      case 'q':
        // Auto-save before exit
        if (session) {
          try { await session.save(); } catch {}
        }
        exit();
        break;

      default:
        // Treat unknown commands as agent tasks
        addNotification(`Unknown command: /${cmd}. Running as task...`, 'warning');
        setIsProcessing(true);
        try {
          const result = await session.run(input);
          if (result.response) {
            setMessages(prev => [...prev, { role: 'assistant', content: result.response, timestamp: Date.now() }]);
          }
        } catch (err) {
          setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, timestamp: Date.now(), isError: true }]);
        } finally {
          setIsProcessing(false);
        }
    }
  }, [session, modelBrowser, model, messages, totalCost, totalTokens, toolCount, addNotification, exit]);

  // ─── Model Switching ────────────────────────────────────────────
  const handleModelSwitch = useCallback(async (newModelId) => {
    if (!newModelId) return;

    const modelInfo = modelBrowser?.getModel(newModelId);
    if (!modelInfo) {
      addNotification(`Model not found: ${newModelId}`, 'error');
      return;
    }

    setModel(newModelId);
    if (session) {
      session.model = newModelId;
      session.agent.model = newModelId;
      const contextLength = modelInfo.contextLength || 128000;
      if (session.agent.setMaxContextTokens) {
        session.agent.setMaxContextTokens(contextLength);
      }
    }
    if (modelBrowser) await modelBrowser.addRecent(newModelId);
    addNotification(`Switched to ${newModelId}`, 'success');
  }, [session, modelBrowser, addNotification]);

  // ─── Keyboard Shortcuts ─────────────────────────────────────────
  useInput((input, key) => {
    if (key.ctrl) {
      switch (input.toLowerCase()) {
        case 'q':
          if (session) { try { session.save(); } catch {} }
          exit();
          break;
        case '/':
          setShowHelp(prev => !prev);
          break;
        case 'n':
          if (session) session.agent.clear();
          setMessages([]);
          addNotification('New chat', 'info');
          break;
        case 'k':
          if (session) session.agent.clear();
          setMessages([]);
          break;
        case 'b':
          setSidebarCollapsed(prev => !prev);
          break;
        case 't': {
          const themeNames = Object.keys(THEMES);
          const currentIndex = themeNames.indexOf(theme);
          const next = themeNames[(currentIndex + 1) % themeNames.length];
          setTheme(next);
          addNotification(`Theme: ${next}`, 'info');
          break;
        }
      }
    }

    if (key.escape) {
      setShowHelp(false);
    }
  });

  // ─── Splash Screen ──────────────────────────────────────────────
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  if (showSplash || initError || initStatus) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
        {showSplash && (
          <>
            <Gradient colors={['#00D9FF', '#7C3AED', '#F59E0B']}>
              <BigText text="OpenAgent" font="block" />
            </Gradient>
            <Box marginTop={1}>
              <Text color={themeColors.textMuted}>v4.2 — AI-Powered Agentic Assistant</Text>
            </Box>
          </>
        )}
        {initStatus && !initError && (
          <Box marginTop={1}>
            <Status theme={themeColors} message={initStatus} isProcessing={true} />
          </Box>
        )}
        {initError && (
          <Box marginTop={1} flexDirection="column" alignItems="center">
            <Text color={themeColors.error}>❌ {initError}</Text>
            <Box marginTop={1}>
              <Text color={themeColors.textDim}>Press Ctrl+Q to exit</Text>
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  // ─── Help Modal ─────────────────────────────────────────────────
  const HelpModal = () => (
    <Box
      position="absolute"
      top={0} left={0} right={0} bottom={0}
      backgroundColor="rgba(0,0,0,0.85)"
      alignItems="center"
      justifyContent="center"
      zIndex={100}
    >
      <Box
        borderStyle="round"
        borderColor={themeColors.primary}
        padding={2}
        backgroundColor={themeColors.backgroundSecondary}
        minWidth={55}
        flexDirection="column"
      >
        <Text color={themeColors.primary} bold>⌨️ Keyboard Shortcuts</Text>
        <Box marginTop={1} flexDirection="column">
          <Text><Text color={themeColors.primary} bold>Ctrl+Q</Text> — Quit</Text>
          <Text><Text color={themeColors.primary} bold>Ctrl+N</Text> — New Chat</Text>
          <Text><Text color={themeColors.primary} bold>Ctrl+K</Text> — Clear Chat</Text>
          <Text><Text color={themeColors.primary} bold>Ctrl+B</Text> — Toggle Sidebar</Text>
          <Text><Text color={themeColors.primary} bold>Ctrl+T</Text> — Cycle Themes</Text>
          <Text><Text color={themeColors.primary} bold>Ctrl+/</Text> — This Help</Text>
          <Text><Text color={themeColors.primary} bold>Esc</Text> — Close Modals</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={themeColors.textMuted}>Type /help for all commands</Text>
        </Box>
        <Box marginTop={1} justifyContent="center">
          <Text color={themeColors.textDim}>Press Esc to close</Text>
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
        setModel={handleModelSwitch}
        notifications={notifications}
        addNotification={addNotification}
        // Real backend data
        activeToolCalls={activeToolCalls}
        currentIteration={currentIteration}
        modelsLoaded={modelsLoaded}
        availableModels={availableModels}
        modelBrowser={modelBrowser}
        inputHistory={inputHistory}
      />

      <Status
        theme={themeColors}
        model={model}
        isProcessing={isProcessing}
        messageCount={messages.length}
        cost={totalCost}
        tokens={totalTokens}
        iteration={currentIteration}
      />
    </Box>
  );
}
