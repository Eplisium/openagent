/**
 * 📦 File Content LRU Cache
 * Caches file reads with mtime validation for instant re-reads
 */

import fs from 'fs-extra';

const DEFAULT_MAX_ENTRIES = 500;

const STAT_CACHE_TTL_MS = 5000; // Skip stat() for 5s after last read (same-iteration optimization)

class FileLRUCache {
  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    this.cache = new Map(); // filePath -> { content, mtime, size, lastRead }
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
   * Check if we can skip stat() entirely (file was read very recently).
   * Returns cached mtime if within TTL, null otherwise.
   */
  getRecentMtime(filePath) {
    const entry = this.cache.get(filePath);
    if (!entry) return null;
    if (Date.now() - entry.lastRead < STAT_CACHE_TTL_MS) {
      return entry.mtime;
    }
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

    this.cache.set(filePath, { content, mtime: mtimeMs, size, lastRead: Date.now() });

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
 * Returns { content, fromCache: boolean, stat?: Stats } or throws on error.
 * @param {string} filePath
 * @param {boolean} returnStat - If true, also return the fs.Stats object
 */
export async function getCachedFile(filePath, returnStat = false) {
  // Fast path: if file was read within last 5s, skip stat() entirely
  const recentMtime = fileCache.getRecentMtime(filePath);
  if (recentMtime !== null) {
    const cached = fileCache.get(filePath, recentMtime);
    if (cached) {
      const result = { content: cached.content, fromCache: true };
      if (returnStat) {
        // Return a minimal stat-like object from cache
        result.stat = { isDirectory: () => false, size: cached.size, mtimeMs: cached.mtime };
      }
      return result;
    }
  }

  const stat = await fs.stat(filePath);
  const mtimeMs = stat.mtimeMs;

  const cached = fileCache.get(filePath, mtimeMs);
  if (cached) {
    const result = { content: cached.content, fromCache: true };
    if (returnStat) result.stat = stat;
    return result;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  fileCache.set(filePath, content, mtimeMs, stat.size);
  const result = { content, fromCache: false };
  if (returnStat) result.stat = stat;
  return result;
}

export { fileCache };
export default fileCache;
