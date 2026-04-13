import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillRegistry, SkillPackage } from '../../src/skills/SkillRegistry.js';
import fs from '../../src/utils/fs-compat.js';
import path from 'path';
import os from 'os';

// Mock fetch globally
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Mock fs-compat (replaces fs-extra)
vi.mock('../../src/utils/fs-compat.js', () => ({
  default: {
    ensureDir: vi.fn(),
    pathExists: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    writeFile: vi.fn(),
    chmod: vi.fn(),
    remove: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
  },
  __esModule: true,
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('SkillRegistry', () => {
  let registry;
  let mockFetch;
  const originalFetch = global.fetch;
  
  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();
    
    // Setup mock implementations
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    registry = new SkillRegistry({
      registryUrl: 'https://test-registry.example.com/api/v1',
      cacheDir: '/tmp/test-cache',
      globalSkillsDir: '/tmp/test-skills',
      verbose: false,
    });
    
    // Setup default mock behaviors
    fs.ensureDir.mockResolvedValue(undefined);
    fs.pathExists.mockResolvedValue(false);
    fs.readJson.mockResolvedValue({ skills: {}, lastUpdated: null });
    fs.writeJson.mockResolvedValue(undefined);
  });
  
  afterEach(() => {
    global.fetch = originalFetch;
  });
  
  describe('SkillPackage', () => {
    it('should create from registry data', () => {
      const data = {
        slug: 'test-skill',
        name: 'Test Skill',
        latest_version: '2.1.0',
        description: 'A test skill',
        author: { username: 'testuser' },
        license: 'MIT',
        tags: ['test', 'example'],
        dependencies: ['dep1'],
        keywords: ['testing'],
        download_count: 1000,
        rating: 4.5,
        updated_at: '2024-01-01T00:00:00Z',
        homepage: 'https://example.com',
        repository: 'https://github.com/test/test-skill',
      };
      
      const pkg = SkillPackage.fromRegistry(data);
      
      expect(pkg.id).toBe('test-skill');
      expect(pkg.name).toBe('Test Skill');
      expect(pkg.version).toBe('2.1.0');
      expect(pkg.description).toBe('A test skill');
      expect(pkg.author).toBe('testuser');
      expect(pkg.tags).toEqual(['test', 'example']);
      expect(pkg.downloads).toBe(1000);
      expect(pkg.rating).toBe(4.5);
    });
    
    it('should create from minimal data', () => {
      const data = {
        slug: 'minimal-skill',
        name: 'Minimal Skill',
      };
      
      const pkg = SkillPackage.fromRegistry(data);
      
      expect(pkg.id).toBe('minimal-skill');
      expect(pkg.name).toBe('Minimal Skill');
      expect(pkg.version).toBe('1.0.0'); // default
      expect(pkg.author).toBe('');
      expect(pkg.tags).toEqual([]);
    });
  });
  
  describe('search', () => {
    it('should search registry successfully', async () => {
      const mockResponse = {
        skills: [
          {
            slug: 'skill-1',
            name: 'Skill 1',
            description: 'First skill',
          },
          {
            slug: 'skill-2',
            name: 'Skill 2',
            description: 'Second skill',
          },
        ],
        total: 2,
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      
      const result = await registry.search('test query');
      
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(2);
      expect(result.skills[0].id).toBe('skill-1');
      expect(result.skills[1].id).toBe('skill-2');
      expect(result.total).toBe(2);
      
      // Check fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-registry.example.com/api/v1/skills/search?q=test+query&limit=20&offset=0',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          headers: expect.objectContaining({
            'Accept': 'application/json',
          }),
        })
      );
    });
    
    it('should fallback to local cache on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      const cache = {
        skills: {
          'cached-skill': new SkillPackage({
            id: 'cached-skill',
            name: 'Cached Skill',
            description: 'From cache',
          }),
        },
        lastUpdated: '2024-01-01T00:00:00Z',
      };
      
      fs.pathExists.mockResolvedValueOnce(true);
      fs.readJson.mockResolvedValueOnce(cache);
      
      const result = await registry.search('cached');
      
      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].id).toBe('cached-skill');
    });
    
    it('should filter by tags', async () => {
      const mockResponse = {
        skills: [
          {
            slug: 'tagged-skill',
            name: 'Tagged Skill',
            tags: ['python', 'ai'],
          },
        ],
        total: 1,
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      
      await registry.search('test', { tags: ['python'] });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('tags=python'),
        expect.any(Object)
      );
    });
  });
  
  describe('install', () => {
    it('should install a skill successfully', async () => {
      const skillId = 'test-skill';
      const mockData = {
        name: 'Test Skill',
        version: '1.2.0',
        author: 'testuser',
        skillContent: '# Test Skill\n\nInstructions here',
        scripts: {
          'run.sh': '#!/bin/bash\necho "Running skill"',
        },
        dependencies: [],
      };
      
      // Mock registry API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });
      
      // Mock file system
      fs.pathExists.mockResolvedValue(false);
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);
      fs.chmod.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);
      
      const result = await registry.install(skillId);
      
      expect(result.success).toBe(true);
      expect(result.skillId).toBe(skillId);
      expect(result.version).toBe('1.2.0');
      expect(result.path).toContain(skillId);
      
      // Verify file operations
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('SKILL.md'),
        mockData.skillContent,
        'utf-8'
      );
      expect(fs.chmod).toHaveBeenCalledWith(
        expect.stringContaining('run.sh'),
        0o755
      );
    });
    
    it('should skip installation if already installed', async () => {
      const skillId = 'installed-skill';
      
      // Mock existing installation
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({
        version: '1.0.0',
        installedAt: '2024-01-01T00:00:00Z',
      });
      
      const result = await registry.install(skillId);
      
      expect(result.success).toBe(false);
      expect(result.installed).toBe(true);
      expect(result.currentVersion).toBe('1.0.0');
      
      // Should not call registry API
      expect(mockFetch).not.toHaveBeenCalled();
    });
    
    it('should force reinstall when requested', async () => {
      const skillId = 'force-skill';
      const mockData = {
        name: 'Force Skill',
        version: '2.0.0',
        skillContent: '# Force Skill',
        scripts: {},
        dependencies: [],
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });
      
      fs.pathExists.mockResolvedValue(true); // Already exists
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);
      fs.chmod.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);
      
      const result = await registry.install(skillId, { force: true });
      
      expect(result.success).toBe(true);
      expect(result.version).toBe('2.0.0');
    });
  });
  
  describe('uninstall', () => {
    it('should uninstall a skill successfully', async () => {
      const skillId = 'remove-skill';
      const skillDir = path.join('/tmp/test-skills', skillId);
      
      fs.pathExists.mockResolvedValue(true);
      fs.remove.mockResolvedValue(undefined);
      
      const result = await registry.uninstall(skillId);
      
      expect(result.success).toBe(true);
      expect(result.skillId).toBe(skillId);
      
      expect(fs.remove).toHaveBeenCalledWith(skillDir);
    });
    
    it('should handle non-existent skill', async () => {
      const skillId = 'nonexistent';
      
      fs.pathExists.mockResolvedValue(false);
      
      const result = await registry.uninstall(skillId);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
  
  describe('checkForUpdates', () => {
    it('should check for available updates', async () => {
      const skillsDir = '/tmp/test-skills';
      
      fs.pathExists.mockImplementation((p) => {
        const normalized = p.replace(/\\/g, '/');
        if (normalized === skillsDir) return Promise.resolve(true);
        if (normalized.includes('skill-1/')) return Promise.resolve(true);
        if (normalized.includes('skill-2/')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      
      fs.readdir.mockResolvedValue([
        { name: 'skill-1', isDirectory: () => true },
        { name: 'skill-2', isDirectory: () => true },
      ]);
      
      fs.readJson.mockImplementation((p) => {
        const normalized = p.replace(/\\/g, '/');
        if (normalized.includes('skill-1/')) {
          return Promise.resolve({ version: '1.0.0' });
        }
        if (normalized.includes('skill-2/')) {
          return Promise.resolve({ version: '2.0.0' });
        }
        return Promise.resolve({});
      });
      
      // Mock getSkillInfo for each skill
      const getSkillInfoSpy = vi.spyOn(registry, 'getSkillInfo');
      getSkillInfoSpy
        .mockResolvedValueOnce({
          success: true,
          skill: { version: '1.1.0' },
        })
        .mockResolvedValueOnce({
          success: true,
          skill: { version: '2.0.0' },
        });
      
      const { updates } = await registry.checkForUpdates();
      
      expect(updates).toHaveLength(1);
      expect(updates[0].skillId).toBe('skill-1');
      expect(updates[0].currentVersion).toBe('1.0.0');
      expect(updates[0].availableVersion).toBe('1.1.0');
    });
  });
  
  describe('cache management', () => {
    it('should load cache from disk', async () => {
      const cacheData = {
        skills: {
          'cached': new SkillPackage({ id: 'cached' }),
        },
        lastUpdated: '2024-01-01T00:00:00Z',
      };
      
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue(cacheData);
      
      const cache = await registry.loadCache();
      
      expect(cache).toEqual(cacheData);
      expect(registry._cache).toEqual(cacheData);
    });
    
    it('should create empty cache if not exists', async () => {
      fs.pathExists.mockResolvedValue(false);
      fs.writeJson.mockResolvedValue(undefined);
      
      const cache = await registry.loadCache();
      
      expect(cache).toEqual({ skills: {}, lastUpdated: null });
      // fs.writeJson is not called for empty cache in current implementation
    });
    
    it('should save cache to disk', async () => {
      const cache = {
        skills: { test: {} },
        lastUpdated: null,
      };
      
      fs.ensureDir.mockResolvedValue(undefined);
      fs.writeJson.mockResolvedValue(undefined);
      
      await registry.saveCache(cache);
      
      expect(cache.lastUpdated).toBeDefined();
      expect(fs.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('registry-cache.json'),
        cache,
        { spaces: 2 }
      );
    });
  });
  
  describe('listInstalled', () => {
    it('should list installed skills with manifest', async () => {
      const skillsDir = '/tmp/test-skills';
      
      fs.pathExists.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([
        { name: 'skill-a', isDirectory: () => true },
        { name: 'skill-b', isDirectory: () => true },
      ]);
      
      fs.readJson.mockImplementation((p) => {
        if (p.includes('skill-a')) {
          return Promise.resolve({
            name: 'Skill A',
            version: '1.0.0',
            author: 'author-a',
            installedAt: '2024-01-01T00:00:00Z',
          });
        }
        if (p.includes('skill-b')) {
          return Promise.resolve({
            name: 'Skill B',
            version: '2.0.0',
            author: 'author-b',
            installedAt: '2024-01-02T00:00:00Z',
          });
        }
        return Promise.reject(new Error('Not found'));
      });
      
      const skills = await registry.listInstalled();
      
      expect(skills).toHaveLength(2);
      expect(skills[0].name).toBe('Skill A');
      expect(skills[1].version).toBe('2.0.0');
    });
    
    it('should handle skills without manifest', async () => {
      const skillsDir = '/tmp/test-skills';
      
      fs.pathExists.mockImplementation((p) => {
        if (p === skillsDir) return Promise.resolve(true);
        if (p.includes('manifest-missing')) return Promise.resolve(false);
        return Promise.resolve(false);
      });
      
      fs.readdir.mockResolvedValue([
        { name: 'manifest-missing', isDirectory: () => true },
      ]);
      
      const skills = await registry.listInstalled();
      
      expect(skills).toHaveLength(1);
      expect(skills[0].version).toBe('local');
    });
  });
  
  describe('getStats', () => {
    it('should return registry statistics', async () => {
      const listInstalledSpy = vi.spyOn(registry, 'listInstalled');
      const checkForUpdatesSpy = vi.spyOn(registry, 'checkForUpdates');
      const loadCacheSpy = vi.spyOn(registry, 'loadCache');
      
      listInstalledSpy.mockResolvedValue([{}, {}, {}]);
      checkForUpdatesSpy.mockResolvedValue({ updates: [{}] });
      loadCacheSpy.mockResolvedValue({
        skills: { a: {}, b: {} },
        lastUpdated: '2024-01-01T00:00:00Z',
      });
      
      const stats = await registry.getStats();
      
      expect(stats.installedCount).toBe(3);
      expect(stats.updatesAvailable).toBe(1);
      expect(stats.cachedSkills).toBe(2);
      expect(stats.cacheLastUpdated).toBe('2024-01-01T00:00:00Z');
      expect(stats.registryUrl).toBe('https://test-registry.example.com/api/v1');
    });
  });
});
