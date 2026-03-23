/**
 * 🧠 Memory Tools
 * Tools for the agent to interact with the project memory system
 */

import { MemoryValidator } from '../memory/MemoryValidator.js';
import { RetrievalChecker } from '../memory/RetrievalChecker.js';

/**
 * Create memory tools for the agent
 * @param {import('../memory/MemoryManager.js').MemoryManager} memoryManager
 * @param {object} [options]
 * @param {((prompt: string) => Promise<string>)|null} [options.llmCallFn] - LLM call function for deep validation
 * @returns {Array} Tool definitions
 */
export function createMemoryTools(memoryManager, options = {}) {
  const { llmCallFn = null } = options;
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
          paths: !global ? memoryManager.getProjectPaths() : undefined,
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
          paths: memoryManager.getProjectPaths(),
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
        const paths = memoryManager.getProjectPaths();
        return {
          success: true,
          message: 'Project memory initialized. AGENTS.md and OPENAGENT.md live in the project root, and MEMORY.md lives under .openagent/memory/.',
          paths,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const validateMemoryTool = {
    name: 'validate_memory',
    description: [
      'Validate and optionally repair project memory using MemMA-inspired backward-path validation.',
      'Quick mode (default): runs rule-based structural checks — no LLM required.',
      'Deep mode: generates probe QA pairs from the session content, verifies memory can answer them, and repairs failures via SKIP/MERGE/INSERT actions.',
      'Use dryRun=true to preview issues without making any changes.',
    ].join(' '),
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        sessionContent: {
          type: 'string',
          description: 'The session transcript or content to generate probes from. Required when deep=true.',
        },
        deep: {
          type: 'boolean',
          description: 'If true and sessionContent is provided, run full LLM-powered probe generation, verification, and repair. If false (default), run a quick structural check only.',
          default: false,
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, report issues and proposed repairs without applying any changes to memory.',
          default: false,
        },
      },
    },
    async execute({ sessionContent, deep = false, dryRun = false }) {
      try {
        const validator = new MemoryValidator({
          memoryManager,
          llmCallFn: deep ? llmCallFn : null,
          verbose: true,
        });

        if (!deep || !sessionContent) {
          // Quick structural check only
          const result = await validator.quickCheck();
          return {
            success: true,
            mode: 'quick',
            passed: result.passed,
            issues: result.issues,
            checks: result.checks,
            stats: result.stats,
            probes: [],
            failures: [],
            repairs: [],
            summary: result.passed
              ? 'Quick check passed — memory structure looks healthy.'
              : `Quick check found ${result.issues.length} issue(s): ${result.issues.join('; ')}`,
          };
        }

        // Deep validation: probes → verify → repair
        if (!llmCallFn) {
          return {
            success: false,
            error: 'Deep validation requires an LLM call function (llmCallFn). The agent runtime must provide one via createMemoryTools(memoryManager, { llmCallFn }).',
          };
        }

        const { probes, failures, repairs, summary } = await validator.validateAndRepair(
          sessionContent,
          { dryRun }
        );

        return {
          success: true,
          mode: 'deep',
          dryRun,
          probes,
          failures,
          repairs,
          summary,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const checkRetrievalTool = {
    name: 'check_retrieval',
    description: [
      'Evaluate whether retrieved content is sufficient for answering a query.',
      'Inspired by MemMA\'s Query Reasoner, which iteratively checks and refines retrieval until context is adequate.',
      'Quick mode (default): rule-based checks on content length, query term coverage, and placeholder detection — no LLM required.',
      'Deep mode: uses an LLM to evaluate gaps and suggest a refined query.',
    ].join(' '),
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The original question or task that was used to retrieve the content.',
        },
        content: {
          type: 'string',
          description: 'The retrieved content to evaluate.',
        },
        deep: {
          type: 'boolean',
          description: 'If true, use LLM-powered evaluation (requires llmCallFn). If false (default), use fast rule-based checks.',
          default: false,
        },
      },
      required: ['query', 'content'],
    },
    async execute({ query, content, deep = false }) {
      try {
        const checker = new RetrievalChecker({
          llmCallFn: deep ? llmCallFn : null,
          verbose: true,
        });

        const result = await checker.evaluateRetrieval({
          query,
          retrievedContent: content,
          options: { deep },
        });

        return {
          success: true,
          sufficient: result.sufficient,
          score: result.score,
          missingAspects: result.missingAspects,
          refinedQuery: result.refinedQuery,
          reasoning: result.reasoning,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [saveMemoryTool, getMemoryTool, initMemoryTool, validateMemoryTool, checkRetrievalTool];
}
