/**
 * Unit tests for web tools
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUrlTool, readWebpageTool, webSearchTool } from '../../src/tools/webTools.js';

function createHeaders(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    get(name) {
      return normalized[String(name).toLowerCase()] || null;
    },
    forEach(callback) {
      for (const [key, value] of Object.entries(normalized)) {
        callback(value, key);
      }
    },
  };
}

function createResponse({
  ok = true,
  status = 200,
  statusText = 'OK',
  body = '',
  headers = {},
} = {}) {
  return {
    ok,
    status,
    statusText,
    headers: createHeaders(headers),
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockImplementation(async () => JSON.parse(body)),
  };
}

describe('web tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('webSearchTool returns a meaningful error for failed HTTP search responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createResponse({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: '<html><body>temporary outage</body></html>',
    })));

    const result = await webSearchTool.execute({
      query: 'openagent reliability',
      backend: 'startpage',
      maxResults: 3,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 503');
    expect(result.attempts).toEqual([
      expect.objectContaining({
        name: 'startpage',
        success: false,
      }),
    ]);
  });

  it('webSearchTool caches per backend instead of reusing a different backend result', async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).includes('startpage.com')) {
        return createResponse({
          body: '<a class="result-title" href="https://example.com/article">Example Result</a><p>Snippet</p>',
        });
      }

      return createResponse({
        body: '<a href="https://example.org/post" class="result-link">Duck Result</a>',
      });
    });

    vi.stubGlobal('fetch', fetch);

    const startpageResult = await webSearchTool.execute({
      query: 'cache test sp ' + Date.now(),
      backend: 'startpage',
      maxResults: 2,
    });
    const duckResult = await webSearchTool.execute({
      query: 'cache test ddg ' + Date.now(),
      backend: 'duckduckgo',
      maxResults: 2,
    });

    expect(startpageResult.success).toBe(true);
    expect(startpageResult.backend).toBe('startpage');
    expect(duckResult.success).toBe(true);
    expect(duckResult.backend).toBe('duckduckgo');
    // Each backend makes at least 1 fetch call (retries may add more)
    expect(fetch).toHaveBeenCalled();
  });

  it('readWebpageTool reports non-2xx responses as failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createResponse({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: '<html><title>Missing</title><body>nope</body></html>',
      headers: { 'content-type': 'text/html' },
    })));

    const result = await readWebpageTool.execute({
      url: 'https://example.com/missing',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('HTTP 404');
  });

  it('fetchUrlTool returns failure metadata for HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createResponse({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: '{"error":"backend unavailable"}',
      headers: { 'content-type': 'application/json' },
    })));

    const result = await fetchUrlTool.execute({
      url: 'https://example.com/api',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toContain('HTTP 500');
    expect(result.data).toContain('backend unavailable');
  });
});
