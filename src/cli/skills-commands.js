/**
 * 🎯 Skills CLI Commands
 * Marketplace integration for skill management
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { EnhancedSkillParser } from '../skills/EnhancedSkillParser.js';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';

// ═══════════════════════════════════════════════════════════════════
// 🎯 Skills CLI
// ═══════════════════════════════════════════════════════════════════

export class SkillsCLI {
  constructor(options = {}) {
    this.registry = new SkillRegistry(options);
    this.parser = new EnhancedSkillParser(options);
    this.verbose = options.verbose !== false;
  }

  /**
   * List installed skills
   */
  async list(options = {}) {
    const { json = false } = options;
    
    try {
      const installed = await this.registry.listInstalled();
      
      if (json) {
        console.log(JSON.stringify(installed, null, 2));
        return;
      }
      
      if (installed.length === 0) {
        console.log(chalk.yellow('No skills installed'));
        console.log(chalk.gray('Use \'openagent skills search <query>\' to find skills'));
        return;
      }
      
      console.log(chalk.blue(`\nInstalled skills (${installed.length}):\n`));
      
      for (const skill of installed) {
        console.log(chalk.green(`  ${skill.name}`));
        console.log(chalk.gray(`    Version: ${skill.version}`));
        console.log(chalk.gray(`    Path: ${skill.path}`));
        if (skill.author) {
          console.log(chalk.gray(`    Author: ${skill.author}`));
        }
        console.log();
      }
      
      // Show updates available
      const { updates } = await this.registry.checkForUpdates();
      if (updates.length > 0) {
        console.log(chalk.blue(`Updates available for ${updates.length} skill(s):`));
        for (const update of updates) {
          console.log(chalk.yellow(`  ${update.skillId}: ${update.currentVersion} → ${update.availableVersion}`));
        }
        console.log(chalk.gray('\nRun \'openagent skills update\' to update all'));  
      }
    } catch (error) {
      console.error(chalk.red(`Error listing skills: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Search registry for skills
   */
  async search(query, options = {}) {
    const { limit = 10, tags = [], json = false } = options;
    
    if (!query && tags.length === 0) {
      console.log(chalk.red('Please provide a search query or tags'));
      process.exit(1);
    }
    
    try {
      console.log(chalk.blue(`Searching for: ${query || tags.join(', ')}...`));
      
      const result = await this.registry.search(query, { limit, tags });
      
      if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      
      if (result.skills.length === 0) {
        console.log(chalk.yellow('No skills found'));
        if (result.fromCache) {
          console.log(chalk.gray('(Results from offline cache)'));
        }
        return;
      }
      
      console.log(chalk.blue(`\nFound ${result.skills.length} skill(s):\n`));
      
      for (const skill of result.skills) {
        console.log(chalk.green(`  ${skill.name} v${skill.version}`));
        console.log(chalk.gray(`    ${skill.description}`));
        console.log(chalk.gray(`    Author: ${skill.author} | Downloads: ${skill.downloads}`));
        if (skill.tags.length > 0) {
          console.log(chalk.gray(`    Tags: ${skill.tags.join(', ')}`));
        }
        console.log();
      }
      
      if (result.fromCache) {
        console.log(chalk.gray('(Results from offline cache. Use --update-cache to refresh)'));
      }
      
    } catch (error) {
      console.error(chalk.red(`Search failed: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Install a skill
   */
  async install(skillId, options = {}) {
    const { version = 'latest', force = false, yes = false } = options;
    
    if (!skillId) {
      console.log(chalk.red('Please specify a skill ID to install'));
      process.exit(1);
    }
    
    try {
      // Get skill info first
      console.log(chalk.blue(`Fetching info for ${skillId}...`));
      const info = await this.registry.getSkillInfo(skillId);
      
      if (!info.success) {
        console.error(chalk.red(`Skill not found: ${skillId}`));
        process.exit(1);
      }
      
      const skill = info.skill;
      
      // Show details and confirm
      console.log(chalk.blue(`\nSkill: ${skill.name}`));
      console.log(chalk.gray(`Description: ${skill.description}`));
      console.log(chalk.gray(`Version: ${skill.version}`));
      console.log(chalk.gray(`Author: ${skill.author}`));
      console.log(chalk.gray(`License: ${skill.license}`));
      
      if (skill.dependencies.length > 0) {
        console.log(chalk.yellow(`\nDependencies: ${skill.dependencies.join(', ')}`));
      }
      
      if (!yes) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Install ${skill.name} v${skill.version}?`,
          default: true
        }]);
        
        if (!confirm) {
          console.log(chalk.gray('Installation cancelled'));
          return;
        }
      }
      
      // Install
      console.log(chalk.blue(`\nInstalling ${skill.name}...`));
      const result = await this.registry.install(skillId, { version, force });
      
      if (result.success) {
        console.log(chalk.green(`✓ Successfully installed ${skill.name} v${result.version}`));
        console.log(chalk.gray(`Location: ${result.path}`));
        
        // Check compatibility
        const skillDir = result.path;
        const enhanced = await this.parser.loadEnhancedSkill(skillDir);
        if (enhanced && !enhanced.isCompatible()) {
          console.log(chalk.yellow(`⚠ Skill may not be compatible with your system`));
          console.log(chalk.gray(`  Compatibility: ${JSON.stringify(enhanced.compatibility)}`));
        }
      } else {
        console.error(chalk.red(`Installation failed: ${result.error}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Installation error: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Remove a skill
   */
  async remove(skillId, options = {}) {
    const { yes = false } = options;
    
    if (!skillId) {
      console.log(chalk.red('Please specify a skill ID to remove'));
      process.exit(1);
    }
    
    try {
      if (!yes) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Remove skill ${skillId}?`,
          default: false
        }]);
        
        if (!confirm) {
          console.log(chalk.gray('Removal cancelled'));
          return;
        }
      }
      
      console.log(chalk.blue(`Removing ${skillId}...`));
      const result = await this.registry.uninstall(skillId);
      
      if (result.success) {
        console.log(chalk.green(`✓ Successfully removed ${skillId}`));
      } else {
        console.error(chalk.red(`Removal failed: ${result.error}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Removal error: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Update skills
   */
  async update(skillId = null, options = {}) {
    const { yes = false } = options;
    
    try {
      if (skillId) {
        // Update specific skill
        console.log(chalk.blue(`Updating ${skillId}...`));
        const result = await this.registry.update(skillId);
        
        if (result.success) {
          console.log(chalk.green(`✓ Updated ${skillId} to v${result.version}`));
        } else {
          console.error(chalk.red(`Update failed: ${result.error}`));
          process.exit(1);
        }
      } else {
        // Check for updates
        console.log(chalk.blue('Checking for updates...'));
        const { updates } = await this.registry.checkForUpdates();
        
        if (updates.length === 0) {
          console.log(chalk.green('All skills are up to date'));
          return;
        }
        
        console.log(chalk.yellow(`Found ${updates.length} skill(s) with updates:`));
        for (const update of updates) {
          console.log(chalk.gray(`  ${update.skillId}: ${update.currentVersion} → ${update.availableVersion}`));
        }
        
        if (!yes) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Update ${updates.length} skill(s)?`,
            default: true
          }]);
          
          if (!confirm) {
            console.log(chalk.gray('Update cancelled'));
            return;
          }
        }
        
        // Update all
        console.log(chalk.blue('\nUpdating skills...'));
        const result = await this.registry.update();
        
        console.log(chalk.green(`\n✓ Updated ${result.updated} skill(s)`));
        if (result.failed > 0) {
          console.log(chalk.red(`✗ Failed to update ${result.failed} skill(s)`));
        }
      }
    } catch (error) {
      console.error(chalk.red(`Update error: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Create a new skill
   */
  async create(name, options = {}) {
    const { 
      description = `A skill for ${name}`,
      template = 'basic',
      force = false
    } = options;
    
    if (!name) {
      console.log(chalk.red('Please specify a skill name'));
      process.exit(1);
    }
    
    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.log(chalk.red('Skill name must be lowercase alphanumeric with hyphens only'));
      process.exit(1);
    }
    
    const skillDir = path.join(os.homedir(), '.openagent', 'skills', name);
    
    // Check if exists
    if (await fs.pathExists(skillDir) && !force) {
      console.error(chalk.red(`Skill already exists: ${name}`));
      console.log(chalk.gray('Use --force to overwrite'));
      process.exit(1);
    }
    
    try {
      console.log(chalk.blue(`Creating skill ${name}...`));
      
      // Create directory structure
      await fs.ensureDir(skillDir);
      await fs.ensureDir(path.join(skillDir, 'scripts'));
      
      // Generate content from template
      const templateData = {
        name,
        description,
        author: os.userInfo().username,
        version: '1.0.0',
        tags: [],
        triggers: [name],
        hooks: {},
        compatibility: {
          os: ['linux', 'macos', 'windows'],
          node: '>=18'
        },
        dependencies: [],
        instructions: `# ${name}\n\n## Overview\n${description}\n\n## Instructions\n<!-- Add your skill instructions here -->`,
        examples: []
      };
      
      // Get template if available
      if (template !== 'basic') {
        const templatePath = path.join(path.dirname(import.meta.url), '../skills/templates', template, 'SKILL.md');
        if (await fs.pathExists(templatePath)) {
          const templateContent = await fs.readFile(templatePath, 'utf-8');
          const { frontmatter, body } = this.parser.parseFrontmatter(templateContent);
          
          // Merge template frontmatter
          Object.assign(templateData, frontmatter);
          templateData.name = name; // Override
          templateData.description = description;
          templateData.author = os.userInfo().username;
          
          if (body) {
            templateData.instructions = body;
          }
        }
      }
      
      // Generate SKILL.md
      const skillContent = this.parser.generateSkillContent(templateData);
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      // Create example scripts
      const scriptContent = `#!/bin/bash
# Example script for ${name}
echo "Hello from ${name} skill!"
`;
      await fs.writeFile(path.join(skillDir, 'scripts', 'example.sh'), scriptContent, 'utf-8');
      await fs.chmod(path.join(skillDir, 'scripts', 'example.sh'), 0o755);
      
      // Create README
      const readme = `# ${name}\n\n${description}\n\n## Files\n- SKILL.md: Skill definition\n- scripts/: Executable scripts\n- REFERENCE.md: Detailed reference\n`;
      await fs.writeFile(path.join(skillDir, 'README.md'), readme, 'utf-8');
      
      console.log(chalk.green(`✓ Created skill: ${name}`));
      console.log(chalk.gray(`Location: ${skillDir}`));
      console.log(chalk.blue('\nNext steps:'));  
      console.log(chalk.gray('1. Edit SKILL.md to customize your skill'));
      console.log(chalk.gray('2. Add scripts to scripts/ directory'));
      console.log(chalk.gray('3. Test with: openagent skills list'));
      
    } catch (error) {
      console.error(chalk.red(`Creation failed: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Show registry statistics
   */
  async stats(options = {}) {
    const { json = false } = options;
    
    try {
      const stats = await this.registry.getStats();
      
      if (json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      
      console.log(chalk.blue('\nSkill Registry Statistics:\n'));
      console.log(chalk.gray(`Installed skills: ${stats.installedCount}`));
      console.log(chalk.gray(`Updates available: ${stats.updatesAvailable}`));
      console.log(chalk.gray(`Cached skills: ${stats.cachedSkills}`));
      console.log(chalk.gray(`Registry: ${stats.registryUrl}`));
      if (stats.cacheLastUpdated) {
        console.log(chalk.gray(`Last cache update: ${stats.cacheLastUpdated}`));
      }
      
    } catch (error) {
      console.error(chalk.red(`Stats error: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Clear registry cache
   */
  async clearCache() {
    try {
      await this.registry.clearCache();
      console.log(chalk.green('✓ Registry cache cleared'));
    } catch (error) {
      console.error(chalk.red(`Clear cache failed: ${error.message}`));
      process.exit(1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 Command Registration
// ═══════════════════════════════════════════════════════════════════

/**
 * Register skills commands with the CLI
 */
export function registerSkillsCommands(program) {
  const skillsCLI = new SkillsCLI();
  
  const skillsCommand = program.command('skills')
    .description('Manage skills and marketplace');
  
  // List
  skillsCommand.command('list')
    .description('List installed skills')
    .option('--json', 'Output as JSON')
    .option('--global', 'Show global skills only')
    .option('--project', 'Show project skills only')
    .action(async (options) => {
      await skillsCLI.list(options);
    });
  
  // Search
  skillsCommand.command('search <query>')
    .description('Search registry for skills')
    .option('-l, --limit <n>', 'Limit results', parseInt, 10)
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('--json', 'Output as JSON')
    .action(async (query, options) => {
      const tags = options.tags ? options.tags.split(',') : [];
      await skillsCLI.search(query, { ...options, tags });
    });
  
  // Install
  skillsCommand.command('install <skillId>')
    .description('Install a skill from registry')
    .option('-v, --version <version>', 'Specific version to install', 'latest')
    .option('-f, --force', 'Force reinstall', false)
    .option('-y, --yes', 'Skip confirmation', false)
    .action(async (skillId, options) => {
      await skillsCLI.install(skillId, options);
    });
  
  // Remove
  skillsCommand.command('remove <skillId>')
    .description('Remove an installed skill')
    .option('-y, --yes', 'Skip confirmation', false)
    .action(async (skillId, options) => {
      await skillsCLI.remove(skillId, options);
    });
  
  // Update
  skillsCommand.command('update [skillId]')
    .description('Update skills (all or specific)')
    .option('-y, --yes', 'Skip confirmation', false)
    .action(async (skillId, options) => {
      await skillsCLI.update(skillId, options);
    });
  
  // Create
  skillsCommand.command('create <name>')
    .description('Create a new skill from template')
    .option('-d, --description <desc>', 'Skill description')
    .option('-t, --template <template>', 'Template type', 'basic')
    .option('-f, --force', 'Overwrite if exists', false)
    .action(async (name, options) => {
      await skillsCLI.create(name, options);
    });
  
  // Stats
  skillsCommand.command('stats')
    .description('Show registry statistics')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await skillsCLI.stats(options);
    });
  
  // Clear cache
  skillsCommand.command('clear-cache')
    .description('Clear registry cache')
    .action(async () => {
      await skillsCLI.clearCache();
    });
}

export default SkillsCLI;
