/**
 * 🎯 Skills Handler for CLI
 * Handles /skills commands in the REPL and shell subcommands
 * 
 * Supports:
 * - /skills list [--global|--project] — List all skills
 * - /skills info <name> — Show skill details
 * - /skills create <name> [--global] — Create a new skill
 * - /skills remove <name> [--global|--project|--all] — Remove a skill from scope(s)
 * - /skills transfer <name> --from X --to Y — Move between global, project, or cross-project
 * - /skills search <query> — Search registry for skills
 * - /skills install <id> — Install a skill from registry
 * - /skills update [id] — Update skills (all or specific)
 */

import chalk from '../utils/chalk-compat.js';
import fs from '../utils/fs-compat.js';
import path from 'path';
import os from 'os';
import { SkillManager } from '../skills/SkillManager.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { EnhancedSkillParser } from '../skills/EnhancedSkillParser.js';

const SKILLS_DIR = 'skills';
const SKILL_FILE = 'SKILL.md';

/**
 * Get the global and project skills directories
 */
function getSkillDirs(workingDir) {
  const openAgentDir = path.join(workingDir, '.openagent');
  return {
    global: path.join(os.homedir(), '.openagent', SKILLS_DIR),
    project: path.join(openAgentDir, SKILLS_DIR),
  };
}

/**
 * Create a SkillManager instance for the given working directory
 */
function createManager(workingDir) {
  const dirs = getSkillDirs(workingDir);
  return new SkillManager({
    workingDir,
    globalSkillsDir: dirs.global,
    projectSkillsDir: dirs.project,
    verbose: false,
  });
}

/**
 * Create a SkillRegistry instance
 */
function createRegistry() {
  return new SkillRegistry({ verbose: false });
}

/**
 * List all skills (global + project) using SkillManager
 */
export async function listSkills(workingDir, options = {}) {
  const manager = createManager(workingDir);
  const skills = await manager.getSkills();
  const dirs = getSkillDirs(workingDir);

  const showGlobal = !options.projectOnly;
  const showProject = !options.globalOnly;

  const globalSkills = [];
  const projectSkills = [];

  for (const [, skill] of skills) {
    if (skill.source === 'global' && showGlobal) globalSkills.push(skill);
    if (skill.source === 'project' && showProject) projectSkills.push(skill);
  }

  const allSkills = [...globalSkills, ...projectSkills];

  if (allSkills.length === 0) {
    console.log(chalk.yellow('\nNo skills installed.'));
    console.log(chalk.gray('  Global skills: ') + chalk.dim(dirs.global));
    console.log(chalk.gray('  Project skills: ') + chalk.dim(dirs.project));
    console.log(chalk.gray('\nUse /skills create <name> to create a skill'));
    console.log(chalk.gray('Use /skills search <query> to find skills in the registry'));
    return;
  }

  console.log(chalk.blue(`\n📋 Skills (${allSkills.length}):\n`));

  if (showGlobal && globalSkills.length > 0) {
    console.log(chalk.cyan(`  🌐 Global (${globalSkills.length}):`));
    for (const skill of globalSkills) {
      const tags = skill.tags.length > 0 ? chalk.gray(` [${skill.tags.join(', ')}]`) : '';
      console.log(chalk.green(`    ${skill.name}`) + chalk.gray(` v${skill.version}`) + tags);
      if (skill.description) console.log(chalk.gray(`      ${skill.description}`));
    }
    console.log();
  }

  if (showProject && projectSkills.length > 0) {
    console.log(chalk.cyan(`  📁 Project (${projectSkills.length}):`));
    for (const skill of projectSkills) {
      const tags = skill.tags.length > 0 ? chalk.gray(` [${skill.tags.join(', ')}]`) : '';
      console.log(chalk.green(`    ${skill.name}`) + chalk.gray(` v${skill.version}`) + tags);
      if (skill.description) console.log(chalk.gray(`      ${skill.description}`));
    }
    console.log();
  }

  if (options.json) {
    console.log(JSON.stringify({ global: globalSkills.map(s => s.getMetadata()), project: projectSkills.map(s => s.getMetadata()) }, null, 2));
  }
}

/**
 * Show detailed info about a skill
 */
export async function showSkillInfo(workingDir, skillName) {
  const manager = createManager(workingDir);
  const skill = await manager.getSkill(skillName);

  if (!skill) {
    console.log(chalk.red(`Skill not found: ${skillName}`));
    console.log(chalk.gray('Use /skills list to see available skills'));
    return;
  }

  const sourceIcon = skill.source === 'global' ? '🌐' : '📁';
  console.log(chalk.blue(`\n${sourceIcon} Skill: ${chalk.bold(skill.name)}\n`));
  console.log(chalk.gray(`  Source:      ${skill.source}`));
  console.log(chalk.gray(`  Version:     ${skill.version}`));
  console.log(chalk.gray(`  Path:        ${skill.dirPath}`));
  if (skill.author) console.log(chalk.gray(`  Author:      ${skill.author}`));
  if (skill.description) console.log(chalk.gray(`  Description: ${skill.description}`));
  if (skill.tags.length > 0) console.log(chalk.gray(`  Tags:        ${skill.tags.join(', ')}`));
  if (skill.triggers.length > 0) console.log(chalk.gray(`  Triggers:    ${skill.triggers.join(', ')}`));
  if (skill.dependencies.length > 0) console.log(chalk.gray(`  Dependencies: ${skill.dependencies.join(', ')}`));

  // List scripts
  const scripts = await skill.listScripts();
  if (scripts.length > 0) {
    console.log(chalk.blue('\n  Scripts:'));
    for (const s of scripts) {
      console.log(chalk.gray(`    ${s.name}`));
    }
  }

  // List files
  try {
    const files = await listFilesRecursive(skill.dirPath, 2);
    console.log(chalk.blue('\n  Files:'));
    for (const f of files) {
      console.log(chalk.gray(`    ${f}`));
    }
  } catch { /* ignore */ }
}

/**
 * List files recursively (limited depth)
 */
async function listFilesRecursive(dir, maxDepth, prefix = '') {
  const files = [];
  if (maxDepth <= 0) return files;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const subFiles = await listFilesRecursive(path.join(dir, entry.name), maxDepth - 1, relPath);
      files.push(...subFiles);
    } else {
      files.push(relPath);
    }
  }
  return files;
}

/**
 * Create a new skill
 */
export async function createSkill(workingDir, skillName, options = {}) {
  if (!skillName) {
    console.log(chalk.red('Please specify a skill name'));
    return;
  }

  if (!/^[a-z0-9-]+$/.test(skillName)) {
    console.log(chalk.red('Skill name must be lowercase alphanumeric with hyphens only'));
    return;
  }

  const dirs = getSkillDirs(workingDir);
  const targetDir = options.global ? dirs.global : dirs.project;
  const source = options.global ? 'global' : 'project';
  const skillDir = path.join(targetDir, skillName);

  if (await fs.pathExists(skillDir)) {
    console.log(chalk.red(`Skill already exists: ${skillName} (${source})`));
    return;
  }

  await fs.ensureDir(skillDir);
  await fs.ensureDir(path.join(skillDir, 'scripts'));

  const description = options.description || `A skill for ${skillName}`;
  const author = os.userInfo().username;

  const skillContent = `---
name: ${skillName}
description: "${description}"
version: "1.0.0"
author: ${author}
tags: []
triggers:
  - ${skillName}
keywords: []
hooks: {}
compatibility:
  os:
    - linux
    - macos
    - windows
  node: ">=18"
dependencies: []
---

# ${skillName}

## Overview
${description}

## Instructions
<!-- Add your skill instructions here -->

## Examples
<!-- Add usage examples here -->
`;

  await fs.writeFile(path.join(skillDir, SKILL_FILE), skillContent, 'utf-8');

  // Create reference template
  const refContent = `# ${skillName} Reference\n\n## Detailed Information\n<!-- Add detailed reference material here -->\n`;
  await fs.writeFile(path.join(skillDir, 'REFERENCE.md'), refContent, 'utf-8');

  console.log(chalk.green(`\n✓ Created skill: ${skillName} (${source})`));
  console.log(chalk.gray(`  Location: ${skillDir}`));
  console.log(chalk.blue('\n  Next steps:'));
  console.log(chalk.gray('  1. Edit SKILL.md to customize your skill'));
  console.log(chalk.gray('  2. Add scripts to scripts/ directory'));
  console.log(chalk.gray('  3. Test with: /skills list'));
}

/**
 * Remove a skill from a specific scope or entirely
 * 
 * Behaviors:
 * - /skills remove <name> --project  → Remove from project only (global stays)
 * - /skills remove <name> --global   → Remove from global only (project stays)
 * - /skills remove <name> --all      → Remove from ALL scopes (complete delete)
 * - /skills remove <name>            → Remove from project if exists, otherwise global
 */
export async function removeSkill(workingDir, skillName, options = {}) {
  if (!skillName) {
    console.log(chalk.red('Please specify a skill name to remove'));
    return;
  }

  const dirs = getSkillDirs(workingDir);
  const projectDir = path.join(dirs.project, skillName);
  const globalDir = path.join(dirs.global, skillName);
  const inProject = await fs.pathExists(projectDir);
  const inGlobal = await fs.pathExists(globalDir);

  if (!inProject && !inGlobal) {
    console.log(chalk.red(`Skill not found: ${skillName}`));
    console.log(chalk.gray('Use /skills list to see available skills'));
    return;
  }

  // --all: remove from every scope
  if (options.all) {
    const removed = [];
    if (inProject) {
      await fs.remove(projectDir);
      removed.push('project');
    }
    if (inGlobal) {
      await fs.remove(globalDir);
      removed.push('global');
    }
    console.log(chalk.green(`✓ Completely removed skill: ${skillName}`));
    console.log(chalk.gray(`  Removed from: ${removed.join(', ')}`));
    return;
  }

  // --global: only remove from global
  if (options.global) {
    if (!inGlobal) {
      console.log(chalk.yellow(`Skill "${skillName}" not found in global scope`));
      if (inProject) console.log(chalk.gray(`  It exists in project scope. Use --project or --all to remove it there.`));
      return;
    }
    await fs.remove(globalDir);
    console.log(chalk.green(`✓ Removed skill from global: ${skillName}`));
    if (inProject) console.log(chalk.gray(`  Project copy still available.`));
    return;
  }

  // --project: only remove from project
  if (options.project) {
    if (!inProject) {
      console.log(chalk.yellow(`Skill "${skillName}" not found in project scope`));
      if (inGlobal) console.log(chalk.gray(`  It exists in global scope and is still available to all projects.`));
      return;
    }
    await fs.remove(projectDir);
    console.log(chalk.green(`✓ Removed skill from project: ${skillName}`));
    if (inGlobal) console.log(chalk.gray(`  Global copy still available to all projects.`));
    return;
  }

  // No flag: remove from project first, fall back to global
  if (inProject) {
    await fs.remove(projectDir);
    console.log(chalk.green(`✓ Removed skill from project: ${skillName}`));
    if (inGlobal) console.log(chalk.gray(`  Global copy still available. Use --all to remove completely.`));
  } else {
    await fs.remove(globalDir);
    console.log(chalk.green(`✓ Removed skill from global: ${skillName}`));
    console.log(chalk.gray(`  This skill was only in global scope and is now deleted.`));
  }
}


/**
 * Transfer a skill between scopes
 * 
 * Supports:
 * - /skills transfer <name> --from global --to project  (global → project)
 * - /skills transfer <name> --from project --to global  (project → global)
 * - /skills transfer <name> --from project --to <other-project-dir>  (project → other project)
 * 
 * When --to is a path (not 'global' or 'project'), copies to that project's .openagent/skills/ dir.
 */
export async function transferSkill(workingDir, skillName, options = {}) {
  if (!skillName) {
    console.log(chalk.red('Please specify a skill name to transfer'));
    return;
  }

  const dirs = getSkillDirs(workingDir);
  const fromScope = options.from || 'project';
  const toScope = options.to || 'global';

  if (fromScope === toScope) {
    console.log(chalk.red('Source and destination must be different'));
    return;
  }

  // Resolve source directory
  let fromDir;
  if (fromScope === 'global') {
    fromDir = dirs.global;
  } else if (fromScope === 'project') {
    fromDir = dirs.project;
  } else {
    // Treat as a project path
    fromDir = path.join(fromScope, '.openagent', SKILLS_DIR);
  }

  // Resolve destination directory
  let toDir;
  let toLabel;
  if (toScope === 'global') {
    toDir = dirs.global;
    toLabel = 'global';
  } else if (toScope === 'project') {
    toDir = dirs.project;
    toLabel = 'project';
  } else {
    // Treat as a project path — transfer to another project
    toDir = path.join(toScope, '.openagent', SKILLS_DIR);
    toLabel = `project: ${toScope}`;
  }

  const fromPath = path.join(fromDir, skillName);
  const toPath = path.join(toDir, skillName);

  if (!await fs.pathExists(fromPath)) {
    console.log(chalk.red(`Skill not found in ${fromScope}: ${skillName}`));
    return;
  }

  if (await fs.pathExists(toPath)) {
    console.log(chalk.red(`Skill already exists in ${toLabel}: ${skillName}`));
    console.log(chalk.gray('Remove it first with /skills remove <name> --' + (toScope === 'global' ? 'global' : 'project')));
    return;
  }

  await fs.ensureDir(toDir);
  await fs.copy(fromPath, toPath);
  await fs.remove(fromPath);

  console.log(chalk.green(`✓ Transferred skill: ${skillName}`));
  console.log(chalk.gray(`  ${fromScope} → ${toLabel}`));
}

/**
 * Search the registry for skills
 */
export async function searchSkills(query, options = {}) {
  if (!query) {
    console.log(chalk.red('Please provide a search query'));
    return;
  }

  const registry = createRegistry();
  console.log(chalk.blue(`Searching for: ${query}...`));

  try {
    const result = await registry.search(query, { limit: options.limit || 10 });

    if (result.skills.length === 0) {
      console.log(chalk.yellow('No skills found'));
      if (result.fromCache) {
        console.log(chalk.gray('(Results from offline cache)'));
      }
      return;
    }

    console.log(chalk.blue(`\\nFound ${result.skills.length} skill(s):\\n`));

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
      console.log(chalk.gray('(Results from offline cache)'));
    }
  } catch (error) {
    console.error(chalk.red(`Search failed: ${error.message}`));
  }
}

/**
 * Install a skill from the registry
 */
export async function installSkill(skillId, options = {}) {
  if (!skillId) {
    console.log(chalk.red('Please specify a skill ID to install'));
    return;
  }

  const registry = createRegistry();
  const parser = new EnhancedSkillParser({ verbose: false });

  try {
    console.log(chalk.blue(`Fetching info for ${skillId}...`));
    const info = await registry.getSkillInfo(skillId);

    if (!info.success) {
      console.error(chalk.red(`Skill not found: ${skillId}`));
      return;
    }

    const skill = info.skill;
    console.log(chalk.blue(`\nSkill: ${skill.name}`));
    console.log(chalk.gray(`Description: ${skill.description}`));
    console.log(chalk.gray(`Version: ${skill.version}`));
    console.log(chalk.gray(`Author: ${skill.author}`));

    if (skill.dependencies.length > 0) {
      console.log(chalk.yellow(`\nDependencies: ${skill.dependencies.join(', ')}`));
    }

    console.log(chalk.blue(`\nInstalling ${skill.name}...`));
    const result = await registry.install(skillId, { version: options.version || 'latest', force: options.force });

    if (result.success) {
      console.log(chalk.green(`✓ Successfully installed ${skill.name} v${result.version}`));
      console.log(chalk.gray(`Location: ${result.path}`));

      // Check compatibility
      const enhanced = await parser.loadEnhancedSkill(result.path);
      if (enhanced && !enhanced.isCompatible()) {
        console.log(chalk.yellow(`⚠ Skill may not be compatible with your system`));
      }
    } else {
      console.error(chalk.red(`Installation failed: ${result.error}`));
    }
  } catch (error) {
    console.error(chalk.red(`Installation error: ${error.message}`));
  }
}

/**
 * Update skills
 */
export async function updateSkills(skillId, _options = {}) {
  const registry = createRegistry();

  try {
    if (skillId) {
      console.log(chalk.blue(`Updating ${skillId}...`));
      const result = await registry.install(skillId, { force: true });

      if (result.success) {
        console.log(chalk.green(`✓ Updated ${skillId} to v${result.version}`));
      } else {
        console.error(chalk.red(`Update failed: ${result.error}`));
      }
    } else {
      console.log(chalk.blue('Checking for updates...'));
      const { updates } = await registry.checkForUpdates();

      if (updates.length === 0) {
        console.log(chalk.green('All skills are up to date'));
        return;
      }

      console.log(chalk.yellow(`Found ${updates.length} skill(s) with updates:`));
      for (const update of updates) {
        console.log(chalk.gray(`  ${update.skillId}: ${update.currentVersion} → ${update.availableVersion}`));
      }

      console.log(chalk.blue('\nUpdating skills...'));
      const result = await registry.update();

      console.log(chalk.green(`\n✓ Updated ${result.updated} skill(s)`));
      if (result.failed > 0) {
        console.log(chalk.red(`✗ Failed to update ${result.failed} skill(s)`));
      }
    }
  } catch (error) {
    console.error(chalk.red(`Update error: ${error.message}`));
  }
}

/**
 * Parse arguments from a command string
 */
function parseArgs(argStr) {
  const args = [];
  const options = {};

  if (!argStr) return { args, options };

  const parts = argStr.trim().split(/\s+/);
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.startsWith('--')) {
      const key = part.slice(2);
      if (key === 'json') {
        options.json = true;
      } else if (key === 'global') {
        options.globalOnly = true;
        options.global = true;
      } else if (key === 'project') {
        options.projectOnly = true;
        options.project = true;
      } else if (key === 'force') {
        options.force = true;
      } else if (key === 'all') {
        options.all = true;
      } else if (key === 'from' || key === 'to' || key === 'desc' || key === 'limit' || key === 'version') {
        i++;
        if (i < parts.length) {
          if (key === 'from') options.from = parts[i];
          else if (key === 'to') options.to = parts[i];
          else if (key === 'desc') options.description = parts[i];
          else if (key === 'limit') options.limit = parseInt(parts[i], 10);
          else if (key === 'version') options.version = parts[i];
        }
      }
    } else {
      args.push(part);
    }
    i++;
  }

  return { args, options };
}

/**
 * Main handler for /skills commands
 */
export async function handleSkillsCommand(workingDir, argStr) {
  const { args, options } = parseArgs(argStr);
  const subcommand = args[0];
  const name = args[1];

  switch (subcommand) {
    case 'list':
    case 'ls':
      await listSkills(workingDir, options);
      break;

    case 'info':
    case 'show':
      await showSkillInfo(workingDir, name);
      break;

    case 'create':
    case 'new':
      await createSkill(workingDir, name, options);
      break;

    case 'remove':
    case 'rm':
    case 'delete':
      await removeSkill(workingDir, name, options);
      break;

    case 'transfer':
    case 'move':
    case 'mv':
      await transferSkill(workingDir, name, options);
      break;

    case 'search':
    case 'find':
      await searchSkills(name, options);
      break;

    case 'install':
    case 'get':
      await installSkill(name, options);
      break;

    case 'update':
    case 'upgrade':
      await updateSkills(name, options);
      break;

    case 'help':
    default:
      console.log(chalk.blue('\n📋 Skills Commands:\n'));
      console.log(chalk.gray('  /skills list [--global|--project]       ') + chalk.dim('List all skills'));
      console.log(chalk.gray('  /skills info <name>                     ') + chalk.dim('Show skill details'));
      console.log(chalk.gray('  /skills create <name> [--global] [--desc <text>]') + chalk.dim('Create a new skill'));
      console.log(chalk.gray('  /skills remove <name> [--global|--project|--all]') + chalk.dim('Remove a skill'));
      console.log(chalk.gray('  /skills transfer <name> --from X --to Y ') + chalk.dim('Move skill (global↔project, project↔project)'));
      console.log(chalk.gray('  /skills search <query> [--limit N]      ') + chalk.dim('Search registry for skills'));
      console.log(chalk.gray('  /skills install <id> [--version V]      ') + chalk.dim('Install from registry'));
      console.log(chalk.gray('  /skills update [id]                     ') + chalk.dim('Update skills'));
      console.log();
      break;
  }
}

/**
 * Handle skills as a shell subcommand (openagent skills list)
 * Returns true if handled, false otherwise
 */
export async function handleShellSkillsCommand(workingDir, args) {
  const subcommand = args[0] || 'list';
  const rest = args.slice(1).join(' ');
  await handleSkillsCommand(workingDir, `${subcommand} ${rest}`.trim());
}
