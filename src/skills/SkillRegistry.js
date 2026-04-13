/**
 * 🎯 Skill Registry v1.0
 * Remote skill discovery, installation, and dependency management
 * 
 * Features:
 * - Remote registry API integration (ClawHub-compatible)
 * - Local skill caching with versioning
 * - Skill installation/uninstallation
 * - Search and filtering
 * - Dependency resolution
 */

import fs from '../utils/fs-compat.js';
import path from 'path';
import os from 'os';
import chalk from '../utils/chalk-compat.js';
// execSync removed — not used

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_REGISTRY_URL = 'https://registry.openagent.ai/api/v1';
const CACHE_FILE = 'registry-cache.json';
const SKILL_FILE = 'SKILL.md';
const MANIFEST_FILE = 'skill-manifest.json';

// ═══════════════════════════════════════════════════════════════════
// 🎯 Skill Package Class
// ═══════════════════════════════════════════════════════════════════

/**
 * Represents a skill package from the registry
 */
export class SkillPackage {
  constructor(data = {}) {
    this.id = data.id || '';
    this.name = data.name || '';
    this.version = data.version || '1.0.0';
    this.description = data.description || '';
    this.author = data.author || '';
    this.license = data.license || 'MIT';
    this.tags = data.tags || [];
    this.dependencies = data.dependencies || [];
    this.keywords = data.keywords || [];
    this.downloads = data.downloads || 0;
    this.rating = data.rating || 0;
    this.updatedAt = data.updatedAt || '';
    this.homepage = data.homepage || '';
    this.repository = data.repository || '';
  }

  /**
   * Create from registry API response
   */
  static fromRegistry(data) {
    return new SkillPackage({
      id: data.slug || data.id,
      name: data.name,
      version: data.latest_version || data.version,
      description: data.description,
      author: data.author?.username || data.author,
      license: data.license || 'MIT',
      tags: data.tags || [],
      dependencies: data.dependencies || [],
      keywords: data.keywords || [],
      downloads: data.download_count || data.downloads || 0,
      rating: data.rating || 0,
      updatedAt: data.updated_at || data.updatedAt || '',
      homepage: data.homepage || '',
      repository: data.repository || '',
    });
  }

  /**
   * Convert to metadata summary
   */
  toSummary() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      tags: this.tags,
      downloads: this.downloads,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 Skill Registry
// ═══════════════════════════════════════════════════════════════════

/**
 * Manages skill discovery, installation, and updates from remote registries
 */
export class SkillRegistry {
  constructor(options = {}) {
    this.registryUrl = options.registryUrl || DEFAULT_REGISTRY_URL;
    this.cacheDir = options.cacheDir || path.join(os.homedir(), '.openagent', 'cache');
    this.globalSkillsDir = options.globalSkillsDir || path.join(os.homedir(), '.openagent', 'skills');
    this.cacheFile = path.join(this.cacheDir, CACHE_FILE);
    this.verbose = options.verbose !== false;
    
    // In-memory cache
    this._cache = null;
    this._cacheTimestamp = 0;
    this._cacheTTL = options.cacheTTL || 3600000; // 1 hour default
  }

  /**
   * Ensure cache directory exists
   */
  async ensureCacheDir() {
    await fs.ensureDir(this.cacheDir);
  }

  /**
   * Load cache from disk
   */
  async loadCache() {
    if (this._cache && Date.now() - this._cacheTimestamp < this._cacheTTL) {
      return this._cache;
    }

    await this.ensureCacheDir();
    
    if (await fs.pathExists(this.cacheFile)) {
      try {
        const data = await fs.readJson(this.cacheFile);
        this._cache = data;
        this._cacheTimestamp = Date.now();
        return data;
      } catch (err) {
        if (this.verbose) {
          console.log(chalk.yellow(`⚠ Failed to load cache: ${err.message}`));
        }
      }
    }

    this._cache = { skills: {}, lastUpdated: null };
    return this._cache;
  }

  /**
   * Save cache to disk
   */
  async saveCache(cache) {
    await this.ensureCacheDir();
    cache.lastUpdated = new Date().toISOString();
    await fs.writeJson(this.cacheFile, cache, { spaces: 2 });
    this._cache = cache;
    this._cacheTimestamp = Date.now();
  }

  /**
   * Fetch from registry API with error handling
   */
  async fetchFromRegistry(endpoint, options = {}) {
    const url = `${this.registryUrl}${endpoint}`;
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...options.headers,
        },
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Registry request timed out');
      }
      throw err;
    }
  }

  /**
   * Search for skills in the registry
   */
  async search(query, options = {}) {
    const { limit = 20, offset = 0, tags = [] } = options;
    
    try {
      const params = new URLSearchParams({
        q: query,
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      if (tags.length > 0) {
        params.set('tags', tags.join(','));
      }
      
      const data = await this.fetchFromRegistry(`/skills/search?${params}`);
      
      const skills = (data.skills || []).map(s => SkillPackage.fromRegistry(s));
      
      // Update cache
      const cache = await this.loadCache();
      for (const skill of skills) {
        cache.skills[skill.id] = skill;
      }
      await this.saveCache(cache);
      
      return {
        success: true,
        skills,
        total: data.total || skills.length,
        query,
      };
    } catch (err) {
      if (this.verbose) {
        console.log(chalk.yellow(`⚠ Registry search failed: ${err.message}`));
      }
      
      // Fallback to local cache
      return this.searchLocalCache(query, options);
    }
  }

  /**
   * Search local cache (offline fallback)
   */
  async searchLocalCache(query, options = {}) {
    const { limit = 20, tags = [] } = options;
    const cache = await this.loadCache();
    
    const queryLower = query.toLowerCase();
    const skills = Object.values(cache.skills)
      .filter(skill => {
        const matchesQuery = 
          skill.name.toLowerCase().includes(queryLower) ||
          skill.description.toLowerCase().includes(queryLower) ||
          skill.keywords?.some(k => k.toLowerCase().includes(queryLower));
        
        const matchesTags = tags.length === 0 ||
          tags.some(t => skill.tags?.includes(t));
        
        return matchesQuery && matchesTags;
      })
      .slice(0, limit);
    
    return {
      success: true,
      skills,
      total: skills.length,
      query,
      fromCache: true,
    };
  }

  /**
   * Get skill details from registry
   */
  async getSkillInfo(skillId) {
    try {
      const data = await this.fetchFromRegistry(`/skills/${skillId}`);
      return {
        success: true,
        skill: SkillPackage.fromRegistry(data),
      };
    } catch (_err) {
      // Check cache
      const cache = await this.loadCache();
      if (cache.skills[skillId]) {
        return {
          success: true,
          skill: cache.skills[skillId],
          fromCache: true,
        };
      }
      
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }
  }

  /**
   * Download and install a skill
   */
  async install(skillId, options = {}) {
    const { version = 'latest', force = false } = options;
    
    const installDir = path.join(this.globalSkillsDir, skillId);
    
    // Check if already installed
    if (await fs.pathExists(installDir) && !force) {
      const manifestPath = path.join(installDir, MANIFEST_FILE);
      if (await fs.pathExists(manifestPath)) {
        const manifest = await fs.readJson(manifestPath);
        if (manifest.version) {
          return {
            success: false,
            error: `Skill already installed (v${manifest.version}). Use force=true to reinstall.`,
            installed: true,
            currentVersion: manifest.version,
          };
        }
      }
    }
    
    try {
      // Download skill package
      const versionParam = version === 'latest' ? '' : `?version=${version}`;
      const data = await this.fetchFromRegistry(`/skills/${skillId}/download${versionParam}`);
      
      // Resolve dependencies
      if (data.dependencies?.length > 0) {
        await this.resolveDependencies(data.dependencies, options);
      }
      
      // Create skill directory
      await fs.ensureDir(installDir);
      await fs.ensureDir(path.join(installDir, 'scripts'));
      
      // Write SKILL.md
      if (data.skillContent) {
        await fs.writeFile(path.join(installDir, SKILL_FILE), data.skillContent, 'utf-8');
      }
      
      // Write scripts
      if (data.scripts) {
        for (const [name, content] of Object.entries(data.scripts)) {
          const scriptPath = path.join(installDir, 'scripts', name);
          await fs.writeFile(scriptPath, content, 'utf-8');
          // Make executable
          await fs.chmod(scriptPath, 0o755);
        }
      }
      
      // Write manifest
      const manifest = {
        id: skillId,
        name: data.name || skillId,
        version: data.version || '1.0.0',
        author: data.author || 'unknown',
        installedAt: new Date().toISOString(),
        installedFrom: this.registryUrl,
        dependencies: data.dependencies || [],
      };
      await fs.writeJson(path.join(installDir, MANIFEST_FILE), manifest, { spaces: 2 });
      
      // Update cache
      const cache = await this.loadCache();
      cache.skills[skillId] = SkillPackage.fromRegistry(data);
      await this.saveCache(cache);
      
      if (this.verbose) {
        console.log(chalk.green(`✓ Installed skill: ${skillId} v${manifest.version}`));
      }
      
      return {
        success: true,
        skillId,
        version: manifest.version,
        path: installDir,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to install skill: ${err.message}`,
      };
    }
  }

  /**
   * Resolve and install dependencies
   */
  async resolveDependencies(dependencies, options = {}) {
    const results = [];
    
    for (const dep of dependencies) {
      const depId = typeof dep === 'string' ? dep : dep.name;
      const depVersion = typeof dep === 'string' ? 'latest' : (dep.version || 'latest');
      
      // Skip if already installed
      const depDir = path.join(this.globalSkillsDir, depId);
      if (await fs.pathExists(depDir)) {
        results.push({ skillId: depId, status: 'already_installed' });
        continue;
      }
      
      const result = await this.install(depId, { ...options, version: depVersion });
      results.push({ skillId: depId, status: result.success ? 'installed' : 'failed', error: result.error });
    }
    
    return results;
  }

  /**
   * Uninstall a skill
   */
  async uninstall(skillId) {
    const skillDir = path.join(this.globalSkillsDir, skillId);
    
    if (!await fs.pathExists(skillDir)) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }
    
    try {
      await fs.remove(skillDir);
      
      if (this.verbose) {
        console.log(chalk.green(`✓ Uninstalled skill: ${skillId}`));
      }
      
      return {
        success: true,
        skillId,
        message: 'Skill uninstalled successfully',
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to uninstall: ${err.message}`,
      };
    }
  }

  /**
   * Check for updates for all installed skills
   */
  async checkForUpdates() {
    const updates = [];
    
    if (!await fs.pathExists(this.globalSkillsDir)) {
      return { success: true, updates: [] };
    }
    
    const entries = await fs.readdir(this.globalSkillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const skillId = entry.name;
      const manifestPath = path.join(this.globalSkillsDir, skillId, MANIFEST_FILE);
      
      if (!await fs.pathExists(manifestPath)) continue;
      
      try {
        const manifest = await fs.readJson(manifestPath);
        const info = await this.getSkillInfo(skillId);
        
        if (info.success && info.skill.version !== manifest.version) {
          updates.push({
            skillId,
            currentVersion: manifest.version,
            availableVersion: info.skill.version,
          });
        }
      } catch (_err) {
        // Skip skills with invalid manifests
      }
    }
    
    return { success: true, updates };
  }

  /**
   * Update a specific skill or all skills
   */
  async update(skillId = null) {
    if (skillId) {
      return this.install(skillId, { force: true });
    }
    
    const { updates } = await this.checkForUpdates();
    const results = [];
    
    for (const update of updates) {
      const result = await this.install(update.skillId, { force: true });
      results.push({
        skillId: update.skillId,
        ...result,
      });
    }
    
    return {
      success: true,
      updated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }

  /**
   * List all installed skills with their versions
   */
  async listInstalled() {
    const skills = [];
    
    if (!await fs.pathExists(this.globalSkillsDir)) {
      return skills;
    }
    
    const entries = await fs.readdir(this.globalSkillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const skillId = entry.name;
      const manifestPath = path.join(this.globalSkillsDir, skillId, MANIFEST_FILE);
      const skillPath = path.join(this.globalSkillsDir, skillId);
      
      if (await fs.pathExists(manifestPath)) {
        try {
          const manifest = await fs.readJson(manifestPath);
          skills.push({
            id: skillId,
            name: manifest.name || skillId,
            version: manifest.version,
            author: manifest.author,
            installedAt: manifest.installedAt,
            path: skillPath,
          });
        } catch {
          // Include without manifest info
          skills.push({
            id: skillId,
            name: skillId,
            version: 'unknown',
            path: skillPath,
          });
        }
      } else {
        skills.push({
          id: skillId,
          name: skillId,
          version: 'local',
          path: skillPath,
        });
      }
    }
    
    return skills;
  }

  /**
   * Get registry statistics
   */
  async getStats() {
    const installed = await this.listInstalled();
    const { updates } = await this.checkForUpdates();
    const cache = await this.loadCache();
    
    return {
      installedCount: installed.length,
      updatesAvailable: updates.length,
      cachedSkills: Object.keys(cache.skills).length,
      cacheLastUpdated: cache.lastUpdated,
      registryUrl: this.registryUrl,
    };
  }

  /**
   * Clear the registry cache
   */
  async clearCache() {
    this._cache = null;
    this._cacheTimestamp = 0;
    
    if (await fs.pathExists(this.cacheFile)) {
      await fs.remove(this.cacheFile);
    }
    
    return { success: true, message: 'Cache cleared' };
  }
}

export default SkillRegistry;
