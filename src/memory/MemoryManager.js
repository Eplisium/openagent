/**
 * 🧠 Memory Manager v5.0
 * Project memory system with AGENTS.md hierarchy, @imports, and auto-memory
 * 
 * Architecture inspired by Claude Code's memory system:
 * - AGENTS.md hierarchy: global → project → subdirectory
 * - OPENAGENT.md: OpenAgent-specific configuration
 * - MEMORY.md: Agent-written learnings (auto-memory)
 * - @imports: Modular context references
 * - Progressive loading: First 200 lines of MEMORY.md auto-load
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

const MEMORY_FILE = 'MEMORY.md';
const AGENTS_FILE = 'AGENTS.md';
const OPENAGENT_FILE = 'OPENAGENT.md';
const CLAUDE_FILE = 'CLAUDE.md'; // Support reading existing CLAUDE.md files

const MAX_IMPORT_DEPTH = 5;
const MEMORY_AUTO_LOAD_LINES = 200;
const MAX_MEMORY_FILE_SIZE = 50000; // chars

// ═══════════════════════════════════════════════════════════════════
// 🧠 Memory Manager
// ═══════════════════════════════════════════════════════════════════

export class MemoryManager {
  constructor(options = {}) {
    this.workingDir = path.resolve(options.workingDir || process.cwd());
    this.openAgentDir = options.openAgentDir || path.join(this.workingDir, '.openagent');
    this.globalMemoryDir = options.globalMemoryDir || path.join(os.homedir(), '.openagent');
    this.verbose = options.verbose !== false;
    
    // Memory file paths
    this.paths = {
      // Global level
      globalAgents: path.join(this.globalMemoryDir, AGENTS_FILE),
      globalOpenAgent: path.join(this.globalMemoryDir, OPENAGENT_FILE),
      globalMemory: path.join(this.globalMemoryDir, 'memory', MEMORY_FILE),
      
      // Project level
      projectAgents: path.join(this.workingDir, AGENTS_FILE),
      projectOpenAgent: path.join(this.workingDir, OPENAGENT_FILE),
      projectClaude: path.join(this.workingDir, CLAUDE_FILE),
      projectMemory: path.join(this.openAgentDir, 'memory', MEMORY_FILE),
      
      // Local (non-committed) level
      projectLocal: path.join(this.workingDir, 'OPENAGENT.local.md'),
    };
    
    // Cache for loaded memory
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = options.cacheTTL || 60000; // 1 minute
  }

  /**
   * Get the memory directory for a project
   */
  getMemoryDir() {
    return path.join(this.openAgentDir, 'memory');
  }

  getProjectPaths() {
    return {
      agents: this.paths.projectAgents,
      openagent: this.paths.projectOpenAgent,
      memory: this.paths.projectMemory,
      local: this.paths.projectLocal,
      openAgentDir: this.openAgentDir,
    };
  }

  /**
   * Ensure memory directories exist
   */
  async ensureDirs() {
    await fs.ensureDir(this.globalMemoryDir);
    await fs.ensureDir(path.join(this.globalMemoryDir, 'memory'));
    await fs.ensureDir(this.openAgentDir);
    await fs.ensureDir(this.getMemoryDir());
  }

  /**
   * Resolve @imports in content recursively
   * @param {string} content - Content with potential @imports
   * @param {string} basePath - Base directory for resolving imports
   * @param {number} depth - Current import depth (max 5)
   * @returns {Promise<string>} Content with imports resolved
   */
  async resolveImports(content, basePath, depth = 0) {
    if (depth >= MAX_IMPORT_DEPTH) {
      return content + '\n\n[Max import depth reached]';
    }

    const importRegex = /^@(.+)$/gm;
    let result = content;
    const matches = [...content.matchAll(importRegex)];

    for (const match of matches) {
      const importPath = match[1].trim();
      const resolvedPath = path.resolve(basePath, importPath);
      
      try {
        if (await fs.pathExists(resolvedPath)) {
          const importedContent = await fs.readFile(resolvedPath, 'utf-8');
          // Recursively resolve imports in imported content
          const resolved = await this.resolveImports(
            importedContent,
            path.dirname(resolvedPath),
            depth + 1
          );
          result = result.replace(match[0], `\n<!-- Imported from: ${importPath} -->\n${resolved}\n<!-- End import: ${importPath} -->\n`);
        } else {
          result = result.replace(match[0], `<!-- Import not found: ${importPath} -->`);
        }
      } catch (err) {
        result = result.replace(match[0], `<!-- Import error: ${importPath} - ${err.message} -->`);
      }
    }

    return result;
  }

  /**
   * Read a memory file if it exists
   * @param {string} filePath - Path to memory file
   * @param {boolean} resolveImports - Whether to resolve @imports
   * @returns {Promise<{content: string, path: string} | null>}
   */
  async readFile(filePath, resolveImports = true) {
    try {
      if (!await fs.pathExists(filePath)) {
        return null;
      }

      const stat = await fs.stat(filePath);
      if (stat.size > MAX_MEMORY_FILE_SIZE) {
        if (this.verbose) {
          console.log(chalk.yellow(`⚠ Memory file too large: ${filePath}`));
        }
        return null;
      }

      let content = await fs.readFile(filePath, 'utf-8');
      
      if (resolveImports) {
        content = await this.resolveImports(content, path.dirname(filePath));
      }

      return { content, path: filePath };
    } catch (err) {
      if (this.verbose) {
        console.log(chalk.dim(`  Could not read ${filePath}: ${err.message}`));
      }
      return null;
    }
  }

  /**
   * Load the full memory hierarchy
   * Order (bottom-up, later files take precedence):
   * 1. Global AGENTS.md
   * 2. Global OPENAGENT.md
   * 3. Project AGENTS.md
   * 4. Project CLAUDE.md (compatibility)
   * 5. Project OPENAGENT.md
   * 6. Project OPENAGENT.local.md (non-committed)
   * 7. Global MEMORY.md (agent-written)
   * 8. Project MEMORY.md (agent-written, first 200 lines auto-load)
   */
  async loadAll() {
    // Check cache
    if (this._cache && (Date.now() - this._cacheTime < this._cacheTTL)) {
      return this._cache;
    }

    const sections = [];

    // 1. Global AGENTS.md
    const globalAgents = await this.readFile(this.paths.globalAgents);
    if (globalAgents) {
      sections.push({ source: 'global:AGENTS.md', ...globalAgents });
    }

    // 2. Global OPENAGENT.md
    const globalOpenAgent = await this.readFile(this.paths.globalOpenAgent);
    if (globalOpenAgent) {
      sections.push({ source: 'global:OPENAGENT.md', ...globalOpenAgent });
    }

    // 3. Project AGENTS.md
    const projectAgents = await this.readFile(this.paths.projectAgents);
    if (projectAgents) {
      sections.push({ source: 'project:AGENTS.md', ...projectAgents });
    }

    // 4. Project CLAUDE.md (compatibility)
    const projectClaude = await this.readFile(this.paths.projectClaude);
    if (projectClaude) {
      sections.push({ source: 'project:CLAUDE.md', ...projectClaude });
    }

    // 5. Project OPENAGENT.md
    const projectOpenAgent = await this.readFile(this.paths.projectOpenAgent);
    if (projectOpenAgent) {
      sections.push({ source: 'project:OPENAGENT.md', ...projectOpenAgent });
    }

    // 6. Project OPENAGENT.local.md (non-committed)
    const projectLocal = await this.readFile(this.paths.projectLocal);
    if (projectLocal) {
      sections.push({ source: 'project:OPENAGENT.local.md', ...projectLocal });
    }

    // 7. Global MEMORY.md (agent-written)
    const globalMemory = await this.readFile(this.paths.globalMemory);
    if (globalMemory) {
      const lines = globalMemory.content.split('\n');
      const autoLoad = lines.slice(0, MEMORY_AUTO_LOAD_LINES).join('\n');
      sections.push({ 
        source: 'global:MEMORY.md', 
        content: autoLoad,
        path: globalMemory.path,
        truncated: lines.length > MEMORY_AUTO_LOAD_LINES
      });
    }

    // 8. Project MEMORY.md (agent-written, first 200 lines auto-load)
    const projectMemory = await this.readFile(this.paths.projectMemory);
    if (projectMemory) {
      const lines = projectMemory.content.split('\n');
      const autoLoad = lines.slice(0, MEMORY_AUTO_LOAD_LINES).join('\n');
      sections.push({ 
        source: 'project:MEMORY.md', 
        content: autoLoad,
        path: projectMemory.path,
        truncated: lines.length > MEMORY_AUTO_LOAD_LINES
      });
    }

    // Cache result
    this._cache = {
      sections,
      combined: this.buildCombinedContext(sections),
      timestamp: new Date().toISOString(),
    };
    this._cacheTime = Date.now();

    return this._cache;
  }

  /**
   * Build combined context from all memory sections
   */
  buildCombinedContext(sections) {
    if (sections.length === 0) {
      return '';
    }

    const parts = [];
    
    for (const section of sections) {
      parts.push(`<!-- Source: ${section.source} -->`);
      parts.push(section.content.trim());
      if (section.truncated) {
        parts.push(`\n<!-- Memory truncated. Full file: ${section.path} -->`);
      }
      parts.push(''); // Blank line between sections
    }

    return parts.join('\n');
  }

  /**
   * Get memory context for injection into system prompt
   * @returns {Promise<string>} Formatted memory context
   */
  async getContext() {
    const memory = await this.loadAll();
    
    if (!memory.combined) {
      return '';
    }

    return `## 📋 Project Memory

The following context is loaded from your project memory files (AGENTS.md, OPENAGENT.md, MEMORY.md):

${memory.combined}

---
*Memory loaded from ${memory.sections.length} source(s) at ${memory.timestamp}*
*Use \`save_memory\` to record learnings for future sessions.*`;
  }

  /**
   * Save a learning to the project MEMORY.md (auto-memory)
   * @param {string} learning - The learning to save
   * @param {object} options - Options
   */
  async saveMemory(learning, options = {}) {
    await this.ensureDirs();
    
    const memoryPath = options.global 
      ? this.paths.globalMemory 
      : this.paths.projectMemory;
    
    let existing = '';
    if (await fs.pathExists(memoryPath)) {
      existing = await fs.readFile(memoryPath, 'utf-8');
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const entry = `\n## ${timestamp} — ${options.category || 'Learning'}\n\n${learning}\n`;

    // Append to existing memory
    const updated = existing.trimEnd() + '\n' + entry;
    
    await fs.writeFile(memoryPath, updated, 'utf-8');
    
    // Invalidate cache
    this._cache = null;

    if (this.verbose) {
      console.log(chalk.green(`✓ Saved to ${options.global ? 'global' : 'project'} memory`));
    }

    return { path: memoryPath, entry };
  }

  /**
   * List all memory files and their status
   */
  async listFiles() {
    const files = [];

    for (const [key, filePath] of Object.entries(this.paths)) {
      const exists = await fs.pathExists(filePath);
      let size = 0;
      let lines = 0;
      
      if (exists) {
        const stat = await fs.stat(filePath);
        size = stat.size;
        const content = await fs.readFile(filePath, 'utf-8');
        lines = content.split('\n').length;
      }

      files.push({
        name: key,
        path: filePath,
        exists,
        size,
        lines,
      });
    }

    return files;
  }

  /**
   * Initialize memory files for a project
   * Creates starter AGENTS.md and OPENAGENT.md
   */
  async initProject(options = {}) {
    await this.ensureDirs();

    // Create AGENTS.md if it doesn't exist
    if (!await fs.pathExists(this.paths.projectAgents)) {
      const agentsContent = `# AGENTS.md

## Project Overview
<!-- Brief description of this project -->

## Build & Test Commands
- \`npm test\` — Run tests
- \`npm run build\` — Build project
- \`npm run lint\` — Run linter

## Code Style
<!-- Coding conventions and preferences -->

## Architecture
<!-- Key architectural decisions -->

## Important Notes
<!-- Things an AI agent should know -->
`;
      await fs.writeFile(this.paths.projectAgents, agentsContent, 'utf-8');
      if (this.verbose) {
        console.log(chalk.green('✓ Created AGENTS.md'));
      }
    }

    // Create OPENAGENT.md if it doesn't exist
    if (!await fs.pathExists(this.paths.projectOpenAgent)) {
      const openAgentContent = `# OPENAGENT.md

## OpenAgent Configuration
<!-- OpenAgent-specific settings and preferences -->

## Skills
<!-- Custom skills for this project -->

## Hooks
<!-- Custom hooks for this project -->

## Model Preferences
<!-- Preferred models for different tasks -->
`;
      await fs.writeFile(this.paths.projectOpenAgent, openAgentContent, 'utf-8');
      if (this.verbose) {
        console.log(chalk.green('✓ Created OPENAGENT.md'));
      }
    }

    // Create memory directory
    await fs.ensureDir(this.getMemoryDir());
    
    // Create initial MEMORY.md if it doesn't exist
    const memoryPath = this.paths.projectMemory;
    if (!await fs.pathExists(memoryPath)) {
      const memoryContent = `# Project Memory

This file is automatically maintained by OpenAgent. It contains learnings and insights from previous sessions.

## Key Learnings
<!-- Agent will add learnings here -->

## Common Patterns
<!-- Recurring patterns discovered -->

## Gotchas
<!-- Things to watch out for -->
`;
      await fs.writeFile(memoryPath, memoryContent, 'utf-8');
      if (this.verbose) {
        console.log(chalk.green('✓ Created MEMORY.md'));
      }
    }

    return { initialized: true };
  }

  /**
   * Clear the memory cache
   */
  clearCache() {
    this._cache = null;
    this._cacheTime = 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔍 MemMA Validator support methods
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get the raw content string of the project MEMORY.md.
   * Used by MemoryValidator during probe verification.
   *
   * @returns {Promise<string>} Raw markdown content (empty string if file missing)
   */
  async getMemoryContent() {
    const memoryPath = this.paths.projectMemory;
    if (!await fs.pathExists(memoryPath)) {
      return '';
    }
    try {
      return await fs.readFile(memoryPath, 'utf-8');
    } catch (err) {
      if (this.verbose) {
        console.log(chalk.dim(`  Could not read MEMORY.md: ${err.message}`));
      }
      return '';
    }
  }

  /**
   * Apply a repair action to the project MEMORY.md.
   * Supports: insert (append new content), merge (replace a target section), remove (delete target lines).
   *
   * @param {object} opts
   * @param {'insert'|'merge'|'remove'} opts.action - The repair action
   * @param {string} [opts.target]  - Exact text / heading to locate for merge/remove
   * @param {string} [opts.content] - New content to insert or replace with
   * @returns {Promise<{action: string, path: string}>}
   */
  async applyRepair({ action, target, content }) {
    await this.ensureDirs();
    const memoryPath = this.paths.projectMemory;

    let existing = '';
    if (await fs.pathExists(memoryPath)) {
      existing = await fs.readFile(memoryPath, 'utf-8');
    }

    const timestamp = new Date().toISOString().split('T')[0];
    let updated;

    switch (action) {
      case 'insert': {
        // Append as a new dated section
        const block = content.startsWith('#')
          ? `\n${content.trim()}\n`
          : `\n## ${timestamp} — Memory Repair\n\n${content.trim()}\n`;
        updated = existing.trimEnd() + '\n' + block;
        break;
      }

      case 'merge': {
        if (target && existing.includes(target)) {
          // Replace the target text with new content
          updated = existing.replace(target, content || '');
        } else {
          // Target not found — fall back to insert
          const block = content.startsWith('#')
            ? `\n${content.trim()}\n`
            : `\n## ${timestamp} — Memory Repair (Merge)\n\n${content.trim()}\n`;
          updated = existing.trimEnd() + '\n' + block;
        }
        break;
      }

      case 'remove': {
        if (target && existing.includes(target)) {
          updated = existing.replace(target, '');
        } else {
          // Nothing to remove
          updated = existing;
        }
        break;
      }

      default:
        throw new Error(`applyRepair: unknown action "${action}"`);
    }

    await fs.writeFile(memoryPath, updated, 'utf-8');

    // Invalidate cache so next load picks up the change
    this._cache = null;

    if (this.verbose) {
      console.log(chalk.green(`✓ Applied repair (${action}) to MEMORY.md`));
    }

    return { action, path: memoryPath };
  }

  /**
   * Get detailed stats about the project MEMORY.md.
   * Used by MemoryValidator during quickCheck().
   *
   * @returns {Promise<{totalEntries: number, sections: string[], categories: string[], lastUpdated: string|null}>}
   */
  async getMemoryStats() {
    const content = await this.getMemoryContent();

    if (!content) {
      return { totalEntries: 0, sections: [], categories: [], lastUpdated: null };
    }

    const lines = content.split('\n');

    // Collect ## headings (dated entries use "## YYYY-MM-DD — Category" format)
    const sectionRegex = /^#{2,3} (.+)$/;
    const sections = [];
    const categories = new Set();

    // Date pattern like "2024-01-15" in a heading
    const dateHeadingRegex = /^#{2,3} (\d{4}-\d{2}-\d{2})[^\n]*/;
    let lastUpdated = null;

    for (const line of lines) {
      const sectionMatch = line.match(sectionRegex);
      if (sectionMatch) {
        sections.push(sectionMatch[1].trim());

        // Extract category from "YYYY-MM-DD — Category" headings
        const catPart = sectionMatch[1].replace(/^\d{4}-\d{2}-\d{2}\s*[—–-]\s*/, '').trim();
        if (catPart && catPart !== sectionMatch[1]) {
          // Only add if we actually stripped a date prefix
          categories.add(catPart);
        }
      }

      const dateMatch = line.match(dateHeadingRegex);
      if (dateMatch) {
        const d = dateMatch[1];
        if (!lastUpdated || d > lastUpdated) {
          lastUpdated = d;
        }
      }
    }

    // Count entries: ## headings that start with a date
    const totalEntries = sections.filter(s => /^\d{4}-\d{2}-\d{2}/.test(s)).length;

    return {
      totalEntries,
      sections,
      categories: [...categories],
      lastUpdated,
    };
  }

  /**
   * Get memory stats
   */
  async getStats() {
    const files = await this.listFiles();
    const existingFiles = files.filter(f => f.exists);
    
    return {
      totalFiles: files.length,
      existingFiles: existingFiles.length,
      totalLines: existingFiles.reduce((sum, f) => sum + f.lines, 0),
      totalSize: existingFiles.reduce((sum, f) => sum + f.size, 0),
      files: existingFiles.map(f => ({
        name: f.name,
        lines: f.lines,
        size: f.size,
      })),
    };
  }
}

export default MemoryManager;
