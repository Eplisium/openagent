/**
 * 🎨 Formatting Utilities
 * Number, text, duration, and display formatting helpers.
 */

// ═══════════════════════════════════════════════════════════════════
// 📊 Number & Duration Formatting
// ═══════════════════════════════════════════════════════════════════

/**
 * Format large numbers in compact form (1.2M, 500K, etc.)
 */
export function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1000000000) return sign + (abs / 1000000000).toFixed(abs >= 10000000000 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (abs >= 1000) return sign + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return sign + Math.round(abs).toString();
}

/**
 * Format milliseconds into a human-readable duration string
 */
export function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 1000) return `${Math.round(value)}ms`;
  const totalSeconds = value / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
}

/**
 * Format elapsed time in a verbose style (e.g., "2m 30s", "1h 5m")
 */
export function formatElapsedTime(ms) {
  const totalMs = Math.max(0, Number(ms) || 0);
  const seconds = Math.floor(totalMs / 1000);
  const tenths = Math.floor((totalMs % 1000) / 100);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  if (seconds > 0) return `${seconds}.${tenths}s`;
  return `${totalMs.toFixed(0)}ms`;
}

/**
 * Format token counts in compact form: '1.2K', '80.5K', '1.2M'
 */
export function formatTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000000) {
    const v = abs / 1000000;
    return (v >= 10 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '') + 'M';
  }
  if (abs >= 1000) {
    const v = abs / 1000;
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(1)).replace(/\.0$/, '') + 'K';
  }
  return Math.round(abs).toString();
}

/**
 * Format cost in dollar form: '$0.06', '$1.23', '$0.000123'
 */
export function formatCost(value) {
  const v = Number(value || 0);
  if (v === 0) return '$0.00';
  if (v < 0.0001) return '$' + v.toFixed(6);
  if (v < 0.01) return '$' + v.toFixed(4);
  if (v < 1) return '$' + v.toFixed(3);
  return '$' + v.toFixed(2);
}


// ═══════════════════════════════════════════════════════════════════
// 📝 Text Formatting
// ═══════════════════════════════════════════════════════════════════

/**
 * Truncate inline text with ellipsis
 */
export function truncateInline(text, maxLength = 56) {
  if (!text) return '';
  return text.length > maxLength
    ? text.substring(0, maxLength - 3) + '...'
    : text;
}

/**
 * Shorten a model ID to just the model name (last segment)
 */
export function shortenModelLabel(modelId) {
  if (!modelId) return 'unknown';
  const [provider, model] = String(modelId).split('/');
  const knownProviders = new Set(['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'moonshotai', 'x-ai']);
  const label = model && knownProviders.has(provider) ? model : String(modelId).split('/').pop();
  return truncateInline(label.replace(/-\d{8}$/, ''), 28);
}

/**
 * Get a relative time string (e.g., "2m ago", "1h ago")
 */
export function getRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}

/**
 * Format an iteration label for display
 */
export function formatIterationLabel(num) {
  return `iteration ${num}`;
}

// ═══════════════════════════════════════════════════════════════════
// 🔧 Text Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Simple text similarity check (Jaccard on words)
 */
export function textSimilarity(a, b) {
  const wordsA = new Set(String(a || '').toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(String(b || '').toLowerCase().split(/\s+/).filter(Boolean));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Normalize generated text for render/deduplication comparisons.
 */
export function normalizeResponseText(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Conservative same-response check for display guards.
 */
export function responsesAreSimilar(a, b) {
  const left = normalizeResponseText(a);
  const right = normalizeResponseText(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  const lengthRatio = shorter.length / longer.length;
  if (shorter.length >= 80 && lengthRatio > 0.75 && longer.includes(shorter)) return true;

  if (Math.min(left.length, right.length) < 120) return false;
  return lengthRatio > 0.88 && textSimilarity(left, right) > 0.96;
}

function segmentSimilarity(a, b) {
  const left = normalizeResponseText(a);
  const right = normalizeResponseText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (Math.min(left.length, right.length) < 40) return textSimilarity(left, right);
  const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  return lengthRatio < 0.9 ? 0 : textSimilarity(left, right);
}

function dedupeRepeatedUnits(content, splitter, joiner) {
  const trimmed = String(content || '').trim();
  const units = trimmed.split(splitter).map(part => part.trim()).filter(Boolean);
  if (units.length < 2) return null;

  for (let cycleLength = 1; cycleLength <= Math.floor(units.length / 2); cycleLength++) {
    if (units.length % cycleLength !== 0) continue;
    const repeats = units.length / cycleLength;
    if (repeats < 2) continue;

    const firstCycle = units.slice(0, cycleLength);
    let matches = true;
    for (let i = cycleLength; i < units.length; i++) {
      if (segmentSimilarity(units[i], firstCycle[i % cycleLength]) < 0.97) {
        matches = false;
        break;
      }
    }
    if (matches) return firstCycle.join(joiner).trim();
  }

  return null;
}

function nearestBoundary(content, approxIndex) {
  const boundaries = ['\n\n', '\n', '. ', '! ', '? '];
  let best = -1;
  let bestDistance = Infinity;
  for (const boundary of boundaries) {
    const before = content.lastIndexOf(boundary, approxIndex);
    const after = content.indexOf(boundary, approxIndex);
    for (const candidate of [before, after]) {
      if (candidate < 50) continue;
      const end = candidate + boundary.length;
      const distance = Math.abs(end - approxIndex);
      if (distance < bestDistance && distance < 120) {
        best = end;
        bestDistance = distance;
      }
    }
  }
  return best > 0 ? best : approxIndex;
}

function dedupeRepeatedChunks(content) {
  const text = String(content || '').trim();
  if (text.length < 160) return null;

  for (let repeats = 8; repeats >= 2; repeats--) {
    const approxLength = Math.floor(text.length / repeats);
    if (approxLength < 30) continue;

    const chunks = [];
    let cursor = 0;
    for (let i = 1; i < repeats; i++) {
      const boundary = nearestBoundary(text, approxLength * i);
      chunks.push(text.slice(cursor, boundary).trim());
      cursor = boundary;
    }
    chunks.push(text.slice(cursor).trim());

    const first = chunks[0];
    if (!first || chunks.some(chunk => !chunk)) continue;
    const matches = chunks.slice(1).every(chunk => segmentSimilarity(first, chunk) > 0.96);
    if (matches) return first.trim();
  }

  return null;
}

/**
 * Deduplicate response content that may have been repeated by the LLM.
 * Only triggers on near-exact duplication — avoids false positives on
 * long structured content (codebase analyses, etc.) where both halves
 * share vocabulary but are semantically distinct.
 */
function deduplicateResponseInner(content) {
  if (!content || content.length < 80) return content;

  // Check for repeated paragraphs/lines/chunks FIRST — these are more precise
  // than half-dup and handle N-way repetition cleanly (6x, 3x, etc.)
  const repeatedParagraphs = dedupeRepeatedUnits(content, /\n{2,}/, '\n\n');
  if (repeatedParagraphs) return repeatedParagraphs;

  const repeatedLines = dedupeRepeatedUnits(content, /\n+/, '\n');
  if (repeatedLines) return repeatedLines;

  const repeatedChunks = dedupeRepeatedChunks(content);
  if (repeatedChunks) return repeatedChunks;

  // Check for exact substring duplication (half-dup)
  const half = Math.floor(content.length / 2);
  for (let offset = -20; offset <= 20; offset++) {
    const splitPoint = half + offset;
    if (splitPoint < 50 || splitPoint > content.length - 50) continue;

    const part1 = content.substring(0, splitPoint).trim();
    const part2 = content.substring(splitPoint).trim();

    if (part1 === part2) {
      return part1;
    }

    if (responsesAreSimilar(part1, part2)) {
      return part1;
    }
  }

  // Jaccard similarity guard: only apply for very long content (>4000 chars)
  // where a false positive is less likely, and use a very high threshold (0.95)
  // to avoid catching structured reports with shared vocabulary.
  if (content.length > 4000) {
    const firstHalf = content.substring(0, half).trim();
    const secondHalf = content.substring(half).trim();
    if (firstHalf.length > 100 && secondHalf.length > 100) {
      const structuralMarkers = [/```/g, /^\s{0,3}#{1,6}\s/gm, /^\s*[-*+]\s/gm, /^\s*\d+\.\s/gm, /^\|.+\|$/gm];
      const markerDeltaOk = structuralMarkers.every((regex) => {
        const left = firstHalf.match(regex)?.length || 0;
        const right = secondHalf.match(regex)?.length || 0;
        return Math.abs(left - right) <= Math.max(1, Math.ceil(Math.max(left, right) * 0.1));
      });
      if (!markerDeltaOk) return content;
      const similarity = textSimilarity(firstHalf, secondHalf);
      if (similarity > 0.95) {
        return firstHalf;
      }
    }
  }

  return content;
}

/**
 * Deduplicate response content that may have been repeated by the LLM.
 * Only triggers on near-exact duplication — avoids false positives on
 * long structured content (codebase analyses, etc.) where both halves
 * share vocabulary but are semantically distinct.
 *
 * Recursively applies deduplication until the result stabilizes,
 * handling cases like 6x repeated content (6→3→1).
 */
export function deduplicateResponse(content) {
  if (!content || content.length < 80) return content;
  let result = deduplicateResponseInner(content);
  // Recursively deduplicate until stable (handles 6x→3x→1x etc.)
  let iterations = 0;
  while (result !== content && result.length < content.length && iterations < 5) {
    const next = deduplicateResponseInner(result);
    if (next === result || next.length >= result.length) break;
    result = next;
    iterations++;
  }
  return result;
}
