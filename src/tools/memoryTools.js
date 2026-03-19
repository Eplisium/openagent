/**
 * 🧠 Memory Tools
 * Tools for the agent to interact with the project memory system
 */

/**
 * Create memory tools for the agent
 * @param {import('../memory/MemoryManager.js').MemoryManager} memoryManager
 * @returns {Array} Tool definitions
 */
export function createMemoryTools(memoryManager) {
  const saveMemoryTool = {
    name: 'save_memory',
    description: 'Save a learning or insight to project memory for future sessions. Use this to record important discoveries, conventions, gotchas, or patterns you want to remember.',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        learning: {
          type: 'string',
          description: 'The learning or insight to save. Be specific and actionable.',
        },
        category: {
          type: 'string',
          description: 'Category for the learning (e.g., "Architecture", "Gotcha", "Pattern", "Convention")',
          default: 'Learning',
        },
        global: {
          type: 'boolean',
          description: 'Save to global memory (true) or project memory (false, default)',
          default: false,
        },
      },
      required: ['learning'],
    },
    async execute({ learning, category = 'Learning', global = false }) {
      try {
        const result = await memoryManager.saveMemory(learning, { category, global });
        return {
          success: true,
          path: result.path,
          message: `Saved to ${global ? 'global' : 'project'} memory`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const getMemoryTool = {
    name: 'get_memory',
    description: 'Get the current project memory context. Shows all loaded memory files (AGENTS.md, OPENAGENT.md, MEMORY.md) with their content.',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        stats: {
          type: 'boolean',
          description: 'If true, return stats instead of full content',
          default: false,
        },
      },
    },
    async execute({ stats = false }) {
      try {
        if (stats) {
          const memoryStats = await memoryManager.getStats();
          return { success: true, stats: memoryStats };
        }

        const context = await memoryManager.getContext();
        const files = await memoryManager.listFiles();
        
        return {
          success: true,
          context: context || 'No memory files found. Use init_memory to create them.',
          files: files.filter(f => f.exists),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const initMemoryTool = {
    name: 'init_memory',
    description: 'Initialize project memory files (AGENTS.md, OPENAGENT.md, MEMORY.md). Run this once when starting a new project.',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        await memoryManager.initProject();
        return {
          success: true,
          message: 'Project memory initialized. Edit AGENTS.md and OPENAGENT.md to add project-specific context.',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [saveMemoryTool, getMemoryTool, initMemoryTool];
}
