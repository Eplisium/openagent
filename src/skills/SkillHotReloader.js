/**
 * 🎯 Skill Hot Reloader
 * File watcher for skill development with auto-reload and validation
 * 
 * Features:
 * - Watch skill directories for changes
 * - Auto-reload modified skills
 * - Validate skill structure on load
 * - Provide development feedback
 */

import fs from 'fs-extra';
import path from 'path';
import chokidar from 'chokidar';
import chalk from 'chalk';
import { EnhancedSkillParser } from './EnhancedSkillParser.js';
import { SkillManager } from './SkillManager.js';

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

const SKILL_FILE = 'SKILL.md';
const WATCH_DEBOUNCE_MS = 300;

// ═══════════════════════════════════════════════════════════════════
// 🎯 Skill Hot Reloader
// ═══════════════════════════════════════════════════════════════════

export class SkillHotReloader {
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.skillManager = options.skillManager || new SkillManager({ workingDir: this.workingDir });
    this.parser = new EnhancedSkillParser(options);
    this.verbose = options.verbose !== false;
    this.debounceMs = options.debounceMs || WATCH_DEBOUNCE_MS;
    
    this.watcher = null;
    this.debounceTimers = new Map();
    this.loadedSkills = new Map();
    
    // Callbacks
    this.onSkillLoaded = options.onSkillLoaded || null;
    this.onSkillUnloaded = options.onSkillUnloaded || null;
    this.onSkillError = options.onSkillError || null;
  }

  /**
   * Start watching skill directories
   */
  async startWatching() {
    const watchPaths = [
      this.skillManager.projectSkillsDir,
      this.skillManager.globalSkillsDir,
    ].filter(p => fs.existsSync(p));
    
    if (watchPaths.length === 0) {
      if (this.verbose) {
        console.log(chalk.yellow('No skill directories to watch'));
      }
      return;
    }
    
    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      depth: 3,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      },
      ignored: /(^|[/\\])\../,
    });
    
    // Set up event handlers
    this.watcher
      .on('add', (filePath) => this.handleFileChange('add', filePath))
      .on('change', (filePath) => this.handleFileChange('change', filePath))
      .on('unlink', (filePath) => this.handleFileChange('unlink', filePath))
      .on('addDir', (dirPath) => this.handleDirChange('add', dirPath))
      .on('unlinkDir', (dirPath) => this.handleDirChange('unlink', dirPath))
      .on('error', (error) => console.error(chalk.red(`Watcher error: ${error}`)))
      .on('ready', () => {
        if (this.verbose) {
          console.log(chalk.blue(`Watching ${watchPaths.length} skill directory(ies) for changes...`));
          watchPaths.forEach(p => console.log(chalk.gray(`  ${p}`)));
        }
      });
    
    // Initial load of existing skills
    await this.loadExistingSkills();
  }

  /**
   * Stop watching
   */
  async stopWatching() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    
    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Handle file changes with debouncing
   */
  handleFileChange(event, filePath) {
    // Debounce to avoid multiple rapid reloads
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }
    
    this.debounceTimers.set(filePath, setTimeout(() => {
      this.processFileChange(event, filePath);
      this.debounceTimers.delete(filePath);
    }, this.debounceMs));
  }

  /**
   * Process a file change
   */
  async processFileChange(event, filePath) {
    const fileName = path.basename(filePath);
    const skillDir = path.dirname(filePath);
    
    // Only process SKILL.md files and scripts
    if (fileName !== SKILL_FILE && !skillDir.endsWith('/scripts')) {
      return;
    }
    
    const skillName = this.getSkillNameFromPath(skillDir);
    
    if (event === 'add' || event === 'change') {
      if (fileName === SKILL_FILE) {
        // Reload the entire skill
        await this.reloadSkill(skillName, skillDir);
      } else {
        // Script changed, just notify
        if (this.verbose) {
          console.log(chalk.blue(`Script changed: ${fileName} in skill ${skillName}`));
        }
        await this.notifyScriptChange(skillName, filePath);
      }
    } else if (event === 'unlink') {
      if (fileName === SKILL_FILE) {
        // Skill removed
        await this.unloadSkill(skillName);
      }
    }
  }

  /**
   * Handle directory changes
   */
  async handleDirChange(event, dirPath) {
    // Check if this is a skill directory (has SKILL.md)
    const skillFile = path.join(dirPath, SKILL_FILE);
    if (await fs.pathExists(skillFile)) {
      const skillName = this.getSkillNameFromPath(dirPath);
      
      if (event === 'add') {
        await this.loadSkill(skillName, dirPath);
      } else if (event === 'unlink') {
        await this.unloadSkill(skillName);
      }
    }
  }

  /**
   * Load existing skills on startup
   */
  async loadExistingSkills() {
    const skillsDir = this.skillManager.projectSkillsDir;
    
    if (!await fs.pathExists(skillsDir)) {
      return;
    }
    
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(skillsDir, entry.name);
        const skillFile = path.join(skillDir, SKILL_FILE);
        
        if (await fs.pathExists(skillFile)) {
          await this.loadSkill(entry.name, skillDir);
        }
      }
    }
  }

  /**
   * Load a single skill
   */
  async loadSkill(skillName, skillDir) {
    try {
      const skill = await this.parser.loadEnhancedSkill(skillDir, 'project');
      
      if (!skill) {
        throw new Error('Failed to load skill');
      }
      
      // Validate compatibility
      if (!skill.isCompatible()) {
        if (this.verbose) {
          console.log(chalk.yellow(`⚠ Skill ${skillName} may not be compatible with current system`));
        }
      }
      
      // Check dependencies
      const installedSkills = Array.from(this.loadedSkills.values());
      const deps = skill.checkDependencies(installedSkills);
      
      if (!deps.satisfied) {
        if (this.verbose) {
          console.log(chalk.yellow(`⚠ Skill ${skillName} missing dependencies: ${deps.missing.join(', ')}`));
        }
      }
      
      // Store loaded skill
      this.loadedSkills.set(skillName, {
        skill,
        skillDir,
        loadedAt: new Date(),
      });
      
      // Notify via callback
      if (this.onSkillLoaded) {
        await this.onSkillLoaded(skillName, skill);
      }
      
      if (this.verbose) {
        console.log(chalk.green(`✓ Loaded skill: ${skillName}`));
      }
      
    } catch (error) {
      if (this.verbose) {
        console.log(chalk.red(`✗ Failed to load skill ${skillName}: ${error.message}`));
      }
      
      if (this.onSkillError) {
        await this.onSkillError(skillName, error);
      }
    }
  }

  /**
   * Reload a skill
   */
  async reloadSkill(skillName, skillDir) {
    if (this.verbose) {
      console.log(chalk.blue(`Reloading skill: ${skillName}`));
    }
    
    // Unload first
    await this.unloadSkill(skillName);
    
    // Then load again
    await this.loadSkill(skillName, skillDir);
  }

  /**
   * Unload a skill
   */
  async unloadSkill(skillName) {
    if (!this.loadedSkills.has(skillName)) {
      return;
    }
    
    const skillData = this.loadedSkills.get(skillName);
    this.loadedSkills.delete(skillName);
    
    // Notify via callback
    if (this.onSkillUnloaded) {
      await this.onSkillUnloaded(skillName, skillData.skill);
    }
    
    if (this.verbose) {
      console.log(chalk.yellow(`Unloaded skill: ${skillName}`));
    }
  }

  /**
   * Notify about script changes
   */
  async notifyScriptChange(skillName, scriptPath) {
    if (this.verbose) {
      console.log(chalk.blue(`Script updated: ${path.basename(scriptPath)} in skill ${skillName}`));
    }
  }

  /**
   * Get skill name from directory path
   */
  getSkillNameFromPath(skillDir) {
    return path.basename(skillDir);
  }

  /**
   * Get all currently loaded skills
   */
  getLoadedSkills() {
    const skills = {};
    for (const [name, data] of this.loadedSkills) {
      skills[name] = {
        ...data.skill.getMetadata(),
        skillDir: data.skillDir,
        loadedAt: data.loadedAt,
      };
    }
    return skills;
  }

  /**
   * Validate skill structure
   */
  async validateSkill(skillDir) {
    const issues = [];
    
    // Check SKILL.md exists
    const skillFile = path.join(skillDir, SKILL_FILE);
    if (!await fs.pathExists(skillFile)) {
      issues.push({ type: 'error', message: 'Missing SKILL.md file' });
      return issues;
    }
    
    try {
      // Parse and validate frontmatter
      const content = await fs.readFile(skillFile, 'utf-8');
      const { frontmatter } = this.parser.parseFrontmatter(content);
      
      // Check required fields
      if (!frontmatter.name) {
        issues.push({ type: 'warning', message: 'Missing name in frontmatter' });
      }
      if (!frontmatter.description) {
        issues.push({ type: 'warning', message: 'Missing description in frontmatter' });
      }
      
      // Check hooks reference valid files
      if (frontmatter.hooks && typeof frontmatter.hooks === 'object') {
        for (const [hookType, hookDef] of Object.entries(frontmatter.hooks)) {
          if (typeof hookDef === 'string') {
            const hookPath = path.join(skillDir, 'scripts', hookDef);
            if (!await fs.pathExists(hookPath)) {
              issues.push({ type: 'error', message: `Hook ${hookType} references missing script: ${hookDef}` });
            }
          }
        }
      }
      
    } catch (error) {
      issues.push({ type: 'error', message: `Failed to parse SKILL.md: ${error.message}` });
    }
    
    return issues;
  }

  /**
   * Run validation on all loaded skills
   */
  async validateAllSkills() {
    const results = {};
    
    for (const [skillName, data] of this.loadedSkills) {
      const issues = await this.validateSkill(data.skillDir);
      results[skillName] = {
        valid: issues.filter(i => i.type === 'error').length === 0,
        issues,
      };
    }
    
    return results;
  }
}

export default SkillHotReloader;
