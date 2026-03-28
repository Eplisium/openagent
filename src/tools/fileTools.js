/**
 * 📁 File Operation Tools
 * Read, write, edit, search, and manage files
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { glob } from 'glob';
import { createPathContext, isProtectedInstallationPath, getInstallationDir } from '../paths.js';
import { encodeImageToBase64, getImageMimeType, isVisionModel } from '../vision.js';
import { CONFIG } from '../config.js';
import { Platform } from '../utils/platform.js';
import { getCachedFile } from './fileCache.js';

const PATH_PREFIX_NOTE = 'Supports absolute paths plus the special prefixes project:, workdir:, workspace:, and openagent:.';

export function createFileTools(options = {}) {
  const pathContext = createPathContext(options);
  const resolvePathForAgent = pathContext.resolvePath;
  const getOpenAgentDir = pathContext.getOpenAgentDir;
  const allowFullAccess = options.allowFullAccess === true || options.permissions?.allowFullAccess === true || process.env.OPENAGENT_FULL_ACCESS === 'true';

  async function buildMissingFileError(filePath, resolvedPath) {
    let error = `File not found: ${resolvedPath}`;
    const openAgentDir = getOpenAgentDir?.();
    const requestedBaseName = path.basename(String(filePath || ''));

    if (openAgentDir && requestedBaseName.toUpperCase() === 'MEMORY.MD') {
      const projectMemoryPath = path.join(openAgentDir, 'memory', 'MEMORY.md');
      if (projectMemoryPath !== resolvedPath && await fs.pathExists(projectMemoryPath)) {
        error += `\nHint: project memory is usually stored at openagent:memory/MEMORY.md (${projectMemoryPath})`;
      }
    }

    return error;
  }

  /**
   * Validate that a resolved path is within allowed directories
   */
  function normalizeForComparison(targetPath) {
    const normalized = path.resolve(targetPath);
    return Platform.isWindows ? normalized.toLowerCase() : normalized;
  }

  function isWithinAllowedDir(targetPath, allowedDir) {
    const relative = path.relative(
      normalizeForComparison(allowedDir),
      normalizeForComparison(targetPath)
    );

    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  function validatePath(resolvedPath, { access = 'read' } = {}) {
    const baseDir = pathContext.getBaseDir();
    const workspaceDir = pathContext.getWorkspaceDir();
    const openAgentDir = getOpenAgentDir?.();
    
    const canonicalPath = path.resolve(resolvedPath);
    const allowedDirs = [baseDir, workspaceDir, openAgentDir, os.homedir(), os.tmpdir()].filter(Boolean).map(d => path.resolve(d));
    
    const isAllowed = allowFullAccess || allowedDirs.some(allowed => isWithinAllowedDir(canonicalPath, allowed));
    if (!isAllowed && allowedDirs.length > 0) {
      return {
        valid: false,
        error: `Path "${resolvedPath}" is outside allowed directories. Start OpenAgent with --full-access or set OPENAGENT_FULL_ACCESS=true to allow arbitrary filesystem access.`
      };
    }

    // Block writes to OpenAgent's own installation directory (source code protection)
    if (access !== 'read' && !allowFullAccess && isProtectedInstallationPath(canonicalPath)) {
      const installDir = getInstallationDir();
      return {
        valid: false,
        error: `Path "${resolvedPath}" is inside the OpenAgent installation directory (${installDir}). You cannot write to OpenAgent's own source code unless you explicitly enable full access. Use your project directory or the workspace instead, or start OpenAgent with --full-access.`
      };
    }

    return { valid: true };
  }

  const readFileTool = {
    name: 'read_file',
    description: `Read the contents of a file. Returns the full file content with line numbers. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Absolute or agent-relative path to the file. ${PATH_PREFIX_NOTE}`,
        },
        startLine: {
          type: 'integer',
          description: 'Start line number (1-indexed) for partial reads',
        },
        endLine: {
          type: 'integer',
          description: 'End line number (1-indexed) for partial reads',
        },
      },
      required: ['path'],
    },
    async execute({ path: filePath, startLine, endLine }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);
        
        // Validate path is within allowed directories (prevents path traversal)
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: await buildMissingFileError(filePath, resolvedPath) };
        }

        const stat = await fs.stat(resolvedPath);
        if (stat.isDirectory()) {
          return { success: false, error: `Path is a directory: ${resolvedPath}` };
        }

        const { content } = await getCachedFile(resolvedPath);
        const lines = Platform.splitLines(content);
        const MAX_LINES = CONFIG.FILE_READ_MAX_LINES;
        const MAX_CHARS = CONFIG.FILE_READ_MAX_CHARS;

        if (startLine || endLine) {
          const start = Math.max(0, (startLine || 1) - 1);
          const end = endLine ? Math.min(lines.length, endLine) : Math.min(lines.length, start + MAX_LINES);
          const selectedLines = lines.slice(start, end);
          const numbered = selectedLines.map((line, i) => `${start + i + 1}│ ${line}`).join('\n');

          return {
            success: true,
            content: numbered.length > MAX_CHARS ? numbered.substring(0, MAX_CHARS) + '\n... [truncated]' : numbered,
            totalLines: lines.length,
            showing: `${start + 1}-${end}`,
            truncated: end < lines.length,
            path: resolvedPath,
          };
        }

        const limitedLines = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES) : lines;
        const numbered = limitedLines.map((line, i) => `${i + 1}│ ${line}`).join('\n');

        return {
          success: true,
          content: numbered.length > MAX_CHARS ? numbered.substring(0, MAX_CHARS) + '\n... [truncated]' : numbered,
          totalLines: lines.length,
          showing: `1-${limitedLines.length}`,
          truncated: lines.length > MAX_LINES,
          size: stat.size,
          path: resolvedPath,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const writeFileTool = {
    name: 'write_file',
    description: `Write content to a file. Creates parent directories automatically. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Absolute or agent-relative path to the file. ${PATH_PREFIX_NOTE}`,
        },
        content: {
          type: 'string',
          description: 'The complete content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    async execute({ path: filePath, content }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);
        
        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath, { access: 'write' });
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }
        
        await fs.ensureDir(path.dirname(resolvedPath));

        const existed = await fs.pathExists(resolvedPath);
        await fs.writeFile(resolvedPath, content, 'utf-8');

        const stat = await fs.stat(resolvedPath);

        return {
          success: true,
          path: resolvedPath,
          action: existed ? 'overwritten' : 'created',
          size: stat.size,
          lines: Platform.splitLines(content).length,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const editFileTool = {
    name: 'edit_file',
    description: `Edit a file by finding and replacing text. Supports: exact match, line-based editing (startLine/endLine), batch edits, regex, dry-run, and undo. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file to edit. ${PATH_PREFIX_NOTE}`,
        },
        find: {
          type: 'string',
          description: 'Text to find (must match exactly including whitespace). When useRegex is true, treated as a regex pattern.',
        },
        replace: {
          type: 'string',
          description: 'Text to replace with. Supports regex capture groups ($1, $2, etc.) when useRegex is true.',
        },
        replaceAll: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false)',
        },
        startLine: {
          type: 'integer',
          description: 'Start line number (1-indexed) for line-based replacement. Use with endLine and replace.',
        },
        endLine: {
          type: 'integer',
          description: 'End line number (1-indexed, inclusive) for line-based replacement. Use with startLine and replace.',
        },
        edits: {
          type: 'array',
          description: 'Array of {find, replace} objects for batch edits',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
            },
            required: ['find', 'replace'],
          },
        },
        useRegex: {
          type: 'boolean',
          description: 'Treat find patterns as regex instead of literal strings (default: false)',
        },
        dryRun: {
          type: 'boolean',
          description: 'Show what would change without writing to the file (default: false)',
        },
        undo: {
          type: 'boolean',
          description: 'Restore the file from the .bak backup file created by a previous edit (default: false)',
        },
        continueOnError: {
          type: 'boolean',
          description: 'When processing batch edits, collect errors but continue applying remaining edits (default: false)',
        },
      },
      required: ['path'],
    },
    async execute({ path: filePath, find, replace, replaceAll = false, startLine, endLine, edits, useRegex = false, dryRun = false, undo = false, continueOnError = false }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);
        
        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath, { access: 'write' });
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }
        
        const bakPath = resolvedPath + '.bak';

        // --- Undo mode: restore from .bak file ---
        if (undo) {
          if (!await fs.pathExists(bakPath)) {
            return { success: false, error: `No backup file found: ${bakPath}` };
          }
          const backupContent = await fs.readFile(bakPath, 'utf-8');
          await fs.writeFile(resolvedPath, backupContent, 'utf-8');
          await fs.remove(bakPath);
          return {
            success: true,
            path: resolvedPath,
            action: 'restored',
            message: 'File restored from backup',
          };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: await buildMissingFileError(filePath, resolvedPath) };
        }

        let content = await fs.readFile(resolvedPath, 'utf-8');
        const originalContent = content;

        /**
         * Apply a single find/replace operation to content.
         * Returns { content, changed, error? }
         */
        function applyEdit(content, editFind, editReplace) {
          if (useRegex) {
            try {
              const flags = replaceAll ? 'g' : '';
              const regex = new RegExp(editFind, flags);
              const newContent = content.replace(regex, editReplace);
              return { content: newContent, changed: newContent !== content };
            } catch (err) {
              return { content, changed: false, error: `Invalid regex "${editFind}": ${err.message}` };
            }
          } else {
            if (!content.includes(editFind)) {
              // Provide helpful context: show the first 200 chars of what was searched
              const searchedPreview = editFind.length > 200 ? editFind.substring(0, 200) + '...' : editFind;
              // Try to find the closest matching line for debugging
              const searchLines = Platform.splitLines(editFind);
              const firstLine = searchLines[0].trim();
              const contentLines = Platform.splitLines(content);
              const similarLines = contentLines
                .map((line, i) => ({ line: i + 1, text: line.trim(), similarity: firstLine.length > 0 && line.includes(firstLine.substring(0, Math.min(20, firstLine.length))) ? 1 : 0 }))
                .filter(l => l.similarity > 0)
                .slice(0, 3);
              
              let hint = `Text not found in file.\n\nSearched for (${editFind.length} chars):\n"${searchedPreview}"`;
              if (similarLines.length > 0) {
                hint += `\n\nSimilar lines found in file:`;
                for (const sl of similarLines) {
                  hint += `\n  Line ${sl.line}: "${sl.text.substring(0, 100)}"`;
                }
                hint += `\n\nTIP: Use read_file with startLine/endLine to get the exact text, then retry with the verbatim content.`;
              } else {
                hint += `\n\nTIP: Re-read the file with read_file to get the current content, then use the EXACT text from the file.`;
              }
              return { content, changed: false, error: hint, suggestion: 'Re-read the file with read_file and use the EXACT text as find, or use startLine/endLine for line-based editing.' };
            }
            const newContent = replaceAll ? content.split(editFind).join(editReplace) : content.replace(editFind, editReplace);
            return { content: newContent, changed: newContent !== content };
          }
        }

        /**
         * Collect line-level changes between original and new content.
         */
        function collectChanges(original, updated) {
          const origLines = Platform.splitLines(original);
          const newLines = Platform.splitLines(updated);
          const changes = [];
          const maxLen = Math.max(origLines.length, newLines.length);
          for (let i = 0; i < maxLen; i++) {
            const origLine = origLines[i] ?? '';
            const newLine = newLines[i] ?? '';
            if (origLine !== newLine) {
              changes.push({ line: i + 1, original: origLine, replacement: newLine });
            }
          }
          return changes;
        }

        // --- Line-based replacement mode (startLine + endLine) ---
        if (startLine !== undefined && endLine !== undefined) {
          if (replace === undefined) {
            return { success: false, error: 'Line-based editing requires the "replace" parameter' };
          }
          const lines = Platform.splitLines(content);
          const startIdx = Math.max(0, startLine - 1);
          const endIdx = Math.min(lines.length, endLine);
          if (startIdx >= lines.length) {
            return { success: false, error: `startLine ${startLine} exceeds file length (${lines.length} lines)` };
          }
          if (endIdx <= startIdx) {
            return { success: false, error: `endLine (${endLine}) must be greater than startLine (${startLine})` };
          }
          const newLines = Platform.splitLines(replace);
          const resultLines = [...lines.slice(0, startIdx), ...newLines, ...lines.slice(endIdx)];
          content = resultLines.join(Platform.getEOL());

          if (dryRun) {
            const changes = collectChanges(originalContent, content);
            return {
              success: true,
              dryRun: true,
              changes,
              totalChanges: changes.length,
              linesReplaced: `${startLine}-${endLine} (${endIdx - startIdx} lines -> ${newLines.length} lines)`,
              path: resolvedPath,
            };
          }

          if (content === originalContent) {
            return { success: true, message: 'No changes made', path: resolvedPath };
          }

          await fs.writeFile(bakPath, originalContent, 'utf-8');
          await fs.writeFile(resolvedPath, content, 'utf-8');

          return {
            success: true,
            path: resolvedPath,
            originalSize: originalContent.length,
            newSize: content.length,
            changed: true,
            linesReplaced: `${startLine}-${endLine} (${endIdx - startIdx} lines -> ${newLines.length} lines)`,
          };
        }

        // --- Batch edits mode ---
        if (edits && Array.isArray(edits)) {
          const errors = [];
          let changesApplied = 0;

          for (let i = 0; i < edits.length; i++) {
            const edit = edits[i];
            const result = applyEdit(content, edit.find, edit.replace);

            if (result.error) {
              if (continueOnError) {
                errors.push({ index: i, find: edit.find, error: result.error });
                continue;
              } else {
                return { success: false, error: result.error };
              }
            }

            content = result.content;
            if (result.changed) changesApplied++;
          }

          if (dryRun) {
            const changes = collectChanges(originalContent, content);
            return {
              success: true,
              dryRun: true,
              changes,
              totalChanges: changes.length,
              changesApplied,
              errors: continueOnError ? errors : undefined,
              totalEdits: edits.length,
              path: resolvedPath,
            };
          }

          if (content === originalContent) {
            return {
              success: true,
              message: 'No changes made',
              path: resolvedPath,
              changesApplied: 0,
              errors: continueOnError && errors.length > 0 ? errors : undefined,
              totalEdits: edits.length,
            };
          }

          // Create backup before writing
          await fs.writeFile(bakPath, originalContent, 'utf-8');
          await fs.writeFile(resolvedPath, content, 'utf-8');

          return {
            success: true,
            path: resolvedPath,
            originalSize: originalContent.length,
            newSize: content.length,
            changed: true,
            changesApplied,
            errors: continueOnError && errors.length > 0 ? errors : undefined,
            totalEdits: edits.length,
          };
        }

        // --- Single find/replace mode ---
        if (find !== undefined && replace !== undefined) {
          const result = applyEdit(content, find, replace);

          if (result.error) {
            return { success: false, error: result.error, suggestion: result.suggestion };
          }

          content = result.content;

          if (dryRun) {
            const changes = collectChanges(originalContent, content);
            return {
              success: true,
              dryRun: true,
              changes,
              totalChanges: changes.length,
              path: resolvedPath,
            };
          }

          if (content === originalContent) {
            return { success: true, message: 'No changes made', path: resolvedPath };
          }

          // Create backup before writing
          await fs.writeFile(bakPath, originalContent, 'utf-8');
          await fs.writeFile(resolvedPath, content, 'utf-8');

          return {
            success: true,
            path: resolvedPath,
            originalSize: originalContent.length,
            newSize: content.length,
            changed: true,
          };
        }

        return { success: false, error: 'Must provide find+replace, startLine+endLine+replace, or edits array' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const listDirectoryTool = {
    name: 'list_directory',
    description: `List files and directories in a given path. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Directory path to list (default: project root). ${PATH_PREFIX_NOTE}`,
        },
        recursive: {
          type: 'boolean',
          description: 'List recursively (default: false)',
        },
        maxDepth: {
          type: 'integer',
          description: 'Maximum depth for recursive listing',
        },
        includeHidden: {
          type: 'boolean',
          description: 'Include hidden files (default: false)',
        },
      },
    },
    async execute({ path: dirPath = '.', recursive = false, maxDepth, includeHidden = false }) {
      try {
        const resolvedPath = resolvePathForAgent(dirPath);

        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `Directory not found: ${resolvedPath}` };
        }

        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          return { success: false, error: `Not a directory: ${resolvedPath}` };
        }

        const entries = [];
        // Directories to skip (common noise that bloats results)
        const SKIP_DIRS = new Set(['node_modules', '.git', '.openagent', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.windop-backups']);
        const MAX_ENTRIES = 500;

        if (recursive) {
          const pattern = path.join(resolvedPath, '**', '*').replace(/\\/g, '/');
          const files = await glob(pattern, {
            dot: includeHidden,
            maxDepth: maxDepth || undefined,
            ignore: ['**/node_modules/**', '**/.git/**', '**/.openagent/**', '**/dist/**', '**/build/**', '**/.next/**', '**/__pycache__/**'],
          });

          for (const file of files) {
            if (entries.length >= MAX_ENTRIES) break;
            try {
              const fileStat = await fs.stat(file);
              entries.push({
                name: path.basename(file),
                path: file,
                relativePath: path.relative(resolvedPath, file),
                type: fileStat.isDirectory() ? 'directory' : 'file',
                size: fileStat.size,
                modified: fileStat.mtime.toISOString(),
              });
            } catch {}
          }
        } else {
          const items = await fs.readdir(resolvedPath);

          for (const item of items) {
            if (entries.length >= MAX_ENTRIES) break;
            if (!includeHidden && item.startsWith('.')) continue;
            if (SKIP_DIRS.has(item)) continue;

            try {
              const itemPath = path.join(resolvedPath, item);
              const itemStat = await fs.stat(itemPath);
              entries.push({
                name: item,
                path: itemPath,
                type: itemStat.isDirectory() ? 'directory' : 'file',
                size: itemStat.size,
                modified: itemStat.mtime.toISOString(),
              });
            } catch {}
          }
        }

        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        const skipped = entries.length >= MAX_ENTRIES ? ` (limited to ${MAX_ENTRIES} entries)` : '';
        return {
          success: true,
          path: resolvedPath,
          baseDir: pathContext.getBaseDir(),
          workspaceDir: pathContext.getWorkspaceDir(),
          entries,
          total: entries.length,
          directories: entries.filter(e => e.type === 'directory').length,
          files: entries.filter(e => e.type === 'file').length,
          note: skipped || undefined,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const searchInFilesTool = {
    name: 'search_in_files',
    description: `Search for text patterns across files in a directory. Supports regex patterns. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Directory to search in. ${PATH_PREFIX_NOTE}`,
        },
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        filePattern: {
          type: 'string',
          description: 'File glob pattern to filter (e.g., "*.js", "*.py")',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search (default: false)',
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum number of results (default: 20)',
        },
        contextLines: {
          type: 'integer',
          description: 'Number of context lines around matches (default: 1)',
        },
      },
      required: ['path', 'pattern'],
    },
    async execute({ path: searchPath, pattern, filePattern, caseSensitive = false, maxResults = 20, contextLines = 1 }) {
      try {
        const resolvedPath = resolvePathForAgent(searchPath);

        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `Directory not found: ${resolvedPath}` };
        }

        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          return { success: false, error: `Not a directory: ${resolvedPath}` };
        }

        const globPattern = filePattern
          ? path.join(resolvedPath, '**', filePattern).replace(/\\/g, '/')
          : path.join(resolvedPath, '**', '*').replace(/\\/g, '/');

        const files = await glob(globPattern, { nodir: true });
        const regex = new RegExp(pattern, caseSensitive ? '' : 'i');
        const results = [];

        for (const file of files) {
          if (results.length >= maxResults) break;

          const ext = path.extname(file).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tar', '.mp4', '.mp3', '.wav', '.avi', '.mov', '.pdf', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.db', '.sqlite', '.pyc', '.class', '.o', '.obj', '.lock'].includes(ext)) {
            continue;
          }
          
          // Skip common large/noise directories
          if (file.includes('node_modules') || file.includes('.git' + path.sep) || file.includes(path.sep + 'dist' + path.sep) || file.includes(path.sep + 'build' + path.sep) || file.includes(path.sep + '.next' + path.sep) || file.includes(path.sep + 'coverage' + path.sep) || file.includes('__pycache__')) {
            continue;
          }

          try {
            const content = await fs.readFile(file, 'utf-8');
            const lines = Platform.splitLines(content);
            const matches = [];

            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxResults) break;

              const line = lines[i];
              if (regex.test(line)) {
                const contextStart = Math.max(0, i - contextLines);
                const contextEnd = Math.min(lines.length, i + contextLines + 1);
                const context = lines.slice(contextStart, contextEnd).map((contextLine, idx) => ({
                  line: contextStart + idx + 1,
                  content: contextLine,
                  isMatch: contextStart + idx === i,
                }));

                matches.push({
                  line: i + 1,
                  content: line.trim(),
                  context,
                });
              }
            }

            if (matches.length > 0) {
              results.push({
                file: path.relative(resolvedPath, file),
                fullPath: file,
                matchCount: matches.length,
                matches,
              });
            }
          } catch {
            // Skip binary or unreadable files
          }
        }

        const totalMatches = results.reduce((sum, entry) => sum + entry.matchCount, 0);
        let resultStr = JSON.stringify(results);
        let truncated = false;

        if (resultStr.length > CONFIG.SEARCH_RESULTS_MAX_CHARS) {
          for (const entry of results) {
            if (entry.matches.length > CONFIG.SEARCH_MAX_MATCHES_PER_FILE) {
              entry.matches = entry.matches.slice(0, CONFIG.SEARCH_MAX_MATCHES_PER_FILE);
              entry.matchCount = entry.matches.length;
              entry.hasMore = true;
            }
          }
          resultStr = JSON.stringify(results);
          truncated = true;
        }

        return {
          success: true,
          pattern,
          searchPath: resolvedPath,
          filesSearched: files.length,
          filesWithMatches: results.length,
          totalMatches,
          truncated,
          results,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const getFileInfoTool = {
    name: 'get_file_info',
    description: `Get detailed information about a file or directory. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file or directory. ${PATH_PREFIX_NOTE}`,
        },
      },
      required: ['path'],
    },
    async execute({ path: filePath }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);

        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `Path not found: ${resolvedPath}` };
        }

        const stat = await fs.stat(resolvedPath);
        const lstat = await fs.lstat(resolvedPath);
        const ext = path.extname(resolvedPath);

        return {
          success: true,
          path: resolvedPath,
          name: path.basename(resolvedPath),
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          extension: ext || null,
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString(),
          accessed: stat.atime.toISOString(),
          isSymlink: lstat.isSymbolicLink(),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const readImageTool = {
    name: 'read_image',
    description: `Read an image file and return it as base64 for vision analysis. Supports PNG, JPG, JPEG, GIF, WebP, BMP, SVG. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the image file. ${PATH_PREFIX_NOTE}`,
        },
      },
      required: ['path'],
    },
    async execute({ path: filePath }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);
        
        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }
        
        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `File not found: ${resolvedPath}` };
        }
        
        const stat = await fs.stat(resolvedPath);
        if (stat.isDirectory()) {
          return { success: false, error: `Path is a directory: ${resolvedPath}` };
        }
        
        const base64 = await encodeImageToBase64(resolvedPath);
        const mimeType = getImageMimeType(resolvedPath);
        
        return {
          success: true,
          path: resolvedPath,
          name: path.basename(resolvedPath),
          mimeType,
          size: stat.size,
          base64,
          message: `Image loaded: ${path.basename(resolvedPath)} (${mimeType}, ${stat.size} bytes)`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const deleteFileTool = {
    name: 'delete_file',
    description: `Safely delete a file with confirmation. Requires confirm=true to actually delete. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    destructive: true,
    permission: 'delete',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Absolute or agent-relative path to the file to delete. ${PATH_PREFIX_NOTE}`,
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to actually delete the file (default: false)',
        },
      },
      required: ['path'],
    },
    async execute({ path: filePath, confirm = false }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);

        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath, { access: 'delete' });
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `File not found: ${resolvedPath}` };
        }

        const stat = await fs.stat(resolvedPath);
        const fileInfo = {
          path: resolvedPath,
          name: path.basename(resolvedPath),
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };

        if (!confirm) {
          return {
            success: false,
            warning: `Deletion not confirmed. Set confirm=true to delete this ${fileInfo.type}.`,
            ...fileInfo,
          };
        }

        await fs.remove(resolvedPath);

        return {
          success: true,
          message: `${fileInfo.type === 'directory' ? 'Directory' : 'File'} deleted successfully`,
          deleted: fileInfo,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const moveFileTool = {
    name: 'move_file',
    description: `Move or rename a file or directory. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: `Source path of the file to move. ${PATH_PREFIX_NOTE}`,
        },
        destination: {
          type: 'string',
          description: `Destination path for the file. ${PATH_PREFIX_NOTE}`,
        },
      },
      required: ['source', 'destination'],
    },
    async execute({ source, destination }) {
      try {
        const resolvedSource = resolvePathForAgent(source);
        const resolvedDestination = resolvePathForAgent(destination);

        // Validate paths are within allowed directories
        const sourceValidation = validatePath(resolvedSource, { access: 'write' });
        if (!sourceValidation.valid) {
          return { success: false, error: sourceValidation.error };
        }
        const destValidation = validatePath(resolvedDestination, { access: 'write' });
        if (!destValidation.valid) {
          return { success: false, error: destValidation.error };
        }

        if (!await fs.pathExists(resolvedSource)) {
          return { success: false, error: `Source not found: ${resolvedSource}` };
        }

        await fs.ensureDir(path.dirname(resolvedDestination));
        await fs.move(resolvedSource, resolvedDestination, { overwrite: true });

        const stat = await fs.stat(resolvedDestination);

        return {
          success: true,
          message: 'File moved successfully',
          source: resolvedSource,
          destination: resolvedDestination,
          name: path.basename(resolvedDestination),
          size: stat.size,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const findFilesTool = {
    name: 'find_files',
    description: `Find files by glob pattern. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g., "*.js", "**/*.txt")',
        },
        path: {
          type: 'string',
          description: `Directory to search in (default: current directory). ${PATH_PREFIX_NOTE}`,
        },
        ignore: {
          type: 'array',
          description: 'Array of glob patterns to ignore',
          items: { type: 'string' },
        },
      },
      required: ['pattern'],
    },
    async execute({ pattern, path: searchPath = '.', ignore = [] }) {
      try {
        const resolvedPath = resolvePathForAgent(searchPath);

        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `Directory not found: ${resolvedPath}` };
        }

        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          return { success: false, error: `Not a directory: ${resolvedPath}` };
        }

        const globPattern = path.join(resolvedPath, pattern).replace(/\\/g, '/');
        const globOptions = {
          nodir: false,
          dot: false,
        };

        if (ignore && ignore.length > 0) {
          globOptions.ignore = ignore.map(p => path.join(resolvedPath, p).replace(/\\/g, '/'));
        }

        const matches = await glob(globPattern, globOptions);
        const files = [];

        for (const match of matches) {
          try {
            const fileStat = await fs.stat(match);
            files.push({
              name: path.basename(match),
              path: match,
              relativePath: path.relative(resolvedPath, match),
              type: fileStat.isDirectory() ? 'directory' : 'file',
              size: fileStat.size,
              modified: fileStat.mtime.toISOString(),
            });
          } catch {
            // Skip files that can't be accessed
          }
        }

        return {
          success: true,
          pattern,
          searchPath: resolvedPath,
          files,
          total: files.length,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const diffFilesTool = {
    name: 'diff_files',
    description: `Compare two files and show their differences line by line. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        file1: {
          type: 'string',
          description: `Path to the first file. ${PATH_PREFIX_NOTE}`,
        },
        file2: {
          type: 'string',
          description: `Path to the second file. ${PATH_PREFIX_NOTE}`,
        },
      },
      required: ['file1', 'file2'],
    },
    async execute({ file1, file2 }) {
      try {
        const resolvedFile1 = resolvePathForAgent(file1);
        const resolvedFile2 = resolvePathForAgent(file2);

        // Validate paths are within allowed directories
        const file1Validation = validatePath(resolvedFile1);
        if (!file1Validation.valid) {
          return { success: false, error: file1Validation.error };
        }
        const file2Validation = validatePath(resolvedFile2);
        if (!file2Validation.valid) {
          return { success: false, error: file2Validation.error };
        }

        if (!await fs.pathExists(resolvedFile1)) {
          return { success: false, error: `File not found: ${resolvedFile1}` };
        }
        if (!await fs.pathExists(resolvedFile2)) {
          return { success: false, error: `File not found: ${resolvedFile2}` };
        }

        const stat1 = await fs.stat(resolvedFile1);
        const stat2 = await fs.stat(resolvedFile2);

        if (stat1.isDirectory() || stat2.isDirectory()) {
          return { success: false, error: 'Both paths must be files, not directories' };
        }

        const content1 = await fs.readFile(resolvedFile1, 'utf-8');
        const content2 = await fs.readFile(resolvedFile2, 'utf-8');

        const lines1 = Platform.splitLines(content1);
        const lines2 = Platform.splitLines(content2);
        const maxLines = Math.max(lines1.length, lines2.length);

        const differences = [];
        let diffCount = 0;

        for (let i = 0; i < maxLines; i++) {
          const line1 = i < lines1.length ? lines1[i] : undefined;
          const line2 = i < lines2.length ? lines2[i] : undefined;

          if (line1 !== line2) {
            diffCount++;
            if (differences.length < CONFIG.DIFF_MAX_DIFFERENCES) {
              differences.push({
                line: i + 1,
                file1: line1,
                file2: line2,
              });
            }
          }
        }

        const identical = diffCount === 0;

        return {
          success: true,
          identical,
          file1: {
            path: resolvedFile1,
            name: path.basename(resolvedFile1),
            lines: lines1.length,
            size: stat1.size,
          },
          file2: {
            path: resolvedFile2,
            name: path.basename(resolvedFile2),
            lines: lines2.length,
            size: stat2.size,
          },
          differences,
          totalDifferences: diffCount,
          truncated: diffCount > 100,
          summary: identical
            ? 'Files are identical'
            : `Found ${diffCount} difference(s) between files`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const previewEditTool = {
    name: 'preview_edit',
    description: `Preview what an edit_file operation would change without writing. Shows a formatted diff. Use this before edit_file to verify changes. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file to preview editing. ${PATH_PREFIX_NOTE}`,
        },
        find: {
          type: 'string',
          description: 'Text to find (must match exactly including whitespace)',
        },
        replace: {
          type: 'string',
          description: 'Text to replace with',
        },
        replaceAll: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false)',
        },
        useRegex: {
          type: 'boolean',
          description: 'Treat find patterns as regex (default: false)',
        },
      },
      required: ['path', 'find', 'replace'],
    },
    async execute({ path: filePath, find, replace, replaceAll = false, useRegex = false }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);

        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `File not found: ${resolvedPath}` };
        }

        const originalContent = await fs.readFile(resolvedPath, 'utf-8');
        let newContent;

        if (useRegex) {
          const flags = replaceAll ? 'g' : '';
          const regex = new RegExp(find, flags);
          newContent = originalContent.replace(regex, replace);
        } else {
          newContent = replaceAll
            ? originalContent.split(find).join(replace)
            : originalContent.replace(find, replace);
        }

        if (newContent === originalContent) {
          return {
            success: true,
            changed: false,
            message: 'No changes would be made',
            path: resolvedPath,
          };
        }

        // Build unified diff
        const origLines = Platform.splitLines(originalContent);
        const newLines = Platform.splitLines(newContent);
        const diffLines = [];
        let changeCount = 0;

        const maxLen = Math.max(origLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          const orig = origLines[i];
          const updated = newLines[i];
          if (orig !== updated) {
            changeCount++;
            if (orig !== undefined) diffLines.push(`- ${orig}`);
            if (updated !== undefined) diffLines.push(`+ ${updated}`);
          }
        }

        return {
          success: true,
          changed: true,
          path: resolvedPath,
          preview: diffLines.join('\n'),
          changeCount,
          originalLines: origLines.length,
          newLines: newLines.length,
          originalSize: originalContent.length,
          newSize: newContent.length,
          message: `${changeCount} line(s) would change. Use edit_file to apply.`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const searchAndReplaceTool = {
    name: 'search_and_replace',
    description: `Powerful regex search-and-replace across an entire file. Supports multiple patterns, case-insensitive matching, and preview mode. Ideal for bulk renames, refactoring, and pattern-based replacements. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file. ${PATH_PREFIX_NOTE}`,
        },
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for (e.g., "\\boldName\\b" for word-boundary match)',
        },
        replacement: {
          type: 'string',
          description: 'Replacement string. Supports regex capture groups: $1, $2, etc.',
        },
        flags: {
          type: 'string',
          description: 'Regex flags: g=global, i=case-insensitive, m=multiline, s=dotAll (default: "gi")',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview changes without writing (default: false)',
        },
        contextLines: {
          type: 'integer',
          description: 'Number of context lines around each change in preview (default: 2)',
        },
      },
      required: ['path', 'pattern', 'replacement'],
    },
    async execute({ path: filePath, pattern, replacement, flags = 'gi', dryRun = false, contextLines = 2 }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);
        
        // Validate path is within allowed directories
        const pathValidation = validatePath(resolvedPath, { access: 'write' });
        if (!pathValidation.valid) {
          return { success: false, error: pathValidation.error };
        }
        
        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `File not found: ${resolvedPath}` };
        }
        const stat = await fs.stat(resolvedPath);
        if (stat.isDirectory()) {
          return { success: false, error: `Path is a directory: ${resolvedPath}` };
        }
        const content = await fs.readFile(resolvedPath, 'utf-8');
        let regex;
        try {
          regex = new RegExp(pattern, flags);
        } catch (err) {
          return { success: false, error: `Invalid regex pattern: ${err.message}` };
        }
        const newContent = content.replace(regex, replacement);
        const matchCount = (content.match(regex) || []).length;
        if (!flags.includes('g')) {
          // If not global, only first match counts
        }
        if (matchCount === 0) {
          return {
            success: true,
            changed: false,
            message: `Pattern matched 0 occurrences in ${resolvedPath}`,
            path: resolvedPath,
          };
        }
        if (dryRun) {
          // Build preview of changes
          const origLines = content.split('\n');
          const newLines = Platform.splitLines(newContent);
          const changes = [];
          const maxLen = Math.max(origLines.length, newLines.length);
          for (let i = 0; i < maxLen; i++) {
            if (origLines[i] !== newLines[i]) {
              const start = Math.max(0, i - contextLines);
              const end = Math.min(maxLen, i + contextLines + 1);
              changes.push({
                line: i + 1,
                before: origLines[i] ?? '',
                after: newLines[i] ?? '',
                context: origLines.slice(start, end).map((l, idx) => `${start + idx + 1}│ ${l}`).join('\n'),
              });
            }
          }
          return {
            success: true,
            dryRun: true,
            changed: true,
            matchCount,
            changes: changes.slice(0, 20),
            totalChanges: changes.length,
            path: resolvedPath,
            message: `Would replace ${matchCount} occurrence(s) in ${changes.length} line(s)`,
          };
        }
        const bakPath = resolvedPath + '.bak';
        await fs.writeFile(bakPath, content, 'utf-8');
        await fs.writeFile(resolvedPath, newContent, 'utf-8');
        return {
          success: true,
          changed: true,
          path: resolvedPath,
          matchCount,
          originalSize: content.length,
          newSize: newContent.length,
          message: `Replaced ${matchCount} occurrence(s) in ${resolvedPath}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    searchAndReplaceTool,
    listDirectoryTool,
    searchInFilesTool,
    getFileInfoTool,
    readImageTool,
    deleteFileTool,
    moveFileTool,
    findFilesTool,
    diffFilesTool,
    previewEditTool,
  ];
}

const defaultFileTools = createFileTools();

export const [
  readFileTool,
  writeFileTool,
  editFileTool,
  searchAndReplaceTool,
  listDirectoryTool,
  searchInFilesTool,
  getFileInfoTool,
  readImageTool,
  deleteFileTool,
  moveFileTool,
  findFilesTool,
  diffFilesTool,
  previewEditTool,
] = defaultFileTools;

export const fileTools = defaultFileTools;
