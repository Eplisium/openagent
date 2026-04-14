/**
 * 🔬 EditEngine v1.0
 * Advanced code editing engine with fuzzy matching, indentation preservation,
 * and multiple edit format support.
 *
 * Inspired by: Codex (patch format), Aider (SEARCH/REPLACE blocks),
 * RooCode (fuzzy matching), Cursor (specialized change application).
 *
 * Features:
 * - Fuzzy matching with multiple strategies (exact → whitespace-insensitive → indentation-preserving → fuzzy)
 * - Indentation preservation: auto-detects and maintains indent style
 * - SEARCH/REPLACE block parsing and application
 * - Codex-style patch format parsing and application
 * - Unified diff generation
 * - Multi-file edit coordination with rollback
 */

import difflib from '../utils/difflib.js';
import { Platform } from '../utils/platform.js';

// ─────────────────────────────────────────────────────────────────────────────
// Indentation Detection & Preservation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the indentation style used in a file.
 * Returns { type: 'spaces'|'tabs', size: number, char: string }
 */
export function detectIndentation(content) {
  const lines = content.split('\n');
  let spaceCount = 0;
  let tabCount = 0;
  const spaceSizes = {};

  for (const line of lines) {
    if (line.length === 0 || line.trim().length === 0) continue;
    const match = line.match(/^(\s+)/);
    if (!match) continue;

    const indent = match[1];
    if (indent.includes('\t')) {
      tabCount++;
    } else {
      spaceCount++;
      const size = indent.length;
      spaceSizes[size] = (spaceSizes[size] || 0) + 1;
    }
  }

  if (tabCount > spaceCount) {
    return { type: 'tabs', size: 1, char: '\t' };
  }

  // Find most common space indent size
  let mostCommonSize = 2;
  let mostCommonCount = 0;
  for (const [size, count] of Object.entries(spaceSizes)) {
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonSize = parseInt(size, 10);
    }
  }

  // Infer indent unit from most common size (usually 2 or 4)
  const indentSize = inferIndentUnit(spaceSizes);
  return { type: 'spaces', size: indentSize, char: ' '.repeat(indentSize) };
}

/**
 * Infer the indent unit (2, 4, etc.) from observed indent sizes.
 */
function inferIndentUnit(spaceSizes) {
  const sizes = Object.keys(spaceSizes).map(Number).sort((a, b) => a - b);
  if (sizes.length === 0) return 2;

  // Check for common indent sizes
  for (const candidate of [2, 4, 3, 8]) {
    if (sizes.some(s => s === candidate)) return candidate;
  }

  // GCD of all sizes
  return sizes.reduce(gcd);
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 2;
}

/**
 * Get the indentation level (number of indent units) for a line.
 */
export function getIndentLevel(line, indentInfo) {
  const match = line.match(/^(\s*)/);
  if (!match || !match[1]) return 0;
  const spaces = match[1].replace(/\t/g, ' '.repeat(indentInfo.size || 2)).length;
  return Math.floor(spaces / (indentInfo.size || 2));
}

/**
 * Re-indent a block of code to match a target indentation level.
 * Preserves relative indentation within the block.
 */
export function reindentBlock(block, targetIndent, indentInfo) {
  const lines = block.split('\n');
  if (lines.length === 0) return block;

  // Find minimum indent in the block (excluding empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^(\s*)/);
    const indent = match ? match[1].length : 0;
    minIndent = Math.min(minIndent, indent);
  }
  if (minIndent === Infinity) minIndent = 0;

  const targetSpaces = targetIndent * (indentInfo.size || 2);
  const indentStr = ' '.repeat(targetSpaces);

  return lines.map(line => {
    if (line.trim().length === 0) return '';
    const stripped = line.slice(minIndent);
    return indentStr + stripped;
  }).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy Matching Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multi-strategy search for finding text in a file.
 * Tries progressively fuzzier matching strategies.
 *
 * @param {string} content - File content to search in
 * @param {string} searchText - Text to find
 * @returns {{ found: boolean, strategy: string, index: number, matchedText: string, similarity?: number }}
 */
export function fuzzyFind(content, searchText) {
  if (!searchText || searchText.length === 0) {
    return { found: false, strategy: 'empty_search', index: -1, matchedText: '' };
  }

  // Strategy 1: Exact match
  const exactIndex = content.indexOf(searchText);
  if (exactIndex !== -1) {
    return { found: true, strategy: 'exact', index: exactIndex, matchedText: searchText };
  }

  // Strategy 2: Whitespace-insensitive match
  const normalizedSearch = searchText.replace(/\s+/g, ' ').trim();
  const normalizedContent = content.replace(/\s+/g, ' ');
  const wsIndex = normalizedContent.indexOf(normalizedSearch);
  if (wsIndex !== -1) {
    // Map back to original content position
    const originalIndex = mapNormalizedIndex(content, wsIndex, normalizedSearch.length);
    if (originalIndex !== -1) {
      const matchedText = content.substring(originalIndex.start, originalIndex.end);
      return { found: true, strategy: 'whitespace_insensitive', index: originalIndex.start, matchedText };
    }
  }

  // Strategy 3: Line-by-line with trimmed comparison
  const lineResult = lineByLineSearch(content, searchText);
  if (lineResult.found) {
    return lineResult;
  }

  // Strategy 4: Fuzzy match using sequence matching
  const fuzzyResult = fuzzySequenceMatch(content, searchText);
  if (fuzzyResult.found) {
    return fuzzyResult;
  }

  return { found: false, strategy: 'no_match', index: -1, matchedText: '' };
}

/**
 * Map a position in normalized (single-space) content back to original content.
 */
function mapNormalizedIndex(original, normStart, normLen) {
  let origPos = 0;
  let normPos = 0;
  let matchOrigStart = -1;

  while (origPos < original.length && normPos < normStart + normLen) {
    const ch = original[origPos];

    if (/\s/.test(ch)) {
      // Collapse whitespace
      if (normPos < normStart || (normPos >= normStart && normPos < normStart + normLen)) {
        if (normPos === normStart) matchOrigStart = origPos;
        // Skip all consecutive whitespace in original
        while (origPos < original.length && /\s/.test(original[origPos])) origPos++;
        normPos++; // counts as 1 space in normalized
      }
    } else {
      if (normPos === normStart) matchOrigStart = origPos;
      origPos++;
      normPos++;
    }
  }

  if (matchOrigStart === -1) return null;

  // Find the end position in original
  let matchOrigEnd = origPos;
  // Include trailing whitespace in original that was collapsed
  while (matchOrigEnd < original.length && /\s/.test(original[matchOrigEnd]) &&
         matchOrigEnd + 1 < original.length && /\s/.test(original[matchOrigEnd + 1])) {
    matchOrigEnd++;
  }

  return { start: matchOrigStart, end: matchOrigEnd };
}

/**
 * Line-by-line search: splits search text into lines, finds matching lines in content.
 * Handles indentation differences gracefully.
 */
function lineByLineSearch(content, searchText) {
  const searchLines = searchText.split('\n');
  const contentLines = content.split('\n');

  if (searchLines.length === 0 || searchLines.length > contentLines.length) {
    return { found: false, strategy: 'line_by_line', index: -1, matchedText: '' };
  }

  // Trim each search line for comparison
  const trimmedSearch = searchLines.map(l => l.trim()).filter(l => l.length > 0);
  if (trimmedSearch.length === 0) return { found: false, strategy: 'line_by_line', index: -1, matchedText: '' };

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let allMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j].trim()) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      // Reconstruct the matched text from original content
      const matchedLines = contentLines.slice(i, i + searchLines.length);
      const matchStart = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const matchedText = matchedLines.join('\n');
      return { found: true, strategy: 'line_trimmed', index: matchStart, matchedText };
    }
  }

  return { found: false, strategy: 'line_by_line', index: -1, matchedText: '' };
}

/**
 * Fuzzy sequence matching using a simplified Levenshtein-based approach.
 * Scans a window across the content looking for the best match.
 */
function fuzzySequenceMatch(content, searchText) {
  const contentLines = content.split('\n');
  const searchLines = searchText.split('\n');

  if (searchLines.length === 0 || searchLines.length > contentLines.length) {
    return { found: false, strategy: 'fuzzy', index: -1, matchedText: '' };
  }

  let bestRatio = 0;
  let bestStart = -1;

  const windowSize = searchLines.length;

  for (let i = 0; i <= contentLines.length - windowSize; i++) {
    const window = contentLines.slice(i, i + windowSize);
    const ratio = difflibSequenceRatio(searchLines, window);

    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestStart = i;
    }
  }

  const THRESHOLD = 0.75; // 75% similarity required
  if (bestRatio >= THRESHOLD && bestStart !== -1) {
    const matchedLines = contentLines.slice(bestStart, bestStart + searchLines.length);
    const matchStart = contentLines.slice(0, bestStart).join('\n').length + (bestStart > 0 ? 1 : 0);
    const matchedText = matchedLines.join('\n');
    return {
      found: true,
      strategy: 'fuzzy',
      index: matchStart,
      matchedText,
      similarity: bestRatio,
    };
  }

  return { found: false, strategy: 'fuzzy', index: -1, matchedText: '' };
}

/**
 * Calculate sequence similarity ratio between two arrays of strings.
 */
function difflibSequenceRatio(a, b) {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  // Use trimmed comparison for each line
  let matches = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].trim() === b[i].trim()) {
      matches++;
    } else {
      // Partial line match using character-level similarity
      const lineRatio = characterSimilarity(a[i].trim(), b[i].trim());
      matches += lineRatio;
    }
  }
  return matches / len;
}

/**
 * Character-level similarity between two strings (Dice coefficient).
 */
function characterSimilarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0.0;

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.substring(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.substring(i, i + 2);
    if (bigramsA.has(bg) && bigramsA.get(bg) > 0) {
      matches++;
      bigramsA.set(bg, bigramsA.get(bg) - 1);
    }
  }

  return (2 * matches) / (a.length - 1 + b.length - 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH/REPLACE Block Parser (Aider-style)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse SEARCH/REPLACE blocks from content.
 * Format:
 * ```
 * path/to/file.ext
 * <<<<<<< SEARCH
 * content to find
 * =======
 * replacement content
 * >>>>>>> REPLACE
 * ```
 *
 * Also supports the `:start_line:N` annotation:
 * ```
 * path/to/file.ext
 * <<<<<<< SEARCH
 * :start_line:10
 * -------
 * content to find
 * =======
 * replacement content
 * >>>>>>> REPLACE
 * ```
 *
 * @param {string} text - Text containing SEARCH/REPLACE blocks
 * @returns {Array<{file: string, search: string, replace: string, startLine?: number}>}
 */
export function parseSearchReplaceBlocks(text) {
  const blocks = [];
  const blockRegex = /(?:^|\n)((?:[^\n<>\s][^\n]*\n)?)<{5,} SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>{5,} REPLACE/g;

  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    let filePath = match[1].trim();
    let searchContent = match[2];
    const replaceContent = match[3];

    // Check for :start_line: annotation
    let startLine = undefined;
    const startLineMatch = searchContent.match(/^:start_line:(\d+)\n-+\n/);
    if (startLineMatch) {
      startLine = parseInt(startLineMatch[1], 10);
      searchContent = searchContent.substring(startLineMatch[0].length);
    }

    // Remove trailing newline from search/replace if present
    searchContent = searchContent.replace(/\n$/, '');
    const finalReplace = replaceContent.replace(/\n$/, '');

    if (filePath) {
      blocks.push({
        file: filePath,
        search: searchContent,
        replace: finalReplace,
        startLine,
      });
    }
  }

  return blocks;
}

/**
 * Apply a single SEARCH/REPLACE block to file content.
 * Uses multi-strategy matching for robustness.
 *
 * @param {string} content - Original file content
 * @param {string} search - Text to find
 * @param {string} replace - Replacement text
 * @param {Object} options - { indentAware: boolean, startLine?: number }
 * @returns {{ success: boolean, content: string, strategy: string, error?: string, similarity?: number }}
 */
export function applySearchReplace(content, search, replace, options = {}) {
  const { indentAware = true, startLine } = options;

  // Handle start line hint
  let searchRegion = content;
  let regionOffset = 0;
  if (startLine !== undefined) {
    const lines = content.split('\n');
    const startIdx = Math.max(0, startLine - 1);
    searchRegion = lines.slice(startIdx).join('\n');
    regionOffset = lines.slice(0, startIdx).join('\n').length + (startIdx > 0 ? 1 : 0);
  }

  // Try to find the search text
  const result = fuzzyFind(searchRegion, search);

  if (!result.found) {
    // Provide diagnostic information
    const searchLines = search.split('\n');
    const contentLines = content.split('\n');
    const similarLines = findSimilarLines(searchLines[0]?.trim() || '', contentLines);

    let error = `SEARCH block failed to match.\n`;
    error += `Strategy: ${result.strategy}\n`;
    error += `Searched ${search.length} chars across ${searchLines.length} lines.\n`;

    if (similarLines.length > 0) {
      error += `\nSimilar lines found in file:\n`;
      for (const sl of similarLines.slice(0, 5)) {
        error += `  Line ${sl.line}: "${sl.text.substring(0, 120)}"\n`;
      }
      error += `\nTIP: Re-read the file with read_file to get the EXACT text.`;
    }

    return { success: false, content, strategy: result.strategy, error };
  }

  // Apply the replacement
  let actualIndex = result.index;
  if (startLine !== undefined) {
    actualIndex += regionOffset;
  }

  let newContent;
  if (indentAware && result.strategy !== 'exact') {
    // Preserve indentation: detect indent of the matched block and re-indent replacement
    const indentInfo = detectIndentation(content);
    const matchedIndent = getIndentAtPosition(content, actualIndex);
    const reindented = reindentBlock(replace, matchedIndent, indentInfo);
    newContent = content.substring(0, actualIndex) + reindented + content.substring(actualIndex + result.matchedText.length);
  } else {
    newContent = content.substring(0, actualIndex) + replace + content.substring(actualIndex + result.matchedText.length);
  }

  return {
    success: true,
    content: newContent,
    strategy: result.strategy,
    similarity: result.similarity,
  };
}

/**
 * Get the indentation level at a specific position in content.
 */
function getIndentAtPosition(content, position) {
  // Find the start of the line containing this position
  let lineStart = content.lastIndexOf('\n', position - 1);
  lineStart = lineStart === -1 ? 0 : lineStart + 1;

  const line = content.substring(lineStart);
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/**
 * Find lines similar to a target in a set of lines.
 */
function findSimilarLines(target, lines) {
  if (!target || target.length < 3) return [];

  return lines
    .map((line, i) => {
      const trimmed = line.trim();
      if (trimmed.length < 3) return null;
      const ratio = characterSimilarity(target, trimmed);
      return ratio > 0.4 ? { line: i + 1, text: trimmed, similarity: ratio } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex-Style Patch Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Codex-style patch from text.
 *
 * Format:
 * ```
 * *** Begin Patch
 * *** [Operation] File: [filepath]
 * @@ [anchor text]
 *   [context line (starts with space)]
 * - [line to remove (starts with -)]
 * + [line to add (starts with +)]
 * *** End Patch
 * ```
 *
 * @param {string} text - Patch text
 * @returns {{ valid: boolean, patches: Array, error?: string }}
 */
export function parsePatch(text) {
  const patches = [];

  // Normalize line endings
  const normalizedText = text.replace(/\r\n/g, '\n');

  if (!normalizedText.includes('*** Begin Patch')) {
    return { valid: false, patches: [], error: 'Patch must start with *** Begin Patch' };
  }

  // Extract patch blocks
  const patchBlocks = normalizedText.split('*** Begin Patch').slice(1);

  for (const block of patchBlocks) {
    const endIdx = block.indexOf('*** End Patch');
    if (endIdx === -1) continue;

    const patchContent = block.substring(0, endIdx).trim();
    const lines = patchContent.split('\n');

    // Parse operation and file
    const headerMatch = lines[0]?.match(/^\*\*\*\s*(Add File|Update File|Delete File):\s*(.+)/i);
    if (!headerMatch) continue;

    const operation = headerMatch[1].toLowerCase().replace(' ', '_');
    const filePath = headerMatch[2].trim();

    const hunks = [];
    let currentHunk = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('@@')) {
        // New hunk with anchor
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          anchor: line.substring(2).trim(),
          lines: [],
        };
      } else if (currentHunk && (line.startsWith(' ') || line.startsWith('-') || line.startsWith('+'))) {
        currentHunk.lines.push({
          type: line[0] === ' ' ? 'context' : line[0] === '-' ? 'remove' : 'add',
          content: line.substring(1),
        });
      }
    }

    if (currentHunk) hunks.push(currentHunk);

    patches.push({ operation, file: filePath, hunks });
  }

  return { valid: patches.length > 0, patches };
}

/**
 * Apply a parsed patch to file contents.
 *
 * @param {string} content - Original file content
 * @param {Object} patch - Parsed patch with hunks
 * @returns {{ success: boolean, content: string, error?: string, appliedHunks: number }}
 */
export function applyPatchToContent(content, patch) {
  let result = content;
  let appliedHunks = 0;
  const errors = [];

  for (const hunk of patch.hunks) {
    // Find the anchor in the content
    const anchorResult = fuzzyFind(result, hunk.anchor);
    if (!anchorResult.found) {
      errors.push(`Could not find anchor: "${hunk.anchor.substring(0, 80)}"`);
      continue;
    }

    // Build the context and changes from the hunk
    const contextLines = hunk.lines.filter(l => l.type === 'context').map(l => l.content);
    const removeLines = hunk.lines.filter(l => l.type === 'remove').map(l => l.content);
    const addLines = hunk.lines.filter(l => l.type === 'add').map(l => l.content);

    // Find exact position using context lines
    const lines = result.split('\n');
    let hunkStart = -1;

    // Search near the anchor
    const anchorLine = result.substring(0, anchorResult.index).split('\n').length - 1;
    const searchStart = Math.max(0, anchorLine - 5);
    const searchEnd = Math.min(lines.length, anchorLine + 20);

    for (let i = searchStart; i <= searchEnd - contextLines.length; i++) {
      let contextMatch = true;
      for (let j = 0; j < contextLines.length; j++) {
        const contentLine = lines[i + j]?.trim() || '';
        const ctxLine = contextLines[j]?.trim() || '';
        if (contentLine !== ctxLine) {
          contextMatch = false;
          break;
        }
      }
      if (contextMatch) {
        hunkStart = i;
        break;
      }
    }

    if (hunkStart === -1) {
      errors.push(`Could not locate hunk context near anchor: "${hunk.anchor.substring(0, 50)}"`);
      continue;
    }

    // Apply the hunk: remove marked lines, add new lines
    const hunkEnd = hunkStart + removeLines.length;
    const newLines = [...lines.slice(0, hunkStart), ...addLines, ...lines.slice(hunkEnd)];
    result = newLines.join('\n');
    appliedHunks++;
  }

  return {
    success: errors.length === 0,
    content: result,
    error: errors.length > 0 ? errors.join('; ') : undefined,
    appliedHunks,
    totalHunks: patch.hunks.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Diff Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unified diff between two strings.
 *
 * @param {string} original - Original content
 * @param {string} modified - Modified content
 * @param {Object} options - { contextLines: number, fromFile: string, toFile: string }
 * @returns {string} Unified diff format string
 */
export function generateUnifiedDiff(original, modified, options = {}) {
  const { contextLines = 3, fromFile = 'a/file', toFile = 'b/file' } = options;

  const origLines = original.split('\n');
  const modLines = modified.split('\n');

  const diff = difflib.unifiedDiff(origLines, modLines, {
    fromfile: fromFile,
    tofile: toFile,
    lineterm: '',
    n: contextLines,
  });

  return diff;
}

/**
 * Generate a compact diff summary showing only changed lines.
 */
export function generateCompactDiff(original, modified) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const maxLen = Math.max(origLines.length, modLines.length);
  const changes = [];

  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const mod = modLines[i];
    if (orig !== mod) {
      changes.push({
        line: i + 1,
        removed: orig !== undefined ? orig : null,
        added: mod !== undefined ? mod : null,
      });
    }
  }

  return changes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-File Edit Coordinator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coordinate edits across multiple files with rollback support.
 *
 * @param {Array<{path: string, content: string, edits: Array}>} fileEdits
 * @param {Function} readFileFn - Async function to read a file
 * @param {Function} writeFileFn - Async function to write a file
 * @returns {Promise<{success: boolean, results: Array, error?: string}>}
 */
export async function applyMultiFileEdits(fileEdits, readFileFn, writeFileFn) {
  const backups = [];
  const results = [];

  try {
    // Phase 1: Read all files and validate edits
    for (const fileEdit of fileEdits) {
      const originalContent = await readFileFn(fileEdit.path);
      backups.push({ path: fileEdit.path, content: originalContent });

      let content = originalContent;
      const editResults = [];

      for (const edit of fileEdit.edits) {
        const result = applySearchReplace(content, edit.search, edit.replace, edit.options);
        editResults.push({
          success: result.success,
          strategy: result.strategy,
          error: result.error,
          similarity: result.similarity,
        });

        if (!result.success) {
          results.push({
            path: fileEdit.path,
            success: false,
            error: result.error,
            editResults,
          });
          // Rollback all changes
          for (const backup of backups) {
            await writeFileFn(backup.path, backup.content);
          }
          return {
            success: false,
            results,
            error: `Edit failed in ${fileEdit.path}: ${result.error}`,
            rolledBack: true,
          };
        }

        content = result.content;
      }

      results.push({
        path: fileEdit.path,
        success: true,
        editResults,
        originalSize: originalContent.length,
        newSize: content.length,
      });

      // Write the modified content
      await writeFileFn(fileEdit.path, content);
    }

    return { success: true, results };
  } catch (error) {
    // Rollback on any error
    for (const backup of backups) {
      try {
        await writeFileFn(backup.path, backup.content);
      } catch { /* best effort rollback */ }
    }
    return {
      success: false,
      results,
      error: `Multi-file edit failed: ${error.message}`,
      rolledBack: true,
    };
  }
}

export default {
  detectIndentation,
  getIndentLevel,
  reindentBlock,
  fuzzyFind,
  parseSearchReplaceBlocks,
  applySearchReplace,
  parsePatch,
  applyPatchToContent,
  generateUnifiedDiff,
  generateCompactDiff,
  applyMultiFileEdits,
};
