/**
 * 🤝 Subagent Tools
 * Tools for delegating tasks to subagents
 */

/**
 * Create subagent tools for a given SubagentManager
 */
export function createSubagentTools(subagentManager) {
  return [
    {
      name: 'delegate_task',
      description: `Delegate a task to a specialized subagent. Use this when you want to:
- Offload a specific task to focus on other work
- Run a task in parallel with your current work
- Use a specialized agent (coder, researcher, file_manager, tester, reviewer)
- Break a complex task into smaller parallel tasks

The subagent will work independently and return its results.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task to delegate. Be specific and include all necessary context.',
          },
          specialization: {
            type: 'string',
            enum: ['general', 'coder', 'researcher', 'file_manager', 'tester', 'reviewer'],
            description: 'The type of subagent to use. Choose based on the task:',
            default: 'general',
          },
          priority: {
            type: 'number',
            description: 'Task priority (1-10, higher = more urgent)',
            default: 5,
          },
        },
        required: ['task'],
      },
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
            duration: result.duration,
            iterations: result.iterations,
            error: result.error,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    },
    {
      name: 'delegate_parallel',
      description: `Delegate multiple tasks to run in parallel with subagents. Use this when you have:
- Multiple independent tasks that can run simultaneously
- A task that can be broken into parallel subtasks
- Research that needs multiple searches at once
- Multiple files to process at the same time

Each task runs in its own isolated subagent.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of tasks to run in parallel',
            items: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'The task description',
                },
                specialization: {
                  type: 'string',
                  enum: ['general', 'coder', 'researcher', 'file_manager', 'tester', 'reviewer'],
                  description: 'Subagent type for this task',
                  default: 'general',
                },
              },
              required: ['task'],
            },
          },
          maxConcurrent: {
            type: 'number',
            description: 'Maximum number of subagents to run at once',
            default: 3,
          },
        },
        required: ['tasks'],
      },
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
              response: r.response,
              duration: r.duration,
              error: r.error,
            })),
            summary: {
              total: results.length,
              successful: successful.length,
              failed: failed.length,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    },
    {
      name: 'delegate_with_synthesis',
      description: `Delegate multiple tasks to subagents and automatically synthesize their results into a coherent response. Use this when:
- You need to gather information from multiple sources
- You want parallel research with a unified summary
- You need to process multiple files and combine results
- You want the benefits of parallel work with a single coherent output`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of tasks to run',
            items: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'The task description',
                },
                specialization: {
                  type: 'string',
                  enum: ['general', 'coder', 'researcher', 'file_manager', 'tester', 'reviewer'],
                  default: 'general',
                },
              },
              required: ['task'],
            },
          },
          synthesisPrompt: {
            type: 'string',
            description: 'Instructions for how to synthesize the results',
            default: 'Synthesize these results into a clear, organized summary.',
          },
        },
        required: ['tasks'],
      },
      async execute(args) {
        try {
          const result = await subagentManager.delegateWithSynthesis(
            args.tasks,
            args.synthesisPrompt || 'Synthesize these results into a clear, organized summary.'
          );
          
          return {
            success: result.success,
            synthesis: result.synthesis,
            stats: result.stats,
            individualResults: result.individualResults?.map(r => ({
              taskId: r.taskId,
              success: r.success,
              response: r.response?.substring(0, 500),
            })),
            error: result.error,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    },
    {
      name: 'subagent_status',
      description: 'Check the status of subagent tasks and get statistics about subagent usage.',
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Specific task ID to check (optional - omit for all tasks)',
          },
        },
      },
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
