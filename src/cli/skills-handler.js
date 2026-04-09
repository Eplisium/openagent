/**
 * 🎯 Skills Handler for CLI
 * Handles /skills commands in the REPL and shell subcommands
 * 
 * Supports:
 * - /skills list [--global|--project] — List all skills
 * - /skills create <name> [--global] — Create a new skill
 * - /skills remove <name> [--global|--project] — Remove a skill
 * - /skills transfer <name> --from project --to global (or vice versa)
 * - /skills info <name> — Show skill details
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { SkillManager } from '../skills/SkillManager.js';

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
 * Scan a skills directory and return skill info
 */
async function scanSkillsDir(dir, source) {
  const skills = [];
  if (!await fs.pathExists(dir)) return skills;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const skillFile = path.join(skillDir, SKILL_FILE);
    
    let description = '';
    let version = '';
    let tags = [];
    
    if (await fs.pathExists(skillFile)) {
      try {
        const content = await fs.readFile(skillFile, 'utf-8');
        // Parse YAML frontmatter
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          // Handle multi-line description (YAML > folded scalar)
          const descBlockMatch = fm.match(/description:\s*>\n((?:\s+.+\n?)+)/);
          const descInlineMatch = fm.match(/description:\s*["']?(.+?)["']?\s*$/m);
          if (descBlockMatch) {
            description = descBlockMatch[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ');
          } else if (descInlineMatch) {
            description = descInlineMatch[1].trim().replace(/^["']|["']$/g, '');
          }
          const verMatch = fm.match(/version:\s*["']?([^"'\n]+)["']?/);
          const tagsMatch = fm.match(/tags:\s*\[(.*?)\]/);
          if (verMatch) version = verMatch[1].trim();
          if (tagsMatch) tags = tagsMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, ''));
        }
      } catch { /* ignore parse errors */ }
    }
    
    skills.push({
      name: entry.name,
      source,
      dir: skillDir,
      description,
      version: version || 'local',
      tags,
    });
  }
  return skills;
}

/**
 * List all skills (global + project)
 */
export async function listSkills(workingDir, options = {}) {
  const dirs = getSkillDirs(workingDir);
  const globalSkills = await scanSkillsDir(dirs.global, 'global');
  const projectSkills = await scanSkillsDir(dirs.project, 'project');

  const showGlobal = !options.projectOnly;
  const showProject = !options.globalOnly;

  const allSkills = [];
  if (showGlobal) allSkills.push(...globalSkills);
  if (showProject) allSkills.push(...projectSkills);

  if (allSkills.length === 0) {
    console.log(chalk.yellow('\nNo skills installed.'));
    console.log(chalk.gray('  Global skills: ') + chalk.dim(dirs.global));
    console.log(chalk.gray('  Project skills: ') + chalk.dim(dirs.project));
    console.log(chalk.gray('\nUse /skills create <name> to create a skill'));
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
    console.log(JSON.stringify({ global: globalSkills, project: projectSkills }, null, 2));
  }
}

/**
 * Show detailed info about a skill
 */
export async function showSkillInfo(workingDir, skillName) {
  const dirs = getSkillDirs(workingDir);
  const globalSkills = await scanSkillsDir(dirs.global, 'global');
  const projectSkills = await scanSkillsDir(dirs.project, 'project');

  const skill = [...projectSkills, ...globalSkills].find(s => s.name === skillName);
  if (!skill) {
    console.log(chalk.red(`Skill not found: ${skillName}`));
    console.log(chalk.gray('Use /skills list to see available skills'));
    return;
  }

  const sourceIcon = skill.source === 'global' ? '🌐' : '📁';
  console.log(chalk.blue(`\n${sourceIcon} Skill: ${chalk.bold(skill.name)}\n`));
  console.log(chalk.gray(`  Source:    ${skill.source}`));
  console.log(chalk.gray(`  Version:   ${skill.version}`));
  console.log(chalk.gray(`  Path:      ${skill.dir}`));
  if (skill.description) console.log(chalk.gray(`  Description: ${skill.description}`));
  if (skill.tags.length > 0) console.log(chalk.gray(`  Tags:      ${skill.tags.join(', ')}`));

  // List files
  try {
    const files = await listFilesRecursive(skill.dir, 2);
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
 * Remove a skill
 */
export async function removeSkill(workingDir, skillName, options = {}) {
  if (!skillName) {
    console.log(chalk.red('Please specify a skill name to remove'));
    return;
  }

  const dirs = getSkillDirs(workingDir);
  
  // Find the skill
  let targetDir = null;
  let source = null;

  if (options.global) {
    const skillDir = path.join(dirs.global, skillName);
    if (await fs.pathExists(skillDir)) {
      targetDir = skillDir;
      source = 'global';
    }
  } else if (options.project) {
    const skillDir = path.join(dirs.project, skillName);
    if (await fs.pathExists(skillDir)) {
      targetDir = skillDir;
      source = 'project';
    }
  } else {
    // Search both
    const projectDir = path.join(dirs.project, skillName);
    const globalDir = path.join(dirs.global, skillName);
    if (await fs.pathExists(projectDir)) {
      targetDir = projectDir;
      source = 'project';
    } else if (await fs.pathExists(globalDir)) {
      targetDir = globalDir;
      source = 'global';
    }
  }

  if (!targetDir) {
    console.log(chalk.red(`Skill not found: ${skillName}`));
    console.log(chalk.gray('Use /skills list to see available skills'));
    return;
  }

  await fs.remove(targetDir);
  console.log(chalk.green(`✓ Removed skill: ${skillName} (${source})`));
}

/**
 * Transfer a skill between global and project
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

  const fromDir = fromScope === 'global' ? dirs.global : dirs.project;
  const toDir = toScope === 'global' ? dirs.global : dirs.project;
  const fromPath = path.join(fromDir, skillName);
  const toPath = path.join(toDir, skillName);

  if (!await fs.pathExists(fromPath)) {
    console.log(chalk.red(`Skill not found in ${fromScope}: ${skillName}`));
    return;
  }

  if (await fs.pathExists(toPath)) {
    console.log(chalk.red(`Skill already exists in ${toScope}: ${skillName}`));
    console.log(chalk.gray('Remove it first with /skills remove <name> --' + toScope));
    return;
  }

  await fs.ensureDir(toDir);
  await fs.copy(fromPath, toPath);
  await fs.remove(fromPath);

  console.log(chalk.green(`✓ Transferred skill: ${skillName}`));
  console.log(chalk.gray(`  ${fromScope} → ${toScope}`));
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
      } else if (key === 'project') {
        options.projectOnly = true;
      } else if (key === 'from' || key === 'to' || key === 'desc') {
        i++;
        if (i < parts.length) {
          if (key === 'from') options.from = parts[i];
          else if (key === 'to') options.to = parts[i];
          else if (key === 'desc') options.description = parts[i];
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

    case 'help':
    default:
      console.log(chalk.blue('\n📋 Skills Commands:\n'));
      console.log(chalk.gray('  /skills list [--global|--project]  ') + chalk.dim('List all skills'));
      console.log(chalk.gray('  /skills info <name>                ') + chalk.dim('Show skill details'));
      console.log(chalk.gray('  /skills create <name> [--global]   ') + chalk.dim('Create a new skill'));
      console.log(chalk.gray('  /skills remove <name> [--global]   ') + chalk.dim('Remove a skill'));
      console.log(chalk.gray('  /skills transfer <name> --from X --to Y') + chalk.dim('Move skill between scopes'));
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
