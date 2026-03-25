#!/usr/bin/env node
/**
 * OpenAgent Ink CLI Entry Point
 * Renders the React/Ink UI directly when bundled
 * Falls back to loading bundle when imported from cli.js
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

// Determine if we are the bundle or the source
const IS_BUNDLE = import.meta.url.startsWith('file://') &&
                  import.meta.url.includes('/dist/cli-ink.mjs');

let __filename = '';
let __dirname = '';
let projectRoot = '';

try {
  __filename = fileURLToPath(import.meta.url);
  __dirname = path.dirname(__filename);
  projectRoot = path.resolve(__dirname, '..');
} catch (e) {
  try {
    if (process.argv[1]) {
      __filename = path.resolve(process.argv[1]);
      __dirname = path.dirname(__filename);
      projectRoot = path.resolve(__dirname, '..');
    }
  } catch (e2) {
    __dirname = process.cwd();
    projectRoot = process.cwd();
  }
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the bundle path
 */
function getBundlePath() {
  const possiblePaths = [
    path.join(projectRoot, 'dist', 'cli-ink.mjs'),
    path.join(__dirname, '..', 'dist', 'cli-ink.mjs'),
    path.join(process.cwd(), 'dist', 'cli-ink.mjs'),
  ];
  
  for (const p of possiblePaths) {
    if (fileExists(p)) return p;
  }
  return null;
}

/**
 * Load the bundled UI module
 */
async function loadBundleUI() {
  const bundlePath = getBundlePath();
  if (!bundlePath) {
    throw new Error('Bundle not found. Run "npm run build" first.');
  }
  const bundleUrl = pathToFileURL(bundlePath).href;
  const module = await import(bundleUrl);
  return module;
}

/**
 * Main UI launcher function
 * Renders the Ink/React App component
 */
async function launchUI(options = {}) {
  // Dynamic imports - only loaded when UI is actually started
  const React = (await import('react')).default;
  const { render } = await import('ink');
  const App = (await import('./ui/App.jsx')).default;
  
  const config = options.config || options;
  
  console.log('');
  
  const { unmount, rerender, waitUntilExit } = render(
    React.createElement(App, { config })
  );
  
  await waitUntilExit();
  unmount();
}

/**
 * Exported function called from cli.js
 */
export async function startInkUI(options = {}) {
  // If we are not bundled, try to load the bundle first
  if (!IS_BUNDLE) {
    const bundlePath = getBundlePath();
    if (bundlePath) {
      try {
        const bundle = await loadBundleUI();
        if (bundle && typeof bundle.startInkUI === 'function') {
          return await bundle.startInkUI(options);
        }
      } catch (e) {
        // Bundle failed, fall back to direct loading
        console.warn('Bundle load failed, attempting direct load:', e.message);
      }
    }
  }
  
  try {
    await launchUI(options);
  } catch (error) {
    console.error('Fatal error starting Ink UI:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Also export as default for compatibility
export default startInkUI;

// Direct execution detection
function shouldRunDirectly() {
  if (!process.argv[1] || !__filename) {
    return false;
  }
  try {
    const argPath = path.resolve(process.argv[1]).toLowerCase();
    const thisPath = path.resolve(__filename).toLowerCase();
    return argPath === thisPath;
  } catch {
    return false;
  }
}

if (shouldRunDirectly()) {
  startInkUI().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
