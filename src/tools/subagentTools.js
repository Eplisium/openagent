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

CRITICAL: Be VERY specific in your task description. ALWAYS include exact file paths (e.g., 'Shopify Template/index.html', not just 'index.html'). The subagent starts blind — it does NOT have your context. Include: file paths, function names, what to change, and exact requirements.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Detailed task description. ALWAYS include exact file paths with project: prefix or relative paths. Example: "Read project:src/index.html and add a footer section before the closing </body> tag." The subagent starts without context — give it everything it needs.',
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
            stopReason: result.stopReason,
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

CRITICAL: Include exact file paths in every task description. Subagents start blind.

Example tasks array:
[
  { "task": "Read project:src/auth.js and analyze for security issues", "specialization": "reviewer" },
  { "task": "Read project:src/utils.js and write unit tests in project:tests/utils.test.js", "specialization": "tester" },
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
                  description: 'Detailed task description. ALWAYS include exact file paths (project: prefix or relative). Subagents start without your context.',
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
            success: failed.length === 0,
            partial: successful.length > 0 && failed.length > 0,
            results: results.map(r => ({
              taskId: r.taskId,
              success: r.success,
              specialization: r.specialization,
              response: r.response,
              duration: r.duration,
              iterations: r.iterations,
              error: r.error,
              stopReason: r.stopReason,
            })),
            summary: {
              total: results.length,
              successful: successful.length,
              failed: failed.length,
              totalDuration: results.length > 0 ? Math.max(...results.map(r => r.duration || 0)) : 0,
            },
            ...(failed.length > 0
              ? { error: `${failed.length} delegated task${failed.length === 1 ? '' : 's'} failed or stopped early.` }
              : {}),
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
      name: 'delegate_background',
      description: `Fire-and-forget delegation: start a subagent task and return IMMEDIATELY with a task ID.

Best for:
- Starting long-running tasks (research, test suites, builds) while you keep working
- Parallel work where you don't need results right away
- Multi-task scenarios: start 3-4 tasks, do other work, then collect results

The subagent runs in the background. Use get_background_result or await_background to collect results later.

CRITICAL: Include exact file paths in task descriptions. Subagents start blind.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Detailed task description with exact file paths (project: prefix or relative).',
          },
          specialization: {
            type: 'string',
            enum: ['general', 'coder', 'architect', 'researcher', 'file_manager', 'tester', 'reviewer'],
            default: 'general',
          },
        },
        required: ['task'],
      },
      timeout: 5000, // Returns immediately
      async execute(args) {
        try {
          const result = subagentManager.delegateBackground(args.task, {
            specialization: args.specialization || 'general',
          });
          return { success: true, ...result };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'get_background_result',
      description: 'Check the status/result of a background subagent task. Returns immediately — does NOT wait. Use this to poll for results while doing other work.',
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'The task ID returned from delegate_background.',
          },
        },
        required: ['taskId'],
      },
      timeout: 5000,
      async execute(args) {
        try {
          return { success: true, ...subagentManager.getBackgroundResult(args.taskId) };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'await_background',
      description: 'Wait for a background subagent task to complete and return its full result. Blocks until done or timeout.',
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'The task ID returned from delegate_background.',
          },
          timeoutMs: {
            type: 'number',
            description: 'Max wait time in ms. Default: 600000 (10 min).',
            default: 600000,
          },
        },
        required: ['taskId'],
      },
      timeout: 600000,
      async execute(args) {
        try {
          const result = await subagentManager.awaitBackground(args.taskId, args.timeoutMs);
          return { success: result.success !== false, ...result };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'delegate_fanout',
      description: `Fan-out a large coding task into parallel subagents, each working on different files.

Best for:
- Refactoring across multiple files (each file gets its own coder)
- Adding a feature that touches many files (split by component/module)
- Large-scale changes (rename, API migration, style updates)

You provide file groups — each group gets its own coder subagent.
All groups run in parallel. Results are aggregated.

Example:
[
  { "files": ["src/auth.js", "src/middleware.js"], "description": "Add JWT validation middleware" },
  { "files": ["src/routes/api.js"], "description": "Update API routes to use new auth" },
  { "files": ["tests/auth.test.js"], "description": "Write tests for new auth flow" }
]`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Overall task description that provides context for all subagents.',
          },
          fileGroups: {
            type: 'array',
            description: 'Array of file groups. Each group gets its own parallel subagent.',
            items: {
              type: 'object',
              properties: {
                files: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'File paths this subagent should modify (project: prefix or relative).',
                },
                description: {
                  type: 'string',
                  description: 'What this subagent should do with these files.',
                },
                specialization: {
                  type: 'string',
                  enum: ['general', 'coder', 'architect', 'researcher', 'file_manager', 'tester', 'reviewer'],
                  default: 'coder',
                },
              },
              required: ['files', 'description'],
            },
          },
          maxConcurrent: {
            type: 'number',
            description: 'Max subagents to run at once. Default: 3.',
            default: 3,
          },
        },
        required: ['task', 'fileGroups'],
      },
      timeout: 600000,
      async execute(args) {
        try {
          const result = await subagentManager.delegateFanout(
            args.task,
            args.fileGroups,
            { maxConcurrent: args.maxConcurrent || 3 }
          );
          return result;
        } catch (error) {
          return { success: false, error: `Fan-out failed: ${error.message}` };
        }
      },
    },

    {
      name: 'list_background_tasks',
      description: 'List all background (fire-and-forget) subagent tasks and their current status. Use this to see what\'s running in the background.',
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {},
      },
      timeout: 5000,
      async execute() {
        try {
          return { success: true, tasks: subagentManager.listBackgroundTasks() };
        } catch (error) {
          return { success: false, error: error.message };
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

    {
      name: 'send_subagent_message',
      description: `Send a message to a subagent's message queue. Messages persist even after the subagent completes, enabling post-completion communication between the parent agent and subagents.

Use cases:
- Send follow-up instructions to a completed subagent's results
- Share context between sequential subagent tasks
- Notify a subagent of changes made by other subagents`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          subagentId: {
            type: 'string',
            description: 'The task ID of the target subagent (returned from delegate_task or subagent_status).',
          },
          message: {
            type: 'string',
            description: 'The message content to send.',
          },
        },
        required: ['subagentId', 'message'],
      },
      timeout: 5000,
      async execute(args) {
        try {
          const result = subagentManager.sendMessage(args.subagentId, args.message);
          return { success: true, ...result };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'get_subagent_messages',
      description: `Retrieve and clear all pending messages for a subagent. Returns messages that were sent to this subagent's task ID via send_subagent_message.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          subagentId: {
            type: 'string',
            description: 'The task ID of the subagent to retrieve messages for.',
          },
        },
        required: ['subagentId'],
      },
      timeout: 5000,
      async execute(args) {
        try {
          const messages = subagentManager.receiveMessages(args.subagentId);
          return { success: true, messages, count: messages.length };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'set_shared_context',
      description: `Set a shared context value accessible by all subagents. Use this to share data (analysis results, file lists, configurations) between subagents without direct messaging.

Examples:
- set_shared_context({ key: "target_files", value: ["src/auth.js", "src/middleware.js"] })
- set_shared_context({ key: "review_findings", value: { critical: 2, warnings: 5 } })`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The context key. Use descriptive names like "analysis_results" or "target_files".',
          },
          value: {
            description: 'The value to store (string, number, object, or array). Must be JSON-serializable.',
          },
        },
        required: ['key', 'value'],
      },
      timeout: 5000,
      async execute(args) {
        try {
          subagentManager.setSharedContext(args.key, args.value);
          return { success: true, key: args.key };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'get_shared_context',
      description: `Get a shared context value by key, or retrieve all shared context if no key is specified.`,
      category: 'subagent',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The context key to retrieve. Omit to get all shared context as an object.',
          },
        },
      },
      timeout: 5000,
      async execute(args) {
        try {
          if (args.key) {
            const value = subagentManager.getSharedContext(args.key);
            return { success: true, key: args.key, value, found: value !== undefined };
          } else {
            const allContext = subagentManager.getAllSharedContext();
            return { success: true, context: allContext, keys: Object.keys(allContext) };
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },
  ];
}

export default createSubagentTools;
