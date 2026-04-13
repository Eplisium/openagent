/**
 * 📁 Input Handler
 * Handles drag-and-drop detection, file path parsing, and file content reading.
 * Supports Windows paths, Unix paths, and mixed input scenarios.
 */

import fs from './utils/fs-compat.js';
import path from 'path';

/**
 * Supported image file extensions
 */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];

/**
 * MIME type mapping for image extensions
 */
const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Text file extensions that should be read as text content
 */
const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.json', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.rb', '.rs', '.go', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.kt',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql', '.proto',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.csv', '.tsv', '.log', '.diff', '.patch',
];

/**
 * Regex patterns for path detection
 */
const WINDOWS_PATH_PATTERN = /[a-zA-Z]:[\\/](?:[^<>:"|?*\n\r]+[\\/]?)*[^<>:"|?*\n\r\s]*/g;
const QUOTED_PATH_PATTERN = /["']([a-zA-Z]:[\\/][^"'\n]+)["']/g;
const UNIX_PATH_PATTERN = /(?:^|\s)(\/(?:[^/\s]+\/?)*[^/\s]*)(?:\s|$)/g;

/**
 * Check if a file path points to an image
 * @param {string} filePath - Path to check
 * @returns {boolean} True if the path has an image extension
 */
export function isImagePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Detect Windows file paths in input text
 * @param {string} input - Input text to scan
 * @returns {string[]} Array of detected Windows paths
 */
function detectWindowsPaths(input) {
  const paths = [];

  // Check for quoted paths first (more specific)
  const quotedMatches = input.matchAll(QUOTED_PATH_PATTERN);
  for (const match of quotedMatches) {
    paths.push(match[1]);
  }

  // Check for unquoted Windows paths
  const unquotedMatches = input.matchAll(WINDOWS_PATH_PATTERN);
  for (const match of unquotedMatches) {
    const candidate = match[0].trim();
    // Skip if already captured as quoted path
    if (!paths.some(p => candidate.includes(p) || p.includes(candidate))) {
      paths.push(candidate);
    }
  }

  return paths;
}

/**
 * Detect Unix-style paths in input text
 * @param {string} input - Input text to scan
 * @returns {string[]} Array of detected Unix paths
 */
function detectUnixPaths(input) {
  const paths = [];
  const matches = input.matchAll(UNIX_PATH_PATTERN);

  for (const match of matches) {
    const candidate = (match[1] || match[0]).trim();
    // Skip common false positives
    if (candidate === '/' || candidate.length < 2) continue;
    if (['/dev', '/proc', '/sys', '/tmp'].some(p => candidate === p)) continue;
    paths.push(candidate);
  }

  return paths;
}

/**
 * Check if input is purely a file/folder path (drag-and-drop scenario)
 * @param {string} input - Trimmed input text
 * @param {string[]} paths - Detected paths
 * @returns {boolean} True if input is only a path
 */
function isPurePathInput(input, paths) {
  if (paths.length === 0) return false;
  if (paths.length === 1) {
    // Single path: input should be just the path (possibly quoted)
    const cleaned = input.replace(/^["']|["']$/g, '').trim();
    return cleaned === paths[0];
  }
  // Multiple paths: input should only contain paths and whitespace
  let remaining = input;
  for (const p of paths) {
    remaining = remaining.replace(p, '').replace(/["']/g, '');
  }
  return remaining.trim().length === 0;
}

/**
 * Process user input to detect file paths and categorize content
 * @param {string} input - Raw user input
 * @param {object} [options] - Processing options
 * @param {boolean} [options.validateExistence=false] - Whether to check if paths actually exist
 * @returns {Promise<{type: 'paths'|'text'|'mixed', paths: string[], text: string, processed: boolean}>}
 */
export async function processInput(input, options = {}) {
  if (!input || typeof input !== 'string') {
    return { type: 'text', paths: [], text: input || '', processed: false };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { type: 'text', paths: [], text: '', processed: false };
  }

  // Detect all paths
  const windowsPaths = detectWindowsPaths(trimmed);
  const unixPaths = detectUnixPaths(trimmed);

  // Combine and deduplicate
  const allPaths = [...new Set([...windowsPaths, ...unixPaths])];

  // Optionally validate paths exist
  let validPaths = allPaths;
  if (options.validateExistence && allPaths.length > 0) {
    validPaths = [];
    for (const p of allPaths) {
      try {
        const resolved = path.resolve(p);
        await fs.access(resolved);
        validPaths.push(resolved);
      } catch {
        // Path doesn't exist, treat as text
      }
    }
  }

  if (validPaths.length === 0) {
    return { type: 'text', paths: [], text: input, processed: false };
  }

  // Check if input is purely paths (drag-and-drop)
  if (isPurePathInput(trimmed, validPaths)) {
    return { type: 'paths', paths: validPaths, text: '', processed: true };
  }

  // Mixed content: paths + text
  // Extract the non-path text
  let textContent = trimmed;
  for (const p of validPaths) {
    textContent = textContent.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
  }
  // Clean up quoted path remnants
  textContent = textContent.replace(/["']/g, '').replace(/\s+/g, ' ').trim();

  if (textContent.length === 0) {
    return { type: 'paths', paths: validPaths, text: '', processed: true };
  }

  return { type: 'mixed', paths: validPaths, text: textContent, processed: true };
}

/**
 * Read a dropped file or directory and return structured content
 * @param {string} filePath - Path to the file or directory
 * @returns {Promise<object>} Structured file/directory information
 */
export async function readDroppedFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path provided');
  }

  const resolvedPath = path.resolve(filePath);

  // Check existence
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    throw new Error(`Path does not exist: ${resolvedPath}`);
  }

  // Handle directory
  if (stat.isDirectory()) {
    let entries;
    try {
      const items = await fs.readdir(resolvedPath, { withFileTypes: true });
      entries = items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        path: path.join(resolvedPath, item.name),
      }));
    } catch (error) {
      throw new Error(`Cannot read directory: ${error.message}`);
    }

    return {
      type: 'directory',
      path: resolvedPath,
      entries,
    };
  }

  // Handle file
  if (!stat.isFile()) {
    return {
      type: 'unknown',
      path: resolvedPath,
      message: 'Path is not a regular file or directory',
    };
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const fileName = path.basename(resolvedPath);
  const size = stat.size;

  // Check if image
  if (IMAGE_EXTENSIONS.includes(ext)) {
    try {
      const buffer = await fs.readFile(resolvedPath);
      const base64 = buffer.toString('base64');
      const mimeType = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';

      return {
        type: 'image',
        path: resolvedPath,
        name: fileName,
        mimeType,
        size,
        base64,
      };
    } catch (error) {
      throw new Error(`Cannot read image file: ${error.message}`);
    }
  }

  // Check if text file
  if (TEXT_EXTENSIONS.includes(ext) || isLikelyTextFile(resolvedPath)) {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n').length;

      return {
        type: 'file',
        path: resolvedPath,
        name: fileName,
        content,
        size,
        lines,
        extension: ext,
      };
    } catch {
      // Might be binary after all
      return {
        type: 'binary',
        path: resolvedPath,
        name: fileName,
        size,
        message: `Binary file detected (${formatFileSize(size)})`,
      };
    }
  }

  // Binary file
  return {
    type: 'binary',
    path: resolvedPath,
    name: fileName,
    size,
    message: `Binary file detected (${formatFileSize(size)})`,
  };
}

/**
 * Heuristic check if a file without known extension is likely text
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function isLikelyTextFile(filePath) {
  try {
    const buffer = fs.readFileSync(filePath, { length: 512 });
    // Check for null bytes (common in binary files)
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format dropped file/directory results for injection into agent context
 * @param {object[]} results - Array of readDroppedFile results
 * @returns {string} Formatted string for agent context
 */
export function formatDroppedContent(results) {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return '';
  }

  const sections = [];

  for (const result of results) {
    if (result.type === 'directory') {
      const entryList = result.entries
        .slice(0, 50) // Limit to prevent huge context
        .map(e => `  ${e.type === 'directory' ? '📁' : '📄'} ${e.name}`)
        .join('\n');

      const truncated = result.entries.length > 50
        ? `\n  ... and ${result.entries.length - 50} more items`
        : '';

      sections.push(
        `📁 **Directory: ${result.path}**\n` +
        `Contains ${result.entries.length} items:\n${entryList}${truncated}`
      );
    } else if (result.type === 'image') {
      sections.push(
        `🖼️ **Image: ${result.name}**\n` +
        `Path: ${result.path}\n` +
        `Type: ${result.mimeType}\n` +
        `Size: ${formatFileSize(result.size)}\n` +
        `[Image data available as base64 - ${result.base64.length} characters]`
      );
    } else if (result.type === 'file') {
      const preview = result.content.length > 5000
        ? result.content.slice(0, 5000) + '\n\n... [truncated - file continues]'
        : result.content;

      sections.push(
        `📄 **File: ${result.name}**\n` +
        `Path: ${result.path}\n` +
        `Size: ${formatFileSize(result.size)} | Lines: ${result.lines}\n` +
        `\`\`\`${result.extension ? result.extension.slice(1) : ''}\n${preview}\n\`\`\``
      );
    } else if (result.type === 'binary') {
      sections.push(
        `📦 **Binary File: ${result.name}**\n` +
        `Path: ${result.path}\n` +
        `Size: ${formatFileSize(result.size)}\n` +
        `${result.message}`
      );
    } else {
      sections.push(
        `❓ **Unknown: ${result.path}**\n` +
        `${result.message || 'Unable to process this item'}`
      );
    }
  }

  return sections.join('\n\n---\n\n');
}

export default {
  IMAGE_EXTENSIONS,
  isImagePath,
  processInput,
  readDroppedFile,
  formatDroppedContent,
};
