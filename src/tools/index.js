/**
 * 🛠️ Tools Index v3.0
 * Export all tools and the registry
 */

export { ToolRegistry, ToolErrorType } from './ToolRegistry.js';
export { createFileTools, fileTools, readFileTool, writeFileTool, editFileTool, listDirectoryTool, searchInFilesTool, getFileInfoTool } from './fileTools.js';
export { createShellTools, shellTools, execTool, execBackgroundTool, processStatusTool, systemInfoTool } from './shellTools.js';
export { webTools, webSearchTool, readWebpageTool, fetchUrlTool } from './webTools.js';
export { createGitTools, gitTools, gitStatusTool, gitLogTool, gitDiffTool, gitAddTool, gitCommitTool, gitPushTool, gitPullTool, gitBranchTool, gitInfoTool } from './gitTools.js';
export { createSubagentTools } from './subagentTools.js';
export { createTaskTools } from './taskTools.js';

import { createFileTools, fileTools } from './fileTools.js';
import { createShellTools, shellTools } from './shellTools.js';
import { webTools } from './webTools.js';
import { createGitTools, gitTools } from './gitTools.js';
import { ToolRegistry, ToolErrorType } from './ToolRegistry.js';
import { createSubagentTools } from './subagentTools.js';
import { createTaskTools } from './taskTools.js';

/**
 * Create a fully-configured tool registry
 */
export function createDefaultRegistry(options = {}) {
  const registry = new ToolRegistry(options);
  const fileTools = createFileTools(options);
  const shellTools = createShellTools(options);
  const gitTools = createGitTools(options);
  
  registry.registerAll([
    ...fileTools,
    ...shellTools,
    ...webTools,
    ...gitTools,
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
  const registry = new ToolRegistry({
    ...options,
    permissions: {
      allowShell: false,
      allowFileWrite: false,
      allowNetwork: false,
      ...options.permissions,
    },
  });

  const fileTools = createFileTools(options);
  
  // Only register read-only tools
  registry.registerAll([
    fileTools.find(t => t.name === 'read_file'),
    fileTools.find(t => t.name === 'list_directory'),
    fileTools.find(t => t.name === 'search_in_files'),
    fileTools.find(t => t.name === 'get_file_info'),
  ].filter(Boolean));
  
  return registry;
}

export default {
  ToolRegistry,
  ToolErrorType,
  createDefaultRegistry,
  createMinimalRegistry,
  createFileTools,
  fileTools,
  createShellTools,
  shellTools,
  createGitTools,
  gitTools,
  webTools,
  createSubagentTools,
  createTaskTools,
};
