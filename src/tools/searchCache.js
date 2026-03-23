/**
 * 🗄️ Multi-Tier Search Cache
 * Memory LRU + Disk-backed caching for web search results
 *
 * - Memory LRU: 200 entries, 10-minute TTL
 * - Disk cache: .openagent/search-cache/ directory, JSON files named by hash(query+engine)
 * - Auto-cleanup: delete disk cache entries older than 24 hours on startup
 */

import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MEMORY_MAX_ENTRIES = 200;
const MEMORY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DISK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DISK_DIR_NAME = '.openagent/search-cache';

let diskDir = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex').substring(0, 24);
}

async function getDiskDir(baseDir) {
  if (diskDir) return diskDir;
  diskDir = join(baseDir, DISK_DIR_NAME);
  try {
    await mkdir(diskDir, { recursive: true });
  } catch {
    // Directory may already exist
  }
  return diskDir;
}

function getDiskPath(dir, hash) {
  return join(dir, `${hash}.json`);
}

// ---------------------------------------------------------------------------
// Memory LRU Cache
// ---------------------------------------------------------------------------

class MemoryLRU {
  constructor(maxEntries = MEMORY_MAX_ENTRIES, ttlMs = MEMORY_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    /** @type {Map<string, { data: any, timestamp: number }>} */
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
  }

  set(key, data) {
    // Delete if exists (to re-insert at end)
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict oldest if at capacity
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }

    this.store.set(key, { data, timestamp: Date.now() });
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  get size() {
    return this.store.size;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Disk Cache
// ---------------------------------------------------------------------------

class DiskCache {
  constructor() {
    this.initialized = false;
    this.baseDir = null;
  }

  async init(baseDir) {
    this.baseDir = await getDiskDir(baseDir);
    this.initialized = true;
    // Clean up old entries on startup
    await this.cleanup();
  }

  async get(key) {
    if (!this.initialized) return undefined;
    const filePath = getDiskPath(this.baseDir, hashKey(key));
    try {
      const raw = await readFile(filePath, 'utf-8');
      const entry = JSON.parse(raw);

      // Check TTL
      if (Date.now() - entry.timestamp > DISK_TTL_MS) {
        await unlink(filePath).catch(() => {});
        return undefined;
      }

      return entry.data;
    } catch {
      return undefined;
    }
  }

  async set(key, data) {
    if (!this.initialized) return;
    const filePath = getDiskPath(this.baseDir, hashKey(key));
    try {
      const entry = JSON.stringify({ data, timestamp: Date.now() });
      await writeFile(filePath, entry, 'utf-8');
    } catch {
      // Disk write failure is non-fatal
    }
  }

  async cleanup() {
    if (!this.initialized) return;
    try {
      const files = await readdir(this.baseDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(this.baseDir, file);
        try {
          const s = await stat(filePath);
          if (now - s.mtimeMs > DISK_TTL_MS) {
            await unlink(filePath).catch(() => {});
          }
        } catch {
          // File may have been deleted
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }
}

// ---------------------------------------------------------------------------
// SearchCache — unified multi-tier interface
// ---------------------------------------------------------------------------

/**
 * Multi-tier search cache with memory LRU + disk persistence.
 *
 * Usage:
 *   const cache = new SearchCache();
 *   await cache.init('/path/to/project');  // sets disk cache directory
 *
 *   const cached = await cache.get('query', 'engine', maxResults);
 *   if (cached) { return cached; }
 *
 *   const results = await doSearch();
 *   await cache.set('query', 'engine', maxResults, results);
 */
export class SearchCache {
  constructor() {
    this.memory = new MemoryLRU(MEMORY_MAX_ENTRIES, MEMORY_TTL_MS);
    this.disk = new DiskCache();
  }

  /**
   * Initialize the cache. Must be called before use.
   * @param {string} baseDir - Project root directory (disk cache goes in .openagent/search-cache/)
   */
  async init(baseDir) {
    await this.disk.init(baseDir);
  }

  /**
   * Build a cache key from query parameters.
   */
  _buildKey(query, engine, maxResults) {
    return `${engine}:${query}:${maxResults}`;
  }

  /**
   * Get cached results. Checks memory first, then disk.
   * @param {string} query
   * @param {string} engine
   * @param {number} maxResults
   * @returns {Promise<any|undefined>}
   */
  async get(query, engine, maxResults) {
    const key = this._buildKey(query, engine, maxResults);

    // Tier 1: Memory
    const memResult = this.memory.get(key);
    if (memResult !== undefined) {
      return { ...memResult, cached: true, cacheTier: 'memory' };
    }

    // Tier 2: Disk
    const diskResult = await this.disk.get(key);
    if (diskResult !== undefined) {
      // Promote to memory
      this.memory.set(key, diskResult);
      return { ...diskResult, cached: true, cacheTier: 'disk' };
    }

    return undefined;
  }

  /**
   * Store results in both memory and disk.
   * @param {string} query
   * @param {string} engine
   * @param {number} maxResults
   * @param {any} data
   */
  async set(query, engine, maxResults, data) {
    const key = this._buildKey(query, engine, maxResults);

    // Store in memory
    this.memory.set(key, data);

    // Store on disk (async, non-blocking)
    this.disk.set(key, data).catch(() => {});
  }

  /**
   * Periodic memory cleanup (call from heartbeat or similar).
   */
  cleanupMemory() {
    this.memory.cleanup();
  }

  /**
   * Force disk cleanup.
   */
  async cleanupDisk() {
    await this.disk.cleanup();
  }

  /**
   * Get cache stats for debugging.
   */
  getStats() {
    return {
      memoryEntries: this.memory.size,
      memoryMaxEntries: this.memory.maxEntries,
      memoryTtlMs: this.memory.ttlMs,
      diskTtlMs: DISK_TTL_MS,
      diskInitialized: this.disk.initialized,
    };
  }
}

// Singleton instance
let _instance = null;

/**
 * Get the singleton SearchCache instance.
 */
export function getSearchCache() {
  if (!_instance) {
    _instance = new SearchCache();
  }
  return _instance;
}

export default SearchCache;
