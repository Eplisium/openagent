/**
 * SkillsBrowser.jsx - Skills marketplace interface for OpenAgent Ink CLI
 * Props: theme, onInstall, onUninstall, installedSkills
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { ThemeColors } from './Theme.js';

// Mock skill data
const MOCK_SKILLS = [
  {
    id: 'code-formatter',
    name: 'Code Formatter',
    description: 'Automatic code formatting with Prettier and ESLint integration',
    author: 'OpenAgent',
    version: '1.0.0',
    category: 'development',
    downloads: 15420,
    stars: 128,
    installed: false,
    hotReloading: true,
    documentation: 'Formats code using Prettier with configurable rules. Supports JavaScript, TypeScript, CSS, HTML, and JSON.',
    capabilities: ['prettier', 'eslint', 'multi-language'],
    size: '125KB',
    lastUpdated: '2024-01-15'
  },
  {
    id: 'api-tester',
    name: 'API Tester',
    description: 'REST and GraphQL API testing with automated validation',
    author: 'Community',
    version: '2.3.1',
    category: 'testing',
    downloads: 8930,
    stars: 94,
    installed: true,
    hotReloading: false,
    documentation: 'Test APIs with automated request/response validation, assertion libraries, and environment variables.',
    capabilities: ['rest', 'graphql', 'testing', 'automation'],
    size: '210KB',
    lastUpdated: '2024-01-10'
  },
  {
    id: 'database-migration',
    name: 'Database Migration',
    description: 'Database schema migrations with rollback support',
    author: 'OpenAgent',
    version: '1.5.2',
    category: 'database',
    downloads: 12100,
    stars: 87,
    installed: false,
    hotReloading: true,
    documentation: 'Manage database schema changes with version control, rollback capabilities, and multi-database support.',
    capabilities: ['mysql', 'postgresql', 'sqlite', 'versioning'],
    size: '89KB',
    lastUpdated: '2024-01-08'
  },
  {
    id: 'git-workflow',
    name: 'Git Workflow',
    description: 'Enhanced git workflow with branch management and CI integration',
    author: 'Community',
    version: '3.1.0',
    category: 'development',
    downloads: 19850,
    stars: 156,
    installed: true,
    hotReloading: false,
    documentation: 'Streamline git workflows with branch management, automated commits, pull request templates, and CI/CD integration.',
    capabilities: ['git', 'branching', 'ci-cd', 'automation'],
    size: '175KB',
    lastUpdated: '2024-01-12'
  },
  {
    id: 'security-scanner',
    name: 'Security Scanner',
    description: 'Static security analysis and vulnerability detection',
    author: 'OpenAgent',
    version: '1.2.4',
    category: 'security',
    downloads: 7650,
    stars: 112,
    installed: false,
    hotReloading: true,
    documentation: 'Scan code for security vulnerabilities, dependency issues, and common security anti-patterns.',
    capabilities: ['static-analysis', 'vulnerability', 'dependencies'],
    size: '245KB',
    lastUpdated: '2024-01-05'
  }
];

// Categories
const CATEGORIES = [
  { label: 'All Skills', value: 'all' },
  { label: 'Development', value: 'development' },
  { label: 'Testing', value: 'testing' },
  { label: 'Database', value: 'database' },
  { label: 'Security', value: 'security' },
  { label: 'DevOps', value: 'devops' },
  { label: 'Utilities', value: 'utilities' }
];

/**
 * Format number with K/M suffix
 */
const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

/**
 * SkillsBrowser component
 */
export default function SkillsBrowser({ theme, onInstall, onUninstall, installedSkills }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsSkill, setDetailsSkill] = useState(null);
  const [installationProgress, setInstallationProgress] = useState({});
  const [hotReloadingActive, setHotReloadingActive] = useState(true);
  
  // Filter skills based on search and category
  const filteredSkills = useMemo(() => {
    let skills = MOCK_SKILLS;
    
    // Apply category filter
    if (selectedCategory !== 'all') {
      skills = skills.filter(skill => skill.category === selectedCategory);
    }
    
    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      skills = skills.filter(skill => 
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.author.toLowerCase().includes(query) ||
        skill.capabilities.some(cap => cap.toLowerCase().includes(query))
      );
    }
    
    // Sort by downloads (most popular first)
    return skills.sort((a, b) => b.downloads - a.downloads);
  }, [searchQuery, selectedCategory]);
  
  // Get currently selected skill
  const selectedSkill = useMemo(() => {
    return filteredSkills[selectedIndex] || null;
  }, [filteredSkills, selectedIndex]);
  
  // Check if skill is installed
  const isSkillInstalled = useCallback((skillId) => {
    return installedSkills?.includes(skillId) || 
           MOCK_SKILLS.find(s => s.id === skillId)?.installed || 
           false;
  }, [installedSkills]);
  
  // Handle keyboard navigation
  useInput((input, key) => {
    if (key.escape) {
      if (showDetails) {
        setShowDetails(false);
        setDetailsSkill(null);
      }
      return;
    }
    
    if (showDetails) return;
    
    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => 
        prev > 0 ? prev - 1 : filteredSkills.length - 1
      );
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => 
        prev < filteredSkills.length - 1 ? prev + 1 : 0
      );
    }
    
    // Show details
    if (input === 'd' && selectedSkill) {
      setDetailsSkill(selectedSkill);
      setShowDetails(true);
    }
    
    // Install/Uninstall
    if (key.return && selectedSkill) {
      if (isSkillInstalled(selectedSkill.id)) {
        handleUninstall(selectedSkill.id);
      } else {
        handleInstall(selectedSkill.id);
      }
    }
    
    // Category shortcuts
    if (input === '1') setSelectedCategory('all');
    if (input === '2') setSelectedCategory('development');
    if (input === '3') setSelectedCategory('testing');
    if (input === '4') setSelectedCategory('database');
    if (input === '5') setSelectedCategory('security');
    
    // Search focus
    if (input === '/') {
      // In production, this would focus the search input
    }
    
    // Toggle hot reloading view
    if (input === 'h') {
      setHotReloadingActive(prev => !prev);
    }
  });
  
  // Handle skill installation
  const handleInstall = useCallback((skillId) => {
    // Set installation progress
    setInstallationProgress(prev => ({ ...prev, [skillId]: 'installing' }));
    
    // Simulate installation delay
    setTimeout(() => {
      setInstallationProgress(prev => ({ ...prev, [skillId]: 'complete' }));
      
      // Call parent handler
      if (onInstall) {
        onInstall(skillId);
      }
      
      // Clear progress after delay
      setTimeout(() => {
        setInstallationProgress(prev => {
          const newState = { ...prev };
          delete newState[skillId];
          return newState;
        });
      }, 2000);
    }, 1500);
  }, [onInstall]);
  
  // Handle skill uninstallation
  const handleUninstall = useCallback((skillId) => {
    // Set uninstallation progress
    setInstallationProgress(prev => ({ ...prev, [skillId]: 'uninstalling' }));
    
    // Simulate uninstallation delay
    setTimeout(() => {
      setInstallationProgress(prev => ({ ...prev, [skillId]: 'complete' }));
      
      // Call parent handler
      if (onUninstall) {
        onUninstall(skillId);
      }
      
      // Clear progress after delay
      setTimeout(() => {
        setInstallationProgress(prev => {
          const newState = { ...prev };
          delete newState[skillId];
          return newState;
        });
      }, 2000);
    }, 1000);
  }, [onUninstall]);
  
  // Handle category change
  const handleCategoryChange = useCallback((item) => {
    setSelectedCategory(item.value);
    setSelectedIndex(0);
  }, []);
  
  // Render skill details
  const renderSkillDetails = () => {
    if (!detailsSkill) return null;
    
    const installed = isSkillInstalled(detailsSkill.id);
    const progress = installationProgress[detailsSkill.id];
    
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} padding={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Box>
            <Text bold color={theme.primary}>{detailsSkill.name}</Text>
            <Text color={theme.textMuted}> v{detailsSkill.version}</Text>
          </Box>
          <Text color={theme.accent}>{detailsSkill.category}</Text>
        </Box>
        
        <Text color={theme.text} marginBottom={1}>{detailsSkill.description}</Text>
        
        <Box marginBottom={1}>
          <Text color={theme.textMuted}>By: </Text>
          <Text color={theme.info}>{detailsSkill.author}</Text>
        </Box>
        
        <Box marginBottom={1} flexDirection="column">
          <Text color={theme.textMuted}>Capabilities:</Text>
          <Box flexWrap="wrap">
            {detailsSkill.capabilities.map(cap => (
              <Text key={cap} color={theme.accent} marginRight={1}>
                [{cap}]
              </Text>
            ))}
          </Box>
        </Box>
        
        <Box marginBottom={1} justifyContent="space-between">
          <Box>
            <Text color={theme.textMuted}>Downloads: </Text>
            <Text color={theme.success}>{formatNumber(detailsSkill.downloads)}</Text>
          </Box>
          <Box>
            <Text color={theme.textMuted}>Stars: </Text>
            <Text color={theme.accent}>{detailsSkill.stars}</Text>
          </Box>
          <Box>
            <Text color={theme.textMuted}>Size: </Text>
            <Text>{detailsSkill.size}</Text>
          </Box>
        </Box>
        
        <Box marginBottom={1} paddingX={2} paddingY={1} backgroundColor={theme.backgroundTertiary}>
          <Box flexDirection="column">
            <Text bold color={theme.primary}>Documentation:</Text>
            <Text>{detailsSkill.documentation}</Text>
          </Box>
        </Box>
        
        {detailsSkill.hotReloading && (
          <Box marginBottom={1}>
            <Text color={theme.warning}>
              ⚡ Supports hot-reloading - changes take effect immediately
            </Text>
          </Box>
        )}
        
        <Box marginTop={1} justifyContent="space-between">
          {progress ? (
            <Box alignItems="center">
              <Text color={theme.info}>
                <Spinner type="dots" />
                <Text> {progress === 'installing' ? 'Installing...' : 
                       progress === 'uninstalling' ? 'Uninstalling...' : 
                       'Complete!'}</Text>
              </Text>
            </Box>
          ) : (
            <Box>
              {installed ? (
                <Text color={theme.success}>✓ Installed</Text>
              ) : (
                <Text color={theme.textMuted}>Not installed</Text>
              )}
            </Box>
          )}
          <Text color={theme.textMuted}>
            [Enter] {installed ? 'Uninstall' : 'Install'}  [Esc] Back
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
          <Text bold color={theme.primary}>Skills Marketplace</Text>
          <Text color={theme.textMuted}> ({filteredSkills.length} skills)</Text>
        </Box>
        <Box alignItems="center">
          <Text color={hotReloadingActive ? theme.success : theme.textMuted}>
            ⚡ Hot Reload: {hotReloadingActive ? 'ON' : 'OFF'}
          </Text>
          <Text color={theme.textMuted}> [H] to toggle</Text>
        </Box>
      </Box>
      
      {/* Search and category filter */}
      <Box marginBottom={1}>
        <Box borderStyle="round" borderColor={theme.border} paddingX={1} flexGrow={1}>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search skills..."
            placeholderColor={theme.textDim}
          />
        </Box>
        <Box marginLeft={1}>
          <SelectInput
            items={CATEGORIES}
            onSelect={handleCategoryChange}
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
      
      {/* Installed skills count */}
      <Box marginBottom={1} paddingX={1} backgroundColor={theme.backgroundTertiary}>
        <Text color={theme.textMuted}>Installed: </Text>
        <Text bold color={theme.success}>{installedSkills?.length || 0}</Text>
        <Text color={theme.textMuted}> skills  |  </Text>
        <Text color={theme.textMuted}>Press </Text>
        <Text color={theme.accent}>[1-5]</Text>
        <Text color={theme.textMuted}> for categories  |  </Text>
        <Text color={theme.textMuted}>Press </Text>
        <Text color={theme.accent}>[D]</Text>
        <Text color={theme.textMuted}> for details</Text>
      </Box>
      
      {/* Skill list or details */}
      {showDetails ? (
        renderSkillDetails()
      ) : (
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={theme.border}>
          {filteredSkills.length === 0 ? (
            <Box padding={1} justifyContent="center">
              <Text color={theme.textMuted}>No skills found</Text>
            </Box>
          ) : (
            filteredSkills.map((skill, index) => {
              const installed = isSkillInstalled(skill.id);
              const progress = installationProgress[skill.id];
              
              return (
                <Box 
                  key={skill.id}
                  paddingX={1}
                  paddingY={0}
                  backgroundColor={index === selectedIndex ? theme.hover : undefined}
                  flexDirection="column"
                >
                  <Box justifyContent="space-between">
                    <Box>
                      <Text color={installed ? theme.success : theme.textMuted}>
                        {installed ? '✓ ' : '  '}
                      </Text>
                      <Text bold={index === selectedIndex} color={theme.text}>
                        {skill.name}
                      </Text>
                      <Text color={theme.textMuted}> v{skill.version}</Text>
                    </Box>
                    <Box>
                      {progress ? (
                        <Text color={theme.info}>
                          <Spinner type="dots" />
                          <Text> {progress}</Text>
                        </Text>
                      ) : (
                        <>
                          <Text color={theme.textMuted}>
                            {formatNumber(skill.downloads)} ⬇
                          </Text>
                          <Text color={theme.textMuted}>  </Text>
                          <Text color={theme.accent}>
                            {skill.stars} ★
                          </Text>
                        </>
                      )}
                    </Box>
                  </Box>
                  <Box paddingLeft={2}>
                    <Text color={theme.textDim} wrap="truncate">
                      {skill.description}
                    </Text>
                  </Box>
                  <Box paddingLeft={2}>
                    <Text color={theme.textDim}>
                      By {skill.author} • {skill.category}
                      {skill.hotReloading && (
                        <Text color={theme.warning}> • ⚡ Hot Reload</Text>
                      )}
                    </Text>
                  </Box>
                </Box>
              );
            })
          )}
        </Box>
      )}
      
      {/* Footer with shortcuts */}
      <Box marginTop={1} justifyContent="space-between">
        <Text color={theme.textDim}>
          [↑/↓] Navigate  [Enter] Install/Uninstall  [D] Details  [/] Search
        </Text>
        <Text color={theme.textDim}>
          [H] Hot Reload
        </Text>
      </Box>
    </Box>
  );
}
