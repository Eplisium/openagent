#!/usr/bin/env node
/**
 * OpenAgent Ink CLI Entry Point
 * Renders the React/Ink UI directly when bundled
 * Falls back to loading bundle when imported from cli.js
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import React from 'react';
import { render } from 'ink';
import App from './ui/App.jsx';

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
 * Main UI launcher function
 * Renders the Ink/React App component
 */
async function launchUI(options = {}) {
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
