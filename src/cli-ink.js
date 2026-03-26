#!/usr/bin/env node
/**
 * OpenAgent Ink CLI Entry Point
 * Renders the React/Ink UI directly when bundled
 * Falls back to loading bundle when imported from cli.js
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { createRequire } from 'module';

// Determine if we are the bundle or the source
const IS_BUNDLE = import.meta.url.startsWith('file://') &&
                  import.meta.url.includes('/dist/cli-ink.mjs');
const require = createRequire(import.meta.url);

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

function getCLIOptions(args = process.argv.slice(2)) {
  const modelIndex = args.indexOf('--model');
  const themeIndex = args.indexOf('--theme');
  const allowFullAccess = args.includes('--full-access') || process.env.OPENAGENT_FULL_ACCESS === 'true';

  return {
    model: modelIndex !== -1 && args[modelIndex + 1] ? args[modelIndex + 1] : undefined,
    theme: themeIndex !== -1 && args[themeIndex + 1] ? args[themeIndex + 1] : undefined,
    allowFullAccess,
    permissions: {
      allowFileDelete: true,
      allowFullAccess,
    },
  };
}

function buildResolvedOptions(options = {}) {
  const cliOptions = getCLIOptions();
  const resolved = {
    ...cliOptions,
    ...options,
  };
  const allowFullAccess = resolved.allowFullAccess === true || resolved.permissions?.allowFullAccess === true;

  return {
    ...resolved,
    allowFullAccess,
    permissions: {
      allowFileDelete: true,
      ...cliOptions.permissions,
      ...options.permissions,
      allowFullAccess,
    },
  };
}

function isSourceLaunchError(error) {
  const message = `${error?.message || ''}`;
  return error?.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension ".jsx"/.test(message);
}

async function relaunchSourceUIWithTsx() {
  let tsxCliPath = '';

  try {
    tsxCliPath = require.resolve('tsx/dist/cli.mjs');
  } catch {
    return false;
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCliPath, __filename, ...process.argv.slice(2)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`TSX UI launcher exited with code ${code}`));
    });
  });

  return true;
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
  
  const { unmount, waitUntilExit } = render(
    React.createElement(App, { config })
  );
  
  await waitUntilExit();
  unmount();
}

/**
 * Exported function called from cli.js
 */
export async function startInkUI(options = {}) {
  const resolvedOptions = buildResolvedOptions(options);

  // If we are already the bundle, launch directly (jsx is compiled in)
  if (IS_BUNDLE) {
    try {
      await launchUI(resolvedOptions);
    } catch (error) {
      console.error('Fatal error starting Ink UI:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
    return;
  }

  try {
    await launchUI(resolvedOptions);
    return;
  } catch (error) {
    if (!isSourceLaunchError(error)) {
      console.error('Fatal error starting Ink UI:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }

  // Not the bundle — must load the compiled bundle
  const bundlePath = getBundlePath();
  if (bundlePath) {
    try {
      const bundle = await loadBundleUI();
      if (bundle && typeof bundle.startInkUI === 'function') {
        return await bundle.startInkUI(resolvedOptions);
      }
      console.error('Bundle loaded but does not export startInkUI.');
      process.exit(1);
    } catch (e) {
      try {
        if (await relaunchSourceUIWithTsx()) {
          return;
        }
      } catch (tsxError) {
        console.error('Failed to launch UI via tsx:', tsxError.message);
      }

      console.error('Failed to load bundle:', e.message);
      console.error('Try running "npm run build" to rebuild.');
      process.exit(1);
    }
  }

  try {
    if (await relaunchSourceUIWithTsx()) {
      return;
    }
  } catch (tsxError) {
    console.error('Failed to launch UI via tsx:', tsxError.message);
    process.exit(1);
  }

  console.error('Bundle not found. Run "npm run build" first.');
  process.exit(1);
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
  startInkUI(getCLIOptions()).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
