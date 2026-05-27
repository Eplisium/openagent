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
  return `${(value / 1000).toFixed(1)}s`;
}

/**
 * Format elapsed time in a verbose style (e.g., "2m 30s", "1h 5m")
 */
export function formatElapsedTime(ms) {
  const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
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
 * Deduplicate response content that may have been repeated by the LLM.
 * Only triggers on near-exact duplication — avoids false positives on
 * long structured content (codebase analyses, etc.) where both halves
 * share vocabulary but are semantically distinct.
 */
export function deduplicateResponse(content) {
  if (!content || content.length < 200) return content;

  // Check for exact substring duplication first (most reliable)
  const half = Math.floor(content.length / 2);
  for (let offset = -20; offset <= 20; offset++) {
    const splitPoint = half + offset;
    if (splitPoint < 50 || splitPoint > content.length - 50) continue;

    const part1 = content.substring(0, splitPoint).trim();
    const part2 = content.substring(splitPoint).trim();

    if (part1 === part2) {
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
