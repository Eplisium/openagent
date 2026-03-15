/**
 * 🛠️ Tools Index
 * Export all tools and the registry
 */

export { ToolRegistry } from './ToolRegistry.js';
export { fileTools, readFileTool, writeFileTool, editFileTool, listDirectoryTool, searchInFilesTool, getFileInfoTool } from './fileTools.js';
export { shellTools, execTool, execBackgroundTool, processStatusTool, systemInfoTool } from './shellTools.js';
export { webTools, webSearchTool, readWebpageTool, fetchUrlTool } from './webTools.js';
export { gitTools, gitStatusTool, gitLogTool, gitDiffTool, gitAddTool, gitCommitTool, gitPushTool, gitPullTool, gitBranchTool, gitInfoTool } from './gitTools.js';
export { createSubagentTools } from './subagentTools.js';

import { fileTools } from './fileTools.js';
import { shellTools } from './shellTools.js';
import { webTools } from './webTools.js';
import { gitTools } from './gitTools.js';
import { ToolRegistry } from './ToolRegistry.js';
import { createSubagentTools } from './subagentTools.js';

/**
 * Create a fully-configured tool registry
 */
export function createDefaultRegistry(options = {}) {
  const registry = new ToolRegistry();
  
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

export default {
  ToolRegistry,
  createDefaultRegistry,
  fileTools,
  shellTools,
  webTools,
  gitTools,
  createSubagentTools,
};
