/**
 * 🛠️ Checkpoint Tools
 * Exposes git checkpoint operations as tools for the agent
 */

import { GitCheckpoint } from '../agent/GitCheckpoint.js';
import path from 'path';

/**
 * Create checkpoint tools for the agent
 * @param {Object} options - Tool options
 * @param {string} [options.baseDir=process.cwd()] - Base directory for git operations
 * @returns {Array<Object>} Array of checkpoint tools
 */
export function createCheckpointTools(options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const checkpoint = new GitCheckpoint({ workingDir: baseDir });

  return [
    {
      name: 'checkpoint_save',
      description: 'Save a named checkpoint of the current git repository state. Creates a tagged commit with all changes.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name/label for the checkpoint',
          },
        },
        required: ['name'],
      },
      handler: async (params) => {
        try {
          const result = await checkpoint.createCheckpoint(params.name);
          return {
            success: true,
            message: `Checkpoint "${params.name}" created successfully`,
            checkpoint: result,
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
      name: 'checkpoint_list',
      description: 'List all saved checkpoints in the repository',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const checkpoints = await checkpoint.listCheckpoints();
          if (checkpoints.length === 0) {
            return {
              success: true,
              checkpoints: [],
              message: 'No checkpoints found',
            };
          }
          return {
            success: true,
            checkpoints,
            count: checkpoints.length,
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
      name: 'checkpoint_restore',
      description: 'Restore the repository to a specific checkpoint',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Checkpoint ID to restore to',
          },
        },
        required: ['id'],
      },
      handler: async (params) => {
        try {
          const result = await checkpoint.restoreCheckpoint(params.id);
          return {
            success: true,
            message: `Restored to checkpoint ${params.id}`,
            ...result,
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
      name: 'checkpoint_diff',
      description: 'Show changes between the current state and a checkpoint',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Checkpoint ID to compare against',
          },
        },
        required: ['id'],
      },
      handler: async (params) => {
        try {
          const diff = await checkpoint.getCheckpointDiff(params.id);
          return {
            success: true,
            checkpointId: params.id,
            diff: diff || '(no changes)',
            hasChanges: diff.length > 0,
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
      name: 'checkpoint_delete',
      description: 'Delete a specific checkpoint',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Checkpoint ID to delete',
          },
        },
        required: ['id'],
      },
      handler: async (params) => {
        try {
          const result = await checkpoint.deleteCheckpoint(params.id);
          return {
            success: result,
            message: result ? `Checkpoint ${params.id} deleted` : `Failed to delete checkpoint ${params.id}`,
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
      name: 'checkpoint_status',
      description: 'Get current git repository status',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const status = await checkpoint.getCurrentStatus();
          return {
            success: true,
            ...status,
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
      name: 'checkpoint_is_git',
      description: 'Check if the current directory is a git repository',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const isRepo = await checkpoint.isGitRepo();
          return {
            success: true,
            isGitRepo: isRepo,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    },
  ];
}

export default createCheckpointTools;