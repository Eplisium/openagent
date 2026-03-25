/**
 * MemoryViewer.jsx - Memory visualization for OpenAgent Ink CLI
 * Props: theme, memories, onAdd, onEdit, onDelete
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { ThemeColors } from './Theme.js';

// Mock memory data - in production, this would come from props/memories
const MOCK_MEMORIES = [
  {
    id: 'mem-1',
    content: 'User prefers dark theme and compact UI layout',
    type: 'preference',
    created: '2024-01-15T10:30:00Z',
    updated: '2024-01-15T10:30:00Z',
    importance: 0.7,
    tags: ['ui', 'preferences', 'dark-theme'],
    metadata: { source: 'user-interaction', confidence: 0.95 }
  },
  {
    id: 'mem-2',
    content: 'Working on React Ink CLI project - openagent',
    type: 'project',
    created: '2024-01-14T09:15:00Z',
    updated: '2024-01-14T09:15:00Z',
    importance: 0.9,
    tags: ['project', 'react', 'cli'],
    metadata: { source: 'task-context', confidence: 0.88 }
  },
  {
    id: 'mem-3',
    content: 'Important deadline: Project submission on 2024-01-20',
    type: 'task',
    created: '2024-01-13T16:45:00Z',
    updated: '2024-01-13T16:45:00Z',
    importance: 0.95,
    tags: ['deadline', 'project', 'urgent'],
    metadata: { source: 'calendar', confidence: 1.0 }
  },
  {
    id: 'mem-4',
    content: 'Preferred code style: functional components with hooks',
    type: 'preference',
    created: '2024-01-12T14:20:00Z',
    updated: '2024-01-12T14:20:00Z',
    importance: 0.8,
    tags: ['code', 'preferences', 'react'],
    metadata: { source: 'user-interaction', confidence: 0.92 }
  },
  {
    id: 'mem-5',
    content: 'User asked about ink-select-input installation',
    type: 'conversation',
    created: '2024-01-11T11:10:00Z',
    updated: '2024-01-11T11:10:00Z',
    importance: 0.6,
    tags: ['conversation', 'help', 'ink'],
    metadata: { source: 'chat-history', confidence: 0.85 }
  }
];

// Memory types
const MEMORY_TYPES = [
  { label: 'All Types', value: 'all' },
  { label: 'Preference', value: 'preference' },
  { label: 'Project', value: 'project' },
  { label: 'Task', value: 'task' },
  { label: 'Conversation', value: 'conversation' },
  { label: 'Fact', value: 'fact' },
  { label: 'Skill', value: 'skill' }
];

// View modes
const VIEW_MODES = [
  { label: 'List View', value: 'list' },
  { label: 'Graph View', value: 'graph' }
];

/**
 * Format date for display
 */
const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Format importance as stars
 */
const formatImportance = (importance) => {
  const stars = Math.round(importance * 5);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
};

/**
 * MemoryViewer component
 */
export default function MemoryViewer({ theme, memories = MOCK_MEMORIES, onAdd, onEdit, onDelete }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState('list'); // list or graph
  const [showEditor, setShowEditor] = useState(false);
  const [editingMemory, setEditingMemory] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState('preference');
  const [showStats, setShowStats] = useState(false);
  const [importExportMode, setImportExportMode] = useState(false);
  const [importExportContent, setImportExportContent] = useState('');
  
  // Filter memories based on search and type
  const filteredMemories = useMemo(() => {
    let filtered = memories;
    
    // Apply type filter
    if (selectedType !== 'all') {
      filtered = filtered.filter(memory => memory.type === selectedType);
    }
    
    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(memory => 
        memory.content.toLowerCase().includes(query) ||
        memory.tags.some(tag => tag.toLowerCase().includes(query)) ||
        memory.type.toLowerCase().includes(query)
      );
    }
    
    // Sort by importance (highest first)
    return filtered.sort((a, b) => b.importance - a.importance);
  }, [memories, searchQuery, selectedType]);
  
  // Get currently selected memory
  const selectedMemory = useMemo(() => {
    return filteredMemories[selectedIndex] || null;
  }, [filteredMemories, selectedIndex]);
  
  // Calculate statistics
  const stats = useMemo(() => {
    const total = memories.length;
    const byType = memories.reduce((acc, mem) => {
      acc[mem.type] = (acc[mem.type] || 0) + 1;
      return acc;
    }, {});
    const avgImportance = total > 0 ? 
      memories.reduce((sum, mem) => sum + mem.importance, 0) / total : 0;
    const oldest = memories.reduce((oldest, mem) => 
      (!oldest || new Date(mem.created) < new Date(oldest.created)) ? mem : oldest, null);
    const newest = memories.reduce((newest, mem) => 
      (!newest || new Date(mem.created) > new Date(newest.created)) ? mem : newest, null);
    
    return {
      total,
      byType,
      avgImportance,
      oldest: oldest ? formatDate(oldest.created) : 'N/A',
      newest: newest ? formatDate(newest.created) : 'N/A'
    };
  }, [memories]);
  
  // Handle keyboard navigation
  useInput((input, key) => {
    // Escape from editor or import/export
    if (key.escape) {
      if (showEditor) {
        setShowEditor(false);
        setEditingMemory(null);
        setEditContent('');
        return;
      }
      if (importExportMode) {
        setImportExportMode(false);
        setImportExportContent('');
        return;
      }
      if (showStats) {
        setShowStats(false);
        return;
      }
      return;
    }
    
    // Handle editor mode
    if (showEditor) {
      // Save with Ctrl+S
      if (input === 's' && key.ctrl) {
        handleSaveMemory();
      }
      return;
    }
    
    // Handle import/export mode
    if (importExportMode) {
      // Export with Ctrl+E
      if (input === 'e' && key.ctrl) {
        handleExport();
      }
      // Import with Ctrl+I
      if (input === 'i' && key.ctrl) {
        handleImport();
      }
      return;
    }
    
    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => 
        prev > 0 ? prev - 1 : filteredMemories.length - 1
      );
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => 
        prev < filteredMemories.length - 1 ? prev + 1 : 0
      );
    }
    
    // Add new memory
    if (input === 'a') {
      setEditingMemory(null);
      setEditContent('');
      setEditType('preference');
      setShowEditor(true);
    }
    
    // Edit selected memory
    if (input === 'e' && selectedMemory) {
      setEditingMemory(selectedMemory);
      setEditContent(selectedMemory.content);
      setEditType(selectedMemory.type);
      setShowEditor(true);
    }
    
    // Delete selected memory
    if (input === 'd' && selectedMemory && onDelete) {
      onDelete(selectedMemory.id);
    }
    
    // Toggle view mode
    if (input === 'v') {
      setViewMode(prev => prev === 'list' ? 'graph' : 'list');
    }
    
    // Show statistics
    if (input === 's' && !key.ctrl) {
      setShowStats(prev => !prev);
    }
    
    // Import/export
    if (input === 'i') {
      setImportExportMode(true);
      setImportExportContent(JSON.stringify(memories, null, 2));
    }
    
    // Filter shortcuts
    if (input === '1') setSelectedType('all');
    if (input === '2') setSelectedType('preference');
    if (input === '3') setSelectedType('project');
    if (input === '4') setSelectedType('task');
    if (input === '5') setSelectedType('conversation');
    
    // Search focus
    if (input === '/') {
      // In production, this would focus the search input
    }
  });
  
  // Handle save memory
  const handleSaveMemory = useCallback(() => {
    if (!editContent.trim()) return;
    
    if (editingMemory) {
      // Update existing
      if (onEdit) {
        onEdit(editingMemory.id, {
          content: editContent,
          type: editType,
          updated: new Date().toISOString()
        });
      }
    } else {
      // Create new
      const newMemory = {
        id: `mem-${Date.now()}`,
        content: editContent,
        type: editType,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        importance: 0.7,
        tags: [],
        metadata: { source: 'manual-entry', confidence: 0.9 }
      };
      
      if (onAdd) {
        onAdd(newMemory);
      }
    }
    
    setShowEditor(false);
    setEditingMemory(null);
    setEditContent('');
  }, [editContent, editType, editingMemory, onAdd, onEdit]);
  
  // Handle export
  const handleExport = useCallback(() => {
    // In production, this would trigger a file download
    console.log('Exporting memories:', importExportContent);
    // For now, just close the mode
    setImportExportMode(false);
  }, [importExportContent]);
  
  // Handle import
  const handleImport = useCallback(() => {
    try {
      const imported = JSON.parse(importExportContent);
      // Validate and add memories
      console.log('Importing memories:', imported);
      // For now, just close the mode
      setImportExportMode(false);
    } catch (error) {
      console.error('Invalid JSON:', error);
    }
  }, [importExportContent]);
  
  // Handle filter change
  const handleTypeChange = useCallback((item) => {
    setSelectedType(item.value);
    setSelectedIndex(0);
  }, []);
  
  // Render graph view
  const renderGraphView = () => {
    // Simplified graph representation using text
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} padding={1}>
        <Text bold color={theme.primary}>Memory Graph Visualization</Text>
        <Text color={theme.textMuted}>(Simplified representation)</Text>
        
        <Box marginTop={1} flexDirection="column">
          {filteredMemories.map((memory, index) => (
            <Box key={memory.id} marginBottom={1}>
              <Text color={index === selectedIndex ? theme.accent : theme.textMuted}>
                ●{' '.repeat(index + 1)}→{' '}
              </Text>
              <Text 
                color={index === selectedIndex ? theme.accent : theme.text}
                bold={index === selectedIndex}
              >
                {memory.content.substring(0, 30)}...
              </Text>
              <Text color={theme.textMuted} marginLeft={1}>
                [{memory.type}]
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  };
  
  // Render statistics
  const renderStats = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} padding={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>Memory Statistics</Text>
        </Box>
        
        <Box flexDirection="column">
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={theme.textMuted}>Total Memories:</Text>
            <Text bold color={theme.accent}>{stats.total}</Text>
          </Box>
          
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={theme.textMuted}>Avg Importance:</Text>
            <Text color={theme.warning}>{formatImportance(stats.avgImportance)}</Text>
          </Box>
          
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={theme.textMuted}>Oldest Memory:</Text>
            <Text>{stats.oldest}</Text>
          </Box>
          
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={theme.textMuted}>Newest Memory:</Text>
            <Text>{stats.newest}</Text>
          </Box>
          
          <Box marginTop={1}>
            <Text bold color={theme.primary}>By Type:</Text>
          </Box>
          {Object.entries(stats.byType).map(([type, count]) => (
            <Box key={type} justifyContent="space-between">
              <Text color={theme.textMuted}>  {type}:</Text>
              <Text>{count}</Text>
            </Box>
          ))}
        </Box>
        
        <Box marginTop={1} justifyContent="flex-end">
          <Text color={theme.textMuted}>[Esc] Close  [S] Toggle Stats</Text>
        </Box>
      </Box>
    );
  };
  
  // Render editor
  const renderEditor = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} padding={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>Memory Editor</Text>
          <Text color={theme.textMuted}> ({editingMemory ? 'Edit' : 'Add'})</Text>
        </Box>
        
        <Box marginBottom={1}>
          <Text color={theme.textMuted}>Type: </Text>
          <SelectInput
            items={MEMORY_TYPES.filter(t => t.value !== 'all')}
            onSelect={(item) => setEditType(item.value)}
            initialSelectedItem={MEMORY_TYPES.find(t => t.value === editType)}
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
        
        <Box marginBottom={1} flexDirection="column">
          <Text color={theme.textMuted}>Content:</Text>
          <TextInput
            value={editContent}
            onChange={setEditContent}
            placeholder="Enter memory content..."
            placeholderColor={theme.textDim}
          />
        </Box>
        
        <Box marginTop={1} justifyContent="space-between">
          <Text color={theme.textMuted}>
            [Ctrl+S] Save  [Esc] Cancel
          </Text>
          {editingMemory && (
            <Text color={theme.textDim}>
              Last updated: {formatDate(editingMemory.updated)}
            </Text>
          )}
        </Box>
      </Box>
    );
  };
  
  // Render import/export
  const renderImportExport = () => {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} padding={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>Import/Export Memories</Text>
        </Box>
        
        <Box marginBottom={1} flexDirection="column">
          <Text color={theme.textMuted}>JSON Data:</Text>
          <TextInput
            value={importExportContent}
            onChange={setImportExportContent}
            placeholder="Paste JSON here..."
            placeholderColor={theme.textDim}
          />
        </Box>
        
        <Box marginTop={1} justifyContent="space-between">
          <Text color={theme.textMuted}>
            [Ctrl+E] Export  [Ctrl+I] Import  [Esc] Cancel
          </Text>
          <Text color={theme.textDim}>
            {importExportContent.length} chars
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
        <Box>
          <Text bold color={theme.primary}>Memory Viewer</Text>
          <Text color={theme.textMuted}> ({filteredMemories.length} memories)</Text>
        </Box>
        <Box>
          <Text color={theme.textMuted}>
            View: {viewMode === 'list' ? 'List' : 'Graph'}
          </Text>
          <Text color={theme.textMuted}> [V] to toggle</Text>
        </Box>
      </Box>
      
      {/* Search and filter */}
      <Box marginBottom={1}>
        <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexGrow={1}>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search memories..."
            placeholderColor={theme.textDim}
          />
        </Box>
        <Box marginLeft={1}>
          <SelectInput
            items={MEMORY_TYPES}
            onSelect={handleTypeChange}
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
      
      {/* Quick stats */}
      <Box marginBottom={1} paddingX={1} backgroundColor={theme.backgroundTertiary}>
        <Text color={theme.textMuted}>Total: </Text>
        <Text bold color={theme.accent}>{stats.total}</Text>
        <Text color={theme.textMuted}>  |  Types: </Text>
        <Text color={theme.info}>{Object.keys(stats.byType).length}</Text>
        <Text color={theme.textMuted}>  |  Press </Text>
        <Text color={theme.accent}>[S]</Text>
        <Text color={theme.textMuted}> for detailed stats</Text>
      </Box>
      
      {/* Content area */}
      {showStats ? (
        renderStats()
      ) : showEditor ? (
        renderEditor()
      ) : importExportMode ? (
        renderImportExport()
      ) : viewMode === 'graph' ? (
        renderGraphView()
      ) : (
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={theme.border}>
          {filteredMemories.length === 0 ? (
            <Box padding={1} justifyContent="center">
              <Text color={theme.textMuted}>No memories found</Text>
            </Box>
          ) : (
            filteredMemories.map((memory, index) => (
              <Box 
                key={memory.id}
                paddingX={1}
                paddingY={0}
                backgroundColor={index === selectedIndex ? theme.hover : undefined}
                flexDirection="column"
              >
                <Box justifyContent="space-between">
                  <Box>
                    <Text color={theme.accent}>
                      {formatImportance(memory.importance)}
                    </Text>
                    <Text bold={index === selectedIndex} color={theme.text}>
                      {' '}{memory.content.substring(0, 60)}
                    </Text>
                    {memory.content.length > 60 && (
                      <Text color={theme.textDim}>...</Text>
                    )}
                  </Box>
                  <Text color={theme.textMuted}>
                    {formatDate(memory.created)}
                  </Text>
                </Box>
                <Box paddingLeft={2}>
                  <Text color={theme.textDim}>
                    [{memory.type}] {memory.tags.join(', ')}
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
          [↑/↓] Navigate  [A] Add  [E] Edit  [D] Delete  [V] View
        </Text>
        <Text color={theme.textDim}>
          [S] Stats  [I] Import/Export
        </Text>
      </Box>
    </Box>
  );
}
