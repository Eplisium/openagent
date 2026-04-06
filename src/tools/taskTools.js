/**
 * 📋 Task Management Tools
 * Tools for planning, tracking, and verifying long-running tasks
 */

// TaskManager and FeatureStatus are used via the taskManager parameter passed to createTaskTools

/**
 * Create task management tools for a given TaskManager
 */
export function createTaskTools(taskManager) {
  return [
    {
      name: 'initialize_task',
      description: `Initialize a new task environment for long-running work. Creates progress tracking files.

Use this ONCE at the start of a new complex task. This sets up:
- Progress tracking file
- Feature list file  
- Session logging

After initialization, use create_feature_list to plan the task.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The main task description. Be detailed about what needs to be accomplished.',
          },
        },
        required: ['task'],
      },
      timeout: 10000,
      async execute(args) {
        try {
          const result = await taskManager.initialize(args.task);
          return {
            success: true,
            message: 'Task environment initialized',
            taskDir: taskManager.taskDir,
            workspaceDir: taskManager.workspaceDir,
            status: result.status || result.progress?.status || 'initialized',
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to initialize task: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'create_feature_list',
      description: `Create a detailed feature list for the current task. Break the task into specific, testable features.

Each feature should be:
- Specific and testable
- Have clear success criteria
- Include verification steps
- Have a priority (1-10, higher = more important)

Use this AFTER initialize_task to plan your approach.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {
          features: {
            type: 'array',
            description: 'Array of feature objects to implement',
            items: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                  description: 'Clear description of what this feature does',
                },
                category: {
                  type: 'string',
                  enum: ['functional', 'ui', 'api', 'database', 'testing', 'documentation', 'infrastructure'],
                  description: 'Feature category',
                  default: 'functional',
                },
                priority: {
                  type: 'number',
                  description: 'Priority 1-10 (higher = more important)',
                  default: 5,
                },
                steps: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Implementation steps for this feature',
                },
                verificationSteps: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Steps to verify this feature works correctly',
                },
                dependencies: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Feature IDs that must be completed first',
                },
              },
              required: ['description'],
            },
          },
        },
        required: ['features'],
      },
      timeout: 15000,
      async execute(args) {
        try {
          const result = await taskManager.createFeatureList(args.features);
          return {
            success: true,
            message: `Created feature list with ${result.features.length} features`,
            features: result.features.map(f => ({
              id: f.id,
              description: f.description,
              priority: f.priority,
              status: f.status,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to create feature list: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'get_next_feature',
      description: `Get the next feature to work on. Returns the highest priority pending feature with satisfied dependencies.

Use this to decide what to work on next. The feature will be marked as "in_progress" automatically.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {},
      },
      timeout: 10000,
      async execute(_args) {
        try {
          const feature = await taskManager.getNextFeature();
          
          if (!feature) {
            return {
              success: true,
              message: 'No pending features found. All features may be complete!',
              feature: null,
            };
          }

          // Mark as in progress
          await taskManager.startFeature(feature.id);
          
          return {
            success: true,
            message: `Starting feature: ${feature.description}`,
            feature: {
              id: feature.id,
              description: feature.description,
              priority: feature.priority,
              steps: feature.steps,
              verificationSteps: feature.verificationSteps,
              attempts: feature.attempts,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to get next feature: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'complete_feature',
      description: `Mark a feature as complete and verified. Only do this AFTER:
1. Implementing the feature
2. Testing it works correctly
3. Verifying no regressions

This will update progress tracking and allow dependent features to start.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {
          featureId: {
            type: 'string',
            description: 'The feature ID to mark as complete',
          },
          verification: {
            type: 'object',
            properties: {
              tested: {
                type: 'boolean',
                description: 'Whether the feature was tested',
              },
              testResults: {
                type: 'string',
                description: 'Results of testing',
              },
              notes: {
                type: 'string',
                description: 'Any additional notes about the implementation',
              },
            },
          },
        },
        required: ['featureId'],
      },
      timeout: 10000,
      async execute(args) {
        try {
          const result = await taskManager.completeFeature(args.featureId, args.verification || {});
          const status = await taskManager.getStatus();
          
          return {
            success: true,
            message: `Feature completed: ${result.description}`,
            progress: {
              completed: status.progress.completed,
              total: status.progress.total,
              percentage: status.progress.percentage,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to complete feature: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'fail_feature',
      description: `Mark a feature as failed. Use this when:
- You've tried multiple approaches and can't make it work
- There's a blocking issue that prevents implementation
- You need to skip this feature and move on

Include a clear error message explaining why it failed.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {
          featureId: {
            type: 'string',
            description: 'The feature ID to mark as failed',
          },
          error: {
            type: 'string',
            description: 'Clear explanation of why the feature failed',
          },
        },
        required: ['featureId', 'error'],
      },
      timeout: 10000,
      async execute(args) {
        try {
          const result = await taskManager.failFeature(args.featureId, args.error);
          return {
            success: true,
            message: `Feature marked as failed: ${result.description}`,
            error: args.error,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to mark feature as failed: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'get_task_status',
      description: `Get the current status of the task including:
- Overall progress (X/Y features complete)
- Current feature being worked on
- Next feature to work on
- Status breakdown (passing/failing/pending)
- Recent session history

Use this to understand where you are in the task.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {},
      },
      timeout: 10000,
      async execute(_args) {
        try {
          const status = await taskManager.getStatus();
          return {
            success: true,
            status,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to get task status: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'get_progress_report',
      description: `Get a formatted progress report showing:
- Task description and status
- Feature completion percentage
- Current and next features
- Full feature list with status icons

Use this to report progress to the user or understand the current state.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {},
      },
      timeout: 10000,
      async execute(_args) {
        try {
          const report = await taskManager.generateProgressReport();
          return {
            success: true,
            report,
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to generate progress report: ${error.message}`,
          };
        }
      },
    },

    {
      name: 'save_session_progress',
      description: `Save current session progress and log what was accomplished.

Call this at the end of a work session to:
- Record what was done
- Update progress tracking
- Prepare for the next session

Always call this before ending a session.`,
      category: 'task',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Summary of what was accomplished this session',
          },
        },
      },
      timeout: 10000,
      async execute(_args) {
        try {
          await taskManager.saveSessionLog();
          return {
            success: true,
            message: 'Session progress saved',
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to save session progress: ${error.message}`,
          };
        }
      },
    },
  ];
}

export default createTaskTools;
