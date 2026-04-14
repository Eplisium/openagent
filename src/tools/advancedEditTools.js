/**
 * 🔧 Advanced Edit Tools v1.0
 * Next-generation code editing tools inspired by Codex, Aider, and RooCode.
 *
 * New tools:
 * - apply_patch: Codex-style multi-file patch application
 * - write_file_blocks: Aider-style SEARCH/REPLACE blocks
 * - multi_edit: Atomic multi-file edits with rollback
 * - generate_diff: Generate diffs between file versions
 */

import fs from '../utils/fs-compat.js';
import path from 'path';
import { createPathContext } from '../paths.js';
// Platform not needed in this module
import {
  parsePatch,
  applyPatchToContent,
  parseSearchReplaceBlocks,
  applySearchReplace,
  generateUnifiedDiff,
  generateCompactDiff,
  detectIndentation,
} from './EditEngine.js';

const PATH_PREFIX_NOTE = 'Supports absolute paths plus the special prefixes project:, workdir:, workspace:, and openagent:.';

export function createAdvancedEditTools(options = {}) {
  const pathContext = createPathContext(options);
  const resolvePathForAgent = pathContext.resolvePath;
  const allowFullAccess = options.allowFullAccess === true || options.permissions?.allowFullAccess === true || process.env.OPENAGENT_FULL_ACCESS === 'true';

  function validatePath(resolvedPath, { access: _access = 'read' } = {}) {
    const baseDir = pathContext.getBaseDir();
    const workspaceDir = pathContext.getWorkspaceDir();
    const canonicalPath = path.resolve(resolvedPath);
    const allowedDirs = [baseDir, workspaceDir, pathContext.getOpenAgentDir?.(), require('os').homedir(), require('os').tmpdir()].filter(Boolean).map(d => path.resolve(d));

    const isAllowed = allowFullAccess || allowedDirs.some(allowed => {
      const relative = path.relative(allowed, canonicalPath);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });

    if (!isAllowed && allowedDirs.length > 0) {
      return { valid: false, error: `Path "${resolvedPath}" is outside allowed directories.` };
    }
    return { valid: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 1: apply_patch — Codex-style patch application
  // ─────────────────────────────────────────────────────────────────────────

  const applyPatchTool = {
    name: 'apply_patch',
    description: `Apply a Codex-style patch to one or more files. Supports multi-file patches with context-anchored hunks.

Patch format:
\`\`\`
*** Begin Patch
*** Update File: path/to/file.js
@@ function name or class
  context line (starts with space)
- line to remove (starts with -)
+ line to add (starts with +)
  another context line
*** End Patch
\`\`\`

Operations: "Add File", "Update File", "Delete File"
The @@ line provides anchor text (like a function name) to locate the change — NOT a line number.
Context lines (space prefix) must match existing file content.
Multiple hunks per file are supported. Multiple files per patch are supported.

Best for:
- Multi-line changes that span functions or classes
- Changes to multiple files at once
- When you have clear anchor text (function/class names)
- Adding new files or deleting files as part of a patch`,
    category: 'file',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description: 'The patch text in Codex format. Must start with *** Begin Patch and end with *** End Patch.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview what would change without writing (default: false)',
        },
      },
      required: ['patch'],
    },
    async execute({ patch, dryRun = false }) {
      try {
        const parsed = parsePatch(patch);
        if (!parsed.valid) {
          return { success: false, error: parsed.error || 'Invalid patch format' };
        }

        const results = [];
        let totalApplied = 0;
        let totalFailed = 0;

        for (const patchOp of parsed.patches) {
          const resolvedPath = resolvePathForAgent(patchOp.file);
          const pathValidation = validatePath(resolvedPath, { access: 'write' });
          if (!pathValidation.valid) {
            results.push({ file: patchOp.file, success: false, error: pathValidation.error });
            totalFailed++;
            continue;
          }

          if (patchOp.operation === 'add_file') {
            if (dryRun) {
              results.push({ file: patchOp.file, operation: 'add', success: true, dryRun: true });
              continue;
            }
            await fs.ensureDir(path.dirname(resolvedPath));
            // Extract content from hunks
            const newContent = patchOp.hunks.flatMap(h => h.lines.filter(l => l.type === 'add').map(l => l.content)).join('\n');
            await fs.writeFile(resolvedPath, newContent, 'utf-8');
            results.push({ file: patchOp.file, operation: 'add', success: true });
            totalApplied++;
            continue;
          }

          if (patchOp.operation === 'delete_file') {
            if (!await fs.pathExists(resolvedPath)) {
              results.push({ file: patchOp.file, operation: 'delete', success: false, error: 'File not found' });
              totalFailed++;
              continue;
            }
            if (dryRun) {
              results.push({ file: patchOp.file, operation: 'delete', success: true, dryRun: true });
              continue;
            }
            await fs.remove(resolvedPath);
            results.push({ file: patchOp.file, operation: 'delete', success: true });
            totalApplied++;
            continue;
          }

          // Update file
          if (!await fs.pathExists(resolvedPath)) {
            results.push({ file: patchOp.file, success: false, error: `File not found: ${patchOp.file}` });
            totalFailed++;
            continue;
          }

          const originalContent = await fs.readFile(resolvedPath, 'utf-8');
          const patchResult = applyPatchToContent(originalContent, patchOp);

          if (dryRun) {
            const diff = generateCompactDiff(originalContent, patchResult.content);
            results.push({
              file: patchOp.file,
              success: patchResult.success,
              dryRun: true,
              appliedHunks: patchResult.appliedHunks,
              totalHunks: patchResult.totalHunks,
              changes: diff.slice(0, 20),
              error: patchResult.error,
            });
            continue;
          }

          if (!patchResult.success) {
            results.push({
              file: patchOp.file,
              success: false,
              error: patchResult.error,
              appliedHunks: patchResult.appliedHunks,
              totalHunks: patchResult.totalHunks,
            });
            totalFailed++;
            continue;
          }

          await fs.writeFile(resolvedPath, patchResult.content, 'utf-8');
          results.push({
            file: patchOp.file,
            success: true,
            appliedHunks: patchResult.appliedHunks,
            totalHunks: patchResult.totalHunks,
            originalSize: originalContent.length,
            newSize: patchResult.content.length,
          });
          totalApplied++;
        }

        return {
          success: totalFailed === 0,
          totalApplied,
          totalFailed,
          totalPatches: parsed.patches.length,
          results,
          dryRun,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 2: write_file_blocks — Aider-style SEARCH/REPLACE blocks
  // ─────────────────────────────────────────────────────────────────────────

  const writeFileBlocksTool = {
    name: 'write_file_blocks',
    description: `Apply SEARCH/REPLACE blocks to edit files — the most reliable editing format used by Aider.

Format:
\`\`\`
path/to/file.ext
<<<<<<< SEARCH
exact text to find in the file
=======
replacement text to insert
>>>>>>> REPLACE
\`\`\`

Multiple blocks for the same file are supported. Multiple files in one call are supported.

Optional line hint for large files:
\`\`\`
path/to/file.ext
<<<<<<< SEARCH
:start_line:10
-------
text to find
=======
replacement
>>>>>>> REPLACE
\`\`\`

Features:
- Multi-strategy matching: exact → whitespace-insensitive → line-trimmed → fuzzy (75%+ similarity)
- Indentation preservation: auto-detects indent style and re-indents replacement
- Detailed error diagnostics when a block fails to match
- Atomic: if any block fails, NO files are modified

Best for:
- Precise find-and-replace edits
- When you know the exact text to change
- Multi-edit operations across files
- When edit_file with find/replace is not reliable enough`,
    category: 'file',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        blocks: {
          type: 'string',
          description: 'SEARCH/REPLACE blocks in the format shown above. Can contain multiple blocks for multiple files.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview changes without writing (default: false)',
        },
        indentAware: {
          type: 'boolean',
          description: 'Auto-detect and preserve indentation style (default: true)',
        },
      },
      required: ['blocks'],
    },
    async execute({ blocks, dryRun = false, indentAware = true }) {
      try {
        const parsed = parseSearchReplaceBlocks(blocks);

        if (parsed.length === 0) {
          return {
            success: false,
            error: 'No SEARCH/REPLACE blocks found. Ensure format uses <<<<<<< SEARCH / ======= / >>>>>>> REPLACE markers.',
          };
        }

        // Group blocks by file
        const fileGroups = new Map();
        for (const block of parsed) {
          if (!fileGroups.has(block.file)) fileGroups.set(block.file, []);
          fileGroups.get(block.file).push(block);
        }

        const results = [];
        let totalApplied = 0;
        let totalFailed = 0;

        for (const [filePath, fileBlocks] of fileGroups) {
          const resolvedPath = resolvePathForAgent(filePath);
          const pathValidation = validatePath(resolvedPath, { access: 'write' });
          if (!pathValidation.valid) {
            results.push({ file: filePath, success: false, error: pathValidation.error });
            totalFailed++;
            continue;
          }

          if (!await fs.pathExists(resolvedPath)) {
            results.push({ file: filePath, success: false, error: `File not found: ${filePath}` });
            totalFailed++;
            continue;
          }

          const originalContent = await fs.readFile(resolvedPath, 'utf-8');
          let content = originalContent;
          const blockResults = [];
          let allSucceeded = true;

          for (let i = 0; i < fileBlocks.length; i++) {
            const block = fileBlocks[i];
            const result = applySearchReplace(content, block.search, block.replace, {
              indentAware,
              startLine: block.startLine,
            });

            blockResults.push({
              index: i,
              success: result.success,
              strategy: result.strategy,
              similarity: result.similarity,
              error: result.error,
            });

            if (!result.success) {
              allSucceeded = false;
              totalFailed++;
              break; // Stop processing this file on first failure
            }

            content = result.content;
          }

          if (dryRun) {
            const diff = generateCompactDiff(originalContent, content);
            results.push({
              file: filePath,
              success: allSucceeded,
              dryRun: true,
              blockResults,
              changes: diff.slice(0, 30),
              originalLines: originalContent.split('\n').length,
              newLines: content.split('\n').length,
            });
            continue;
          }

          if (allSucceeded) {
            await fs.writeFile(resolvedPath, content, 'utf-8');
            totalApplied++;
          }

          results.push({
            file: filePath,
            success: allSucceeded,
            blockResults,
            originalSize: originalContent.length,
            newSize: content.length,
          });
        }

        return {
          success: totalFailed === 0,
          totalApplied,
          totalFailed,
          totalFiles: fileGroups.size,
          totalBlocks: parsed.length,
          results,
          dryRun,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 3: multi_edit — Atomic multi-file edits with rollback
  // ─────────────────────────────────────────────────────────────────────────

  const multiEditTool = {
    name: 'multi_edit',
    description: `Apply find/replace edits to MULTIPLE files atomically — all succeed or all roll back.

Use this when you need to make coordinated changes across files (rename a function, update an API, refactor a pattern).

Each edit specifies a file path, search text, and replacement text. If ANY edit fails, ALL files are restored to their original state.

Features:
- Atomic: all-or-nothing with automatic rollback on failure
- Multi-strategy matching (exact → fuzzy) per edit
- Indentation preservation
- Dry-run mode to preview all changes
- Detailed per-edit results

Best for:
- Renaming across multiple files
- Updating API signatures that span files
- Refactoring patterns across a codebase
- When changes must be consistent across files`,
    category: 'file',
    permission: 'write',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'Array of edit operations. Each edit targets one file.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: `File path. ${PATH_PREFIX_NOTE}` },
              find: { type: 'string', description: 'Text to find (exact match preferred)' },
              replace: { type: 'string', description: 'Replacement text' },
              replaceAll: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
              useRegex: { type: 'boolean', description: 'Treat find as regex (default: false)' },
            },
            required: ['path', 'find', 'replace'],
          },
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview all changes without writing (default: false)',
        },
        indentAware: {
          type: 'boolean',
          description: 'Preserve indentation style (default: true)',
        },
      },
      required: ['edits'],
    },
    async execute({ edits, dryRun = false, indentAware = true }) {
      try {
        if (!Array.isArray(edits) || edits.length === 0) {
          return { success: false, error: 'edits must be a non-empty array' };
        }

        // Group edits by file
        const fileGroups = new Map();
        for (const edit of edits) {
          if (!fileGroups.has(edit.path)) fileGroups.set(edit.path, []);
          fileGroups.get(edit.path).push(edit);
        }

        // Read all files first
        const fileContents = new Map();
        for (const [filePath] of fileGroups) {
          const resolvedPath = resolvePathForAgent(filePath);
          const pathValidation = validatePath(resolvedPath, { access: 'write' });
          if (!pathValidation.valid) {
            return { success: false, error: pathValidation.error, file: filePath };
          }
          if (!await fs.pathExists(resolvedPath)) {
            return { success: false, error: `File not found: ${filePath}` };
          }
          fileContents.set(filePath, {
            resolvedPath,
            original: await fs.readFile(resolvedPath, 'utf-8'),
            current: null,
          });
        }

        // Apply edits
        const editResults = [];
        let totalApplied = 0;
        let totalFailed = 0;

        for (const [filePath, fileEdits] of fileGroups) {
          const fileInfo = fileContents.get(filePath);
          let content = fileInfo.original;

          for (let i = 0; i < fileEdits.length; i++) {
            const edit = fileEdits[i];
            let result;

            if (edit.useRegex) {
              try {
                const flags = edit.replaceAll ? 'gi' : 'i';
                const regex = new RegExp(edit.find, flags);
                const newContent = content.replace(regex, edit.replace);
                result = {
                  success: newContent !== content || content.includes(edit.find),
                  content: newContent,
                  strategy: 'regex',
                  error: newContent === content && !content.match(regex) ? 'Regex matched 0 occurrences' : undefined,
                };
              } catch (err) {
                result = { success: false, content, strategy: 'regex', error: `Invalid regex: ${err.message}` };
              }
            } else {
              result = applySearchReplace(content, edit.find, edit.replace, { indentAware });
              if (edit.replaceAll && result.success) {
                // Apply replaceAll after the first match
                const idx = content.indexOf(edit.find);
                if (idx !== -1) {
                  result.content = content.split(edit.find).join(edit.replace);
                }
              }
            }

            editResults.push({
              file: filePath,
              editIndex: i,
              success: result.success,
              strategy: result.strategy,
              error: result.error,
            });

            if (!result.success) {
              totalFailed++;
              // Rollback ALL files
              if (!dryRun) {
                for (const [, fInfo] of fileContents) {
                  try {
                    await fs.writeFile(fInfo.resolvedPath, fInfo.original, 'utf-8');
                  } catch { /* best effort */ }
                }
              }
              return {
                success: false,
                totalApplied,
                totalFailed,
                editResults,
                rolledBack: true,
                error: `Edit failed in ${filePath}: ${result.error}`,
              };
            }

            content = result.content;
            totalApplied++;
          }

          fileInfo.current = content;
        }

        if (dryRun) {
          // Generate diffs for preview
          const previews = [];
          for (const [filePath, fileInfo] of fileContents) {
            if (fileInfo.current && fileInfo.current !== fileInfo.original) {
              previews.push({
                file: filePath,
                changes: generateCompactDiff(fileInfo.original, fileInfo.current).slice(0, 20),
                originalSize: fileInfo.original.length,
                newSize: fileInfo.current.length,
              });
            }
          }
          return {
            success: true,
            dryRun: true,
            totalApplied,
            totalFailed: 0,
            editResults,
            previews,
          };
        }

        // Write all files
        for (const [, fileInfo] of fileContents) {
          if (fileInfo.current) {
            await fs.writeFile(fileInfo.resolvedPath, fileInfo.current, 'utf-8');
          }
        }

        return {
          success: true,
          totalApplied,
          totalFailed: 0,
          totalFiles: fileGroups.size,
          editResults,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 4: generate_diff — Show diffs between content versions
  // ─────────────────────────────────────────────────────────────────────────

  const generateDiffTool = {
    name: 'generate_diff',
    description: `Generate a unified diff showing what would change between two versions of a file. Useful for reviewing changes before applying them.

Can compare:
- Current file content vs. proposed new content
- Two different files
- Original content vs. edited content (inline)

Best for:
- Reviewing changes before committing
- Understanding the scope of a refactoring
- Generating patch files`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        original: {
          type: 'string',
          description: `Path to the original file, or inline text. ${PATH_PREFIX_NOTE}`,
        },
        modified: {
          type: 'string',
          description: `Path to the modified file, or inline text. ${PATH_PREFIX_NOTE}`,
        },
        contextLines: {
          type: 'integer',
          description: 'Number of context lines around changes (default: 3)',
        },
        fromFile: {
          type: 'string',
          description: 'Label for the "from" file in diff header',
        },
        toFile: {
          type: 'string',
          description: 'Label for the "to" file in diff header',
        },
      },
      required: ['original', 'modified'],
    },
    async execute({ original, modified, contextLines = 3, fromFile, toFile }) {
      try {
        let originalContent = original;
        let modifiedContent = modified;

        // Try to read as file paths
        try {
          const resolvedOrig = resolvePathForAgent(original);
          if (await fs.pathExists(resolvedOrig)) {
            const stat = await fs.stat(resolvedOrig);
            if (!stat.isDirectory()) {
              originalContent = await fs.readFile(resolvedOrig, 'utf-8');
              fromFile = fromFile || original;
            }
          }
        } catch { /* treat as inline text */ }

        try {
          const resolvedMod = resolvePathForAgent(modified);
          if (await fs.pathExists(resolvedMod)) {
            const stat = await fs.stat(resolvedMod);
            if (!stat.isDirectory()) {
              modifiedContent = await fs.readFile(resolvedMod, 'utf-8');
              toFile = toFile || modified;
            }
          }
        } catch { /* treat as inline text */ }

        const diff = generateUnifiedDiff(originalContent, modifiedContent, {
          contextLines,
          fromFile: fromFile || 'original',
          toFile: toFile || 'modified',
        });

        const compactChanges = generateCompactDiff(originalContent, modifiedContent);

        return {
          success: true,
          diff: diff || 'Files are identical',
          hasChanges: compactChanges.length > 0,
          changeCount: compactChanges.length,
          changes: compactChanges.slice(0, 50),
          originalLines: originalContent.split('\n').length,
          modifiedLines: modifiedContent.split('\n').length,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 5: detect_indent — Analyze file indentation
  // ─────────────────────────────────────────────────────────────────────────

  const detectIndentTool = {
    name: 'detect_indent',
    description: `Analyze the indentation style of a file. Returns indent type (spaces/tabs), size, and statistics.

Use this to match your edits to the file's existing style.`,
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Path to the file to analyze. ${PATH_PREFIX_NOTE}`,
        },
      },
      required: ['path'],
    },
    async execute({ path: filePath }) {
      try {
        const resolvedPath = resolvePathForAgent(filePath);
        const pathValidation = validatePath(resolvedPath);
        if (!pathValidation.valid) return { success: false, error: pathValidation.error };

        if (!await fs.pathExists(resolvedPath)) {
          return { success: false, error: `File not found: ${resolvedPath}` };
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');
        const indentInfo = detectIndentation(content);

        return {
          success: true,
          path: resolvedPath,
          type: indentInfo.type,
          size: indentInfo.size,
          char: indentInfo.type === 'tabs' ? '\\t' : `${indentInfo.size} spaces`,
          recommendation: `Use ${indentInfo.type === 'tabs' ? 'tabs' : indentInfo.size + ' spaces'} for edits to this file.`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [
    applyPatchTool,
    writeFileBlocksTool,
    multiEditTool,
    generateDiffTool,
    detectIndentTool,
  ];
}

export const advancedEditTools = createAdvancedEditTools();
export default createAdvancedEditTools;
