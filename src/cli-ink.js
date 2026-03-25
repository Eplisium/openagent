#!/usr/bin/env node
/**
 * 🎨 OpenAgent Ink CLI Entry Point
 * Smart loader that uses bundled UI when available
 * Falls back to dev mode with tsx/esbuild if needed
 * 
 * IMPORTANT: This file must be safe to import without side effects!
 * The traditional CLI (cli.js) imports startInkUI from here.
 */

import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

// Safe initialization that won't fail on import
const __filename = typeof import.meta.url === 'string' 
  ? fileURLToPath(import.meta.url) 
  : process.argv[1] || '';
const __dirname = __filename ? path.dirname(__filename) : process.cwd();
const require = createRequire(import.meta.url);

// Paths
const projectRoot = path.resolve(__dirname, '..');
const bundledPath = path.join(projectRoot, 'dist', 'cli-ink.mjs');
const srcPath = path.join(__dirname, 'ui', 'App.jsx');

/**
 * Check if a file exists
 */
function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the UI bundle if needed
 */
async function buildUI() {
  console.log('🔨 Building UI bundle...');
  const { execSync } = await import('child_process');
  try {
    execSync('npm run build', { 
      cwd: projectRoot, 
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    console.log('✅ UI bundle built successfully!');
    return true;
  } catch (error) {
    console.error('❌ Failed to build UI:', error.message);
    return false;
  }
}

/**
 * Main entry point - starts the Ink UI
 * This function can be called from cli.js when user runs 'openagent --ui'
 */
export async function startInkUI(options = {}) {
  // Check if bundled version exists
  if (fileExists(bundledPath)) {
    try {
      // Use pathToFileURL for Windows compatibility
      const bundleUrl = pathToFileURL(bundledPath).href;
      const module = await import(bundleUrl);
      if (module.default && typeof module.default === 'function') {
        return await module.default(options);
      }
      if (module.startInkUI && typeof module.startInkUI === 'function') {
        return await module.startInkUI(options);
      }
      return module;
    } catch (error) {
      console.error('⚠️  Bundled UI failed to load, attempting rebuild...');
      const built = await buildUI();
      if (built && fileExists(bundledPath)) {
        const bundleUrl = pathToFileURL(bundledPath).href;
        const module = await import(bundleUrl);
        if (module.default && typeof module.default === 'function') {
          return await module.default(options);
        }
        return module;
      }
    }
  }

  // No bundled version and build failed - try development mode
  if (fileExists(srcPath)) {
    console.log('📦 No bundled UI found. Trying development mode...');
    console.log('   Tip: Run "npm run build" or "npm run dev:ui" for development');
    
    try {
      const { execSync } = await import('child_process');
      execSync('npx tsx src/cli-ink.js', { 
        cwd: projectRoot,
        stdio: 'inherit',
        env: { ...process.env }
      });
      return;
    } catch (tsxError) {
      // tsx not available, continue to error
    }
  }

  // Last resort: provide helpful error message
  console.error('');
  console.error('❌ Cannot start UI:');
  console.error('   - No bundled version found at: dist/cli-ink.mjs');
  console.error('   - Source JSX files cannot run directly in Node.js');
  console.error('');
  console.error('To fix this, run one of:');
  console.error('   npm run build     # Build the UI bundle');
  console.error('   npm run dev:ui    # Run in development mode with tsx');
  console.error('   npm start         # Use traditional CLI instead');
  console.error('');
  process.exit(1);
}

// Only run if this file is executed directly (not imported)
// Use a very safe check that won't throw errors
if (typeof process.argv[1] === 'string' && process.argv[1].length > 0) {
  try {
    // Resolve both paths and compare (case-insensitive for Windows)
    const argPath = path.resolve(process.argv[1]).toLowerCase();
    const thisPath = path.resolve(__filename).toLowerCase();
    
    if (argPath === thisPath) {
      startInkUI().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
      });
    }
  } catch (e) {
    // Silently ignore any errors in the detection logic
    // This ensures the file is safe to import even if detection fails
  }
}
