/**
 * 📦 Plugin Manager
 * Central plugin manager for OpenAgent
 */

import fs from 'fs-extra';
import path from 'path';
import { validateManifest } from './PluginManifest.js';
// Plugin import removed — not directly used

/**
 * Central plugin manager for OpenAgent
 * Handles plugin discovery, loading, unloading, and hook execution
 */
export class PluginManager {
  /**
   * @param {Object} options - Configuration options
   * @param {string} [options.pluginsDir] - Directory containing plugins
   * @param {boolean} [options.verbose=true] - Enable verbose logging
   */
  constructor(options = {}) {
    this.pluginsDir = options.pluginsDir || path.join(process.cwd(), 'plugins');
    this.verbose = options.verbose !== false;
    this.loadedPlugins = new Map(); // name -> Plugin instance
    this.hooks = new Map(); // hookName -> [callback]
    this.pluginInfo = new Map(); // name -> plugin metadata
  }

  /**
   * Log a message if verbose mode is enabled
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.verbose) {
      console.log(`[PluginManager] ${message}`);
    }
  }

  /**
   * Discover all plugins in the plugins directory
   * @returns {Promise<Array<{name: string, path: string, manifest: object}>>}
   */
  async discoverPlugins() {
    const plugins = [];

    // Check if plugins directory exists
    if (!await fs.pathExists(this.pluginsDir)) {
      this._log(`Plugins directory does not exist: ${this.pluginsDir}`);
      return plugins;
    }

    // Read all directories in plugins folder
    const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const pluginPath = path.join(this.pluginsDir, entry.name);
      const manifestPath = path.join(pluginPath, 'plugin.json');
      
      // Check if plugin has a manifest
      if (!await fs.pathExists(manifestPath)) {
        this._log(`Skipping ${entry.name}: no plugin.json found`);
        continue;
      }

      try {
        const manifest = await fs.readJson(manifestPath);
        const validation = validateManifest(manifest);
        
        if (!validation.valid) {
          this._log(`Skipping ${entry.name}: invalid manifest - ${validation.errors.join(', ')}`);
          continue;
        }

        plugins.push({
          name: manifest.name,
          path: pluginPath,
          manifest,
        });
      } catch (error) {
        this._log(`Error loading plugin ${entry.name}: ${error.message}`);
      }
    }

    return plugins;
  }

  /**
   * Load a single plugin from a path
   * @param {string} pluginPath - Path to the plugin directory
   * @returns {Promise<Plugin|null>}
   */
  async loadPlugin(pluginPath) {
    const manifestPath = path.join(pluginPath, 'plugin.json');
    
    if (!await fs.pathExists(manifestPath)) {
      throw new Error(`No plugin.json found at ${manifestPath}`);
    }

    // Read and validate manifest
    const manifest = await fs.readJson(manifestPath);
    const validation = validateManifest(manifest);
    
    if (!validation.valid) {
      throw new Error(`Invalid plugin manifest: ${validation.errors.join(', ')}`);
    }

    // Check for dependencies
    if (manifest.dependencies && manifest.dependencies.length > 0) {
      for (const dep of manifest.dependencies) {
        if (!this.loadedPlugins.has(dep)) {
          throw new Error(`Missing dependency: ${dep}`);
        }
      }
    }

    // Load the main plugin file
    const mainFile = manifest.main || 'index.js';
    const mainPath = path.join(pluginPath, mainFile);
    
    if (!await fs.pathExists(mainPath)) {
      throw new Error(`Main file not found: ${mainPath}`);
    }

    // Import the plugin module
    let pluginModule;
    try {
      pluginModule = await import(`file://${mainPath}`);
    } catch (error) {
      throw new Error(`Failed to load plugin: ${error.message}`);
    }

    // Create plugin instance
    const PluginClass = pluginModule.default || pluginModule;
    const plugin = new PluginClass(manifest, { 
      pluginPath,
      manager: this,
    });

    // Initialize plugin
    if (typeof plugin.initialize === 'function') {
      await plugin.initialize();
    }

    // Register plugin tools
    if (plugin.tools && Array.isArray(plugin.tools)) {
      this._log(`Registering ${plugin.tools.length} tools from ${manifest.name}`);
    }

    // Register plugin hooks
    if (plugin.hooks && typeof plugin.hooks === 'object') {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        this.registerHook(hookName, handler.bind(plugin));
      }
    }

    // Store plugin
    this.loadedPlugins.set(manifest.name, plugin);
    this.pluginInfo.set(manifest.name, {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      path: pluginPath,
      manifest,
    });

    this._log(`Loaded plugin: ${manifest.name} v${manifest.version}`);
    
    return plugin;
  }

  /**
   * Unload a plugin by name
   * @param {string} name - Plugin name
   * @returns {Promise<boolean>}
   */
  async unloadPlugin(name) {
    const plugin = this.loadedPlugins.get(name);
    if (!plugin) {
      return false;
    }

    // Call plugin cleanup
    if (typeof plugin.cleanup === 'function') {
      await plugin.cleanup();
    }

    // Remove hooks registered by this plugin
    for (const [hookName, callbacks] of this.hooks.entries()) {
      this.hooks.set(
        hookName,
        callbacks.filter(cb => cb.pluginName !== name)
      );
    }

    this.loadedPlugins.delete(name);
    this.pluginInfo.delete(name);
    
    this._log(`Unloaded plugin: ${name}`);
    return true;
  }

  /**
   * Load all discovered plugins
   * @returns {Promise<void>}
   */
  async loadAll() {
    const plugins = await this.discoverPlugins();
    
    // Build dependency graph and sort
    const sorted = this._resolveDependencies(plugins);
    
    for (const pluginInfo of sorted) {
      try {
        await this.loadPlugin(pluginInfo.path);
      } catch (error) {
        this._log(`Failed to load ${pluginInfo.name}: ${error.message}`);
      }
    }
  }

  /**
   * Resolve plugin loading order based on dependencies
   * @param {Array} plugins - Array of plugin info objects
   * @returns {Array} Sorted array
   * @private
   */
  _resolveDependencies(plugins) {
    const loaded = new Set();
    const result = [];
    
    const addPlugin = (plugin) => {
      if (loaded.has(plugin.name)) return;
      loaded.add(plugin.name);
      
      // Load dependencies first
      if (plugin.manifest.dependencies) {
        for (const depName of plugin.manifest.dependencies) {
          const dep = plugins.find(p => p.name === depName);
          if (dep) addPlugin(dep);
        }
      }
      
      result.push(plugin);
    };
    
    for (const plugin of plugins) {
      addPlugin(plugin);
    }
    
    return result;
  }

  /**
   * Get a loaded plugin by name
   * @param {string} name - Plugin name
   * @returns {Plugin|undefined}
   */
  getPlugin(name) {
    return this.loadedPlugins.get(name);
  }

  /**
   * List all loaded plugins
   * @returns {Array<{name: string, version: string, description: string, path: string}>}
   */
  listPlugins() {
    return Array.from(this.pluginInfo.values()).map(info => ({
      name: info.name,
      version: info.version,
      description: info.description,
      path: info.path,
    }));
  }

  /**
   * Register a hook callback
   * @param {string} hookName - Name of the hook
   * @param {Function} callback - Callback function
   */
  registerHook(hookName, callback) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    this.hooks.get(hookName).push(callback);
  }

  /**
   * Run all callbacks for a specific hook
   * @param {string} hookName - Name of the hook
   * @param {...any} args - Arguments to pass to callbacks
   * @returns {Promise<Array>} Results from all callbacks
   */
  async runHook(hookName, ...args) {
    const callbacks = this.hooks.get(hookName) || [];
    const results = [];
    
    for (const callback of callbacks) {
      try {
        const result = await callback(...args);
        results.push({ success: true, result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Reload a plugin (unload and load again)
   * @param {string} name - Plugin name
   * @returns {Promise<boolean>}
   */
  async reloadPlugin(name) {
    const info = this.pluginInfo.get(name);
    if (!info) {
      return false;
    }

    await this.unloadPlugin(name);
    await this.loadPlugin(info.path);
    return true;
  }
}

export default PluginManager;