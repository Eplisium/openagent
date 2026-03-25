/**
 * Settings.jsx - Configuration interface for OpenAgent Ink CLI
 * Props: theme, config, onUpdateConfig
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { ThemeColors, LightThemeColors } from './Theme.js';

// Available themes
const THEMES = [
  { label: 'Dark (Default)', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'High Contrast', value: 'high-contrast' },
  { label: 'Monokai', value: 'monokai' },
  { label: 'Nord', value: 'nord' }
];

// Available models
const AVAILABLE_MODELS = [
  { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
  { label: 'GPT-4', value: 'gpt-4' },
  { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
  { label: 'Claude 3 Opus', value: 'claude-3-opus' },
  { label: 'Claude 3 Sonnet', value: 'claude-3-sonnet' },
  { label: 'Llama 3 70B', value: 'llama-3-70b' },
  { label: 'Gemini Pro', value: 'gemini-pro' }
];

// Display font sizes
const FONT_SIZES = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' }
];

// Settings sections
const SECTIONS = [
  { label: 'General', value: 'general' },
  { label: 'Appearance', value: 'appearance' },
  { label: 'Models', value: 'models' },
  { label: 'API Keys', value: 'apikeys' },
  { label: 'Shortcuts', value: 'shortcuts' }
];

// Default configuration
const DEFAULT_CONFIG = {
  theme: 'dark',
  defaultModel: 'gpt-4-turbo',
  fontSize: 'medium',
  showTimestamps: true,
  showTokenCount: true,
  confirmActions: true,
  autoSave: true,
  compactMode: false,
  apiKeys: {
    openai: '',
    anthropic: '',
    google: ''
  }
};

// Keyboard shortcuts reference
const SHORTCUTS = [
  { key: 'Ctrl+C', action: 'Exit application' },
  { key: 'Ctrl+L', action: 'Clear chat' },
  { key: 'Ctrl+B', action: 'Toggle sidebar' },
  { key: 'Ctrl+1', action: 'Switch to Chat view' },
  { key: 'Ctrl+2', action: 'Switch to Models view' },
  { key: 'Ctrl+3', action: 'Switch to Skills view' },
  { key: 'Ctrl+4', action: 'Switch to Memory view' },
  { key: 'Ctrl+5', action: 'Switch to Settings view' },
  { key: '↑/↓ or j/k', action: 'Navigate lists' },
  { key: 'Enter', action: 'Select/Confirm' },
  { key: 'Escape', action: 'Cancel/Go back' },
  { key: '/', action: 'Focus search' },
  { key: 'Tab', action: 'Next field' },
  { key: '?', action: 'Show help' }
];

/**
 * Settings component
 */
export default function Settings({ theme, config: initialConfig, onUpdateConfig }) {
  const [activeSection, setActiveSection] = useState('general');
  const [config, setConfig] = useState(initialConfig || DEFAULT_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingApiKey, setEditingApiKey] = useState(null);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [saveStatus, setSaveStatus] = useState(null);
  
  // Get current theme colors based on config
  const currentThemeColors = useMemo(() => {
    switch (config.theme) {
      case 'light':
        return LightThemeColors;
      case 'high-contrast':
        return {
          ...ThemeColors,
          text: '#FFFFFF',
          textMuted: '#CCCCCC',
          background: '#000000',
          backgroundSecondary: '#111111',
          border: '#FFFFFF'
        };
      case 'monokai':
        return {
          ...ThemeColors,
          primary: '#A6E22E',
          secondary: '#66D9EF',
          accent: '#F92672',
          text: '#F8F8F2',
          background: '#272822',
          backgroundSecondary: '#3E3D32'
        };
      case 'nord':
        return {
          ...ThemeColors,
          primary: '#88C0D0',
          secondary: '#81A1C1',
          accent: '#A3BE8C',
          text: '#ECEFF4',
          background: '#2E3440',
          backgroundSecondary: '#3B4252'
        };
      default:
        return ThemeColors;
    }
  }, [config.theme]);
  
  // Track changes
  useEffect(() => {
    const hasConfigChanged = JSON.stringify(config) !== JSON.stringify(initialConfig || DEFAULT_CONFIG);
    setHasChanges(hasConfigChanged);
  }, [config, initialConfig]);
  
  // Handle keyboard navigation
  useInput((input, key) => {
    // Handle confirmation dialogs
    if (showSaveConfirm || showResetConfirm) {
      if (input === 'y' || input === 'Y') {
        if (showSaveConfirm) {
          handleSave();
        } else if (showResetConfirm) {
          handleReset();
        }
      } else if (input === 'n' || input === 'N' || key.escape) {
        setShowSaveConfirm(false);
        setShowResetConfirm(false);
      }
      return;
    }
    
    // Handle API key editing
    if (editingApiKey) {
      if (key.escape) {
        setEditingApiKey(null);
        setApiKeyValue('');
      } else if (key.return) {
        handleSaveApiKey();
      }
      return;
    }
    
    // Section navigation with number keys
    if (input === '1') setActiveSection('general');
    if (input === '2') setActiveSection('appearance');
    if (input === '3') setActiveSection('models');
    if (input === '4') setActiveSection('apikeys');
    if (input === '5') setActiveSection('shortcuts');
    
    // Save changes
    if (input === 's' && key.ctrl) {
      handleSave();
    }
    
    // Reset to defaults
    if (input === 'r' && key.ctrl) {
      setShowResetConfirm(true);
    }
    
    // Toggle boolean options
    if (input === 't' && activeSection === 'appearance') {
      toggleOption('showTimestamps');
    }
    if (input === 'c' && activeSection === 'appearance') {
      toggleOption('compactMode');
    }
    if (input === 'a' && activeSection === 'general') {
      toggleOption('autoSave');
    }
    if (input === 'f' && activeSection === 'general') {
      toggleOption('confirmActions');
    }
    
    // Navigate within sections
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(10, prev + 1));
    }
  });
  
  // Toggle boolean option
  const toggleOption = useCallback((option) => {
    setConfig(prev => ({
      ...prev,
      [option]: !prev[option]
    }));
  }, []);
  
  // Handle save
  const handleSave = useCallback(() => {
    setSaveStatus('saving');
    
    // Simulate save delay
    setTimeout(() => {
      if (onUpdateConfig) {
        onUpdateConfig(config);
      }
      setSaveStatus('saved');
      setShowSaveConfirm(false);
      setHasChanges(false);
      
      // Clear status after delay
      setTimeout(() => setSaveStatus(null), 2000);
    }, 500);
  }, [config, onUpdateConfig]);
  
  // Handle reset to defaults
  const handleReset = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    setShowResetConfirm(false);
    setHasChanges(true);
  }, []);
  
  // Handle API key save
  const handleSaveApiKey = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      apiKeys: {
        ...prev.apiKeys,
        [editingApiKey]: apiKeyValue
      }
    }));
    setEditingApiKey(null);
    setApiKeyValue('');
  }, [editingApiKey, apiKeyValue]);
  
  // Start editing API key
  const startEditApiKey = useCallback((provider) => {
    setEditingApiKey(provider);
    setApiKeyValue(config.apiKeys[provider] || '');
  }, [config.apiKeys]);
  
  // Render general settings
  const renderGeneralSettings = () => (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Box>
          <Text color={theme.text}>Auto-save conversations</Text>
          <Text color={theme.textDim}> (Press </Text>
          <Text color={theme.accent}>[A]</Text>
          <Text color={theme.textDim}> to toggle)</Text>
        </Box>
        <Text color={config.autoSave ? theme.success : theme.error}>
          {config.autoSave ? '✓ Enabled' : '✗ Disabled'}
        </Text>
      </Box>
      
      <Box justifyContent="space-between" alignItems="center">
        <Box>
          <Text color={theme.text}>Confirm critical actions</Text>
          <Text color={theme.textDim}> (Press </Text>
          <Text color={theme.accent}>[F]</Text>
          <Text color={theme.textDim}> to toggle)</Text>
        </Box>
        <Text color={config.confirmActions ? theme.success : theme.error}>
          {config.confirmActions ? '✓ Enabled' : '✗ Disabled'}
        </Text>
      </Box>
      
      <Box marginTop={1}>
        <Text color={theme.textMuted}>
          [A] Toggle auto-save  |  [F] Toggle confirmations
        </Text>
      </Box>
    </Box>
  );
  
  // Render appearance settings
  const renderAppearanceSettings = () => (
    <Box flexDirection="column" gap={1}>
      <Box marginBottom={1}>
        <Text color={theme.textMuted}>Theme:</Text>
        <Box marginLeft={1}>
          <SelectInput
            items={THEMES}
            onSelect={(item) => setConfig(prev => ({ ...prev, theme: item.value }))}
            initialSelectedItem={THEMES.find(t => t.value === config.theme)}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? theme.primary : theme.textMuted}>
                {isSelected ? '●' : '○'}
              </Text>
            )}
            itemComponent={({ label, isSelected }) => (
              <Text color={isSelected ? theme.primary : theme.text}>{label}</Text>
            )}
          />
        </Box>
      </Box>
      
      <Box marginBottom={1}>
        <Text color={theme.textMuted}>Font size:</Text>
        <Box marginLeft={1}>
          <SelectInput
            items={FONT_SIZES}
            onSelect={(item) => setConfig(prev => ({ ...prev, fontSize: item.value }))}
            initialSelectedItem={FONT_SIZES.find(f => f.value === config.fontSize)}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? theme.primary : theme.textMuted}>
                {isSelected ? '●' : '○'}
              </Text>
            )}
            itemComponent={({ label, isSelected }) => (
              <Text color={isSelected ? theme.primary : theme.text}>{label}</Text>
            )}
          />
        </Box>
      </Box>
      
      <Box justifyContent="space-between" alignItems="center">
        <Box>
          <Text color={theme.text}>Show timestamps</Text>
          <Text color={theme.textDim}> (Press </Text>
          <Text color={theme.accent}>[T]</Text>
          <Text color={theme.textDim}> to toggle)</Text>
        </Box>
        <Text color={config.showTimestamps ? theme.success : theme.error}>
          {config.showTimestamps ? '✓ Enabled' : '✗ Disabled'}
        </Text>
      </Box>
      
      <Box justifyContent="space-between" alignItems="center">
        <Box>
          <Text color={theme.text}>Compact mode</Text>
          <Text color={theme.textDim}> (Press </Text>
          <Text color={theme.accent}>[C]</Text>
          <Text color={theme.textDim}> to toggle)</Text>
        </Box>
        <Text color={config.compactMode ? theme.success : theme.error}>
          {config.compactMode ? '✓ Enabled' : '✗ Disabled'}
        </Text>
      </Box>
      
      <Box marginTop={1}>
        <Text color={theme.textMuted}>
          [T] Toggle timestamps  |  [C] Toggle compact mode
        </Text>
      </Box>
    </Box>
  );
  
  // Render model settings
  const renderModelSettings = () => (
    <Box flexDirection="column" gap={1}>
      <Box marginBottom={1}>
        <Text color={theme.textMuted}>Default model:</Text>
        <Box marginLeft={1}>
          <SelectInput
            items={AVAILABLE_MODELS}
            onSelect={(item) => setConfig(prev => ({ ...prev, defaultModel: item.value }))}
            initialSelectedItem={AVAILABLE_MODELS.find(m => m.value === config.defaultModel)}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? theme.primary : theme.textMuted}>
                {isSelected ? '●' : '○'}
              </Text>
            )}
            itemComponent={({ label, isSelected }) => (
              <Text color={isSelected ? theme.primary : theme.text}>{label}</Text>
            )}
          />
        </Box>
      </Box>
      
      <Box justifyContent="space-between" alignItems="center">
        <Text color={theme.text}>Show token count</Text>
        <Text color={config.showTokenCount ? theme.success : theme.error}>
          {config.showTokenCount ? '✓ Enabled' : '✗ Disabled'}
        </Text>
      </Box>
      
      <Box marginTop={1} paddingX={1} backgroundColor={theme.backgroundTertiary}>
        <Text color={theme.textDim}>
          Note: Model selection can be changed during chat using the model selector (Ctrl+M)
        </Text>
      </Box>
    </Box>
  );
  
  // Render API keys settings
  const renderApiKeysSettings = () => (
    <Box flexDirection="column" gap={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>API Key Management</Text>
      </Box>
      
      <Box marginBottom={1}>
        <Text color={theme.warning}>
          ⚠ API keys are stored locally and never shared
        </Text>
      </Box>
      
      {['openai', 'anthropic', 'google'].map((provider) => (
        <Box 
          key={provider}
          justifyContent="space-between" 
          alignItems="center"
          paddingX={1}
          paddingY={0}
          backgroundColor={editingApiKey === provider ? theme.hover : undefined}
        >
          <Box>
            <Text color={theme.text} bold>
              {provider.charAt(0).toUpperCase() + provider.slice(1)}:
            </Text>
            <Text color={theme.textMuted} marginLeft={1}>
              {config.apiKeys[provider] ? '••••••••' : '(not set)'}
            </Text>
          </Box>
          <Text 
            color={theme.accent}
            onClick={() => startEditApiKey(provider)}
          >
            [{config.apiKeys[provider] ? 'Edit' : 'Add'}]
          </Text>
        </Box>
      ))}
      
      {editingApiKey && (
        <Box marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.border} flexDirection="column">
          <Text color={theme.primary}>
            Editing {editingApiKey.charAt(0).toUpperCase() + editingApiKey.slice(1)} API Key:
          </Text>
          <TextInput
            value={apiKeyValue}
            onChange={setApiKeyValue}
            placeholder="Enter API key..."
            placeholderColor={theme.textDim}
            mask="*"
          />
          <Box marginTop={1}>
            <Text color={theme.textMuted}>
              [Enter] Save  |  [Esc] Cancel
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
  
  // Render shortcuts reference
  const renderShortcuts = () => (
    <Box flexDirection="column" gap={0}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>Keyboard Shortcuts Reference</Text>
      </Box>
      
      <Box flexDirection="column">
        {SHORTCUTS.map((shortcut, index) => (
          <Box 
            key={shortcut.key}
            justifyContent="space-between"
            paddingX={1}
            backgroundColor={index === selectedIndex ? theme.hover : undefined}
          >
            <Text color={theme.accent} bold>
              {shortcut.key}
            </Text>
            <Text color={theme.textMuted}>
              {shortcut.action}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
  
  // Render section content
  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return renderGeneralSettings();
      case 'appearance':
        return renderAppearanceSettings();
      case 'models':
        return renderModelSettings();
      case 'apikeys':
        return renderApiKeysSettings();
      case 'shortcuts':
        return renderShortcuts();
      default:
        return renderGeneralSettings();
    }
  };
  
  // Main render
  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color={theme.primary}>Settings</Text>
        <Box alignItems="center">
          {saveStatus === 'saving' && (
            <Text color={theme.info}>
              <Spinner type="dots" /> Saving...
            </Text>
          )}
          {saveStatus === 'saved' && (
            <Text color={theme.success}>✓ Saved!</Text>
          )}
          {hasChanges && !saveStatus && (
            <Text color={theme.warning}>Unsaved changes</Text>
          )}
        </Box>
      </Box>
      
      {/* Section tabs */}
      <Box marginBottom={1} borderStyle="round" borderColor={theme.border} paddingX={1}>
        {SECTIONS.map((section, index) => (
          <Box key={section.value} marginRight={2}>
            <Text 
              color={activeSection === section.value ? theme.primary : theme.textMuted}
              bold={activeSection === section.value}
            >
              [{index + 1}] {section.label}
            </Text>
          </Box>
        ))}
      </Box>
      
      {/* Current section indicator */}
      <Box marginBottom={1}>
        <Text color={theme.textMuted}>Current section: </Text>
        <Text bold color={theme.accent}>
          {SECTIONS.find(s => s.value === activeSection)?.label}
        </Text>
      </Box>
      
      {/* Settings content */}
      <Box 
        flexGrow={1} 
        flexDirection="column" 
        borderStyle="round" 
        borderColor={theme.border}
        padding={1}
      >
        {renderSectionContent()}
      </Box>
      
      {/* Confirmation dialogs */}
      {showSaveConfirm && (
        <Box marginTop={1} padding={1} borderStyle="round" borderColor={theme.success}>
          <Text color={theme.success}>
            Save changes? (Y/N)
          </Text>
        </Box>
      )}
      
      {showResetConfirm && (
        <Box marginTop={1} padding={1} borderStyle="round" borderColor={theme.warning}>
          <Text color={theme.warning}>
            Reset all settings to defaults? This cannot be undone. (Y/N)
          </Text>
        </Box>
      )}
      
      {/* Footer with actions */}
      <Box marginTop={1} justifyContent="space-between">
        <Text color={theme.textDim}>
          [Ctrl+S] Save  |  [Ctrl+R] Reset  |  [1-5] Sections
        </Text>
        <Text color={theme.textDim}>
          {hasChanges ? '● Unsaved' : '○ All saved'}
        </Text>
      </Box>
    </Box>
  );
}
