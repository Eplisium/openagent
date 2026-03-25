/**
 * ModelSelector.jsx - Interactive model browser for OpenAgent Ink CLI
 * Props: theme, currentModel, setModel, onClose
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, Static, Transform } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { ThemeColors } from './Theme.js';

// Mock model data - in production, this would come from API
const MOCK_MODELS = [
  { 
    id: 'gpt-4-turbo', 
    name: 'GPT-4 Turbo',
    provider: 'OpenAI',
    description: 'Most capable GPT-4 model, optimized for speed.',
    context: '128K',
    inputPrice: 0.01, // per 1K tokens
    outputPrice: 0.03,
    capabilities: ['chat', 'code', 'analysis'],
    favorite: false,
    recent: true
  },
  { 
    id: 'claude-3-opus', 
    name: 'Claude 3 Opus',
    provider: 'Anthropic',
    description: 'Most powerful Claude model for complex tasks.',
    context: '200K',
    inputPrice: 0.015,
    outputPrice: 0.075,
    capabilities: ['chat', 'code', 'long-context'],
    favorite: true,
    recent: true
  },
  { 
    id: 'llama-3-70b', 
    name: 'Llama 3 70B',
    provider: 'Meta',
    description: 'Open-source model with strong reasoning capabilities.',
    context: '8K',
    inputPrice: 0.0005,
    outputPrice: 0.0005,
    capabilities: ['chat', 'code'],
    favorite: false,
    recent: false
  },
  { 
    id: 'gemini-pro', 
    name: 'Gemini Pro',
    provider: 'Google',
    description: 'Google's multimodal model with strong reasoning.',
    context: '32K',
    inputPrice: 0.0005,
    outputPrice: 0.0015,
    capabilities: ['chat', 'multimodal'],
    favorite: true,
    recent: false
  },
  { 
    id: 'mistral-large', 
    name: 'Mistral Large',
    provider: 'Mistral AI',
    description: 'European AI lab's flagship model with strong coding abilities.',
    context: '32K',
    inputPrice: 0.004,
    outputPrice: 0.012,
    capabilities: ['chat', 'code', 'multilingual'],
    favorite: false,
    recent: true
  }
];

/**
 * Format price with currency
 */
const formatPrice = (price) => {
  return `$${price.toFixed(4)}`;
};

/**
 * Estimate cost based on token count
 */
const estimateCost = (model, inputTokens = 1000, outputTokens = 1000) => {
  const inputCost = (inputTokens / 1000) * model.inputPrice;
  const outputCost = (outputTokens / 1000) * model.outputPrice;
  return inputCost + outputCost;
};

/**
 * ModelSelector component
 */
export default function ModelSelector({ theme, currentModel, setModel, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all'); // all, favorites, recent
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsModel, setDetailsModel] = useState(null);
  const [costEstimate, setCostEstimate] = useState({ input: 1000, output: 1000 });
  
  // Filter models based on search and filter
  const filteredModels = useMemo(() => {
    let models = MOCK_MODELS;
    
    // Apply filter
    if (selectedFilter === 'favorites') {
      models = models.filter(model => model.favorite);
    } else if (selectedFilter === 'recent') {
      models = models.filter(model => model.recent);
    }
    
    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      models = models.filter(model => 
        model.name.toLowerCase().includes(query) ||
        model.provider.toLowerCase().includes(query) ||
        model.description.toLowerCase().includes(query) ||
        model.capabilities.some(cap => cap.toLowerCase().includes(query))
      );
    }
    
    return models;
  }, [searchQuery, selectedFilter]);
  
  // Get currently selected model
  const selectedModel = useMemo(() => {
    return filteredModels[selectedIndex] || null;
  }, [filteredModels, selectedIndex]);
  
  // Handle keyboard navigation
  useInput((input, key) => {
    if (key.escape) {
      if (showDetails) {
        setShowDetails(false);
        setDetailsModel(null);
      } else {
        onClose();
      }
      return;
    }
    
    if (showDetails) return;
    
    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => 
        prev > 0 ? prev - 1 : filteredModels.length - 1
      );
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => 
        prev < filteredModels.length - 1 ? prev + 1 : 0
      );
    }
    
    // Selection
    if (key.return && selectedModel) {
      setModel(selectedModel.id);
      onClose();
    }
    
    // Show details
    if (input === 'd' && selectedModel) {
      setDetailsModel(selectedModel);
      setShowDetails(true);
    }
    
    // Quick filter shortcuts
    if (input === 'f') setSelectedFilter('favorites');
    if (input === 'r') setSelectedFilter('recent');
    if (input === 'a') setSelectedFilter('all');
    
    // Toggle favorite
    if (input === 's' && selectedModel) {
      // In production, this would call an API
      const model = MOCK_MODELS.find(m => m.id === selectedModel.id);
      if (model) model.favorite = !model.favorite;
    }
    
    // Focus search
    if (input === '/') {
      // In production, this would focus the search input
    }
  });
  
  // Handle filter change
  const handleFilterChange = useCallback((item) => {
    setSelectedFilter(item.value);
    setSelectedIndex(0);
  }, []);
  
  // Handle model selection
  const handleModelSelect = useCallback((modelId) => {
    setModel(modelId);
    onClose();
  }, [setModel, onClose]);
  
  // Filter options
  const filterOptions = [
    { label: 'All Models', value: 'all' },
    { label: '★ Favorites', value: 'favorites' },
    { label: 'Recent', value: 'recent' }
  ];
  
  // Render model details
  const renderModelDetails = () => {
    if (!detailsModel) return null;
    
    const totalCost = estimateCost(detailsModel, costEstimate.input, costEstimate.output);
    
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} padding={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>{detailsModel.name}</Text>
          <Text color={theme.textMuted}> ({detailsModel.provider})</Text>
        </Box>
        
        <Text color={theme.text} marginBottom={1}>{detailsModel.description}</Text>
        
        <Box marginBottom={1}>
          <Text color={theme.textMuted}>Context: </Text>
          <Text color={theme.accent}>{detailsModel.context}</Text>
        </Box>
        
        <Box marginBottom={1} flexDirection="column">
          <Text color={theme.textMuted}>Pricing per 1K tokens:</Text>
          <Text>  Input: {formatPrice(detailsModel.inputPrice)}</Text>
          <Text>  Output: {formatPrice(detailsModel.outputPrice)}</Text>
        </Box>
        
        <Box marginBottom={1} flexDirection="column">
          <Text color={theme.textMuted}>Capabilities:</Text>
          <Text>  {detailsModel.capabilities.join(', ')}</Text>
        </Box>
        
        <Box marginTop={1} paddingX={2} paddingY={1} backgroundColor={theme.backgroundTertiary}>
          <Box flexDirection="column">
            <Text bold color={theme.accent}>Cost Estimate (1K input, 1K output tokens):</Text>
            <Text>  Total: ${totalCost.toFixed(6)}</Text>
            <Text color={theme.textDim}>(Prices may vary by provider)</Text>
          </Box>
        </Box>
        
        <Box marginTop={1} justifyContent="space-between">
          <Text color={theme.textMuted}>
            [Enter] Select  [Esc] Back
          </Text>
          <Text color={theme.textDim}>
            [F] Toggle Favorite
          </Text>
        </Box>
      </Box>
    );
  };
  
  // Main render
  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color={theme.primary}>Select Model</Text>
        <Text color={theme.textMuted}>[Esc] to close</Text>
      </Box>
      
      {/* Search and filter */}
      <Box marginBottom={1}>
        <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexGrow={1}>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search models..."
            placeholderColor={theme.textDim}
          />
        </Box>
        <Box marginLeft={1}>
          <SelectInput
            items={filterOptions}
            onSelect={handleFilterChange}
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
      
      {/* Current model display */}
      <Box marginBottom={1} paddingX={1} backgroundColor={theme.backgroundTertiary}>
        <Text color={theme.textMuted}>Current: </Text>
        <Text bold color={theme.accent}>{currentModel}</Text>
      </Box>
      
      {/* Model list or details */}
      {showDetails ? (
        renderModelDetails()
      ) : (
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={theme.border}>
          {filteredModels.length === 0 ? (
            <Box padding={1} justifyContent="center">
              <Text color={theme.textMuted}>No models found</Text>
            </Box>
          ) : (
            filteredModels.map((model, index) => (
              <Box 
                key={model.id}
                paddingX={1}
                paddingY={0}
                backgroundColor={index === selectedIndex ? theme.hover : undefined}
                flexDirection="column"
              >
                <Box justifyContent="space-between">
                  <Box>
                    <Text color={model.favorite ? theme.accent : theme.text}>
                      {model.favorite ? '★ ' : '  '}
                    </Text>
                    <Text bold={index === selectedIndex} color={theme.text}>
                      {model.name}
                    </Text>
                    <Text color={theme.textMuted}> ({model.provider})</Text>
                  </Box>
                  <Text color={theme.textMuted}>{model.context}</Text>
                </Box>
                <Box paddingLeft={2}>
                  <Text color={theme.textDim} wrap="truncate">
                    {model.description}
                  </Text>
                </Box>
              </Box>
            ))
          )}
        </Box>
      )}
      
      {/* Footer with shortcuts */}
      <Box marginTop={1} justifyContent="space-between">
        <Text color={theme.textDim}>
          [↑/↓] Navigate  [Enter] Select  [D] Details  [F] Filter
        </Text>
        <Text color={theme.textDim}>
          {filteredModels.length} models
        </Text>
      </Box>
    </Box>
  );
}
