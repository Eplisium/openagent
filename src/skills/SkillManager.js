/**
 * 🎯 Skill Manager v6.0
 * Filesystem-based skill system with progressive disclosure and enhanced parsing
 * 
 * Enhanced Features:
 * - Uses EnhancedSkillParser for advanced YAML frontmatter
 * - Supports hooks, compatibility, dependencies
 * - Backward compatible with existing code
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { EnhancedSkillParser } from './EnhancedSkillParser.js';

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

const SKILL_FILE = 'SKILL.md';
const SKILLS_DIR = 'skills';
const _MAX_SKILL_CONTENT_SIZE = 50000; // chars
const _METADATA_TOKEN_BUDGET = 100; // ~100 tokens per skill for metadata

// ═══════════════════════════════════════════════════════════════════
// 🎯 Skill Class (backward compatible, now uses EnhancedSkillParser)
// ═══════════════════════════════════════════════════════════════════

export class Skill {
  constructor(options = {}) {
    this.name = options.name || 'unnamed';
    this.description = options.description || '';
    this.version = options.version || '1.0.0';
    this.author = options.author || '';
    this.tags = options.tags || [];
    this.triggers = options.triggers || [];
    this.instructions = options.instructions || '';
    this.references = options.references || [];
    this.scripts = options.scripts || [];
    this.dirPath = options.dirPath || '';
    this.source = options.source || 'project'; // 'project' | 'global'
    // Enhanced properties
    this.hooks = options.hooks || {};
    this.compatibility = options.compatibility || {};
    this.dependencies = options.dependencies || [];
    this.keywords = options.keywords || [];
  }

  /**
   * Get metadata summary (Level 1 — always loaded)
   * ~100 tokens per skill
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      tags: this.tags,
      triggers: this.triggers,
      source: this.source,
    };
  }

  /**
   * Get full instructions (Level 2 — loaded when triggered)
   */
  getInstructions() {
    return this.instructions;
  }

  /**
   * Check if a query matches this skill's triggers
   * Uses simple keyword matching — LLM does the real routing
   */
  matchesTrigger(query) {
    const lowerQuery = query.toLowerCase();
    return this.triggers.some(trigger =>
      lowerQuery.includes(trigger.toLowerCase())
    );
  }

  /**
   * List available scripts in this skill
   */
  async listScripts() {
    const scriptsDir = path.join(this.dirPath, 'scripts');
    if (!await fs.pathExists(scriptsDir)) {
      return [];
    }

    const files = await fs.readdir(scriptsDir);
    return files.map(f => ({
      name: f,
      path: path.join(scriptsDir, f),
      executable: true,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 Skill Manager
// ═══════════════════════════════════════════════════════════════════

export class SkillManager {
  constructor(options = {}) {
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.openAgentDir = options.openAgentDir || path.join(this.workingDir, '.openagent');
    this.globalSkillsDir = options.globalSkillsDir || path.join(os.homedir(), '.openagent', SKILLS_DIR);
    this.projectSkillsDir = options.projectSkillsDir || path.join(this.openAgentDir, SKILLS_DIR);
    this.verbose = options.verbose !== false;
    
    // Use enhanced parser
    this.parser = new EnhancedSkillParser(options);
    
    // Skills cache
    this.skills = new Map();
    this._loaded = false;
  }

  /**
   * Parse YAML frontmatter from SKILL.md content (backward compatible)
   * @param {string} content - Full file content
   * @returns {{ frontmatter: object, body: string }}
   */
  parseFrontmatter(content) {
    // Delegate to enhanced parser
    return this.parser.parseFrontmatter(content);
  }

  /**
   * Load a single skill from a directory (now using enhanced parser)
   * @param {string} skillDir - Path to skill directory
   * @param {string} source - 'project' or 'global'
   * @returns {Promise<Skill | null>}
   */
  async loadSkill(skillDir, source = 'project') {
    const skillFile = path.join(skillDir, SKILL_FILE);
    
    if (!await fs.pathExists(skillFile)) {
      return null;
    }

    try {
      // Use enhanced parser to load skill
      const enhancedSkill = await this.parser.loadEnhancedSkill(skillDir, source);
      
      if (!enhancedSkill) {
        return null;
      }
      
      // Convert enhanced skill to backward compatible Skill object
      return new Skill({
        name: enhancedSkill.name,
        description: enhancedSkill.description,
        version: enhancedSkill.version,
        author: enhancedSkill.author,
        tags: enhancedSkill.tags,
        triggers: enhancedSkill.triggers,
        instructions: enhancedSkill.instructions,
        references: enhancedSkill.references,
        scripts: enhancedSkill.scripts,
        dirPath: enhancedSkill.dirPath,
        source: enhancedSkill.source,
        hooks: enhancedSkill.hooks,
        compatibility: enhancedSkill.compatibility,
        dependencies: enhancedSkill.dependencies,
        keywords: enhancedSkill.keywords,
      });
    } catch (err) {
      if (this.verbose) {
        console.log(chalk.red(`✗ Failed to load skill ${skillDir}: ${err.message}`));
      }
      return null;
    }
  }

  /**
   * Discover and load all skills from global and project directories
   */
  async loadAll() {
    this.skills.clear();

    // Load global skills
    if (await fs.pathExists(this.globalSkillsDir)) {
      const entries = await fs.readdir(this.globalSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skill = await this.loadSkill(
            path.join(this.globalSkillsDir, entry.name),
            'global'
          );
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        }
      }
    }

    // Load project skills (override global with same name)
    if (await fs.pathExists(this.projectSkillsDir)) {
      const entries = await fs.readdir(this.projectSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skill = await this.loadSkill(
            path.join(this.projectSkillsDir, entry.name),
            'project'
          );
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        }
      }
    }

    this._loaded = true;

    if (this.verbose && this.skills.size > 0) {
      console.log(chalk.green(`✓ Loaded ${this.skills.size} skill(s)`));
    }

    return this.skills;
  }

  /**
   * Get all skills
   */
  async getSkills() {
    if (!this._loaded) {
      await this.loadAll();
    }
    return this.skills;
  }

  /**
   * Get a skill by name
   */
  async getSkill(name) {
    if (!this._loaded) {
      await this.loadAll();
    }
    return this.skills.get(name) || null;
  }

  /**
   * Get Level 1 metadata for all skills (always loaded into context)
   * ~100 tokens per skill
   */
  async getMetadataList() {
    const skills = await this.getSkills();
    return Array.from(skills.values()).map(s => s.getMetadata());
  }

  /**
   * Build the skill meta-tool description
   * This is injected into the tool definitions so the LLM can discover skills
   */
  async buildToolDescription() {
    const metadata = await this.getMetadataList();
    
    if (metadata.length === 0) {
      return null;
    }

    const skillList = metadata.map(m => {
      const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
      return `- **${m.name}**: ${m.description}${tags}`;
    }).join('\n');

    return `Available skills (invoke with the skill name to load its instructions):

${skillList}

To use a skill, call it by name. The skill's instructions will be loaded into context.`;
  }

  /**
   * Build tool definition for the skill meta-tool
   */
  async buildToolDefinition() {
    const description = await this.buildToolDescription();
    
    if (!description) {
      return null;
    }

    const skillNames = Array.from(this.skills.keys());

    return {
      name: 'use_skill',
      description,
      category: 'skill',
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            description: 'The name of the skill to activate',
            enum: skillNames,
          },
          action: {
            type: 'string',
            description: 'Action to perform: "load" to get instructions, "list" to see available skills, "scripts" to list skill scripts',
            enum: ['load', 'list', 'scripts'],
            default: 'load',
          },
        },
        required: ['skill'],
      },
      execute: async ({ skill: skillName, action = 'load' }) => {
        return this.executeSkillAction(skillName, action);
      },
    };
  }

  /**
   * Execute a skill action
   */
  async executeSkillAction(skillName, action) {
    const skill = await this.getSkill(skillName);
    
    if (!skill) {
      return {
        success: false,
        error: `Skill "${skillName}" not found. Available: ${Array.from(this.skills.keys()).join(', ')}`,
      };
    }

    switch (action) {
      case 'load': {
        // Level 2: Load full instructions
        let content = `# Skill: ${skill.name}\n\n${skill.instructions}`;
        
        // Level 3: Load references if available
        if (skill.references.length > 0) {
          content += '\n\n## References\n';
          for (const ref of skill.references) {
            try {
              const refContent = await fs.readFile(ref.path, 'utf-8');
              content += `\n### ${ref.name}\n\n${refContent}`;
            } catch {
              content += `\n### ${ref.name}\n\n[Could not read]`;
            }
          }
        }

        return {
          success: true,
          skill: skill.name,
          action: 'loaded',
          content,
          scripts: skill.scripts.map(s => s.name),
        };
      }

      case 'list': {
        const allMetadata = await this.getMetadataList();
        return {
          success: true,
          skills: allMetadata,
        };
      }

      case 'scripts': {
        const scripts = await skill.listScripts();
        return {
          success: true,
          skill: skill.name,
          scripts: scripts.map(s => ({
            name: s.name,
            path: s.path,
          })),
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}`,
        };
    }
  }

  /**
   * Create a new skill from a template
   */
  async createSkill(name, options = {}) {
    const skillDir = path.join(this.projectSkillsDir, name);
    
    if (await fs.pathExists(skillDir)) {
      return { success: false, error: `Skill "${name}" already exists` };
    }

    await fs.ensureDir(skillDir);
    await fs.ensureDir(path.join(skillDir, 'scripts'));

    const description = options.description || `A skill for ${name}`;
    const tags = options.tags || [];
    const triggers = options.triggers || [name];

    // Generate using enhanced parser
    const templateData = {
      name,
      description,
      author: os.userInfo().username,
      version: '1.0.0',
      tags,
      triggers,
      keywords: [],
      hooks: {},
      compatibility: {
        os: ['linux', 'macos', 'windows'],
        node: '>=18'
      },
      dependencies: [],
      instructions: options.instructions || `# ${name}\n\n## Overview\n${description}\n\n## Instructions\n<!-- Add your skill instructions here -->`,
      examples: [],
    };
    
    const skillContent = this.parser.generateSkillContent(templateData);
    await fs.writeFile(path.join(skillDir, SKILL_FILE), skillContent, 'utf-8');

    // Create reference template
    const refContent = `# ${name} Reference

## Detailed Information
<!-- Add detailed reference material here -->
`;
    await fs.writeFile(path.join(skillDir, 'REFERENCE.md'), refContent, 'utf-8');

    // Reload skills
    this._loaded = false;
    await this.loadAll();

    if (this.verbose) {
      console.log(chalk.green(`✓ Created skill: ${name}`));
    }

    return { success: true, path: skillDir };
  }

  /**
   * List all skills with their status
   */
  async listSkills() {
    const skills = await this.getSkills();
    const list = [];

    for (const [name, skill] of skills) {
      list.push({
        name,
        description: skill.description,
        version: skill.version,
        source: skill.source,
        tags: skill.tags,
        triggers: skill.triggers,
        hasScripts: skill.scripts.length > 0,
        hasReferences: skill.references.length > 0,
        dirPath: skill.dirPath,
      });
    }

    return list;
  }

  /**
   * Get skills that match a query based on triggers
   */
  async findMatchingSkills(query) {
    const skills = await this.getSkills();
    const matches = [];

    for (const [name, skill] of skills) {
      if (skill.matchesTrigger(query)) {
        matches.push({
          name,
          description: skill.description,
          relevance: 'trigger-match',
        });
      }
    }

    return matches;
  }

  /**
   * Get stats about loaded skills
   */
  async getStats() {
    const skills = await this.getSkills();
    const globalSkills = Array.from(skills.values()).filter(s => s.source === 'global');
    const projectSkills = Array.from(skills.values()).filter(s => s.source === 'project');

    return {
      total: skills.size,
      global: globalSkills.length,
      project: projectSkills.length,
      withScripts: Array.from(skills.values()).filter(s => s.scripts.length > 0).length,
      withReferences: Array.from(skills.values()).filter(s => s.references.length > 0).length,
    };
  }

  /**
   * Transfer a skill between global and project scopes
   * @param {string} name - Skill name
   * @param {string} fromScope - 'project' or 'global'
   * @param {string} toScope - 'project' or 'global'
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async transferSkill(name, fromScope, toScope) {
    if (fromScope === toScope) {
      return { success: false, error: 'Source and destination must be different' };
    }

    const fromDir = fromScope === 'global' ? this.globalSkillsDir : this.projectSkillsDir;
    const toDir = toScope === 'global' ? this.globalSkillsDir : this.projectSkillsDir;
    const fromPath = path.join(fromDir, name);
    const toPath = path.join(toDir, name);

    if (!await fs.pathExists(fromPath)) {
      return { success: false, error: `Skill not found in ${fromScope}: ${name}` };
    }

    if (await fs.pathExists(toPath)) {
      return { success: false, error: `Skill already exists in ${toScope}: ${name}` };
    }

    await fs.ensureDir(toDir);
    await fs.copy(fromPath, toPath);
    await fs.remove(fromPath);

    // Reload skills to reflect the change
    this._loaded = false;
    await this.loadAll();

    if (this.verbose) {
      console.log(chalk.green(`✓ Transferred skill: ${name} (${fromScope} → ${toScope})`));
    }

    return { success: true, name, from: fromScope, to: toScope };
  }

  /**
   * Remove a skill from a specific scope
   * @param {string} name - Skill name
   * @param {string} scope - 'project', 'global', or null (search both, project first)
   * @returns {Promise<{success: boolean, source?: string, error?: string}>}
   */
  async removeSkill(name, scope = null) {
    let targetDir = null;
    let source = null;

    if (scope === 'global') {
      const skillDir = path.join(this.globalSkillsDir, name);
      if (await fs.pathExists(skillDir)) {
        targetDir = skillDir;
        source = 'global';
      }
    } else if (scope === 'project') {
      const skillDir = path.join(this.projectSkillsDir, name);
      if (await fs.pathExists(skillDir)) {
        targetDir = skillDir;
        source = 'project';
      }
    } else {
      // Search both (project first)
      const projectDir = path.join(this.projectSkillsDir, name);
      const globalDir = path.join(this.globalSkillsDir, name);
      if (await fs.pathExists(projectDir)) {
        targetDir = projectDir;
        source = 'project';
      } else if (await fs.pathExists(globalDir)) {
        targetDir = globalDir;
        source = 'global';
      }
    }

    if (!targetDir) {
      return { success: false, error: `Skill not found: ${name}` };
    }

    await fs.remove(targetDir);

    // Reload skills to reflect the change
    this._loaded = false;
    await this.loadAll();

    if (this.verbose) {
      console.log(chalk.green(`✓ Removed skill: ${name} (${source})`));
    }

    return { success: true, name, source };
  }

  /**
   * Get a skill's location info
   * @param {string} name - Skill name
   * @returns {Promise<{found: boolean, source?: string, dirPath?: string}>}
   */
  async getSkillLocation(name) {
    const projectDir = path.join(this.projectSkillsDir, name);
    const globalDir = path.join(this.globalSkillsDir, name);

    if (await fs.pathExists(path.join(projectDir, SKILL_FILE))) {
      return { found: true, source: 'project', dirPath: projectDir };
    }
    if (await fs.pathExists(path.join(globalDir, SKILL_FILE))) {
      return { found: true, source: 'global', dirPath: globalDir };
    }
    return { found: false };
  }
}

export default SkillManager;