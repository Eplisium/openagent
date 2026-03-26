/**
 * 🤖 OpenAgent Ink UI - Model Selector Component
 * Browse, search, and select from 400+ OpenRouter models
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';

export default function ModelSelector({
  theme,
  model,
  setModel,
  modelsLoaded,
  availableModels = [],
  modelBrowser = null,
  addNotification,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // all, favorites, recents, tools
  const [searchActive, setSearchActive] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Get favorites and recents from modelBrowser
  const favorites = modelBrowser?.favorites || [];
  const recents = modelBrowser?.recents || [];

  // Filter models based on search and filter mode
  const filteredModels = useMemo(() => {
    let list = availableModels;

    // Apply filter mode
    if (filterMode === 'favorites') {
      list = list.filter(m => favorites.includes(m.id));
    } else if (filterMode === 'recents') {
      list = list.filter(m => recents.includes(m.id));
    } else if (filterMode === 'tools') {
      list = list.filter(m => m.supportsTools);
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(m =>
        m.id.toLowerCase().includes(q) ||
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.provider && m.provider.toLowerCase().includes(q))
      );
    }

    return list.slice(0, 30); // Show max 30 results
  }, [availableModels, searchQuery, filterMode, favorites, recents]);

  // Format context length
  const formatCtx = (n) => {
    if (!n) return '?';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return n.toString();
  };

  // Format price
  const formatPrice = (p) => {
    if (!p || p < 0.01) return 'free';
    return `$${p.toFixed(2)}/M`;
  };

  // Provider emoji
  const providerEmoji = (provider) => {
    const map = {
      Openai: '🟢', OpenAI: '🟢', Anthropic: '🟠', Google: '🔵',
      Meta: '🟣', Mistral: '🔴', Deepseek: '🟡', DeepSeek: '🟡',
      xAI: '⬛', 'X-ai': '⬛', Cohere: '🔷', Amazon: '📦',
    };
    return map[provider] || '🔘';
  };

  // Handle model selection
  const handleSelect = useCallback((item) => {
    if (item && item.value) {
      setModel(item.value);
      addNotification?.(`Switched to ${item.value}`, 'success');
    }
  }, [setModel, addNotification]);

  // Keyboard shortcuts within model selector
  useInput((input, key) => {
    if (input === '/' && !searchActive) {
      setSearchActive(true);
      return;
    }
    if (key.escape && searchActive) {
      setSearchActive(false);
      setSearchQuery('');
      return;
    }
    if (input === 'f' && !searchActive) {
      setFilterMode(prev => prev === 'favorites' ? 'all' : 'favorites');
      return;
    }
    if (input === 'r' && !searchActive) {
      setFilterMode(prev => prev === 'recents' ? 'all' : 'recents');
      return;
    }
    if (input === 't' && !searchActive) {
      setFilterMode(prev => prev === 'tools' ? 'all' : 'tools');
      return;
    }
  });

  // Build select items
  const selectItems = filteredModels.map(m => ({
    label: `${m.id === model ? '▸ ' : '  '}${providerEmoji(m.provider)} ${m.id}`,
    value: m.id,
    description: `${m.provider || ''} · ${formatCtx(m.contextLength)} ctx · ${formatPrice(m.inputPrice)}`,
  }));

  if (!modelsLoaded) {
    return (
      <Box flexDirection="column" padding={2} alignItems="center" justifyContent="center" flex={1}>
        <Text color={theme.warning}>⏳ Loading models from OpenRouter...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box
        borderStyle="single"
        borderColor={theme.border}
        borderBottom={true}
        paddingX={2}
        paddingY={0}
        justifyContent="space-between"
      >
        <Text color={theme.primary} bold>🤖 Models</Text>
        <Text color={theme.textDim}>{availableModels.length} available</Text>
      </Box>

      {/* Filter bar */}
      <Box paddingX={2} paddingY={1} flexDirection="column">
        <Box>
          <Text
            color={filterMode === 'all' ? theme.primary : theme.textDim}
            bold={filterMode === 'all'}
          > All</Text>
          <Text color={theme.textDim}> | </Text>
          <Text
            color={filterMode === 'favorites' ? theme.primary : theme.textDim}
            bold={filterMode === 'favorites'}
          > ⭐ Favorites ({favorites.length})</Text>
          <Text color={theme.textDim}> | </Text>
          <Text
            color={filterMode === 'recents' ? theme.primary : theme.textDim}
            bold={filterMode === 'recents'}
          > 🕐 Recent ({recents.length})</Text>
          <Text color={theme.textDim}> | </Text>
          <Text
            color={filterMode === 'tools' ? theme.primary : theme.textDim}
            bold={filterMode === 'tools'}
          > 🛠️ Tools</Text>
        </Box>

        {/* Search */}
        <Box marginTop={1}>
          <Text color={theme.accent}>🔍 </Text>
          <Box flex={1}>
            <TextInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search models... (type to filter)"
              focus={searchActive}
            />
          </Box>
        </Box>
      </Box>

      {/* Current model */}
      <Box paddingX={2} paddingBottom={1}>
        <Text color={theme.textMuted}>Current: </Text>
        <Text color={theme.primary} bold>{model || 'none'}</Text>
      </Box>

      {/* Model list */}
      <Box flexDirection="column" flex={1} overflow="hidden" paddingX={1}>
        {filteredModels.length === 0 ? (
          <Box padding={2}>
            <Text color={theme.textDim}>
              {searchQuery ? `No models match "${searchQuery}"` : 'No models in this filter'}
            </Text>
          </Box>
        ) : (
          <SelectInput
            items={selectItems}
            onSelect={handleSelect}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? theme.primary : 'transparent'}>
                {isSelected ? '▸' : ' '}
              </Text>
            )}
            itemComponent={({ isSelected, label }) => (
              <Text color={isSelected ? theme.primary : theme.text}>
                {label}
              </Text>
            )}
          />
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={2} paddingY={1} borderTop borderColor={theme.border} borderStyle="single">
        <Text color={theme.textDim}>
          Enter: select | /: search | F: favorites | R: recent | T: tools-only
        </Text>
      </Box>
    </Box>
  );
}
