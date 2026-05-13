/**
 * 📄 Content Extractor v1.0
 * High-quality content extraction from HTML and PDF
 *
 * Features:
 * - Mozilla Readability.js for main content extraction (Firefox Reader Mode engine)
 * - Turndown for HTML→Markdown conversion
 * - PDF text extraction via pdf-parse
 * - Smart fallback chain: Readability → Regex extraction → Raw text
 * - Metadata extraction (title, author, date, description, siteName)
 * - Code block language detection
 * - Table conversion to markdown
 */

import TurndownService from 'turndown';
import { tables } from 'turndown-plugin-gfm';

// Lazy-loaded heavy dependencies (loaded on first use)
let Readability = null;
let JSDOM = null;
let pdfParse = null;
let _depsLoaded = false;

async function ensureDeps() {
  if (_depsLoaded) return;
  try {
    const readabilityModule = await import('@mozilla/readability');
    Readability = readabilityModule.Readability;
  } catch {
    // Fallback: will use regex extraction only
  }
  try {
    const jsdomModule = await import('jsdom');
    JSDOM = jsdomModule.JSDOM;
  } catch {
    // Fallback: Readability won't work without JSDOM
  }
  try {
    const pdfModule = await import('pdf-parse');
    pdfParse = pdfModule.default || pdfModule;
  } catch {
    // PDF extraction unavailable
  }
  _depsLoaded = true;
}

// ---------------------------------------------------------------------------
// Turndown (HTML→Markdown) setup
// ---------------------------------------------------------------------------

function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    fence: '```',
  });

  // GFM tables plugin
  td.use([tables]);

  // Remove unwanted elements before conversion
  td.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'form', 'button', 'input', 'select', 'textarea']);

  // Custom rule: preserve code language hints
  td.addRule('fencedCodeBlock', {
    filter(node, options) {
      return (
        options.codeBlockStyle === 'fenced' &&
        node.nodeName === 'PRE' &&
        node.firstChild &&
        node.firstChild.nodeName === 'CODE'
      );
    },
    replacement(content, node) {
      const code = node.firstChild;
      const className = code.getAttribute('class') || '';
      const langMatch = className.match(/(?:language-|lang-|hljs-)(\w[\w+-]*)/i);
      const lang = langMatch ? langMatch[1] : '';
      // Get raw text content (preserve indentation)
      const codeContent = code.textContent || content;
      return `\n\n\`\`\`${lang}\n${codeContent.replace(/\n$/, '')}\n\`\`\`\n\n`;
    },
  });

  // Custom rule: convert images with alt text
  td.addRule('images', {
    filter: 'img',
    replacement(content, node) {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      if (!src) return '';
      return `![${alt}](${src})`;
    },
  });

  return td;
}

let _turndown = null;

function getTurndown() {
  if (!_turndown) _turndown = createTurndown();
  return _turndown;
}

// ---------------------------------------------------------------------------
// HTML Pre-cleaning (remove noise before extraction)
// ---------------------------------------------------------------------------

/**
 * Strip navigation, footers, sidebars, ads, cookie banners, etc.
 * This runs BEFORE Readability to reduce noise.
 */
function precleanHtml(html) {
  if (!html) return '';
  return html
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    // Remove iframes, svgs, objects
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?\/?>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove hidden elements
    .replace(/<[^>]*style="[^"]*display:\s*none[^"]*"[\s\S]*?<\/[^>]+>/gi, '')
    // Remove common ad/tracking containers
    .replace(/<ins[\s\S]*?<\/ins>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');
}

// ---------------------------------------------------------------------------
// Readability.js Extraction
// ---------------------------------------------------------------------------

/**
 * Extract article content using Mozilla Readability.js.
 * Returns { title, content (HTML), textContent, author, siteName, publishedDate } or null.
 */
async function extractWithReadability(html, url) {
  await ensureDeps();
  if (!Readability || !JSDOM) return null;

  try {
    const cleaned = precleanHtml(html);
    const dom = new JSDOM(cleaned, { url: url || 'https://example.com' });
    const doc = dom.window.document;

    const reader = new Readability(doc, {
      charThreshold: 200,
      keepClasses: false,
      nbTopCandidates: 5,
      serializer: (node) => node.innerHTML,
    });

    const article = reader.parse();
    if (!article) return null;

    return {
      title: article.title || '',
      contentHtml: article.content || '',
      textContent: article.textContent || '',
      author: article.byline || '',
      siteName: article.siteName || '',
      publishedDate: article.publishedTime || '',
      length: article.length || 0,
      excerpt: article.excerpt || '',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Regex-based Extraction (fallback)
// ---------------------------------------------------------------------------

/**
 * Fallback content extraction using regex patterns.
 * Less accurate than Readability but works without JSDOM.
 */
function extractWithRegex(html) {
  let content = precleanHtml(html);

  // Try to find main content areas
  const contentSelectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*id="(?:content|main-content|article-body|post-content|story|entry-content|post-body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*(?:content|post|article|entry|story-body|post-body|entry-content|article-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  let foundContent = false;
  for (const selector of contentSelectors) {
    const match = content.match(selector);
    if (match && match[1].length > 300) {
      content = match[1];
      foundContent = true;
      break;
    }
  }

  // Convert to readable text preserving structure
  const text = content
    .replace(/<\/(p|div|br|h[1-6]|li|tr|blockquote|section|dt|dd)>/gi, '\n')
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

  return {
    textContent: text,
    foundContent,
  };
}

// ---------------------------------------------------------------------------
// HTML → Markdown Conversion
// ---------------------------------------------------------------------------

/**
 * Convert HTML to clean, LLM-friendly markdown.
 * Uses Turndown with GFM table support.
 */
export function htmlToMarkdown(html) {
  if (!html) return '';
  try {
    const td = getTurndown();
    let md = td.turndown(html);

    // Post-processing cleanup
    md = md
      // Remove excessive blank lines
      .replace(/\n{4,}/g, '\n\n\n')
      // Fix spacing around headings
      .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
      // Remove trailing whitespace on lines
      .replace(/[ \t]+$/gm, '')
      // Ensure file ends with single newline
      .trimEnd() + '\n';

    return md;
  } catch {
    // Fallback to simple tag stripping
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-zA-Z0-9#]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// ---------------------------------------------------------------------------
// Metadata Extraction
// ---------------------------------------------------------------------------

/**
 * Extract rich metadata from HTML.
 */
export function extractMetadata(html) {
  if (!html) return {};
  const metadata = {};

  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) metadata.title = titleMatch[1].replace(/<[^>]*>/g, '').trim();

  // OG title (often more specific)
  const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i) ||
                       html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:title"[^>]*>/i);
  if (ogTitleMatch) metadata.ogTitle = ogTitleMatch[1];

  // Description
  const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i) ||
                    html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i);
  if (descMatch) metadata.description = descMatch[1];

  // Author
  const authorMatch = html.match(/<meta[^>]*name="author"[^>]*content="([^"]*)"[^>]*>/i) ||
                      html.match(/<meta[^>]*content="([^"]*)"[^>]*name="author"[^>]*>/i) ||
                      html.match(/<[^>]*rel="author"[^>]*>([^<]+)</i) ||
                      html.match(/<span[^>]*class="[^"]*author[^"]*"[^>]*>([^<]+)</i);
  if (authorMatch) metadata.author = authorMatch[1].trim();

  // Published date
  const dateMatch = html.match(/<meta[^>]*property="article:published_time"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<meta[^>]*name="pubdate"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<meta[^>]*name="date"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
  if (dateMatch) metadata.publishedDate = dateMatch[1];

  // Site name
  const siteMatch = html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]*)"[^>]*>/i) ||
                    html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:site_name"[^>]*>/i);
  if (siteMatch) metadata.siteName = siteMatch[1];

  // Language
  const langMatch = html.match(/<html[^>]*lang="([^"]*)"[^>]*>/i);
  if (langMatch) metadata.language = langMatch[1];

  // Canonical URL
  const canonicalMatch = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"[^>]*>/i);
  if (canonicalMatch) metadata.canonicalUrl = canonicalMatch[1];

  // Content type indicators
  metadata.isArticle = /article|post|blog|news|story/i.test(html.substring(0, 5000));
  metadata.hasCodeBlocks = /<pre[^>]*>|<code[^>]*>/i.test(html);

  return metadata;
}

// ---------------------------------------------------------------------------
// PDF Extraction
// ---------------------------------------------------------------------------

/**
 * Extract text content from a PDF buffer.
 * Returns { text, pages, info } or null on failure.
 */
export async function extractPdfContent(buffer) {
  await ensureDeps();
  if (!pdfParse) {
    return { error: 'PDF extraction unavailable. Install pdf-parse: npm install pdf-parse' };
  }

  try {
    const data = await pdfParse(buffer, {
      // Only parse first 50 pages to avoid huge PDFs
      max: 50,
    });

    let text = data.text || '';

    // Clean up common PDF extraction artifacts
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\f/g, '\n---\n') // Form feeds = page breaks
      .replace(/(.)\n(?=[a-z])/g, '$1') // Rejoin broken words
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();

    return {
      text,
      pages: data.numpages || 0,
      info: data.info || {},
      metadata: data.metadata || null,
    };
  } catch (error) {
    return { error: `PDF extraction failed: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// Jina Reader Integration
// ---------------------------------------------------------------------------

/**
 * Fetch a URL via Jina Reader API (r.jina.ai) for LLM-optimized markdown.
 * Free tier: ~1000 requests/day, no API key needed.
 * Handles JS rendering, cookie banners, and returns clean markdown.
 */
export async function extractViaJina(url, options = {}) {
  const { timeout = 25000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers = {
      'Accept': 'text/markdown',
      'X-Return-Format': 'markdown',
    };

    // Optional API key for higher rate limits
    if (process.env.JINA_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
    }

    const response = await fetch(jinaUrl, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      clearTimeout(timer);
      return { error: `Jina Reader returned HTTP ${response.status}`, status: response.status };
    }

    const markdown = await response.text();
    clearTimeout(timer);

    if (!markdown || markdown.length < 100) {
      return { error: 'Jina Reader returned insufficient content' };
    }

    // Parse the markdown for title (usually first H1)
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Try to find source URL reference
    const sourceMatch = markdown.match(/\[Source\]\(([^)]+)\)/i);

    return {
      content: markdown,
      title,
      sourceUrl: sourceMatch ? sourceMatch[1] : url,
      length: markdown.length,
      via: 'jina-reader',
    };
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      return { error: 'Jina Reader request timed out' };
    }
    return { error: `Jina Reader failed: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// Main Extraction Pipeline
// ---------------------------------------------------------------------------

/**
 * Detect if content is likely a PDF based on content-type or URL.
 */
export function isPdf(contentType, url) {
  if (contentType && contentType.includes('application/pdf')) return true;
  if (url && /\.pdf(\?|$|#)/i.test(url)) return true;
  return false;
}

/**
 * Detect if the HTML content looks like it needs JS rendering.
 * Heuristics: very little text content but has JS framework markers.
 */
export function needsJsRendering(html, textLength) {
  if (!html) return false;
  // Very little text but has framework markers
  if (textLength < 500) {
    const hasFrameworkMarkers = /react-root|__next|__nuxt|ng-app|data-reactid|v-cloak/i.test(html);
    if (hasFrameworkMarkers) return true;
    // Check if there's lots of JS but very little content
    const scriptCount = (html.match(/<script/gi) || []).length;
    if (scriptCount > 5 && textLength < 200) return true;
  }
  return false;
}

/**
 * Smart content extraction pipeline.
 * Tries Readability.js first, falls back to regex extraction.
 * Optionally converts to markdown.
 *
 * @param {string} html - Raw HTML content
 * @param {object} options
 * @param {string} options.url - Source URL (for Readability.js)
 * @param {'markdown'|'readable'|'text'|'raw'} options.mode - Extraction mode
 * @param {number} options.maxChars - Maximum characters to return
 * @returns {Promise<object>} Extracted content with metadata
 */
export async function extractContent(html, options = {}) {
  const {
    url = '',
    mode = 'markdown',
    maxChars = 15000,
  } = options;

  if (!html || html.trim().length === 0) {
    return { content: '', metadata: {}, extractionMethod: 'empty' };
  }

  // Extract metadata first (from full HTML)
  const metadata = extractMetadata(html);

  // Raw mode: just return cleaned HTML
  if (mode === 'raw') {
    return {
      content: truncateSmart(html, maxChars),
      metadata,
      extractionMethod: 'raw',
    };
  }

  // Text mode: strip all HTML
  if (mode === 'text') {
    const { textContent } = extractWithRegex(html);
    return {
      content: truncateSmart(textContent, maxChars),
      metadata,
      extractionMethod: 'regex-text',
    };
  }

  // Readable/Markdown mode: use Readability.js with fallback
  let readabilityResult = null;
  let extractionMethod = 'regex';

  // Try Readability.js first
  try {
    readabilityResult = await extractWithReadability(html, url);
    if (readabilityResult) {
      extractionMethod = 'readability';
    }
  } catch {
    // Readability failed, continue to regex
  }

  // Fallback to regex extraction
  if (!readabilityResult) {
    const regexResult = extractWithRegex(html);
    readabilityResult = {
      title: metadata.title || '',
      contentHtml: '', // No HTML from regex
      textContent: regexResult.textContent,
      author: metadata.author || '',
      siteName: metadata.siteName || '',
      publishedDate: metadata.publishedDate || '',
      excerpt: '',
    };
    extractionMethod = 'regex';
  }

  // Convert to the requested format
  let content;
  if (mode === 'markdown') {
    if (readabilityResult.contentHtml) {
      // We have HTML from Readability → convert to markdown
      content = htmlToMarkdown(readabilityResult.contentHtml);
      // Add metadata header
      content = buildMarkdownHeader(readabilityResult) + content;
    } else {
      // Fallback: wrap plain text in markdown formatting
      content = buildMarkdownHeader(readabilityResult) + readabilityResult.textContent;
    }
  } else {
    // 'readable' mode: clean plain text
    content = readabilityResult.textContent || '';
  }

  return {
    content: truncateSmart(content, maxChars),
    metadata: {
      ...metadata,
      author: readabilityResult.author || metadata.author,
      siteName: readabilityResult.siteName || metadata.siteName,
      publishedDate: readabilityResult.publishedDate || metadata.publishedDate,
      extractionMethod,
      readabilityUsed: extractionMethod === 'readability',
    },
    extractionMethod,
    title: readabilityResult.title || metadata.title || '',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a markdown metadata header for extracted content.
 */
function buildMarkdownHeader(article) {
  const parts = [];
  if (article.title) parts.push(`# ${article.title}\n`);
  if (article.author) parts.push(`**Author:** ${article.author}`);
  if (article.siteName) parts.push(`**Source:** ${article.siteName}`);
  if (article.publishedDate) parts.push(`**Published:** ${article.publishedDate}`);
  if (article.excerpt) parts.push(`\n> ${article.excerpt}\n`);
  if (parts.length > 0) parts.push('---\n');
  return parts.join('\n') + '\n';
}

/**
 * Smart truncation: cut at paragraph or sentence boundary.
 */
function truncateSmart(text, maxChars) {
  if (!text || text.length <= maxChars) return text;

  const truncated = text.substring(0, maxChars);
  // Try to cut at a paragraph boundary
  const lastParagraph = truncated.lastIndexOf('\n\n');
  const lastSentence = truncated.lastIndexOf('. ');

  const cutPoint = Math.max(lastParagraph, lastSentence);

  if (cutPoint > maxChars * 0.6) {
    return truncated.substring(0, cutPoint + 1).trimEnd() + '\n\n… [truncated]';
  }

  return truncated.trimEnd() + '\n\n… [truncated]';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  extractContent,
  htmlToMarkdown,
  extractMetadata,
  extractPdfContent,
  extractViaJina,
  isPdf,
  needsJsRendering,
};
