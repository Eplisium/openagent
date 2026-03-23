/**
 * 🔌 Base Plugin Class
 * Base class for all OpenAgent plugins
 */

/**
 * Base plugin class that all plugins should extend
 */
export class Plugin {
  /**
   * @param {Object} manifest - Plugin manifest object
   * @param {Object} context - Plugin context
   * @param {string} context.pluginPath - Path to the plugin directory
   * @param {PluginManager} context.manager - Reference to the plugin manager
   */
  constructor(manifest, context = {}) {
    this.name = manifest.name;
    this.version = manifest.version;
    this.description = manifest.description;
    this.author = manifest.author;
    this.license = manifest.license;
    this.main = manifest.main;
    this.tools = manifest.tools || [];
    this.hooks = manifest.hooks || {};
    this.dependencies = manifest.dependencies || [];
    
    // Context
    this.pluginPath = context.pluginPath || '';
    this.manager = context.manager || null;
    
    // Internal state
    this._initialized = false;
    this._enabled = true;
  }

  /**
   * Initialize the plugin
   * Called when the plugin is loaded
   * @returns {Promise<void>}
   */
  async initialize() {
    this._initialized = true;
  }

  /**
   * Cleanup the plugin
   * Called when the plugin is unloaded
   * @returns {Promise<void>}
   */
  async cleanup() {
    this._initialized = false;
  }

  /**
   * Enable the plugin
   */
  enable() {
    this._enabled = true;
  }

  /**
   * Disable the plugin
   */
  disable() {
    this._enabled = false;
  }

  /**
   * Check if the plugin is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * Check if the plugin is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * Get a configuration value
   * @param {string} key - Configuration key
   * @param {any} defaultValue - Default value if key not found
   * @returns {any}
   */
  getConfig(key, defaultValue = null) {
    if (!this.manager) return defaultValue;
    const config = this.manager.pluginConfigs?.get(this.name);
    return config?.[key] ?? defaultValue;
  }

  /**
   * Register a tool with the agent
   * @param {Object} tool - Tool definition
   */
  registerTool(tool) {
    if (this.manager && this.manager.toolRegistry) {
      this.manager.toolRegistry.register(tool);
    }
  }

  /**
   * Register multiple tools
   * @param {Array<Object>} tools - Array of tool definitions
   */
  registerTools(tools) {
    if (this.manager && this.manager.toolRegistry) {
      this.manager.toolRegistry.registerAll(tools);
    }
  }

  /**
   * Emit a hook to the manager
   * @param {string} hookName - Name of the hook
   * @param {...any} args - Arguments to pass
   * @returns {Promise<Array>}
   */
  async emitHook(hookName, ...args) {
    if (this.manager) {
      return this.manager.runHook(hookName, ...args);
    }
    return [];
  }

  /**
   * Get the path to a file in the plugin directory
   * @param {string} filename - Filename relative to plugin root
   * @returns {string}
   */
  getPath(filename = '') {
    return this.pluginPath ? require('path').join(this.pluginPath, filename) : '';
  }

  /**
   * Get info about the plugin
   * @returns {Object}
   */
  getInfo() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      license: this.license,
      enabled: this._enabled,
      initialized: this._initialized,
    };
  }
}

export default Plugin;