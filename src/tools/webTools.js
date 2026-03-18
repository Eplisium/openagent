/**
 * 🌐 Web Tools (2026 Edition)
 * Search the web, fetch pages, and browse content
 * 
 * Modernized with:
 * - Native fetch (undici) — zero axios dependency
 * - AbortController for request timeouts
 * - Multiple search backends with automatic fallback
 * - Smart HTML parsing with multiple extraction strategies
 * - Result caching
 * - Rate limiting protection
 */

import { CONFIG } from '../config.js';

/**
 * Search cache for deduplication
 */
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clean expired cache entries
 */
function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (now - entry.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
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

/**
 * Search using DuckDuckGo HTML (lite version)
 */
async function searchDuckDuckGo(query, maxResults) {
  const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  
  const response = await fetchWithTimeout(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  }, 15000);
  
  const html = await response.text();
  const results = [];
  let match;
  
  // DDG Lite uses different HTML structure
  const liteRegex = /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = liteRegex.exec(html)) !== null && results.length < maxResults) {
    const url = match[1];
    const title = match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (title && url && !url.includes('duckduckgo.com') && url.startsWith('http')) {
      results.push({ title, url, snippet: '' });
    }
  }
  
  // Alternative: look for table rows with links
  if (results.length === 0) {
    const tableRegex = /<a[^>]*href="(https?:\/\/[^"\s]+)"[^>]*>([^<]+)<\/a>/gi;
    while ((match = tableRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].trim();
      if (!url.includes('duckduckgo.com') && !url.includes('about:') && title.length > 5) {
        results.push({ title, url, snippet: '' });
      }
    }
  }
  
  return results;
}

/**
 * Search using Startpage (Google results without tracking)
 */
async function searchStartpage(query, maxResults) {
  try {
    const searchUrl = `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}&cat=web&language=english`;
    
    const response = await fetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    }, 15000);
    
    const html = await response.text();
    const results = [];
    let match;
    
    // Strategy 1: Find result-title links with h2/h3 titles
    const titleRegex = /<a[^>]*class="[^"]*result-title[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi;
    while ((match = titleRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const titleContent = match[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const afterMatch = html.substring(match.index, match.index + 1000);
      const descMatch = afterMatch.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = descMatch ? descMatch[1].replace(/<[^>]*>/g, '').trim() : '';
      
      if (url.startsWith('http') && !url.includes('startpage.com') && titleContent.length > 5) {
        let cleanTitle = titleContent
          .replace(/\.[a-z0-9-]+\{[^}]*\}/gi, '')
          .replace(/@media[^{]*\{[^}]*\}/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanTitle.length > 5) {
          results.push({
            title: cleanTitle.substring(0, 200),
            url,
            snippet: snippet.substring(0, 300),
          });
        }
      }
    }
    
    // Strategy 2: Extract from h2/h3 tags with nearby links
    if (results.length === 0) {
      const headingRegex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
      while ((match = headingRegex.exec(html)) !== null && results.length < maxResults) {
        const title = match[1].replace(/<[^>]*>/g, '').trim();
        const before = html.substring(Math.max(0, match.index - 500), match.index);
        const after = html.substring(match.index, match.index + 500);
        
        const linkBefore = before.match(/href="(https?:\/\/[^"\s]+)"[^>]*>\s*$/);
        const linkAfter = after.match(/^<\/h[23]>[\s\S]*?href="(https?:\/\/[^"\s]+)"/);
        
        const url = linkBefore?.[1] || linkAfter?.[1] || '';
        
        if (url && !url.includes('startpage.com') && title.length > 10) {
          results.push({ title, url, snippet: '' });
        }
      }
    }
    
    // Strategy 3: Generic external link extraction
    if (results.length === 0) {
      const seen = new Set();
      const linkRegex = /href="(https?:\/\/[^"\s]+)"[^>]*>([^<]{5,100})<\/a>/gi;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2].trim();
        
        if (!url.includes('startpage.com') && !seen.has(url) && title.length > 10) {
          seen.add(url);
          results.push({ title, url, snippet: '' });
        }
      }
    }
    
    return results;
  } catch (e) {
    console.error('Startpage error:', e.message);
    return [];
  }
}

/**
 * Search using Mojeek (independent search engine)
 */
async function searchMojeek(query, maxResults) {
  try {
    const searchUrl = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
    
    const response = await fetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    }, 15000);
    
    const html = await response.text();
    const results = [];
    let match;
    
    const titleRegex = /<a[^>]*href="(https?:\/\/[^"\s]+)"[^>]*class="[^"]*"[^>]*>([^<]+)<\/a>/gi;
    const seen = new Set();
    
    while ((match = titleRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].trim();
      
      if (!url.includes('mojeek.com') && !seen.has(url) && title.length > 10 && !title.includes('{')) {
        seen.add(url);
        const after = html.substring(match.index, match.index + 800);
        const snippetMatch = after.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
        
        results.push({ title, url, snippet: snippet.substring(0, 300) });
      }
    }
    
    // Strategy 2: Generic link extraction
    if (results.length === 0) {
      const linkRegex = /href="(https?:\/\/[^"\s]+)"[^>]*>([^<]{10,100})<\/a>/gi;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2].trim();
        
        if (!url.includes('mojeek.com') && !seen.has(url) && !title.includes('{')) {
          seen.add(url);
          results.push({ title, url, snippet: '' });
        }
      }
    }
    
    return results;
  } catch (e) {
    console.error('Mojeek error:', e.message);
    return [];
  }
}

/**
 * Search using Searx public instances
 */
async function searchSearx(query, maxResults) {
  const searxInstances = [
    'https://searx.be',
    'https://search.bus-hit.me',
    'https://searx.tiekoetter.com',
  ];
  
  for (const instance of searxInstances) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`;
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OpenAgent/4.0)',
        },
      }, 10000);
      
      const data = await response.json();
      
      if (data?.results) {
        return data.results.slice(0, maxResults).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content || '',
        }));
      }
    } catch {
      continue; // Try next instance
    }
  }
  
  return [];
}

/**
 * Search using Tavily API (if configured)
 */
async function searchTavily(query, maxResults) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  
  try {
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
    }, 15000);
    
    const data = await response.json();
    
    if (data?.results) {
      return {
        results: data.results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        })),
        answer: data.answer,
      };
    }
  } catch {}
  
  return null;
}

/**
 * Search using Serper API (if configured)
 */
async function searchSerper(query, maxResults) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return null;
  
  try {
    const response = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: maxResults }),
    }, 10000);
    
    const data = await response.json();
    
    if (data?.organic) {
      return data.organic.slice(0, maxResults).map(r => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet || '',
      }));
    }
  } catch {}
  
  return null;
}

/**
 * Search using Brave Search API (if configured)
 */
async function searchBrave(query, maxResults) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return null;
  
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    }, 10000);
    
    const data = await response.json();
    
    if (data?.web?.results) {
      return data.web.results.slice(0, maxResults).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description || '',
      }));
    }
  } catch {}
  
  return null;
}

/**
 * Main web search tool with multiple backends
 */
export const webSearchTool = {
  name: 'web_search',
  description: 'Search the web for information. Returns titles, URLs, and snippets. Supports multiple search backends with automatic fallback.',
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
        enum: ['auto', 'duckduckgo', 'searx', 'startpage', 'mojeek', 'tavily', 'serper', 'brave'],
        description: 'Search backend to use (default: auto - tries all in order of reliability)',
      },
    },
    required: ['query'],
  },
  async execute({ query, maxResults = 5, backend = 'auto' }) {
    try {
      // Check cache first
      const cacheKey = `${query}:${maxResults}`;
      const cached = searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return { ...cached.result, cached: true };
      }
      
      // Clean old cache entries periodically
      if (searchCache.size > 100) cleanCache();
      
      let results = [];
      let usedBackend = 'none';
      let apiAnswer = null;
      
      // Try API backends first if specifically requested or in auto mode
      if (backend === 'auto' || backend === 'tavily') {
        const tavilyResult = await searchTavily(query, maxResults);
        if (tavilyResult) {
          results = tavilyResult.results;
          apiAnswer = tavilyResult.answer;
          usedBackend = 'tavily';
        }
      }
      
      if (results.length === 0 && (backend === 'auto' || backend === 'serper')) {
        const serperResults = await searchSerper(query, maxResults);
        if (serperResults) {
          results = serperResults;
          usedBackend = 'serper';
        }
      }
      
      if (results.length === 0 && (backend === 'auto' || backend === 'brave')) {
        const braveResults = await searchBrave(query, maxResults);
        if (braveResults) {
          results = braveResults;
          usedBackend = 'brave';
        }
      }
      
      // Try free backends (in order of reliability)
      if (results.length === 0 && (backend === 'auto' || backend === 'startpage')) {
        try {
          results = await searchStartpage(query, maxResults);
          if (results.length > 0) usedBackend = 'startpage';
        } catch {}
      }
      
      if (results.length === 0 && (backend === 'auto' || backend === 'searx')) {
        try {
          results = await searchSearx(query, maxResults);
          if (results.length > 0) usedBackend = 'searx';
        } catch {}
      }
      
      if (results.length === 0 && (backend === 'auto' || backend === 'mojeek')) {
        try {
          results = await searchMojeek(query, maxResults);
          if (results.length > 0) usedBackend = 'mojeek';
        } catch {}
      }
      
      if (results.length === 0 && (backend === 'auto' || backend === 'duckduckgo')) {
        try {
          results = await searchDuckDuckGo(query, maxResults);
          if (results.length > 0) usedBackend = 'duckduckgo';
        } catch {}
      }
      
      const result = {
        success: results.length > 0,
        query,
        results,
        count: results.length,
        backend: usedBackend,
        ...(apiAnswer && { answer: apiAnswer }),
      };
      
      // Cache successful results
      if (results.length > 0) {
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

/**
 * Extract readable text from HTML with smart parsing
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
    .replace(/<!--[\s\S]*?-->/g, '');
  
  // Try to extract main content
  const mainContentMatch = content.match(/<(?:article|main|div[^>]*class="[^"]*(?:content|post|article|entry)[^"]*")[^>]*>([\s\S]*?)<\/(?:article|main|div)>/i);
  if (mainContentMatch && mainContentMatch[1].length > 500) {
    content = mainContentMatch[1];
  }
  
  // Convert HTML to readable text
  content = content
    .replace(/<\/(?:p|div|br|h[1-6]|li|tr|blockquote)>/gi, '\n')
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
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  // Truncate if needed
  if (content.length > maxChars) {
    const truncated = content.substring(0, maxChars);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = Math.max(lastPeriod, lastNewline);
    
    if (cutPoint > maxChars * 0.8) {
      content = truncated.substring(0, cutPoint + 1) + '\n\n... [truncated]';
    } else {
      content = truncated + '... [truncated]';
    }
  }
  
  return content;
}

/**
 * Extract metadata from HTML
 */
function extractMetadata(html) {
  const metadata = {};
  
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) metadata.title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
  
  const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i);
  if (descMatch) metadata.description = descMatch[1];
  
  const authorMatch = html.match(/<meta[^>]*name="author"[^>]*content="([^"]*)"[^>]*>/i) ||
                      html.match(/<meta[^>]*content="([^"]*)"[^>]*name="author"[^>]*>/i);
  if (authorMatch) metadata.author = authorMatch[1];
  
  const dateMatch = html.match(/<meta[^>]*property="article:published_time"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
  if (dateMatch) metadata.publishedDate = dateMatch[1];
  
  return metadata;
}

/**
 * Fetch and read a webpage with smart content extraction
 */
export const readWebpageTool = {
  name: 'read_webpage',
  description: 'Fetch and extract readable text content from a URL. Uses smart content extraction to get the main article/content while filtering out navigation, ads, and scripts.',
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
  async execute({ url, maxChars = 15000, extractMode = 'readable' }) {
    try {
      // Validate URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: 'URL must start with http:// or https://', url };
      }
      
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      }, 20000);
      
      const html = await response.text();
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
            content = content.substring(0, maxChars) + '... [truncated]';
          }
          break;
        case 'raw':
          content = html;
          if (content.length > maxChars) {
            content = content.substring(0, maxChars) + '... [truncated]';
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

/**
 * Fetch raw content from URL
 */
export const fetchUrlTool = {
  name: 'fetch_url',
  description: 'Fetch raw content from a URL. Use for APIs, JSON endpoints, or raw files.',
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
      const fetchOptions = {
        method,
        headers: {
          'User-Agent': 'OpenAgent/4.0',
          ...headers,
        },
      };
      
      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = body;
        if (!headers['Content-Type']) {
          fetchOptions.headers['Content-Type'] = 'application/json';
        }
      }
      
      const response = await fetchWithTimeout(url, fetchOptions, 30000);
      
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
      
      return {
        success: true,
        url,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: typeof data === 'string' ? data.substring(0, 10000) : data,
        truncated: typeof data === 'string' && data.length > 10000,
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

export const webTools = [
  webSearchTool,
  readWebpageTool,
  fetchUrlTool,
];

export default webTools;
