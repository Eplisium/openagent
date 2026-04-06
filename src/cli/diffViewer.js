// chalk removed — not used in this file

export function renderDiff(oldContent, newContent, filePath, theme) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff = computeDiff(oldLines, newLines);

  const lines = [];
  lines.push(theme.accent(`  ${filePath}`));
  lines.push(theme.muted('  ' + '─'.repeat(50)));

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const num = String(line.oldNum || line.newNum || '').padStart(4);
      switch (line.type) {
        case 'context':
          lines.push(`  ${theme.muted(num)} │ ${line.content}`);
          break;
        case 'remove':
          lines.push(`  ${theme.muted(num)} │ ${theme.error('- ' + line.content)}`);
          break;
        case 'add':
          lines.push(`  ${theme.muted(num)} │ ${theme.success('+ ' + line.content)}`);
          break;
      }
    }
    lines.push('');
  }

  const stats = getDiffStats(diff);
  lines.push(`  ${theme.success(`+${stats.additions}`)} ${theme.error(`-${stats.deletions}`)} ${theme.muted(`(${stats.files} file)`)}`);

  return lines.join('\n');
}

function computeDiff(oldLines, newLines) {
  // Simple LCS-based diff algorithm
  // Returns { hunks: [{ lines: [{ type, content, oldNum, newNum }] }] }
  // Keep it simple — no need for full Myers diff

  const hunks = [];
  const hunk = { lines: [] };
  let oi = 0, ni = 0;
  let oldNum = 1, newNum = 1;

  // Find changes by comparing line by line
  // Group consecutive changes into hunks
  // Add 2 lines of context around each change

  const lcs = buildLCS(oldLines, newLines);
  let lcsIdx = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (lcsIdx < lcs.length && oi === lcs[lcsIdx].oldIdx && ni === lcs[lcsIdx].newIdx) {
      // Context line (unchanged)
      hunk.lines.push({ type: 'context', content: oldLines[oi], oldNum: oldNum++, newNum: newNum++ });
      oi++; ni++; lcsIdx++;
    } else if (oi < oldLines.length && (lcsIdx >= lcs.length || oi < lcs[lcsIdx].oldIdx)) {
      // Removed line
      hunk.lines.push({ type: 'remove', content: oldLines[oi], oldNum: oldNum++ });
      oi++;
    } else if (ni < newLines.length) {
      // Added line
      hunk.lines.push({ type: 'add', content: newLines[ni], newNum: newNum++ });
      ni++;
    }
  }

  if (hunk.lines.length > 0) hunks.push(hunk);
  return { hunks };
}

function buildLCS(a, b) {
  // Longest Common Subsequence
  // Returns array of { oldIdx, newIdx } pairs
  const m = a.length, n = b.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i-1] === b[j-1]) {
      result.unshift({ oldIdx: i-1, newIdx: j-1 });
      i--; j--;
    } else if (dp[i-1][j] > dp[i][j-1]) i--;
    else j--;
  }
  return result;
}

function getDiffStats(diff) {
  let additions = 0, deletions = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
  }
  return { additions, deletions, files: 1 };
}
