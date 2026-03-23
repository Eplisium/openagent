/**
 * 📋 Plugin Manifest Validation
 * Validates plugin.json structure
 */

const REQUIRED_FIELDS = ['name', 'version', 'description'];
const OPTIONAL_FIELDS = ['author', 'license', 'main', 'tools', 'hooks', 'dependencies'];

/**
 * Validates a plugin manifest structure
 * @param {Object} manifest - The plugin manifest to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateManifest(manifest) {
  const errors = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!manifest[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate name
  if (manifest.name) {
    if (typeof manifest.name !== 'string') {
      errors.push('Field "name" must be a string');
    } else if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      errors.push('Field "name" must be lowercase alphanumeric with hyphens only');
    }
  }

  // Validate version
  if (manifest.version) {
    if (typeof manifest.version !== 'string') {
      errors.push('Field "version" must be a string');
    } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push('Field "version" must be in semver format (x.y.z)');
    }
  }

  // Validate description
  if (manifest.description && typeof manifest.description !== 'string') {
    errors.push('Field "description" must be a string');
  }

  // Validate author
  if (manifest.author && typeof manifest.author !== 'string') {
    errors.push('Field "author" must be a string');
  }

  // Validate license
  if (manifest.license && typeof manifest.license !== 'string') {
    errors.push('Field "license" must be a string');
  }

  // Validate main
  if (manifest.main && typeof manifest.main !== 'string') {
    errors.push('Field "main" must be a string');
  }

  // Validate tools
  if (manifest.tools) {
    if (!Array.isArray(manifest.tools)) {
      errors.push('Field "tools" must be an array');
    } else {
      for (let i = 0; i < manifest.tools.length; i++) {
        const tool = manifest.tools[i];
        if (typeof tool !== 'object') {
          errors.push(`Field "tools[${i}]" must be an object`);
        } else if (!tool.name) {
          errors.push(`Field "tools[${i}]" missing required "name"`);
        }
      }
    }
  }

  // Validate hooks
  if (manifest.hooks) {
    if (typeof manifest.hooks !== 'object') {
      errors.push('Field "hooks" must be an object');
    } else {
      for (const [hookName, handler] of Object.entries(manifest.hooks)) {
        if (typeof handler !== 'function' && !Array.isArray(handler)) {
          errors.push(`Field "hooks.${hookName}" must be a function or array of functions`);
        }
      }
    }
  }

  // Validate dependencies
  if (manifest.dependencies) {
    if (!Array.isArray(manifest.dependencies)) {
      errors.push('Field "dependencies" must be an array');
    } else {
      for (let i = 0; i < manifest.dependencies.length; i++) {
        if (typeof manifest.dependencies[i] !== 'string') {
          errors.push(`Field "dependencies[${i}]" must be a string (plugin name)`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a template plugin manifest
 * @returns {Object}
 */
export function createManifestTemplate() {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    description: 'My awesome OpenAgent plugin',
    author: 'Your Name',
    license: 'MIT',
    main: 'index.js',
    tools: [],
    hooks: {},
    dependencies: [],
  };
}

export default validateManifest;