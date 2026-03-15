/**
 * 🌐 Web Tools
 * Search the web, fetch pages, and browse content
 */

import axios from 'axios';

/**
 * Search the web
 */
export const webSearchTool = {
  name: 'web_search',
  description: 'Search the web for information. Returns titles, URLs, and snippets.',
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
    },
    required: ['query'],
  },
  async execute({ query, maxResults = 5 }) {
    try {
      // Use DuckDuckGo instant answer API as fallback
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      });
      
      const html = response.data;
      const results = [];
      
      // Parse results (simplified HTML parsing)
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      
      while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        results.push({
          title: match[2].replace(/<[^>]*>/g, '').trim(),
          url: match[1],
          snippet: match[3].replace(/<[^>]*>/g, '').trim(),
        });
      }
      
      if (results.length === 0) {
        // Fallback: try to extract any links
        const linkRegex = /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>(.*?)<\/a>/g;
        while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
          const title = match[2].replace(/<[^>]*>/g, '').trim();
          if (title.length > 10 && !title.includes('DuckDuckGo')) {
            results.push({
              title,
              url: match[1],
              snippet: '',
            });
          }
        }
      }
      
      return {
        success: true,
        query,
        results,
        count: results.length,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

/**
 * Fetch and read a webpage
 */
export const readWebpageTool = {
  name: 'read_webpage',
  description: 'Fetch and extract text content from a URL. Returns readable text from the page.',
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
        description: 'Maximum characters to return (default: 10000)',
      },
    },
    required: ['url'],
  },
  async execute({ url, maxChars = 10000 }) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
        responseType: 'text',
      });
      
      let content = response.data;
      
      // Simple HTML to text conversion
      content = content
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (content.length > maxChars) {
        content = content.substring(0, maxChars) + '... [truncated]';
      }
      
      return {
        success: true,
        url,
        content,
        length: content.length,
        status: response.status,
      };
    } catch (error) {
      return { success: false, error: error.message, url };
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
      const config = {
        method,
        url,
        headers: {
          'User-Agent': 'OpenRouter-Agent/2.0',
          ...headers,
        },
        timeout: 30000,
      };
      
      if (body && (method === 'POST' || method === 'PUT')) {
        config.data = body;
        if (!headers['Content-Type']) {
          config.headers['Content-Type'] = 'application/json';
        }
      }
      
      const response = await axios(config);
      
      let data = response.data;
      if (typeof data === 'object') {
        data = JSON.stringify(data, null, 2);
      }
      
      return {
        success: true,
        url,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: typeof data === 'string' ? data.substring(0, 10000) : data,
        truncated: typeof data === 'string' && data.length > 10000,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        url,
        status: error.response?.status,
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
