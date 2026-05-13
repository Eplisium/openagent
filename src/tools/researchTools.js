/**
 * 🔬 Research Tools v1.0
 * Compound research tools that combine search + read in a single operation
 *
 * Features:
 * - research_query: Search → Read top N sources → Return structured research
 * - deep_research: Multi-hop research with query decomposition
 * - Parallel source fetching for speed
 * - Smart source selection based on ranking scores
 * - Automatic deduplication across sources
 */

import { CONFIG } from '../config.js';
import { extractContent, extractViaJina, isPdf, extractPdfContent } from './contentExtractor.js';

// Lazy reference to web search tool (set via init prevent circular imports)
let _searchTool = null;
let _fetchUrlTool = null;

export function initResearchTools(searchTool, fetchUrlTool) {
  _searchTool = searchTool;
  _fetchUrlTool = fetchUrlTool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch and extract content from a URL.
 * Uses the appropriate method based on content type.
 */
async function fetchAndExtract(url, maxChars, useJina = false) {
  // Try Jina Reader first if enabled (best for LLM markdown output)
  if (useJina) {
    const jinaResult = await extractViaJina(url, { timeout: 20000 });
    if (!jinaResult.error) {
      return {
        url,
        title: jinaResult.title || '',
        content: jinaResult.content.substring(0, maxChars),
        length: jinaResult.content.length,
        method: 'jina-reader',
        success: true,
      };
    }
    // Jina failed, fall through to local extraction
  }

  // Local extraction: fetch the URL directly
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.WEB_READ_TIMEOUT_MS || 20000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timer);

    const contentType = response.headers.get('content-type') || '';

    // Handle PDFs
    if (isPdf(contentType, url)) {
      const buffer = await response.arrayBuffer();
      const pdfResult = await extractPdfContent(Buffer.from(buffer));
      if (pdfResult.error) {
        return { url, content: pdfResult.error, method: 'pdf-failed', success: false };
      }
      return {
        url,
        title: pdfResult.info?.Title || url,
        content: pdfResult.text.substring(0, maxChars),
        pages: pdfResult.pages,
        method: 'pdf-extract',
        success: true,
      };
    }

    // Handle HTML
    const html = await response.text();
    if (!response.ok) {
      return {
        url,
        content: `HTTP ${response.status}: ${response.statusText}`,
        method: 'http-error',
        success: false,
      };
    }

    const result = await extractContent(html, {
      url,
      mode: 'markdown',
      maxChars,
    });

    return {
      url,
      title: result.title || result.metadata?.title || '',
      content: result.content,
      author: result.metadata?.author || '',
      publishedDate: result.metadata?.publishedDate || '',
      method: result.extractionMethod,
      success: result.content.length > 100,
    };
  } catch (error) {
    return {
      url,
      content: `Failed to fetch: ${error.message}`,
      method: 'fetch-error',
      success: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Query Decomposition (rule-based)
// ---------------------------------------------------------------------------

/**
 * Decompose a complex query into focused sub-queries.
 * Uses rule-based decomposition (no LLM call needed).
 * Returns the original query plus 1-2 decomposed variants.
 */
function decomposeQuery(query) {
  const queries = [query]; // Original always first
  const q = query.toLowerCase();

  // Comparison queries: "X vs Y" → search each separately
  const compMatch = query.match(/(.+?)\s+(?:vs\.?|versus|compared?\s+to|or)\s+(.+)/i);
  if (compMatch) {
    queries.push(`${compMatch[1].trim()} features performance`);
    queries.push(`${compMatch[2].trim()} features performance`);
    return queries.slice(0, 3);
  }

  // "How does X work in Y" → search X and Y separately
  const howMatch = query.match(/how\s+(?:does|do|is|are)\s+(.+?)\s+(?:in|on|with|for)\s+(.+)/i);
  if (howMatch) {
    queries.push(`${howMatch[1].trim()} explained`);
    return queries.slice(0, 3);
  }

  // "Best X for Y" → search for recommendations and Y-specific results
  const bestMatch = query.match(/(?:best|top|recommended?)\s+(.+?)\s+(?:for|in)\s+(.+)/i);
  if (bestMatch) {
    queries.push(`${bestMatch[1].trim()} comparison review 2025`);
    return queries.slice(0, 3);
  }

  // Multi-topic: if query has "and" connecting distinct topics
  const andMatch = query.match(/(.+?)\s+and\s+(.+)/i);
  if (andMatch && andMatch[1].length > 10 && andMatch[2].length > 10) {
    queries.push(andMatch[1].trim());
    queries.push(andMatch[2].trim());
    return queries.slice(0, 3);
  }

  // Technical: add "documentation" or "tutorial" variant
  if (/api|function|library|framework|module|package|npm|pip/.test(q)) {
    queries.push(`${query} documentation`);
    return queries.slice(0, 2);
  }

  // News: add "latest" if not already present
  if (/announce|release|update|launch|new/.test(q) && !q.includes('latest')) {
    queries.push(`latest ${query}`);
    return queries.slice(0, 2);
  }

  return queries.slice(0, 2);
}

// ---------------------------------------------------------------------------
// research_query tool
// ---------------------------------------------------------------------------

export const researchQueryTool = {
  name: 'research_query',
  description: 'Deep research tool: searches the web and reads the top sources to provide comprehensive, cited answers in a single call. Use this when you need in-depth information from multiple sources, not just search snippets. Returns structured content with source attribution.',
  category: 'network',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Research query — the question or topic to investigate',
      },
      maxSources: {
        type: 'integer',
        description: 'Number of sources to read in full (default: 3, max: 5)',
      },
      maxCharsPerSource: {
        type: 'integer',
        description: 'Maximum characters per source (default: 8000)',
      },
      useJina: {
        type: 'boolean',
        description: 'Use Jina Reader API for higher quality markdown extraction (default: false — uses local extraction)',
      },
      searchBackend: {
        type: 'string',
        description: 'Specific search backend to use (default: auto)',
      },
    },
    required: ['query'],
  },
  async execute({ query, maxSources = 3, maxCharsPerSource = 8000, useJina = false, searchBackend = 'auto' }) {
    if (!_searchTool) {
      return { success: false, error: 'Research tools not initialized. Internal error.' };
    }

    // Clamp values
    maxSources = Math.min(Math.max(1, maxSources), 5);
    maxCharsPerSource = Math.min(Math.max(1000, maxCharsPerSource), 20000);

    try {
      // Step 1: Search
      const searchResult = await _searchTool.execute({
        query,
        maxResults: Math.max(maxSources * 2, 6), // Fetch extra for better selection
        backend: searchBackend,
      });

      if (!searchResult.success || searchResult.results.length === 0) {
        return {
          success: false,
          error: `No search results found for "${query}". ${searchResult.error || ''}`,
          query,
          searchAttempts: searchResult.attempts,
        };
      }

      // Step 2: Select top sources (already ranked by search)
      const topSources = searchResult.results
        .filter(r => r.url && r.url.startsWith('http'))
        .slice(0, maxSources);

      // Step 3: Read all sources in parallel
      const sourcePromises = topSources.map(result =>
        fetchAndExtract(result.url, maxCharsPerSource, useJina)
          .then(extracted => ({
            ...extracted,
            searchTitle: result.title,
            searchSnippet: result.snippet,
            searchScore: result._score,
          }))
      );

      const sources = await Promise.all(sourcePromises);

      // Step 4: Build response
      const successfulSources = sources.filter(s => s.success);
      const failedSources = sources.filter(s => !s.success);

      return {
        success: true,
        query,
        searchResults: searchResult.results.length,
        searchBackend: searchResult.backend,
        sourcesRead: successfulSources.length,
        sourcesFailed: failedSources.length,
        sources: successfulSources.map(s => ({
          url: s.url,
          title: s.title || s.searchTitle,
          author: s.author,
          publishedDate: s.publishedDate,
          extractionMethod: s.method,
          content: s.content,
          snippet: s.searchSnippet,
          contentLength: s.content.length,
        })),
        failedUrls: failedSources.map(s => ({ url: s.url, error: s.content })),
      };
    } catch (error) {
      return {
        success: false,
        error: `Research failed: ${error.message}`,
        query,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// deep_research tool
// ---------------------------------------------------------------------------

export const deepResearchTool = {
  name: 'deep_research',
  description: 'Multi-hop research tool: decomposes a complex question into sub-queries, searches each, and reads the best sources. For questions that span multiple topics, comparisons, or need broad coverage. Returns a comprehensive research summary with all sources cited.',
  category: 'network',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Complex research question that may need decomposition',
      },
      maxSubQueries: {
        type: 'integer',
        description: 'Maximum sub-queries to generate (default: 3)',
      },
      maxSourcesPerQuery: {
        type: 'integer',
        description: 'Sources to read per sub-query (default: 2)',
      },
      maxCharsPerSource: {
        type: 'integer',
        description: 'Maximum characters per source (default: 6000)',
      },
      useJina: {
        type: 'boolean',
        description: 'Use Jina Reader API for extraction (default: false)',
      },
    },
    required: ['query'],
  },
  async execute({ query, maxSubQueries = 3, maxSourcesPerQuery = 2, maxCharsPerSource = 6000, useJina = false }) {
    if (!_searchTool) {
      return { success: false, error: 'Research tools not initialized. Internal error.' };
    }

    maxSubQueries = Math.min(Math.max(1, maxSubQueries), 4);
    maxSourcesPerQuery = Math.min(Math.max(1, maxSourcesPerQuery), 3);
    maxCharsPerSource = Math.min(Math.max(1000, maxCharsPerSource), 15000);

    try {
      // Step 1: Decompose the query
      const subQueries = decomposeQuery(query).slice(0, maxSubQueries);

      // Step 2: Search all sub-queries in parallel
      const searchPromises = subQueries.map(sq =>
        _searchTool.execute({
          query: sq,
          maxResults: Math.max(maxSourcesPerQuery * 2, 4),
          backend: 'auto',
        }).then(result => ({
          subQuery: sq,
          ...result,
        }))
      );

      const searchResults = await Promise.all(searchPromises);

      // Step 3: Collect all URLs, deduplicate, select best
      const allResults = [];
      const seenUrls = new Set();

      for (const sr of searchResults) {
        if (!sr.success || !sr.results) continue;
        for (const result of sr.results) {
          const normalizedUrl = normalizeUrl(result.url);
          if (!seenUrls.has(normalizedUrl) && result.url?.startsWith('http')) {
            seenUrls.add(normalizedUrl);
            allResults.push({
              ...result,
              subQuery: sr.subQuery,
            });
          }
        }
      }

      // Take top sources (sorted by score, already ranked)
      const topSources = allResults.slice(0, maxSubQueries * maxSourcesPerQuery);

      // Step 4: Read all sources in parallel
      const sourcePromises = topSources.map(result =>
        fetchAndExtract(result.url, maxCharsPerSource, useJina)
          .then(extracted => ({
            ...extracted,
            subQuery: result.subQuery,
            searchTitle: result.title,
            searchSnippet: result.snippet,
          }))
      );

      const sources = await Promise.all(sourcePromises);
      const successfulSources = sources.filter(s => s.success);

      // Step 5: Group sources by sub-query
      const grouped = {};
      for (const s of successfulSources) {
        const key = s.subQuery || query;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          url: s.url,
          title: s.title || s.searchTitle,
          author: s.author,
          publishedDate: s.publishedDate,
          extractionMethod: s.method,
          content: s.content,
          contentLength: s.content.length,
        });
      }

      return {
        success: true,
        query,
        subQueries,
        totalSourcesRead: successfulSources.length,
        totalSourcesFailed: sources.length - successfulSources.length,
        results: grouped,
        rawSources: successfulSources.map(s => ({
          url: s.url,
          title: s.title || s.searchTitle,
          subQuery: s.subQuery,
          content: s.content,
          method: s.method,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: `Deep research failed: ${error.message}`,
        query,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// URL helper
// ---------------------------------------------------------------------------

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    let normalized = parsed.toString();
    if (normalized.endsWith('/') && parsed.pathname.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return (url || '').toLowerCase().replace(/\/+$/, '');
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createResearchTools() {
  return [researchQueryTool, deepResearchTool];
}

export default createResearchTools;
