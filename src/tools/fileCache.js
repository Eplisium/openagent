/**
 * 📦 File Content LRU Cache
 * Caches file reads with mtime validation for instant re-reads
 */

import fs from 'fs-extra';

const DEFAULT_MAX_ENTRIES = 500;

class FileLRUCache {
  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    this.cache = new Map(); // filePath -> { content, mtime, size }
  }

  /**
   * Get cached file content if the mtime matches.
   * Returns { content } on hit, null on miss/stale.
   */
  get(filePath, currentMtimeMs) {
    const entry = this.cache.get(filePath);
    if (!entry) return null;

    if (entry.mtime === currentMtimeMs) {
      // LRU: re-insert to mark as recently used
      this.cache.delete(filePath);
      this.cache.set(filePath, entry);
      return { content: entry.content };
    }

    // Stale entry — remove it
    this.cache.delete(filePath);
    return null;
  }

  /**
   * Store file content in cache.
   */
  set(filePath, content, mtimeMs, size) {
    // LRU eviction: if already exists, delete first to update position
    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    }

    this.cache.set(filePath, { content, mtime: mtimeMs, size });

    // Evict oldest entry if over limit
    if (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Invalidate a specific file entry (e.g. after write/edit).
   */
  invalidate(filePath) {
    this.cache.delete(filePath);
  }

  /**
   * Clear the entire cache.
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache stats.
   */
  stats() {
    return { size: this.cache.size, maxEntries: this.maxEntries };
  }
}

// Singleton instance
const fileCache = new FileLRUCache();

/**
 * Read a file through the LRU cache.
 * Returns { content, fromCache: boolean } or throws on error.
 */
export async function getCachedFile(filePath) {
  const stat = await fs.stat(filePath);
  const mtimeMs = stat.mtimeMs;

  const cached = fileCache.get(filePath, mtimeMs);
  if (cached) {
    return { content: cached.content, fromCache: true };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  fileCache.set(filePath, content, mtimeMs, stat.size);
  return { content, fromCache: false };
}

export { fileCache };
export default fileCache;
