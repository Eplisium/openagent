/**
 * 📁 File Operation Tools
 * Read, write, edit, search, and manage files
 */

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import { resolveAgentPath } from '../paths.js';

const PATH_PREFIX_NOTE = 'Supports absolute paths plus the special prefixes project:, workdir:, and workspace:.';

function createPathContext(options = {}) {
  const getBaseDir = typeof options.getBaseDir === 'function'
    ? options.getBaseDir
    : () => options.baseDir || options.workingDir || process.cwd();
  const getWorkspaceDir = typeof options.getWorkspaceDir === 'function'
    ? options.getWorkspaceDir
    : () => options.workspaceDir || null;

  return {
    getBaseDir: () => path.resolve(getBaseDir()),
    getWorkspaceDir: () => {
      const workspaceDir = getWorkspaceDir();
      return workspaceDir ? path.resolve(workspaceDir) : null;
    },
    resolvePath: (inputPath = '.') => resolveAgentPath(inputPath, {
      baseDir: getBaseDir(),
      workspaceDir: getWorkspaceDir(),
    }),
  };
}

export function createFileTools(options = {}) {
  const pathContext = createPathContext(options);
  const resolvePathForAgent = pathContext.resolvePath;

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

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `File not found: ${resolvedPath}` };
        }

        const stat = await fs.stat(resolvedPath);
        if (stat.isDirectory()) {
          return { success: false, error: `Path is a directory: ${resolvedPath}` };
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');
        const lines = content.split('\n');
        const MAX_LINES = 500;
        const MAX_CHARS = 30000;

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
        await fs.ensureDir(path.dirname(resolvedPath));

        const existed = await fs.pathExists(resolvedPath);
        await fs.writeFile(resolvedPath, content, 'utf-8');

        const stat = await fs.stat(resolvedPath);

        return {
          success: true,
          path: resolvedPath,
          action: existed ? 'overwritten' : 'created',
          size: stat.size,
          lines: content.split('\n').length,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  const editFileTool = {
    name: 'edit_file',
    description: `Edit a file by finding and replacing text. Supports batch edits. ${PATH_PREFIX_NOTE}`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file to edit. ${PATH_PREFIX_NOTE}`,
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
      },
      required: ['path'],
    },
    async execute({ path: filePath, find, replace, replaceAll = false, edits }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `File not found: ${resolvedPath}` };
        }

        let content = await fs.readFile(resolvedPath, 'utf-8');
        const originalContent = content;

        if (edits && Array.isArray(edits)) {
          for (const edit of edits) {
            if (!content.includes(edit.find)) {
              return {
                success: false,
                error: `Text not found in file: "${edit.find.substring(0, 50)}..."`,
              };
            }
            content = content.replace(edit.find, edit.replace);
          }
        } else if (find !== undefined && replace !== undefined) {
          if (!content.includes(find)) {
            return {
              success: false,
              error: `Text not found in file: "${find.substring(0, 50)}..."`,
            };
          }

          content = replaceAll ? content.split(find).join(replace) : content.replace(find, replace);
        } else {
          return { success: false, error: 'Must provide either find+replace or edits array' };
        }

        if (content === originalContent) {
          return { success: true, message: 'No changes made', path: resolvedPath };
        }

        await fs.writeFile(resolvedPath, content, 'utf-8');

        return {
          success: true,
          path: resolvedPath,
          originalSize: originalContent.length,
          newSize: content.length,
          changed: true,
        };
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

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `Directory not found: ${resolvedPath}` };
        }

        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          return { success: false, error: `Not a directory: ${resolvedPath}` };
        }

        const entries = [];

        if (recursive) {
          const pattern = path.join(resolvedPath, '**', '*').replace(/\\/g, '/');
          const files = await glob(pattern, {
            dot: includeHidden,
            maxDepth: maxDepth || undefined,
          });

          for (const file of files) {
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
            if (!includeHidden && item.startsWith('.')) continue;

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

        return {
          success: true,
          path: resolvedPath,
          baseDir: pathContext.getBaseDir(),
          workspaceDir: pathContext.getWorkspaceDir(),
          entries,
          total: entries.length,
          directories: entries.filter(e => e.type === 'directory').length,
          files: entries.filter(e => e.type === 'file').length,
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
          if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tar'].includes(ext)) {
            continue;
          }

          try {
            const content = await fs.readFile(file, 'utf-8');
            const lines = content.split('\n');
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

        if (resultStr.length > 30000) {
          for (const entry of results) {
            if (entry.matches.length > 3) {
              entry.matches = entry.matches.slice(0, 3);
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

  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirectoryTool,
    searchInFilesTool,
    getFileInfoTool,
  ];
}

const defaultFileTools = createFileTools();

export const [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchInFilesTool,
  getFileInfoTool,
] = defaultFileTools;

export const fileTools = defaultFileTools;

export default fileTools;
