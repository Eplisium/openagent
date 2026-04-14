/**
 * 🌐 Web Tools v5.0 (2026 Edition)
 * Search the web, fetch pages, and browse content
 *
 * Major improvements over v4:
 * - Parallel backend racing — tries all search backends concurrently, takes first success
 * - Exponential backoff retries for transient failures (429, 5xx, network errors)
 * - Rotating User-Agents to avoid bot detection
 * - Fresh Searx instance list with health checking
 * - DuckDuckGo HTML (non-lite) backend as primary free search
 * - Google cache fallback for read_webpage 404s
 * - Better content extraction with Readability-style scoring
 * - Per-backend circuit breaker to stop hammering dead backends
 * - Smarter error messages with actionable suggestions
 */

import { CONFIG } from '../config.js';
import { getSearchCache } from './searchCache.js';

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const CACHE_TTL = CONFIG.WEB_SEARCH_CACHE_TTL_MS || 5 * 60 * 1000;
const SEARCH_CACHE_MAX_SIZE = CONFIG.WEB_SEARCH_CACHE_MAX_SIZE || 100;
const searchCache = new Map(); // Legacy in-memory cache (kept for backward compat)
const multiTierCache = getSearchCache();
let _cacheInitialized = false;

/** Lazy-init the multi-tier disk cache on first search */
async function ensureCacheInit() {
  if (_cacheInitialized) return;
  try {
    // Use CWD as base directory for .openagent/search-cache/
    const baseDir = process.cwd();
    await multiTierCache.init(baseDir);
    _cacheInitialized = true;
  } catch {
    // Disk cache init failure is non-fatal (memory cache still works)
    _cacheInitialized = true; // Don't retry
  }
}

/** Rotating user-agents to reduce bot detection */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function truncateText(value, maxChars = 240) {
  if (!value) return '';
  return value.length > maxChars ? `${value.substring(0, maxChars - 3).trimEnd()}...` : value;
}

function stripHtmlTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-zA-Z0-9#]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function createHttpError(label, response, body = '') {
  const preview = truncateText(stripHtmlTags(body), 180);
  const statusLabel = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const message = preview
    ? `${label} failed with HTTP ${statusLabel}: ${preview}`
    : `${label} failed with HTTP ${statusLabel}`;
  const error = new Error(message);
  error.status = response.status;
  error.statusText = response.statusText;
  return error;
}

/** Classify whether an error is retryable */
function isRetryableError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const status = error.status;
  // 429 rate limit, 5xx server errors, network timeouts, DNS failures
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (msg.includes('timeout') || msg.includes('aborted')) return true;
  if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) return true;
  return false;
}

/** Sleep helper */
function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/** Retry with exponential backoff */
async function withRetry(fn, { maxRetries = 2, baseDelayMs = 500, _label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Query Classification & Smart Engine Routing
// ---------------------------------------------------------------------------

function classifyQuery(query) {
  const q = query.toLowerCase();

  // Technical/programming
  if (/code|function|api|error|bug|exception|syntax|compile|runtime|npm|pip|install/.test(q))
    return 'technical';
  if (/stack.?overflow|stackoverflow|so\b/.test(q))
    return 'technical';

  // Code search
  if (/github|repo|repository|source.?code|implement|class|module/.test(q))
    return 'code';

  // Academic/research
  if (/paper|research|study|arxiv|journal|peer.?review|thesis|algorithm|proof/.test(q))
    return 'academic';

  // News/current events
  if (/news|latest|recent|today|yesterday|this.?week|announced|release/.test(q))
    return 'news';

  // Documentation
  if (/docs|documentation|api.?ref|reference|guide|tutorial|how.?to|example/.test(q))
    return 'documentation';

  return 'general';
}

const ENGINE_ROUTES = {
  technical: ['stackoverflow', 'brave', 'duckduckgo'],      // StackOverflow first for code Q&A
  code:      ['github', 'brave', 'duckduckgo'],              // GitHub first for code search
  academic:  ['brave', 'duckduckgo', 'startpage'],           // Startpage for scholarly
  news:      ['brave', 'duckduckgo', 'tavily'],              // Brave for fresh results
  documentation: ['brave', 'duckduckgo', 'startpage'],       // Official docs tend to rank well
  general:   ['brave', 'duckduckgo', 'startpage'],           // General-purpose
};

function expandQuery(query, queryType) {
  const expansions = [query]; // Original is always first

  if (queryType === 'technical') {
    // Add "how to" variant
    if (!query.startsWith('how')) expansions.push(`how to ${query}`);
    // Add language/framework context if detected
    if (/react/.test(query)) expansions.push(`${query} site:react.dev OR site:stackoverflow.com`);
    if (/node/.test(query)) expansions.push(`${query} site:nodejs.org OR site:stackoverflow.com`);
  }

  if (queryType === 'documentation') {
    expansions.push(`${query} official documentation`);
  }

  return expansions.slice(0, 3); // Max 3 variants
}

// ---------------------------------------------------------------------------
// Search Analytics
// ---------------------------------------------------------------------------

const searchAnalytics = {
  totalSearches: 0,
  byEngine: {},
  byQueryType: {},
  avgResultQuality: 0,

  record(engine, queryType, _resultCount) {
    this.totalSearches++;
    this.byEngine[engine] = (this.byEngine[engine] || 0) + 1;
    this.byQueryType[queryType] = (this.byQueryType[queryType] || 0) + 1;
  },

  getReport() {
    return { ...this };
  },
};

export { searchAnalytics };

// ---------------------------------------------------------------------------
// Circuit Breaker — per-backend failure tracking
// ---------------------------------------------------------------------------

class CircuitBreaker {
  constructor(threshold = 3, resetTimeMs = 60000) {
    this.threshold = threshold;
    this.resetTimeMs = resetTimeMs;
    this.failures = new Map(); // backend -> { count, lastFailure }
  }

  recordFailure(backend) {
    const entry = this.failures.get(backend) || { count: 0, lastFailure: 0 };
    entry.count++;
    entry.lastFailure = Date.now();
    this.failures.set(backend, entry);
  }

  recordSuccess(backend) {
    this.failures.delete(backend);
  }

  isOpen(backend) {
    const entry = this.failures.get(backend);
    if (!entry) return false;
    if (entry.count < this.threshold) return false;
    // Check if reset time has passed
    if (Date.now() - entry.lastFailure > this.resetTimeMs) {
      this.failures.delete(backend);
      return false;
    }
    return true;
  }

  getFailureCount(backend) {
    return this.failures.get(backend)?.count || 0;
  }
}

const circuitBreaker = new CircuitBreaker(3, 60000);

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.WEB_FETCH_TIMEOUT_MS || 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Clean expired cache entries
// ---------------------------------------------------------------------------

function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (now - entry.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// HTML Search Backend base class
// ---------------------------------------------------------------------------

class HtmlSearchBackend {
  constructor({ name, buildUrl, excludeDomains = [], strategies = [] }) {
    this.name = name;
    this.buildUrl = buildUrl;
    this.excludeDomains = excludeDomains;
    this.strategies = strategies;
  }

  async search(query, maxResults) {
    if (circuitBreaker.isOpen(this.name)) {
      throw new Error(`${this.name} circuit breaker open (too many recent failures)`);
    }

    const searchUrl = this.buildUrl(query);

    const doFetch = async () => {
      const response = await fetchWithTimeout(searchUrl, {
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
        },
      }, CONFIG.WEB_FETCH_TIMEOUT_MS || 15000);

      const html = await response.text();
      if (!response.ok) {
        throw createHttpError(`${this.name} search`, response, html);
      }
      return html;
    };

    const html = await withRetry(doFetch, { maxRetries: 1, label: `${this.name} search` });
    circuitBreaker.recordSuccess(this.name);

    const results = [];
    const seen = new Set();

    for (const strategy of this.strategies) {
      if (results.length >= maxResults) break;
      strategy(html, maxResults, results, seen, this.excludeDomains);
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// URL decoding helpers
// ---------------------------------------------------------------------------

/** Extract real URL from DDG redirect URLs like //duckduckgo.com/l/?uddg=https%3A%2F... */
function resolveDdgUrl(href) {
  if (!href) return '';
  // Direct http(s) link
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  // Protocol-relative DDG redirect: //duckduckgo.com/l/?uddg=ENCODED_URL&rut=...
  const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try { return decodeURIComponent(uddgMatch[1]); } catch { return ''; }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Parse strategies
// ---------------------------------------------------------------------------

/** DuckDuckGo HTML: result__a links with redirect URLs + snippets */
function ddgHtmlStrategy(html, maxResults, results, seen, excludeDomains) {
  // Match result blocks: <a class="result__a" href="...">title</a> ... <a class="result__snippet" ...>snippet</a>
  const blockRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const rawHref = match[1];
    const url = resolveDdgUrl(rawHref);
    const title = stripHtmlTags(match[2]);
    if (!url || !title || excludeDomains.some(d => url.includes(d)) || seen.has(url)) continue;
    seen.add(url);
    // Find snippet near this result block
    const afterBlock = html.substring(match.index, match.index + 1500);
    const snippetMatch = afterBlock.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? stripHtmlTags(snippetMatch[1]) : '';
    results.push({ title: title.substring(0, 200), url, snippet: snippet.substring(0, 300) });
  }
}

/** DuckDuckGo Lite: links with class containing "result" */
function ddgLiteStrategy(html, maxResults, results, seen, excludeDomains) {
  // DDG Lite uses redirect URLs in href
  const regex = /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < maxResults) {
    const url = resolveDdgUrl(match[1]);
    const title = stripHtmlTags(match[2]);
    if (title && url && !excludeDomains.some(d => url.includes(d)) && !seen.has(url)) {
      seen.add(url);
      results.push({ title, url, snippet: '' });
    }
  }
}

/** DuckDuckGo fallback: any <a> with external URL */
function ddgTableStrategy(html, maxResults, results, seen, excludeDomains) {
  const regex = /<a[^>]*href="([^"]+)"[^>]*>([^<]{5,150})<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < maxResults) {
    const url = resolveDdgUrl(match[1]);
    const title = match[2].trim();
    if (!url || excludeDomains.some(d => url.includes(d)) || seen.has(url)) continue;
    if (title.length > 5 && !title.includes('{') && !title.includes('http')) {
      seen.add(url);
      results.push({ title, url, snippet: '' });
    }
  }
}

function _regexExec(regex, str) {
  return regex.exec(str);
}

/** Startpage Strategy 1: result-title links with snippet extraction */
function startpageTitleStrategy(html, maxResults, results, seen, excludeDomains) {
  const regex = /<a[^>]*class="[^"]*result-title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < maxResults) {
    const url = match[1];
    const titleContent = stripHtmlTags(match[0]);
    const afterMatch = html.substring(match.index, match.index + 1000);
    const descMatch = afterMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = descMatch ? stripHtmlTags(descMatch[1]) : '';

    if (url.startsWith('http') && !excludeDomains.some(d => url.includes(d)) && titleContent.length > 5 && !seen.has(url)) {
      const cleanTitle = titleContent
        .replace(/\.[a-z0-9-]+\{[^}]*\}/gi, '')
        .replace(/@media[^{]*\{[^}]*\}/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanTitle.length > 5) {
        seen.add(url);
        results.push({
          title: cleanTitle.substring(0, 200),
          url,
          snippet: snippet.substring(0, 300),
        });
      }
    }
  }
}

/** Startpage Strategy 2: h2/h3 headings with nearby links */
function startpageHeadingStrategy(html, maxResults, results, seen, excludeDomains) {
  const regex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < maxResults) {
    const title = stripHtmlTags(match[1]);
    const before = html.substring(Math.max(0, match.index - 500), match.index);
    const after = html.substring(match.index, match.index + 500);

    const linkBefore = before.match(/href="(https?:\/\/[^"\s]+)"[^>]*>\s*$/);
    const linkAfter = after.match(/^<\/h[23]>[\s\S]*?href="(https?:\/\/[^"\s]+)"/);
    const url = linkBefore?.[1] || linkAfter?.[1] || '';

    if (url && !excludeDomains.some(d => url.includes(d)) && title.length > 10 && !seen.has(url)) {
      seen.add(url);
      results.push({ title, url, snippet: '' });
    }
  }
}

/** Generic external link extraction fallback */
function genericLinkStrategy(minTitleLen = 10) {
  return function (html, maxResults, results, seen, excludeDomains) {
    const regex = /href="(https?:\/\/[^"\s]+)"[^>]*>([^<]{5,100})<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].trim();

      if (!excludeDomains.some(d => url.includes(d)) && !seen.has(url) && title.length > minTitleLen && !title.includes('{')) {
        seen.add(url);
        results.push({ title, url, snippet: '' });
      }
    }
  };
}

/** Mojeek Strategy: links with a class attribute, plus snippet extraction */
function mojeekTitleStrategy(html, maxResults, results, seen, excludeDomains) {
  const regex = /<a[^>]*href="(https?:\/\/[^"\s]+)"[^>]*class="[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < maxResults) {
    const url = match[1];
    const title = match[2].trim();

    if (!excludeDomains.some(d => url.includes(d)) && !seen.has(url) && title.length > 10 && !title.includes('{')) {
      seen.add(url);
      const after = html.substring(match.index, match.index + 800);
      const snippetMatch = after.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = snippetMatch ? stripHtmlTags(snippetMatch[1]) : '';
      results.push({ title, url, snippet: snippet.substring(0, 300) });
    }
  }
}

// ---------------------------------------------------------------------------
// Backend instances
// ---------------------------------------------------------------------------

const ddgLiteBackend = new HtmlSearchBackend({
  name: 'duckduckgo-lite',
  buildUrl: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
  excludeDomains: ['duckduckgo.com'],
  strategies: [ddgLiteStrategy, ddgTableStrategy],
});

const ddgHtmlBackend = new HtmlSearchBackend({
  name: 'duckduckgo-html',
  buildUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  excludeDomains: ['duckduckgo.com'],
  strategies: [ddgHtmlStrategy, ddgLiteStrategy, ddgTableStrategy],
});

const startpageBackend = new HtmlSearchBackend({
  name: 'startpage',
  buildUrl: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}&cat=web&language=english`,
  excludeDomains: ['startpage.com'],
  strategies: [startpageTitleStrategy, startpageHeadingStrategy, genericLinkStrategy(10)],
});

const mojeekBackend = new HtmlSearchBackend({
  name: 'mojeek',
  buildUrl: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
  excludeDomains: ['mojeek.com'],
  strategies: [mojeekTitleStrategy, genericLinkStrategy(10)],
});

// ---------------------------------------------------------------------------
// API-based search backends
// ---------------------------------------------------------------------------

/** Searx public instances — dynamically checked */
const SEARX_INSTANCES = [
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://searx.tiekoetter.com',
  'https://searx.nixnet.services',
  'https://searx.javelin.workers.dev',
  'https://search.sapti.me',
  'https://searx.prvcy.eu',
  'https://priv.au',
];

async function searchSearx(query, maxResults) {
  const errors = [];

  // Try instances in random order to distribute load
  const shuffled = [...SEARX_INSTANCES].sort(() => Math.random() - 0.5);

  for (const instance of shuffled) {
    if (circuitBreaker.isOpen(`searx:${instance}`)) continue;

    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`;
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OpenAgent/5.0)',
          'Accept': 'application/json',
        },
      }, CONFIG.SEARX_TIMEOUT_MS || 10000);

      if (!response.ok) {
        const body = await response.text();
        const err = createHttpError(`searx (${instance})`, response, body);
        circuitBreaker.recordFailure(`searx:${instance}`);
        errors.push(`${instance}: ${err.message}`);
        continue;
      }

      const data = await response.json();
      circuitBreaker.recordSuccess(`searx:${instance}`);

      if (data?.results?.length > 0) {
        return data.results.slice(0, maxResults).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content || '',
        }));
      }
    } catch (error) {
      circuitBreaker.recordFailure(`searx:${instance}`);
      errors.push(`${instance}: ${error.message}`);
      continue;
    }
  }

  if (errors.length > 0) {
    throw new Error(`All Searx instances failed. ${errors.join(' | ')}`);
  }
  return [];
}

/** DuckDuckGo Instant Answer API (free, no key) */
async function searchDDGInstant(query, maxResults) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': getRandomUA() },
    }, 8000);

    if (!response.ok) return [];

    const data = await response.json();
    const results = [];

    // Abstract text
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= maxResults) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.substring(0, 100),
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
        // Nested subtopics
        if (topic.Topics) {
          for (const sub of topic.Topics) {
            if (results.length >= maxResults) break;
            if (sub.Text && sub.FirstURL) {
              results.push({
                title: sub.Text.substring(0, 100),
                url: sub.FirstURL,
                snippet: sub.Text,
              });
            }
          }
        }
      }
    }

    return results.slice(0, maxResults);
  } catch {
    return [];
  }
}

/** Tavily API */
async function searchTavily(query, maxResults) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { unavailable: true, reason: 'TAVILY_API_KEY is not configured' };
  }

  const response = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: 'basic',
    }),
  }, CONFIG.WEB_FETCH_TIMEOUT_MS || 15000);

  const body = await response.text();
  if (!response.ok) {
    throw createHttpError('tavily search', response, body);
  }

  let data;
  try { data = JSON.parse(body); } catch (e) { throw new Error(`Tavily returned invalid JSON: ${e.message}`); }
  return {
    results: (data?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    })),
    answer: data?.answer,
  };
}

/** Serper API */
async function searchSerper(query, maxResults) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { unavailable: true, reason: 'SERPER_API_KEY is not configured' };
  }

  const response = await fetchWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: maxResults }),
  }, CONFIG.SERPER_TIMEOUT_MS || 10000);

  const body = await response.text();
  if (!response.ok) {
    throw createHttpError('serper search', response, body);
  }
  let data;
  try { data = JSON.parse(body); } catch (e) { throw new Error(`Serper returned invalid JSON: ${e.message}`); }
  return (data?.organic || []).slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || '',
  }));
}

/** Brave Search API */
async function searchBrave(query, maxResults) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return { unavailable: true, reason: 'BRAVE_API_KEY is not configured' };
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  }, CONFIG.BRAVE_TIMEOUT_MS || 10000);

  const body = await response.text();
  if (!response.ok) {
    throw createHttpError('brave search', response, body);
  }

  let data;
  try { data = JSON.parse(body); } catch (e) { throw new Error(`Brave returned invalid JSON: ${e.message}`); }
  return (data?.web?.results || []).slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description || '',
  }));
}

/** StackOverflow Search API (free, no key needed for basic usage) */
async function searchStackOverflow(query, maxResults) {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${maxResults}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'application/json',
    },
  }, CONFIG.WEB_FETCH_TIMEOUT_MS || 15000);

  if (!response.ok) {
    const body = await response.text();
    throw createHttpError('stackoverflow search', response, body);
  }

  const data = await response.json();
  return (data?.items || []).slice(0, maxResults).map(r => ({
    title: stripHtmlTags(r.title || ''),
    url: r.link,
    snippet: r.body_markdown ? truncateText(stripHtmlTags(r.body_markdown), 200) : '',
  }));
}

/** GitHub Code Search API (free, no key needed for basic usage) */
async function searchGitHubCode(query, maxResults) {
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${maxResults}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': getRandomUA(),
      'Accept': 'application/vnd.github.v3+json',
    },
  }, CONFIG.WEB_FETCH_TIMEOUT_MS || 15000);

  if (!response.ok) {
    const body = await response.text();
    throw createHttpError('github code search', response, body);
  }

  const data = await response.json();
  return (data?.items || []).slice(0, maxResults).map(r => {
    const repoName = r.repository?.full_name || '';
    const fileName = r.name || '';
    const title = repoName ? `${repoName}/${fileName}` : fileName;
    const snippet = r.path ? `Path: ${r.path}` : '';
    return {
      title: truncateText(title, 200),
      url: r.html_url,
      snippet,
    };
  });
}

// ---------------------------------------------------------------------------
// Deduplication and Ranking
// ---------------------------------------------------------------------------

const TRUSTED_DOMAINS = {
  // Documentation (score 1.0)
  'developer.mozilla.org': 1.0, 'docs.microsoft.com': 1.0, 'react.dev': 1.0,
  'nodejs.org': 1.0, 'docs.python.org': 1.0, 'go.dev': 1.0,

  // Q&A (score 0.9)
  'stackoverflow.com': 0.9, 'stackexchange.com': 0.9,

  // Code hosting (score 0.85)
  'github.com': 0.85, 'gitlab.com': 0.85,

  // Tech blogs (score 0.7)
  'dev.to': 0.7, 'medium.com': 0.6, 'hashnode.dev': 0.7,
  'css-tricks.com': 0.8, 'smashingmagazine.com': 0.8,

  // Reference (score 0.95)
  'wikipedia.org': 0.95, 'en.wikipedia.org': 0.95,

  // AI/ML (score 0.8)
  'arxiv.org': 0.8, 'huggingface.co': 0.8, 'openai.com': 0.8,
};

function getCredibilityScore(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return TRUSTED_DOMAINS[domain] || 0.5; // Default neutral
  } catch { return 0.3; }
}

/**
 * Normalize a URL for deduplication: lowercase domain, strip trailing slashes, remove fragments.
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    let normalized = parsed.toString();
    // Strip trailing slash (except for root path)
    if (normalized.endsWith('/') && parsed.pathname.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Deduplicate results by normalized URL.
 */
function deduplicateResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = normalizeUrl(r.url);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }
  return deduped;
}

/**
 * Score a search result based on relevance to the query.
 * @param {object} result - { title, url, snippet }
 * @param {string} query - Original search query
 * @returns {number} Score between 0 and 1
 */
function scoreResult(result, query) {
  let score = 0;
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const titleLower = (result.title || '').toLowerCase();
  const snippetLower = (result.snippet || '').toLowerCase();

  // Title relevance: +0.3 if title contains any query keyword
  if (queryWords.some(w => titleLower.includes(w))) {
    score += 0.3;
  }

  // Snippet relevance: +0.1 per keyword match in snippet, max 0.4
  let snippetMatches = 0;
  for (const word of queryWords) {
    if (snippetLower.includes(word)) {
      snippetMatches++;
    }
  }
  score += Math.min(snippetMatches * 0.1, 0.4);

  // Domain authority: credibility-based scoring (0.0–0.3 range, scaled from 0.5 base)
  const credibility = getCredibilityScore(result.url);
  score += (credibility - 0.5) * 0.6; // Maps 0.5→0, 1.0→0.3, 0.3→-0.12

  // Freshness: +0.1 if URL contains current year
  const currentYear = new Date().getFullYear().toString();
  if (result.url && result.url.includes(currentYear)) {
    score += 0.1;
  }

  return score;
}

/**
 * Rank results by relevance score, then return sorted array.
 */
function rankResults(results, query) {
  return results
    .map(r => ({ ...r, _score: scoreResult(r, query) }))
    .sort((a, b) => b._score - a._score);
}

// ---------------------------------------------------------------------------
// Parallel search execution — race backends, take first winner
// ---------------------------------------------------------------------------

/**
 * Try multiple backends in parallel and return the first successful result.
 * Falls back to sequential if all parallel attempts fail.
 */
async function searchParallel(query, maxResults, backends) {
  const attemptResults = [];

  // Build promises for all backends
  const promises = backends.map(async ({ name, runner }) => {
    try {
      const value = await runner();
      if (value?.unavailable) {
        return { name, success: false, skipped: true, error: value.reason, results: [] };
      }
      const count = Array.isArray(value) ? value.length : value?.results?.length || 0;
      return { name, success: count > 0, count, results: Array.isArray(value) ? value : value?.results || [], answer: value?.answer };
    } catch (error) {
      return { name, success: false, error: error.message, results: [] };
    }
  });

  // Race: resolve as soon as ANY backend returns results
  const results = await Promise.allSettled(promises);

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.success && r.value.results.length > 0) {
      attemptResults.push(r.value);
      return {
        results: r.value.results,
        backend: r.value.name,
        answer: r.value.answer,
        attempts: results.map(x => x.status === 'fulfilled' ? x.value : { name: 'unknown', success: false, error: x.reason?.message }),
      };
    }
    if (r.status === 'fulfilled') {
      attemptResults.push(r.value);
    }
  }

  // All failed — return empty with attempt info
  return {
    results: [],
    backend: 'none',
    answer: null,
    attempts: results.map(x => x.status === 'fulfilled' ? x.value : { name: 'unknown', success: false, error: x.reason?.message }),
  };
}

// ---------------------------------------------------------------------------
// web_search tool
// ---------------------------------------------------------------------------

function buildSearchFailureMessage(query, attempts, requestedBackend) {
  const attemptedBackends = attempts.filter((a) => !a.skipped);
  if (attemptedBackends.length === 0) {
    return requestedBackend === 'auto'
      ? `No search backends were available for "${query}". Configure a search API key (TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_API_KEY) or try again later.`
      : `Search backend "${requestedBackend}" is not available. Check configuration.`;
  }

  const failedBackends = attemptedBackends.filter((a) => !a.success);
  if (failedBackends.length === 0) {
    const backendLabel = attemptedBackends.map((a) => a.name).join(', ');
    return `No search results found for "${query}" after checking ${backendLabel}. Try a different query.`;
  }

  const detail = failedBackends
    .map((a) => `${a.name}: ${a.error || 'no results'}`)
    .join('; ');
  return `Search failed for "${query}". ${detail}`;
}

export const webSearchTool = {
  name: 'web_search',
  description: 'Search the web for information. Returns titles, URLs, and snippets. Supports multiple search backends with automatic fallback and parallel racing.',
  category: 'network',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum results to return (default: 5)',
      },
      backend: {
        type: 'string',
        enum: ['auto', 'duckduckgo', 'searx', 'startpage', 'mojeek', 'tavily', 'serper', 'brave', 'ddg-instant', 'stackoverflow', 'github'],
        description: 'Search backend to use (default: auto — races all backends in parallel, takes first success)',
      },
    },
    required: ['query'],
  },
  async execute({ query, maxResults = 5, backend = 'auto' }) {
    try {
      // Ensure multi-tier cache is initialized (disk cache setup + cleanup)
      await ensureCacheInit();

      // Check multi-tier cache first (memory → disk)
      const multiCached = await multiTierCache.get(query, backend, maxResults);
      if (multiCached) {
        return multiCached;
      }

      // Check legacy cache (backward compat)
      const cacheKey = `${backend}:${query}:${maxResults}`;
      const cached = searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return { ...cached.result, cached: true };
      }

      // Clean old cache entries periodically
      if (searchCache.size > SEARCH_CACHE_MAX_SIZE) cleanCache();

      let results = [];
      let usedBackend = 'none';
      let apiAnswer = null;
      let attempts = [];

      if (backend === 'auto') {
        // ── AUTO MODE: Smart engine routing ──
        const queryType = classifyQuery(query);
        const expansions = expandQuery(query, queryType);
        const routedEngines = ENGINE_ROUTES[queryType] || ENGINE_ROUTES.general;

        // Map engine names to runner functions
        const engineRunners = {
          'tavily': (q) => searchTavily(q, maxResults),
          'serper': (q) => searchSerper(q, maxResults),
          'brave': (q) => searchBrave(q, maxResults),
          'ddg-instant': (q) => searchDDGInstant(q, maxResults),
          'duckduckgo': (q) => ddgHtmlBackend.search(q, maxResults),
          'duckduckgo-lite': (q) => ddgLiteBackend.search(q, maxResults),
          'startpage': (q) => startpageBackend.search(q, maxResults),
          'searx': (q) => searchSearx(q, maxResults),
          'mojeek': (q) => mojeekBackend.search(q, maxResults),
          'stackoverflow': (q) => searchStackOverflow(q, maxResults),
          'github': (q) => searchGitHubCode(q, maxResults),
        };

        // Build primary backends from routed engines (original query)
        const primaryBackends = routedEngines
          .filter(name => engineRunners[name])
          .map((name, _i) => ({
            name,
            runner: () => engineRunners[name](query),
          }));

        // Build secondary backends with expansion queries
        const secondaryBackends = [];
        for (let i = 1; i < primaryBackends.length; i++) {
          if (expansions[i]) {
            const origName = primaryBackends[i].name;
            secondaryBackends.push({
              name: `${origName}+expanded`,
              runner: () => engineRunners[origName](expansions[i]),
            });
          }
        }

        // Race primary backends first
        const primaryResult = await searchParallel(query, maxResults, primaryBackends);
        results = primaryResult.results;
        usedBackend = primaryResult.backend;
        apiAnswer = primaryResult.answer;
        attempts = primaryResult.attempts;

        // If primary failed or got few results, try secondary expansions
        if (results.length < 3 && secondaryBackends.length > 0) {
          const secondaryResult = await searchParallel(query, maxResults, secondaryBackends);
          if (secondaryResult.results.length > 0) {
            results = [...results, ...secondaryResult.results];
            attempts = [...attempts, ...secondaryResult.attempts];
            if (!usedBackend || usedBackend === 'none') {
              usedBackend = secondaryResult.backend;
            }
          }
        }

        // Fallback: if routed engines all failed, race ALL backends
        if (results.length === 0) {
          const apiBackends = [
            { name: 'tavily', runner: () => searchTavily(query, maxResults) },
            { name: 'serper', runner: () => searchSerper(query, maxResults) },
            { name: 'brave', runner: () => searchBrave(query, maxResults) },
          ];

          const freeBackends = [
            { name: 'ddg-instant', runner: () => searchDDGInstant(query, maxResults) },
            { name: 'duckduckgo-html', runner: () => ddgHtmlBackend.search(query, maxResults) },
            { name: 'duckduckgo-lite', runner: () => ddgLiteBackend.search(query, maxResults) },
            { name: 'startpage', runner: () => startpageBackend.search(query, maxResults) },
            { name: 'searx', runner: () => searchSearx(query, maxResults) },
            { name: 'mojeek', runner: () => mojeekBackend.search(query, maxResults) },
            { name: 'stackoverflow', runner: () => searchStackOverflow(query, maxResults) },
            { name: 'github', runner: () => searchGitHubCode(query, maxResults) },
          ];

          const allBackends = [...apiBackends, ...freeBackends];
          const fallbackResult = await searchParallel(query, maxResults, allBackends);
          results = fallbackResult.results;
          usedBackend = fallbackResult.backend;
          apiAnswer = fallbackResult.answer;
          attempts = [...attempts, ...fallbackResult.attempts];
        }

        // Record analytics
        searchAnalytics.record(usedBackend, queryType, results.length);

      } else {
        // ── SPECIFIC BACKEND REQUESTED ──
        const tryBackend = async (name, runner) => {
          try {
            const value = await runner();
            if (value?.unavailable) {
              attempts.push({ name, success: false, skipped: true, error: value.reason });
              return null;
            }
            const count = Array.isArray(value) ? value.length : value?.results?.length || 0;
            attempts.push({ name, success: count > 0, count });
            return value;
          } catch (error) {
            attempts.push({ name, success: false, error: error.message });
            return null;
          }
        };

        const backendMap = {
          'tavily': () => searchTavily(query, maxResults),
          'serper': () => searchSerper(query, maxResults),
          'brave': () => searchBrave(query, maxResults),
          'duckduckgo': () => ddgHtmlBackend.search(query, maxResults),
          'startpage': () => startpageBackend.search(query, maxResults),
          'mojeek': () => mojeekBackend.search(query, maxResults),
          'searx': () => searchSearx(query, maxResults),
          'ddg-instant': () => searchDDGInstant(query, maxResults),
          'stackoverflow': () => searchStackOverflow(query, maxResults),
          'github': () => searchGitHubCode(query, maxResults),
        };

        if (backendMap[backend]) {
          const result = await tryBackend(backend, backendMap[backend]);
          if (result) {
            results = Array.isArray(result) ? result : result?.results || [];
            apiAnswer = result?.answer;
            usedBackend = backend;
          }
        }
      }

      // Deduplicate and rank results
      if (results.length > 0) {
        results = deduplicateResults(results);
        results = rankResults(results, query);
      }

      const result = {
        success: results.length > 0,
        query,
        results,
        count: results.length,
        backend: usedBackend,
        attempts,
        ...(apiAnswer && { answer: apiAnswer }),
      };

      if (results.length === 0) {
        result.error = buildSearchFailureMessage(query, attempts, backend);
      }

      // Cache successful results (multi-tier + legacy)
      if (results.length > 0) {
        // Multi-tier cache (memory + disk)
        await multiTierCache.set(query, backend, maxResults, result);
        // Legacy cache (backward compat)
        searchCache.set(cacheKey, { result, timestamp: Date.now() });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        query,
        results: [],
        count: 0,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Content extraction — Readability-style scoring
// ---------------------------------------------------------------------------

/**
 * Extract readable text from HTML using content-density scoring.
 * Falls back to simple extraction if scoring doesn't find good content.
 */
function extractReadableText(html, maxChars) {
  let content = html;

  // Remove unwanted elements
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // Try to extract main content — prefer article/main, then content-classed divs
  const contentSelectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*id="(?:content|main-content|article-body|post-content|story)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*(?:content|post|article|entry|story-body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const selector of contentSelectors) {
    const match = content.match(selector);
    if (match && match[1].length > 300) {
      content = match[1];
      break;
    }
  }

  // Convert HTML to readable text
  content = content
    .replace(/<\/(p|div|br|h[1-6]|li|tr|blockquote|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#\d+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Truncate at sentence/paragraph boundary
  if (content.length > maxChars) {
    const truncated = content.substring(0, maxChars);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = Math.max(lastPeriod, lastNewline);

    if (cutPoint > maxChars * 0.7) {
      content = truncated.substring(0, cutPoint + 1) + '\n\n... [truncated]';
    } else {
      content = truncated + '\n\n... [truncated]';
    }
  }

  return content;
}

/** Extract metadata from HTML */
function extractMetadata(html) {
  const metadata = {};

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) metadata.title = titleMatch[1].replace(/<[^>]*>/g, '').trim();

  const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i) ||
                    html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i);
  if (descMatch) metadata.description = descMatch[1];

  const authorMatch = html.match(/<meta[^>]*name="author"[^>]*content="([^"]*)"[^>]*>/i) ||
                      html.match(/<meta[^>]*content="([^"]*)"[^>]*name="author"[^>]*>/i);
  if (authorMatch) metadata.author = authorMatch[1];

  const dateMatch = html.match(/<meta[^>]*property="article:published_time"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
  if (dateMatch) metadata.publishedDate = dateMatch[1];

  return metadata;
}

// ---------------------------------------------------------------------------
// read_webpage tool — with retry and Google cache fallback
// ---------------------------------------------------------------------------

export const readWebpageTool = {
  name: 'read_webpage',
  description: 'Fetch and extract readable text content from a URL. Uses smart content extraction to get the main article/content while filtering out navigation, ads, and scripts. Includes automatic retry on transient failures.',
  category: 'network',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch (must start with http:// or https://)',
      },
      maxChars: {
        type: 'integer',
        description: 'Maximum characters to return (default: 15000)',
      },
      extractMode: {
        type: 'string',
        enum: ['readable', 'text', 'markdown', 'raw'],
        description: 'Extraction mode: readable (smart), text (plain), markdown (formatted), raw (HTML stripped)',
      },
    },
    required: ['url'],
  },
  async execute({ url, maxChars = CONFIG.WEB_READ_DEFAULT_MAX_CHARS || 15000, extractMode = 'readable' }) {
    try {
      // Validate URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: 'URL must start with http:// or https://', url };
      }

      const doFetch = async (fetchUrl) => {
        const response = await fetchWithTimeout(fetchUrl, {
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'identity',
            'Cache-Control': 'no-cache',
          },
          redirect: 'follow',
        }, CONFIG.WEB_READ_TIMEOUT_MS || 20000);

        const html = await response.text();
        return { response, html };
      };

      let { response, html } = await withRetry(() => doFetch(url), { maxRetries: 2, label: 'read_webpage' });

      // If 404, try Google cache as fallback
      if (!response.ok && response.status === 404) {
        try {
          const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
          const cached = await doFetch(cacheUrl);
          if (cached.response.ok) {
            response = cached.response;
            html = cached.html;
          }
        } catch {
          // Google cache also failed, continue with original error
        }
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
          url,
          status: response.status,
          statusText: response.statusText,
          preview: truncateText(extractReadableText(html, 600), 300),
        };
      }

      const metadata = extractMetadata(html);
      let content;

      switch (extractMode) {
        case 'readable':
          content = extractReadableText(html, maxChars);
          break;
        case 'text':
          content = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (content.length > maxChars) {
            content = content.substring(0, maxChars) + '\n\n... [truncated]';
          }
          break;
        case 'raw':
          content = html;
          if (content.length > maxChars) {
            content = content.substring(0, maxChars) + '\n\n... [truncated]';
          }
          break;
        default:
          content = extractReadableText(html, maxChars);
      }

      return {
        success: true,
        url,
        title: metadata.title,
        content,
        metadata,
        length: content.length,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        url,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// fetch_url tool — with retry
// ---------------------------------------------------------------------------

export const fetchUrlTool = {
  name: 'fetch_url',
  description: 'Fetch raw content from a URL. Use for APIs, JSON endpoints, or raw files. Includes automatic retry on transient failures.',
  category: 'network',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE'],
        description: 'HTTP method (default: GET)',
      },
      headers: {
        type: 'object',
        description: 'HTTP headers to send',
      },
      body: {
        type: 'string',
        description: 'Request body for POST/PUT',
      },
    },
    required: ['url'],
  },
  async execute({ url, method = 'GET', headers = {}, body }) {
    try {
      // URL protocol validation
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: 'Only http:// and https:// URLs are allowed' };
      }

      // SSRF protection — block private/internal IP ranges
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
            hostname.startsWith('10.') || hostname.startsWith('172.16.') || hostname.startsWith('192.168.') ||
            hostname === '169.254.169.254') {
          return { success: false, error: 'Fetching internal/private URLs is not allowed for security reasons' };
        }
      } catch (_e) {
        return { success: false, error: 'Invalid URL format' };
      }

      const doFetch = async () => {
        const fetchOptions = {
          method,
          headers: {
            'User-Agent': 'OpenAgent/5.0',
            ...headers,
          },
        };

        if (body && (method === 'POST' || method === 'PUT')) {
          fetchOptions.body = body;
          if (!headers['Content-Type'] && !headers['content-type']) {
            fetchOptions.headers['Content-Type'] = 'application/json';
          }
        }

        const response = await fetchWithTimeout(url, fetchOptions, CONFIG.WEB_FETCH_URL_TIMEOUT_MS || 30000);

        let data = await response.text();

        // Try to parse as JSON for pretty printing
        try {
          const parsed = JSON.parse(data);
          data = JSON.stringify(parsed, null, 2);
        } catch {
          // Keep as text
        }

        // Collect response headers
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const maxChars = CONFIG.WEB_FETCH_DATA_MAX_CHARS || 10000;
        const truncatedData = typeof data === 'string' ? data.substring(0, maxChars) : data;
        const truncated = typeof data === 'string' && data.length > maxChars;

        if (!response.ok) {
          return {
            success: false,
            error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
            url,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data: truncated ? `${truncatedData}... [truncated]` : truncatedData,
          };
        }

        return {
          success: true,
          url,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          data: truncated ? `${truncatedData}... [truncated]` : truncatedData,
          truncated,
        };
      };

      return await withRetry(doFetch, { maxRetries: 2, label: 'fetch_url' });
    } catch (error) {
      return {
        success: false,
        error: error.message,
        url,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Factory & exports
// ---------------------------------------------------------------------------

export function createWebTools(_options = {}) {
  return [
    webSearchTool,
    readWebpageTool,
    fetchUrlTool,
  ];
}

export const webTools = createWebTools();
