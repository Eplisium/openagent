/**
 * Unit tests for MemoryManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('MemoryManager', () => {
  let manager;
  let testDir;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `openagent-test-${Date.now()}`);
    await fs.ensureDir(testDir);
    manager = new MemoryManager({
      workingDir: testDir,
      openAgentDir: path.join(testDir, '.openagent'),
      globalMemoryDir: path.join(testDir, '.openagent-global'),
      verbose: false,
    });
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  // MemoryManager doesn't have parseFrontmatter (that's SkillManager)
  // MemoryManager uses resolveImports instead

  describe('resolveImports', () => {
    it('should resolve @imports in content', async () => {
      const importDir = path.join(testDir, 'imports');
      await fs.ensureDir(importDir);
      await fs.writeFile(path.join(importDir, 'extra.md'), 'Imported content here');

      const content = 'Before\n@imports/extra.md\nAfter';
      const resolved = await manager.resolveImports(content, testDir);

      expect(resolved).toContain('Imported content here');
      expect(resolved).toContain('Imported from: imports/extra.md');
    });

    it('should handle missing imports gracefully', async () => {
      const content = '@nonexistent/file.md';
      const resolved = await manager.resolveImports(content, testDir);

      expect(resolved).toContain('Import not found');
    });

    it('should handle deeply nested imports', async () => {
      // Create a chain of imports
      const dir = path.join(testDir, 'chain');
      await fs.ensureDir(dir);
      
      // Create 7 files that chain-import each other
      for (let i = 1; i <= 7; i++) {
        const next = i + 1;
        const content = next <= 7 ? `@chain/f${next}.md` : 'Deep content';
        await fs.writeFile(path.join(dir, `f${i}.md`), content);
      }

      const resolved = await manager.resolveImports('@chain/f1.md', testDir);
      // Should contain the first few levels and eventually hit depth limit
      expect(resolved).toContain('Imported from');
    });
  });

  describe('loadAll', () => {
    it('should return empty sections when no memory files exist', async () => {
      const memory = await manager.loadAll();
      expect(memory.sections).toHaveLength(0);
      expect(memory.combined).toBe('');
    });

    it('should load AGENTS.md from project root', async () => {
      await fs.writeFile(
        path.join(testDir, 'AGENTS.md'),
        '# Project Info\nThis is a test project'
      );

      const memory = await manager.loadAll();
      expect(memory.sections).toHaveLength(1);
      expect(memory.sections[0].source).toBe('project:AGENTS.md');
      expect(memory.combined).toContain('test project');
    });

    it('should load OPENAGENT.md from project root', async () => {
      await fs.writeFile(
        path.join(testDir, 'OPENAGENT.md'),
        '# OpenAgent Config\nCustom settings here'
      );

      const memory = await manager.loadAll();
      expect(memory.sections.some(s => s.source === 'project:OPENAGENT.md')).toBe(true);
    });

    it('should load CLAUDE.md for compatibility', async () => {
      await fs.writeFile(
        path.join(testDir, 'CLAUDE.md'),
        '# Claude Config\nClaude-specific settings'
      );

      const memory = await manager.loadAll();
      expect(memory.sections.some(s => s.source === 'project:CLAUDE.md')).toBe(true);
    });

    it('should load MEMORY.md with auto-load truncation', async () => {
      const memoryDir = path.join(testDir, '.openagent', 'memory');
      await fs.ensureDir(memoryDir);
      
      // Create MEMORY.md with 300 lines
      const lines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`);
      await fs.writeFile(
        path.join(memoryDir, 'MEMORY.md'),
        lines.join('\n')
      );

      const memory = await manager.loadAll();
      const memorySection = memory.sections.find(s => s.source === 'project:MEMORY.md');
      expect(memorySection).toBeDefined();
      expect(memorySection.truncated).toBe(true);
    });

    it('should cache results within TTL', async () => {
      await fs.writeFile(path.join(testDir, 'AGENTS.md'), 'Test');
      
      const first = await manager.loadAll();
      const second = await manager.loadAll();
      
      expect(first).toBe(second); // Same reference = cached
    });
  });

  describe('saveMemory', () => {
    it('should save learning to project MEMORY.md', async () => {
      const result = await manager.saveMemory('Always use const over let', {
        category: 'Convention',
      });

      expect(result.path).toContain('MEMORY.md');
      expect(result.entry).toContain('Always use const over let');
      expect(result.entry).toContain('Convention');

      // Verify file was written
      const content = await fs.readFile(result.path, 'utf-8');
      expect(content).toContain('Always use const over let');
    });

    it('should append to existing MEMORY.md', async () => {
      await manager.saveMemory('First learning', { category: 'A' });
      await manager.saveMemory('Second learning', { category: 'B' });

      const memoryDir = manager.getMemoryDir();
      const content = await fs.readFile(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      
      expect(content).toContain('First learning');
      expect(content).toContain('Second learning');
    });
  });

  describe('initProject', () => {
    it('should create AGENTS.md, OPENAGENT.md, and MEMORY.md', async () => {
      await manager.initProject();

      expect(await fs.pathExists(path.join(testDir, 'AGENTS.md'))).toBe(true);
      expect(await fs.pathExists(path.join(testDir, 'OPENAGENT.md'))).toBe(true);
      expect(await fs.pathExists(path.join(manager.getMemoryDir(), 'MEMORY.md'))).toBe(true);
    });

    it('should not overwrite existing files', async () => {
      await fs.writeFile(path.join(testDir, 'AGENTS.md'), 'Existing content');
      
      await manager.initProject();

      const content = await fs.readFile(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content).toBe('Existing content');
    });
  });

  describe('getStats', () => {
    it('should return memory statistics', async () => {
      await fs.writeFile(path.join(testDir, 'AGENTS.md'), 'Line 1\nLine 2');
      await manager.initProject();

      const stats = await manager.getStats();
      expect(stats.existingFiles).toBeGreaterThan(0);
      expect(stats.totalLines).toBeGreaterThan(0);
    });
  });
});
