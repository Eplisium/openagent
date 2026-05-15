import chalk from '../utils/chalk-compat.js';
import { highlightCode } from './syntaxHighlight.js';

export function renderDiff(oldContent, newContent, filePath, theme = {}, options = {}) {
  const { stat = false, contextLines = 3 } = options;
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff = computeDiff(oldLines, newLines);
  const stats = getDiffStats(diff);
  const colors = normalizeTheme(theme);
  const fileSize = Buffer.byteLength(newContent || '', 'utf8');
  const sizeLabel = fileSize > 1024 ? `${(fileSize / 1024).toFixed(1)}KB` : `${fileSize}B`;

  const lines = [];
  lines.push(colors.accent(`  ┌─ ${filePath} ${colors.muted(`(${sizeLabel})`)}`));

  if (stat) {
    const total = Math.max(1, stats.additions + stats.deletions);
    const width = 28;
    const addWidth = Math.round((stats.additions / total) * width);
    const delWidth = Math.round((stats.deletions / total) * width);
    const bar = colors.success('+'.repeat(addWidth)) + colors.error('-'.repeat(delWidth));
    lines.push(`  │ ${bar} ${colors.success(`+${stats.additions}`)} ${colors.error(`-${stats.deletions}`)}`);
    lines.push(colors.accent('  └─'));
    return lines.join('\n');
  }

  let lastWasChange = false;
  for (const hunk of compactHunks(diff.hunks, contextLines)) {
    for (const line of hunk.lines) {
      const num = String(line.oldNum || line.newNum || '').padStart(4);
      const content = highlightLine(line.content, filePath, theme);
      switch (line.type) {
        case 'context':
          if (lastWasChange) lines.push('');
          lines.push(`  ${colors.muted(num)} │ ${content}`);
          lastWasChange = false;
          break;
        case 'remove':
          lines.push(`  ${colors.muted(num)} │ ${colors.error('- ' + content)}`);
          lastWasChange = true;
          break;
        case 'add':
          lines.push(`  ${colors.muted(num)} │ ${colors.success('+ ' + content)}`);
          lastWasChange = true;
          break;
        case 'skip':
          lines.push(colors.muted(`  .... │ ${line.content}`));
          lastWasChange = false;
          break;
      }
    }
    lines.push('');
  }

  const addStr = colors.success(`+${stats.additions}`);
  const delStr = colors.error(`-${stats.deletions}`);
  lines.push(`  └─ ${addStr} ${delStr}`);

  return lines.join('\n');
}

function normalizeTheme(theme = {}) {
  const role = (name, fallback) => {
    if (typeof theme[name] === 'function') return theme[name];
    if (typeof theme[name] === 'string') return chalk.hex(theme[name]);
    return fallback;
  };
  return {
    accent: role('accent', chalk.cyan),
    muted: role('muted', chalk.gray),
    success: role('success', chalk.green),
    error: role('error', chalk.red),
  };
}

function highlightLine(content, filePath, theme) {
  const ext = String(filePath || '').split('.').pop() || 'text';
  const lang = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    yml: 'yaml',
    yaml: 'yaml',
    json: 'json',
    rs: 'rust',
    sh: 'bash',
  }[ext] || ext;
  return highlightCode(content, lang, theme);
}

function compactHunks(hunks, contextLines) {
  if (contextLines < 0) return hunks;
  return hunks.map((hunk) => {
    const changed = new Set();
    hunk.lines.forEach((line, index) => {
      if (line.type !== 'context') {
        const start = Math.max(0, index - contextLines);
        const end = Math.min(hunk.lines.length - 1, index + contextLines);
        for (let i = start; i <= end; i++) changed.add(i);
      }
    });
    const lines = [];
    let skipped = 0;
    hunk.lines.forEach((line, index) => {
      if (changed.has(index) || line.type !== 'context') {
        if (skipped > 0) {
          lines.push({ type: 'skip', content: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
          skipped = 0;
        }
        lines.push(line);
      } else {
        skipped++;
      }
    });
    if (skipped > 0) lines.push({ type: 'skip', content: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
    return { ...hunk, lines };
  });
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
