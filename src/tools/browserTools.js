/**
 * 🌐 Browser Tools — Web automation via Playwright
 * 
 * Provides browser control for the agent: navigate, click, type, screenshot, etc.
 * Playwright is an optional dependency — these tools gracefully degrade if not installed.
 * 
 * Install: npm install playwright && npx playwright install chromium
 */

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  // Playwright not installed — tools will return helpful error messages
}

/** @type {import('playwright').Browser|null} */
let _browser = null;

/** @type {Map<string, import('playwright').Page>} */
const _pages = new Map();
let _pageIdCounter = 0;

async function getBrowser() {
  if (!_browser) {
    if (!playwright) {
      throw new Error('Browser tools require Playwright. Install with: npm install playwright && npx playwright install chromium');
    }
    _browser = await playwright.chromium.launch({ headless: true });
  }
  return _browser;
}

async function getPage(pageId) {
  const page = _pages.get(pageId);
  if (!page) throw new Error(`Page "${pageId}" not found. Use browser_list_pages to see open pages.`);
  return page;
}

export function createBrowserTools(options = {}) {
  return [
    {
      name: 'browser_launch',
      description: 'Launch a browser and open a URL. Returns a page ID for subsequent operations.',
      category: 'browser',
      destructive: false,
      timeout: 30000,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
          headless: { type: 'boolean', description: 'Run headless (no visible browser). Default: true', default: true },
        },
        required: ['url'],
      },
      async execute({ url, headless = true }) {
        try {
          const browser = await getBrowser();
          const context = await browser.newContext();
          const page = await context.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

          const pageId = `page-${++_pageIdCounter}`;
          _pages.set(pageId, page);

          const title = await page.title();
          return {
            success: true,
            pageId,
            url: page.url(),
            title,
            message: `Browser opened "${title}" at ${page.url()}`,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_navigate',
      description: 'Navigate an existing browser page to a new URL.',
      category: 'browser',
      destructive: false,
      timeout: 20000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID from browser_launch' },
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['pageId', 'url'],
      },
      async execute({ pageId, url }) {
        try {
          const page = await getPage(pageId);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          return { success: true, url: page.url(), title: await page.title() };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_click',
      description: 'Click an element on the page by CSS selector or text.',
      category: 'browser',
      destructive: false,
      timeout: 10000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID' },
          selector: { type: 'string', description: 'CSS selector or text to click' },
        },
        required: ['pageId', 'selector'],
      },
      async execute({ pageId, selector }) {
        try {
          const page = await getPage(pageId);
          await page.click(selector, { timeout: 5000 });
          return { success: true, message: `Clicked "${selector}"` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_type',
      description: 'Type text into an input field identified by CSS selector.',
      category: 'browser',
      destructive: false,
      timeout: 10000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID' },
          selector: { type: 'string', description: 'CSS selector for the input' },
          text: { type: 'string', description: 'Text to type' },
          pressEnter: { type: 'boolean', description: 'Press Enter after typing', default: false },
        },
        required: ['pageId', 'selector', 'text'],
      },
      async execute({ pageId, selector, text, pressEnter = false }) {
        try {
          const page = await getPage(pageId);
          await page.fill(selector, text, { timeout: 5000 });
          if (pressEnter) await page.keyboard.press('Enter');
          return { success: true, message: `Typed "${text.slice(0, 50)}" into "${selector}"` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page. Returns base64-encoded PNG.',
      category: 'browser',
      destructive: false,
      timeout: 10000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID' },
          fullPage: { type: 'boolean', description: 'Capture full scrollable page', default: false },
        },
        required: ['pageId'],
      },
      async execute({ pageId, fullPage = false }) {
        try {
          const page = await getPage(pageId);
          const buffer = await page.screenshot({ fullPage, type: 'png' });
          const base64 = buffer.toString('base64');
          return {
            success: true,
            image: `data:image/png;base64,${base64}`,
            size: buffer.length,
            message: `Screenshot captured (${(buffer.length / 1024).toFixed(1)}KB)`,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_get_text',
      description: 'Extract visible text content from the page or a specific element.',
      category: 'browser',
      destructive: false,
      timeout: 10000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID' },
          selector: { type: 'string', description: 'CSS selector (optional, defaults to body)' },
        },
        required: ['pageId'],
      },
      async execute({ pageId, selector = 'body' }) {
        try {
          const page = await getPage(pageId);
          const text = await page.locator(selector).innerText({ timeout: 5000 });
          return { success: true, text: text.slice(0, 10000), length: text.length };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_get_html',
      description: 'Get the HTML content of the page or a specific element.',
      category: 'browser',
      destructive: false,
      timeout: 10000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID' },
          selector: { type: 'string', description: 'CSS selector (optional, defaults to html)' },
        },
        required: ['pageId'],
      },
      async execute({ pageId, selector = 'html' }) {
        try {
          const page = await getPage(pageId);
          const html = await page.locator(selector).innerHTML({ timeout: 5000 });
          return { success: true, html: html.slice(0, 20000), length: html.length };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_evaluate',
      description: 'Execute JavaScript in the page context and return the result.',
      category: 'browser',
      destructive: false,
      timeout: 15000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID' },
          script: { type: 'string', description: 'JavaScript code to execute' },
        },
        required: ['pageId', 'script'],
      },
      async execute({ pageId, script }) {
        try {
          const page = await getPage(pageId);
          const result = await page.evaluate(script);
          return { success: true, result: JSON.stringify(result).slice(0, 10000) };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },

    {
      name: 'browser_wait_for',
      description: 'Wait for an element to appear or a timeout to expire.',
      category: 'browser',
      destructive: false,
      timeout: 30000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID' },
          selector: { type: 'string', description: 'CSS selector to wait for' },
          timeoutMs: { type: 'number', description: 'Max wait time in ms', default: 10000 },
        },
        required: ['pageId', 'selector'],
      },
      async execute({ pageId, selector, timeoutMs = 10000 }) {
        try {
          const page = await getPage(pageId);
          await page.waitForSelector(selector, { timeout: timeoutMs });
          return { success: true, message: `Element "${selector}" appeared` };
        } catch (error) {
          return { success: false, error: `Timed out waiting for "${selector}"` };
        }
      },
    },

    {
      name: 'browser_list_pages',
      description: 'List all open browser pages with their IDs, URLs, and titles.',
      category: 'browser',
      destructive: false,
      timeout: 5000,
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        const pages = [];
        for (const [id, page] of _pages) {
          try {
            pages.push({ id, url: page.url(), title: await page.title() });
          } catch {
            pages.push({ id, url: '(closed)', title: '(closed)' });
          }
        }
        return { success: true, pages, count: pages.length };
      },
    },

    {
      name: 'browser_close',
      description: 'Close a specific page or the entire browser.',
      category: 'browser',
      destructive: false,
      timeout: 5000,
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Page ID to close (omit to close browser entirely)' },
        },
      },
      async execute({ pageId }) {
        try {
          if (pageId) {
            const page = await getPage(pageId);
            await page.close();
            _pages.delete(pageId);
            return { success: true, message: `Page "${pageId}" closed` };
          } else {
            for (const [, page] of _pages) { try { await page.close(); } catch { /* ignore */ } }
            _pages.clear();
            if (_browser) { await _browser.close(); _browser = null; }
            return { success: true, message: 'Browser closed' };
          }
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    },
  ];
}

export default createBrowserTools;
