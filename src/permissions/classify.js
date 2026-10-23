/**
 * Tool permission classification.
 *
 * Every tool call is classified into one permission class:
 *   read        - no side effects (or only local, harmless bookkeeping reads)
 *   write       - modifies files / local state
 *   execute     - runs arbitrary code or processes (shell, subagents, workflows)
 *   network     - mutating network operations (git push, MCP calls, protocol servers)
 *   destructive - deletes or irreversibly rewrites data
 *
 * A tool definition may declare `permission` explicitly (one of the classes
 * above, legacy 'delete' → destructive) or a function `(args) => class`.
 * Otherwise defaults are derived from the tool name and category so no tool
 * file needs editing.
 */

export const PERMISSION_CLASSES = Object.freeze(['read', 'write', 'execute', 'network', 'destructive']);

/**
 * Tools that are safe to run in parallel. This is the list historically
 * hard-coded in Agent.executeToolCallsEnhanced; it includes a few cheap local
 * writes (git_add, git_stash, save_memory) that never conflict.
 */
export const PARALLEL_SAFE_TOOLS = new Set([
  'read_file', 'read_files', 'list_directory', 'file_tree', 'search_files', 'search_in_files', 'get_file_info',
  'find_files', 'diff_files', 'preview_edit', 'read_image',
  'git_status', 'git_log', 'git_diff', 'git_info', 'git_branch',
  'git_add', 'git_remote', 'git_stash',
  'web_search', 'read_webpage', 'fetch_url',
  'system_info', 'process_status', 'computer_control',
  'get_memory', 'list_skills', 'list_memories', 'save_memory',
  'get_task_status', 'get_progress_report', 'list_tasks',
  'subagent_status', 'get_subagent_messages', 'get_shared_context', 'list_subagents',
  'get_background_result',
  'list_workflows', 'get_workflow_state',
  'list_mcp_tools', 'list_a2a_agents',
  'search_library', 'list_library_sources', 'search_in_file',
]);

/** Parallel-safe tools that nevertheless have side effects. */
const PARALLEL_SAFE_BUT_MUTATING = new Set(['git_add', 'git_stash', 'save_memory', 'computer_control', 'git_branch', 'git_remote']);

/** Read-only tools: allowed in every mode, including read-only and plan. */
export const READ_ONLY_TOOLS = new Set([
  ...[...PARALLEL_SAFE_TOOLS].filter(name => !PARALLEL_SAFE_BUT_MUTATING.has(name)),
  'tool_search', 'exit_plan_mode', 'session_search',
  'git_log', 'checkpoint_list', 'checkpoint_status', 'checkpoint_diff', 'checkpoint_is_git',
  'generate_diff', 'detect_indent',
  'list_background_tasks', 'await_background',
  'graph_status', 'graph_list_workflows', 'graph_list_checkpoints', 'graph_visualize',
  'get_autogen_status',
  'mcp_list_servers', 'mcp_list_connections',
  'agui_get_status', 'agui_get_subscribers',
  'plugin_list', 'plugin_info', 'plugin_discover',
  'browser_get_text', 'browser_get_html', 'browser_screenshot', 'browser_list_pages',
  'use_skill', 'check_retrieval', 'validate_memory',
  'deep_research', 'research_query',
  'get_next_feature',
]);

/** Explicit per-name classes for tools whose category default is wrong. */
const NAME_CLASSES = {
  delete_file: 'destructive',
  delete_folder: 'destructive',
  checkpoint_restore: 'destructive',
  checkpoint_delete: 'destructive',
  exec: 'execute',
  exec_background: 'execute',
  computer_control: 'execute',
  git_push: 'network',
  git_clone: 'write',
  git_pull: 'write',
  mcp_call_tool: 'network',
  mcp_auth: 'network',
  save_memory: 'write',
};

/** Argument-sensitive classification for a few multi-action tools. */
const DYNAMIC_CLASSES = {
  git_branch: (args) => {
    const action = args?.action || 'list';
    if (action === 'list') return 'read';
    if (action === 'delete') return 'destructive';
    return 'write';
  },
  git_stash: (args) => {
    const action = args?.action || 'push';
    if (action === 'list') return 'read';
    if (action === 'drop' || action === 'clear') return 'destructive';
    return 'write';
  },
  git_remote: (args) => ((args?.action || 'list') === 'list' ? 'read' : 'write'),
  git_push: (args) => (args?.force ? 'destructive' : 'network'),
  process_status: (args) => (args?.action === 'kill' ? 'execute' : 'read'),
};

/** Category fallbacks for tools not covered above. */
const CATEGORY_CLASSES = {
  file: 'write',
  shell: 'execute',
  git: 'write',
  network: 'network',
  web: 'read',
  memory: 'write',
  task: 'write',
  skill: 'write',
  subagent: 'execute',
  graph: 'execute',
  autogen: 'execute',
  browser: 'execute',
  canvas: 'write',
  meta: 'read',
};

/**
 * Normalize a declared permission value to a class.
 * @param {string} value
 * @returns {string|null}
 */
export function normalizePermissionClass(value) {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  if (v === 'delete') return 'destructive';
  if (v === 'exec' || v === 'shell') return 'execute';
  return PERMISSION_CLASSES.includes(v) ? v : null;
}

/**
 * Classify a tool call.
 * @param {string} toolName
 * @param {object} [tool] - registered tool definition (category, permission, destructive)
 * @param {object} [args]
 * @returns {'read'|'write'|'execute'|'network'|'destructive'}
 */
export function classifyTool(toolName, tool = null, args = {}) {
  if (tool && typeof tool.permission === 'function') {
    const declared = normalizePermissionClass(tool.permission(args || {}));
    if (declared) return declared;
  }
  if (DYNAMIC_CLASSES[toolName]) return DYNAMIC_CLASSES[toolName](args || {});
  const declared = normalizePermissionClass(tool?.permission);
  // Legacy file tools declare permission:'read' implicitly by omission; an
  // explicit declaration always wins.
  if (declared) return declared;
  if (NAME_CLASSES[toolName]) return NAME_CLASSES[toolName];
  if (tool?.destructive === true) return 'destructive';
  if (READ_ONLY_TOOLS.has(toolName)) return 'read';

  // Name heuristics for tools without explicit metadata
  if (/^(get|list|read|search|find|show|view|describe|inspect)_/.test(toolName) || /_(status|info|list)$/.test(toolName)) {
    return 'read';
  }
  if (/^(delete|remove|drop|destroy|purge)_/.test(toolName)) return 'destructive';

  const category = tool?.category || 'general';
  return CATEGORY_CLASSES[category] || 'execute';
}
