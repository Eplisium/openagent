/**
 * 🛠️ Plugin Tools
 * Exposes plugin operations as tools for the agent
 */

import { PluginManager } from '../plugins/PluginManager.js';
import path from 'path';

/**
 * Create plugin tools for the agent
 * @param {Object} options - Tool options
 * @param {string} [options.pluginsDir] - Directory containing plugins
 * @param {boolean} [options.verbose=true] - Enable verbose logging
 * @returns {Array<Object>} Array of plugin tools
 */
export function createPluginTools(options = {}) {
  const pluginsDir = options.pluginsDir || path.join(process.cwd(), 'plugins');
  const manager = new PluginManager({
    pluginsDir,
    verbose: options.verbose,
  });

  return [
    {
      name: 'plugin_list',
      description: 'List all installed/loaded plugins',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const plugins = manager.listPlugins();
          return {
            success: true,
            plugins,
            count: plugins.length,
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
      name: 'plugin_info',
      description: 'Get detailed information about a specific plugin',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the plugin',
          },
        },
        required: ['name'],
      },
      handler: async (params) => {
        try {
          const plugin = manager.getPlugin(params.name);
          if (!plugin) {
            // Try to get info without loading
            const discovered = await manager.discoverPlugins();
            const info = discovered.find(p => p.name === params.name);
            if (info) {
              return {
                success: true,
                loaded: false,
                ...info,
              };
            }
            return {
              success: false,
              error: `Plugin "${params.name}" not found`,
            };
          }
          return {
            success: true,
            loaded: true,
            info: plugin.getInfo(),
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
      name: 'plugin_reload',
      description: 'Hot-reload a plugin (unload and reload)',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the plugin to reload',
          },
        },
        required: ['name'],
      },
      handler: async (params) => {
        try {
          const result = await manager.reloadPlugin(params.name);
          return {
            success: result,
            message: result 
              ? `Plugin "${params.name}" reloaded successfully`
              : `Plugin "${params.name}" not found or failed to reload`,
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
      name: 'plugin_load',
      description: 'Load a specific plugin',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the plugin to load',
          },
        },
        required: ['name'],
      },
      handler: async (params) => {
        try {
          // Discover plugins first
          const discovered = await manager.discoverPlugins();
          const info = discovered.find(p => p.name === params.name);
          
          if (!info) {
            return {
              success: false,
              error: `Plugin "${params.name}" not found in ${pluginsDir}`,
            };
          }

          const plugin = await manager.loadPlugin(info.path);
          return {
            success: true,
            message: `Plugin "${params.name}" loaded successfully`,
            info: plugin.getInfo(),
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
      name: 'plugin_unload',
      description: 'Unload a specific plugin',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the plugin to unload',
          },
        },
        required: ['name'],
      },
      handler: async (params) => {
        try {
          const result = await manager.unloadPlugin(params.name);
          return {
            success: result,
            message: result 
              ? `Plugin "${params.name}" unloaded successfully`
              : `Plugin "${params.name}" not loaded`,
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
      name: 'plugin_discover',
      description: 'Discover available plugins in the plugins directory',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const plugins = await manager.discoverPlugins();
          return {
            success: true,
            plugins,
            count: plugins.length,
            pluginsDir,
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

export default createPluginTools;