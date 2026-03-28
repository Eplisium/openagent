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
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
  return value.toString();
}

/**
 * Format milliseconds into a human-readable duration string
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format elapsed time in a verbose style (e.g., "2m 30s", "1h 5m")
 */
export function formatElapsedTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
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
  return modelId.split('/').pop();
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

// ═══════════════════════════════════════════════════════════════════
// 🔧 Text Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Simple text similarity check (Jaccard on words)
 */
export function textSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Deduplicate response content that may have been repeated by the LLM
 */
export function deduplicateResponse(content) {
  if (!content || content.length < 100) return content;

  const half = Math.floor(content.length / 2);
  const firstHalf = content.substring(0, half).trim();
  const secondHalf = content.substring(half).trim();

  // If both halves are very similar (>85% overlap), take just the first half
  if (firstHalf.length > 50 && secondHalf.length > 50) {
    const similarity = textSimilarity(firstHalf, secondHalf);
    if (similarity > 0.85) {
      return firstHalf;
    }
  }

  // Also check for exact substring duplication
  for (let offset = -20; offset <= 20; offset++) {
    const splitPoint = half + offset;
    if (splitPoint < 50 || splitPoint > content.length - 50) continue;

    const part1 = content.substring(0, splitPoint).trim();
    const part2 = content.substring(splitPoint).trim();

    if (part1 === part2) {
      return part1;
    }
  }

  return content;
}
