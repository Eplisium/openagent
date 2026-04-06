/**
 * 🎯 Enhanced Skill Parser
 * Advanced YAML frontmatter parsing with hooks, compatibility markers, and dependencies
 * 
 * Features:
 * - Extended YAML frontmatter support
 * - Hook definitions (pre/post task execution)
 * - Compatibility markers (OS, Node version, etc.)
 * - Dependency resolution
 * - Resource file handling
 * - Example usage blocks
 */

import fs from 'fs-extra';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

const SKILL_FILE = 'SKILL.md';
const REFERENCE_FILES = ['REFERENCE.md', 'GUIDE.md', 'EXAMPLES.md', 'API.md'];
const HOOK_TYPES = ['pre-task', 'post-task', 'pre-tool', 'post-tool', 'on-error'];
const COMPATIBILITY_FIELDS = ['os', 'node', 'arch', 'platform', 'requires'];

// ═══════════════════════════════════════════════════════════════════
// 🎯 Enhanced Skill Class
// ═══════════════════════════════════════════════════════════════════

export class EnhancedSkill {
  constructor(options = {}) {
    this.name = options.name || 'unnamed';
    this.description = options.description || '';
    this.version = options.version || '1.0.0';
    this.author = options.author || '';
    this.license = options.license || 'MIT';
    this.tags = options.tags || [];
    this.triggers = options.triggers || [];
    this.keywords = options.keywords || [];
    this.instructions = options.instructions || '';
    this.references = options.references || [];
    this.scripts = options.scripts || [];
    this.resources = options.resources || [];
    this.hooks = options.hooks || {};
    this.compatibility = options.compatibility || {};
    this.dependencies = options.dependencies || [];
    this.examples = options.examples || [];
    this.metadata = options.metadata || {};
    this.dirPath = options.dirPath || '';
    this.source = options.source || 'project';
  }

  /**
   * Get metadata summary for LLM context
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      author: this.author,
      tags: this.tags,
      triggers: this.triggers,
      keywords: this.keywords,
      source: this.source,
      compatibility: this.compatibility,
      dependencies: this.dependencies.length,
    };
  }

  /**
   * Get hook definitions
   */
  getHooks() {
    return this.hooks;
  }

  /**
   * Check if skill is compatible with current environment
   */
  isCompatible() {
    const { compatibility } = this;
    
    if (compatibility.os && compatibility.os.length > 0) {
      const currentOS = process.platform;
      const isCompatible = compatibility.os.some(os => {
        if (os === 'linux') return currentOS === 'linux';
        if (os === 'macos') return currentOS === 'darwin';
        if (os === 'windows') return currentOS === 'win32';
        return false;
      });
      if (!isCompatible) return false;
    }
    
    if (compatibility.node) {
      const currentVersion = process.version;
      // Simple semver check
      if (compatibility.node.startsWith('>=')) {
        const required = compatibility.node.substring(2);
        if (this.compareVersions(currentVersion, required) < 0) return false;
      } else if (compatibility.node.startsWith('<')) {
        const required = compatibility.node.substring(1);
        if (this.compareVersions(currentVersion, required) >= 0) return false;
      }
    }
    
    return true;
  }

  /**
   * Compare version strings
   */
  compareVersions(v1, v2) {
    const parts1 = v1.replace(/^v/, '').split('.').map(Number);
    const parts2 = v2.replace(/^v/, '').split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      if (part1 !== part2) return part1 - part2;
    }
    return 0;
  }

  /**
   * Check if dependencies are satisfied
   */
  checkDependencies(installedSkills = []) {
    const missing = [];
    
    for (const dep of this.dependencies) {
      const depName = typeof dep === 'string' ? dep : dep.name;
      const installed = installedSkills.some(skill => skill.name === depName);
      if (!installed) {
        missing.push(depName);
      }
    }
    
    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * List available scripts in skill
   */
  async listScripts() {
    const scriptsDir = path.join(this.dirPath, 'scripts');
    if (!await fs.pathExists(scriptsDir)) {
      return [];
    }
    
    const files = await fs.readdir(scriptsDir);
    return files.map(file => ({
      name: file,
      path: path.join(scriptsDir, file),
      executable: true,
      hook: this.getHookForScript(file),
    }));
  }

  /**
   * Get hook definition for a script
   */
  getHookForScript(scriptName) {
    for (const [hookType, hookDef] of Object.entries(this.hooks)) {
      if (typeof hookDef === 'string' && hookDef === scriptName) {
        return hookType;
      } else if (Array.isArray(hookDef) && hookDef.includes(scriptName)) {
        return hookType;
      }
    }
    return null;
  }

  /**
   * Get examples
   */
  getExamples() {
    return this.examples;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 Enhanced Skill Parser
// ═══════════════════════════════════════════════════════════════════

export class EnhancedSkillParser {
  constructor(options = {}) {
    this.verbose = options.verbose !== false;
  }

  /**
   * Parse YAML frontmatter with advanced features
   * @param {string} content - Full file content
   * @returns {{ frontmatter: object, body: string }}
   */
  parseFrontmatter(content) {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: {}, body: content };
    }

    const yamlContent = match[1];
    const body = match[2].trim();
    
    try {
      const frontmatter = this.parseYAML(yamlContent);
      return { frontmatter, body };
    } catch (error) {
      console.error(`Failed to parse YAML frontmatter: ${error.message}`);
      return { frontmatter: {}, body };
    }
  }

  /**
   * Simple YAML parser with support for common constructs
   * @param {string} yaml - YAML content
   * @returns {object} Parsed object
   */
  parseYAML(yaml) {
    const result = {};
    const lines = yaml.split('\n');
    let currentKey = null;
    let currentValue = '';
    let inArray = false;
    let arrayItems = [];
    const _inObject = false;
    const _objectKey = null;
    const _objectValue = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Check for array items
      if (trimmed.startsWith('- ')) {
        if (currentKey && !inArray) {
          inArray = true;
          arrayItems = [];
        }
        
        if (inArray) {
          const item = trimmed.substring(2);
          // Check if it's a simple item or key-value
          if (item.includes(': ')) {
            const [key, value] = item.split(': ', 2);
            arrayItems.push({ [key]: this.parseValue(value) });
          } else {
            arrayItems.push(this.parseValue(item));
          }
          continue;
        }
      }
      
      // Check for key-value pairs
      const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kvMatch) {
        // Save previous key if exists
        if (currentKey && !inArray) {
          result[currentKey] = this.parseValue(currentValue);
          currentValue = '';
        }
        
        // Handle array closure
        if (inArray && currentKey) {
          result[currentKey] = arrayItems;
          inArray = false;
          arrayItems = [];
        }
        
        currentKey = kvMatch[1];
        currentValue = kvMatch[2];
        
        // Check if value is empty (might be a block)
        if (!currentValue || currentValue === '>' || currentValue === '|') {
          // Read indented lines as block
          let blockContent = '';
          i++;
          while (i < lines.length && (lines[i].startsWith('  ') || lines[i].startsWith('\t') || lines[i] === '')) {
            if (lines[i] !== '') {
              blockContent += (blockContent ? '\n' : '') + lines[i].trim();
            }
            i++;
          }
          i--; // Adjust for loop increment
          
          if (currentValue === '>') {
            // Folded block
            result[currentKey] = blockContent.replace(/\n/g, ' ').trim();
          } else if (currentValue === '|') {
            // Literal block
            result[currentKey] = blockContent;
          } else {
            result[currentKey] = blockContent;
          }
          currentKey = null;
          currentValue = '';
        } else if (currentValue.startsWith('[') && currentValue.endsWith(']')) {
          // Inline array
          result[currentKey] = this.parseArray(currentValue);
          currentKey = null;
          currentValue = '';
        }
        continue;
      }
      
      // Continuation of multiline value
      if (currentKey && trimmed) {
        currentValue += (currentValue ? ' ' : '') + trimmed;
      }
    }
    
    // Save last key
    if (currentKey) {
      if (inArray) {
        result[currentKey] = arrayItems;
      } else {
        result[currentKey] = this.parseValue(currentValue);
      }
    }
    
    return result;
  }

  /**
   * Parse inline array
   */
  parseArray(arrayStr) {
    const content = arrayStr.slice(1, -1).trim();
    if (!content) return [];
    
    // Split by comma, respecting quotes
    const items = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      
      if ((char === '"' || char === "'") && (i === 0 || content[i-1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = null;
        }
        current += char;
      } else if (char === ',' && !inQuotes) {
        items.push(this.parseValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      items.push(this.parseValue(current.trim()));
    }
    
    return items;
  }

  /**
   * Parse YAML value
   */
  parseValue(value) {
    if (!value) return '';
    
    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    
    // Number
    if (!isNaN(value) && !isNaN(parseFloat(value))) {
      return parseFloat(value);
    }
    
    // String
    return value;
  }

  /**
   * Parse hooks section from frontmatter
   */
  parseHooks(hooksData) {
    const hooks = {};
    
    if (typeof hooksData === 'object' && hooksData !== null) {
      for (const [hookType, hookDef] of Object.entries(hooksData)) {
        if (HOOK_TYPES.includes(hookType)) {
          hooks[hookType] = hookDef;
        }
      }
    }
    
    return hooks;
  }

  /**
   * Parse compatibility section
   */
  parseCompatibility(compatData) {
    const compatibility = {};
    
    if (typeof compatData === 'object' && compatData !== null) {
      for (const [key, value] of Object.entries(compatData)) {
        if (COMPATIBILITY_FIELDS.includes(key)) {
          compatibility[key] = value;
        }
      }
    }
    
    return compatibility;
  }

  /**
   * Parse dependencies section
   */
  parseDependencies(depsData) {
    if (Array.isArray(depsData)) {
      return depsData.map(dep => {
        if (typeof dep === 'string') {
          return { name: dep, version: 'latest' };
        } else if (typeof dep === 'object' && dep.name) {
          return {
            name: dep.name,
            version: dep.version || 'latest',
            optional: dep.optional || false,
          };
        }
        return null;
      }).filter(Boolean);
    }
    return [];
  }

  /**
   * Parse examples from body content
   */
  parseExamples(body) {
    const examples = [];
    const exampleRegex = /```example\s*\n([\s\S]*?)```/g;
    let match;
    
    while ((match = exampleRegex.exec(body)) !== null) {
      examples.push(match[1].trim());
    }
    
    // Also look for ## Examples section
    const examplesSection = body.match(/##\s*Examples\s*\n([\s\S]*?)(?=##|$)/);
    if (examplesSection) {
      const content = examplesSection[1].trim();
      if (content) {
        examples.push(content);
      }
    }
    
    return examples;
  }

  /**
   * Extract resources from frontmatter and body
   */
  extractResources(frontmatter, body, _skillDir) {
    const resources = [];
    
    // From frontmatter
    if (frontmatter.resources && Array.isArray(frontmatter.resources)) {
      for (const resource of frontmatter.resources) {
        resources.push({
          name: resource.name || path.basename(resource.path || resource),
          path: resource.path || resource,
          type: resource.type || 'file',
        });
      }
    }
    
    // From body - look for resource references
    const resourceRefs = body.match(/@resource\s+([\w.-]+)/g) || [];
    for (const ref of resourceRefs) {
      const resourceName = ref.replace('@resource', '').trim();
      resources.push({
        name: resourceName,
        path: resourceName,
        type: 'reference',
      });
    }
    
    return resources;
  }

  /**
   * Load and parse an enhanced skill
   */
  async loadEnhancedSkill(skillDir, source = 'project') {
    const skillFile = path.join(skillDir, SKILL_FILE);
    
    if (!await fs.pathExists(skillFile)) {
      return null;
    }

    try {
      const content = await fs.readFile(skillFile, 'utf-8');
      const { frontmatter, body } = this.parseFrontmatter(content);
      
      // Find reference files
      const references = [];
      for (const ref of REFERENCE_FILES) {
        const refPath = path.join(skillDir, ref);
        if (await fs.pathExists(refPath)) {
          references.push({
            name: ref,
            path: refPath,
            size: (await fs.stat(refPath)).size,
          });
        }
      }

      // Find scripts
      const scripts = [];
      const scriptsDir = path.join(skillDir, 'scripts');
      if (await fs.pathExists(scriptsDir)) {
        const files = await fs.readdir(scriptsDir);
        for (const file of files) {
          scripts.push({
            name: file,
            path: path.join(scriptsDir, file),
            executable: true,
          });
        }
      }

      // Parse enhanced fields
      const hooks = this.parseHooks(frontmatter.hooks);
      const compatibility = this.parseCompatibility(frontmatter.compatibility);
      const dependencies = this.parseDependencies(frontmatter.dependencies);
      const examples = this.parseExamples(body);
      const resources = this.extractResources(frontmatter, body, skillDir);

      const skillName = frontmatter.name || path.basename(skillDir);

      return new EnhancedSkill({
        name: skillName,
        description: frontmatter.description || '',
        version: frontmatter.version || '1.0.0',
        author: frontmatter.author || '',
        license: frontmatter.license || 'MIT',
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        triggers: Array.isArray(frontmatter.triggers) ? frontmatter.triggers : [],
        keywords: Array.isArray(frontmatter.keywords) ? frontmatter.keywords : [],
        instructions: body,
        references,
        scripts,
        resources,
        hooks,
        compatibility,
        dependencies,
        examples,
        metadata: frontmatter,
        dirPath: skillDir,
        source,
      });
    } catch (err) {
      if (this.verbose) {
        console.error(`Failed to load enhanced skill ${skillDir}: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Generate SKILL.md from template data
   */
  generateSkillContent(templateData) {
    const { 
      name, 
      description, 
      version = '1.0.0', 
      author = '', 
      license = 'MIT',
      tags = [], 
      triggers = [],
      keywords = [],
      hooks = {},
      compatibility = {},
      dependencies = [],
      instructions = '',
      examples = []
    } = templateData;

    let content = '---\n';
    
    // Required fields
    content += `name: ${name}\n`;
    content += `description: ${description}\n`;
    content += `version: ${version}\n`;
    content += `author: ${author}\n`;
    content += `license: ${license}\n`;
    
    // Arrays
    if (tags.length > 0) {
      content += `tags: [${tags.join(', ')}]\n`;
    }
    if (triggers.length > 0) {
      content += `triggers: [${triggers.join(', ')}]\n`;
    }
    if (keywords.length > 0) {
      content += `keywords: [${keywords.join(', ')}]\n`;
    }
    
    // Dependencies
    if (dependencies.length > 0) {
      content += 'dependencies:\n';
      for (const dep of dependencies) {
        if (typeof dep === 'string') {
          content += `  - ${dep}\n`;
        } else {
          content += `  - name: ${dep.name}\n`;
          if (dep.version) content += `    version: ${dep.version}\n`;
          if (dep.optional) content += `    optional: true\n`;
        }
      }
    }
    
    // Hooks
    if (Object.keys(hooks).length > 0) {
      content += 'hooks:\n';
      for (const [hookType, hookDef] of Object.entries(hooks)) {
        if (Array.isArray(hookDef)) {
          content += `  ${hookType}:\n`;
          for (const item of hookDef) {
            content += `    - ${item}\n`;
          }
        } else {
          content += `  ${hookType}: ${hookDef}\n`;
        }
      }
    }
    
    // Compatibility
    if (Object.keys(compatibility).length > 0) {
      content += 'compatibility:\n';
      for (const [key, value] of Object.entries(compatibility)) {
        if (Array.isArray(value)) {
          content += `  ${key}: [${value.join(', ')}]\n`;
        } else {
          content += `  ${key}: ${value}\n`;
        }
      }
    }
    
    content += '---\n\n';
    
    // Body content
    content += `# ${name.charAt(0).toUpperCase() + name.slice(1)}\n\n`;
    content += `## Overview\n${description}\n\n`;
    content += `## Instructions\n${instructions}\n\n`;
    
    // Examples
    if (examples.length > 0) {
      content += '## Examples\n';
      for (const example of examples) {
        content += '```example\n';
        content += example + '\n';
        content += '```\n\n';
      }
    }
    
    return content;
  }
}

export default EnhancedSkillParser;
