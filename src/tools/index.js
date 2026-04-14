/**
 * 🛠️ Tools Index v3.0
 * Export all tools and the registry
 */

// Re-exports from submodules
export { ToolRegistry, ToolErrorType } from './ToolRegistry.js';
export { createFileTools, fileTools, readFileTool, writeFileTool, editFileTool, searchAndReplaceTool, listDirectoryTool, searchInFilesTool, getFileInfoTool } from './fileTools.js';
export { createShellTools, shellTools, execTool, execBackgroundTool, processStatusTool, systemInfoTool } from './shellTools.js';
export { createWebTools, webTools, webSearchTool, readWebpageTool, fetchUrlTool } from './webTools.js';
export { createGitTools, gitTools, gitStatusTool, gitLogTool, gitDiffTool, gitAddTool, gitCommitTool, gitPushTool, gitPullTool, gitBranchTool, gitInfoTool } from './gitTools.js';
export { createSubagentTools } from './subagentTools.js';
export { createTaskTools } from './taskTools.js';
export { createMcpTools } from './mcpTools.js';
export { createA2ATools } from './a2aTools.js';
export { createAGUITools } from './aguiTools.js';
export { createGraphTools } from './graphTools.js';
export { createAdvancedEditTools, advancedEditTools } from './advancedEditTools.js';
export { default as EditEngine } from './EditEngine.js';

// Local imports for factory functions
import { ToolRegistry as _ToolRegistry } from './ToolRegistry.js';
import { createFileTools as _createFileTools } from './fileTools.js';
import { createShellTools as _createShellTools } from './shellTools.js';
import { createGitTools as _createGitTools } from './gitTools.js';
import { webTools as _webTools } from './webTools.js';
import { createMcpTools as _createMcpTools } from './mcpTools.js';
import { createA2ATools as _createA2ATools } from './a2aTools.js';
import { createAGUITools as _createAGUITools } from './aguiTools.js';
import { createGraphTools as _createGraphTools } from './graphTools.js';
import { createAdvancedEditTools as _createAdvancedEditTools } from './advancedEditTools.js';

/**
 * Create a fully-configured tool registry
 */
export function createDefaultRegistry(options = {}) {
  const registry = new _ToolRegistry(options);
  const tools = _createFileTools(options);
  const shellTools = _createShellTools(options);
  const gitTools = _createGitTools(options);
  
  registry.registerAll([
    ...tools,
    ...shellTools,
    ..._webTools,
    ...gitTools,
    ..._createMcpTools(options),
    ..._createA2ATools(options),
    ..._createAGUITools(options),
    ..._createAdvancedEditTools(options),
  ]);
  
  if (options.permissions) {
    registry.setPermissions(options.permissions);
  }
  
  return registry;
}

/**
 * Create a minimal registry for testing
 */
export function createMinimalRegistry(options = {}) {
  const registry = new _ToolRegistry({
    ...options,
    permissions: {
      allowShell: false,
      allowFileWrite: false,
      allowNetwork: false,
      ...options.permissions,
    },
  });

  const tools = _createFileTools(options);
  
  // Only register read-only tools
  registry.registerAll([
    tools.find(t => t.name === 'read_file'),
    tools.find(t => t.name === 'list_directory'),
    tools.find(t => t.name === 'search_in_files'),
    tools.find(t => t.name === 'get_file_info'),
  ].filter(Boolean));
  
  return registry;
}
