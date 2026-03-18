/**
 * 🤝 Subagent Tools v3.2
 * Enhanced tools for delegating tasks to subagents
 * 
 * Improvements:
 * - Better task descriptions with examples
 * - New pipeline tool for sequential workflows
 * - Improved error messages and result formatting
 * - Coding-focused delegation guidance
 */

/**
 * Create subagent tools for a given SubagentManager
 */
export function createSubagentTools(subagentManager) {
  return [
    {
      name: 'delegate_task',
      description: `Delegate a single task to a specialized subagent that works independently and returns results.

Best for:
- A focused coding task (write a function, fix a bug, add error handling)
- Research on a specific topic
- File organization or cleanup
- Code review of specific files
- Running and analyzing tests

Specializations:
- "coder" → Expert code writing, editing, debugging. Best for any coding task.
- "architect" → System design, refactoring plans, project structure.
- "researcher" → Web search, documentation lookup, information gathering.
- "file_manager" → File operations, directory organization.
- "tester" → Writing tests, running tests, validating code.
- "reviewer" → Code review, security audit, quality checks.
- "general" → Flexible, handles any task type.

IMPORTANT: Be very specific in your task description. Include file paths, function names, and exact requirements.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Detailed task description. Be specific - include file paths, function names, exact requirements. The subagent has access to the same tools as you (file ops, shell, web, git).',
          },
          specialization: {
            type: 'string',
            enum: ['general', 'coder', 'architect', 'researcher', 'file_manager', 'tester', 'reviewer'],
            description: 'Choose the best specialization for the task.',
            default: 'general',
          },
          priority: {
            type: 'number',
            description: 'Task priority 1-10 (higher = more urgent). Default: 5.',
            default: 5,
          },
        },
        required: ['task'],
      },
      timeout: 300000, // 5 minutes for single subagent task
      async execute(args) {
        try {
          const result = await subagentManager.delegate(args.task, {
            specialization: args.specialization || 'general',
            priority: args.priority || 5,
          });
          
          return {
            success: result.success,
            response: result.response,
            taskId: result.taskId,
            specialization: result.specialization,
            duration: result.duration,
            iterations: result.iterations,
            retries: result.retries,
            error: result.error,
          };
        } catch (error) {
          return {
            success: false,
            error: `Delegation failed: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'delegate_parallel',
      description: `Run multiple independent tasks simultaneously using separate subagents.

Best for:
- Multiple file edits that don't depend on each other
- Gathering information from multiple sources at once
- Running different analyses in parallel (code review + tests + docs)
- Processing multiple independent items

Each task runs in its own isolated subagent with its own context.
Tasks should be INDEPENDENT - they cannot see each other's work.

Example tasks array:
[
  { "task": "Read and analyze src/auth.js for security issues", "specialization": "reviewer" },
  { "task": "Write unit tests for src/utils.js", "specialization": "tester" },
  { "task": "Search for best practices for JWT authentication", "specialization": "researcher" }
]`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of independent tasks to run in parallel.',
            items: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'Detailed task description with all necessary context.',
                },
                specialization: {
                  type: 'string',
                  enum: ['general', 'coder', 'architect', 'researcher', 'file_manager', 'tester', 'reviewer'],
                  description: 'Best specialization for this task.',
                  default: 'general',
                },
              },
              required: ['task'],
            },
          },
          maxConcurrent: {
            type: 'number',
            description: 'Max subagents to run at once. Default: 3.',
            default: 3,
          },
        },
        required: ['tasks'],
      },
      timeout: 600000, // 10 minutes for parallel tasks
      async execute(args) {
        try {
          const results = await subagentManager.delegateParallel(args.tasks, {
            maxConcurrent: args.maxConcurrent || 3,
          });
          
          const successful = results.filter(r => r.success);
          const failed = results.filter(r => !r.success);
          
          return {
            success: true,
            results: results.map(r => ({
              taskId: r.taskId,
              success: r.success,
              specialization: r.specialization,
              response: r.response,
              duration: r.duration,
              iterations: r.iterations,
              error: r.error,
            })),
            summary: {
              total: results.length,
              successful: successful.length,
              failed: failed.length,
              totalDuration: Math.max(...results.map(r => r.duration || 0)),
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `Parallel delegation failed: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'delegate_with_synthesis',
      description: `Run multiple tasks in parallel and automatically synthesize results into one coherent response.

Best for:
- Research from multiple angles that needs a unified summary
- Gathering different types of information about a topic
- Multi-perspective analysis (security + performance + style review)
- Any parallel work where you need a combined output

The synthesis step uses an additional subagent to merge all results intelligently.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of tasks to run in parallel before synthesis.',
            items: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'Task description with full context.',
                },
                specialization: {
                  type: 'string',
                  enum: ['general', 'coder', 'architect', 'researcher', 'file_manager', 'tester', 'reviewer'],
                  default: 'general',
                },
              },
              required: ['task'],
            },
          },
          synthesisPrompt: {
            type: 'string',
            description: 'Instructions for how to combine the results. Be specific about what format you want.',
            default: 'Synthesize these results into a clear, organized summary with actionable recommendations.',
          },
        },
        required: ['tasks'],
      },
      timeout: 600000, // 10 minutes for parallel + synthesis
      async execute(args) {
        try {
          const result = await subagentManager.delegateWithSynthesis(
            args.tasks,
            args.synthesisPrompt || 'Synthesize these results into a clear, organized summary with actionable recommendations.'
          );
          
          return {
            success: result.success,
            synthesis: result.synthesis,
            stats: result.stats,
            individualResults: result.individualResults?.map(r => ({
              taskId: r.taskId,
              success: r.success,
              specialization: r.specialization,
              response: r.response?.substring(0, 800),
              duration: r.duration,
            })),
            error: result.error,
          };
        } catch (error) {
          return {
            success: false,
            error: `Synthesis delegation failed: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'delegate_pipeline',
      description: `Run tasks in a sequential pipeline where each stage can use the previous stage's output.

Best for:
- Plan → Code → Test → Review workflows
- Research → Implement → Verify workflows
- Any multi-step process where each step depends on the previous

Use "{{previous}}" in a task description to inject the previous stage's response.

Example:
[
  { "task": "Analyze src/api.js and create a refactoring plan", "specialization": "architect" },
  { "task": "Implement the refactoring plan: {{previous}}", "specialization": "coder" },
  { "task": "Review the changes made: {{previous}}", "specialization": "reviewer" }
]`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          stages: {
            type: 'array',
            description: 'Ordered array of pipeline stages. Each stage runs after the previous completes.',
            items: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'Task description. Use {{previous}} to reference the previous stage output.',
                },
                specialization: {
                  type: 'string',
                  enum: ['general', 'coder', 'architect', 'researcher', 'file_manager', 'tester', 'reviewer'],
                  default: 'general',
                },
              },
              required: ['task'],
            },
          },
          continueOnFailure: {
            type: 'boolean',
            description: 'If true, continue pipeline even if a stage fails. Default: false.',
            default: false,
          },
        },
        required: ['stages'],
      },
      timeout: 900000, // 15 minutes for pipeline
      async execute(args) {
        try {
          const result = await subagentManager.delegatePipeline(args.stages, {
            continueOnFailure: args.continueOnFailure || false,
          });
          
          return {
            success: result.success,
            stages: result.stages.map((s, i) => ({
              stage: i + 1,
              specialization: s.specialization,
              success: s.success,
              response: s.response?.substring(0, 800),
              duration: s.duration,
              error: s.error,
            })),
            finalResult: result.finalResult ? {
              success: result.finalResult.success,
              response: result.finalResult.response,
            } : null,
          };
        } catch (error) {
          return {
            success: false,
            error: `Pipeline failed: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'subagent_status',
      description: 'Check subagent task status, statistics, and available specializations.',
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Specific task ID to check. Omit for overall stats.',
          },
        },
      },
      timeout: 10000,
      async execute(args) {
        if (args.taskId) {
          const status = subagentManager.getTaskStatus(args.taskId);
          return { success: true, task: status };
        }
        
        return {
          success: true,
          stats: subagentManager.getStats(),
          recentTasks: subagentManager.getAllTasksStatus().slice(-10),
          specializations: subagentManager.constructor.listSpecializations(),
        };
      },
    },
  ];
}

export default createSubagentTools;
