/**
 * Simple diff library for unified diff generation.
 * Pure JS implementation — no external dependencies.
 */

/**
 * Generate unified diff between two arrays of lines.
 */
export function unifiedDiff(fromLines, toLines, options = {}) {
  const { fromfile = 'a/file', tofile = 'b/file', lineterm = '', n = 3 } = options;

  // Use a simple diff algorithm based on sequence matching
  const diff = computeDiff(fromLines, toLines);
  if (diff.length === 0) return '';

  const output = [];
  output.push(`--- ${fromfile}`);
  output.push(`+++ ${tofile}`);

  // Group consecutive changes into hunks
  const hunks = groupIntoHunks(diff, fromLines.length, toLines.length, n);

  for (const hunk of hunks) {
    const fromStart = hunk.fromStart + 1; // 1-indexed
    const toStart = hunk.toStart + 1;
    const fromCount = hunk.fromEnd - hunk.fromStart;
    const toCount = hunk.toEnd - hunk.toStart;

    output.push(`@@ -${fromStart},${fromCount} +${toStart},${toCount} @@`);

    for (const line of hunk.lines) {
      if (line.type === 'context') {
        output.push(` ${line.content}`);
      } else if (line.type === 'remove') {
        output.push(`-${line.content}`);
      } else if (line.type === 'add') {
        output.push(`+${line.content}`);
      }
    }
  }

  return output.join('\n') + lineterm;
}

/**
 * Compute diff operations between two line arrays.
 * Returns array of { type, fromIdx, toIdx, content }.
 */
function computeDiff(from, to) {
  const ops = [];

  // Simple approach: find matching segments using LCS
  let i = 0, j = 0;

  while (i < from.length || j < to.length) {
    // Find next matching block
    let matchLen = 0;
    while (i + matchLen < from.length && j + matchLen < to.length &&
           from[i + matchLen] === to[j + matchLen]) {
      matchLen++;
    }

    if (matchLen > 0) {
      // Context (matching) lines
      for (let k = 0; k < matchLen; k++) {
        ops.push({ type: 'context', fromIdx: i + k, toIdx: j + k, content: from[i + k] });
      }
      i += matchLen;
      j += matchLen;
    } else {
      // Find the shortest path through the diff
      // Look ahead for next match
      let bestFrom = -1, bestTo = -1, bestDist = Infinity;

      const maxLookAhead = 50;
      for (let fi = i; fi < Math.min(i + maxLookAhead, from.length); fi++) {
        for (let tj = j; tj < Math.min(j + maxLookAhead, to.length); tj++) {
          if (from[fi] === to[tj]) {
            const dist = (fi - i) + (tj - j);
            if (dist < bestDist) {
              bestDist = dist;
              bestFrom = fi;
              bestTo = tj;
            }
          }
        }
      }

      if (bestFrom !== -1) {
        // Remove lines from 'from' until bestFrom
        while (i < bestFrom) {
          ops.push({ type: 'remove', fromIdx: i, content: from[i] });
          i++;
        }
        // Add lines from 'to' until bestTo
        while (j < bestTo) {
          ops.push({ type: 'add', toIdx: j, content: to[j] });
          j++;
        }
      } else {
        // No more matches — emit remaining as removes and adds
        while (i < from.length) {
          ops.push({ type: 'remove', fromIdx: i, content: from[i] });
          i++;
        }
        while (j < to.length) {
          ops.push({ type: 'add', toIdx: j, content: to[j] });
          j++;
        }
      }
    }
  }

  return ops;
}

/**
 * Group diff operations into hunks with context lines.
 */
function groupIntoHunks(ops, fromLen, toLen, contextLines) {
  if (ops.length === 0) return [];

  const hunks = [];
  let currentHunk = null;

  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx];
    const isChange = op.type !== 'context';

    if (isChange) {
      if (!currentHunk) {
        // Start a new hunk with context
        const contextStart = Math.max(0, (op.fromIdx ?? op.toIdx) - contextLines);
        currentHunk = {
          fromStart: contextStart,
          toStart: contextStart,
          fromEnd: 0,
          toEnd: 0,
          lines: [],
          fromOffset: 0,
          toOffset: 0,
        };
        // Add leading context
        for (let i = contextStart; i < (op.fromIdx ?? op.toIdx); i++) {
          if (i < ops.length && ops[i].type === 'context') {
            currentHunk.lines.push({ type: 'context', content: ops[i].content });
          }
        }
      }

      currentHunk.lines.push({ type: op.type, content: op.content });
    } else if (currentHunk) {
      // Add context line — might extend the hunk
      currentHunk.lines.push({ type: 'context', content: op.content });

      // Check if we should close the hunk
      let nextChange = -1;
      for (let k = idx + 1; k < Math.min(idx + contextLines + 1, ops.length); k++) {
        if (ops[k].type !== 'context') {
          nextChange = k - idx - 1;
          break;
        }
      }

      if (nextChange === -1 || nextChange > contextLines) {
        // Close this hunk
        finalizeHunk(currentHunk, fromLen, toLen);
        hunks.push(currentHunk);
        currentHunk = null;
      }
    }
  }

  if (currentHunk) {
    finalizeHunk(currentHunk, fromLen, toLen);
    hunks.push(currentHunk);
  }

  return hunks;
}

function finalizeHunk(hunk) {
  let fromPos = 0;
  let toPos = 0;

  for (const line of hunk.lines) {
    if (line.type === 'context') {
      fromPos++;
      toPos++;
    } else if (line.type === 'remove') {
      fromPos++;
    } else if (line.type === 'add') {
      toPos++;
    }
  }

  hunk.fromEnd = hunk.fromStart + fromPos;
  hunk.toEnd = hunk.toStart + toPos;
}

export default { unifiedDiff };
