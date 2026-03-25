#!/usr/bin/env node
/**
 * 🎨 OpenAgent Ink CLI Entry Point
 * Smart loader that uses bundled UI when available
 * Falls back to dev mode with tsx/esbuild if needed
 *
 * CRITICAL: This file is imported by cli.js for the --ui flag.
 * It MUST NOT throw any errors when imported, only when run directly.
 */

import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// Safe initialization - all operations wrapped to prevent import errors
// ═══════════════════════════════════════════════════════════════

let __filename = '';
let __dirname = '';
let projectRoot = '';
let bundledPath = '';
let srcPath = '';

try {
  __filename = fileURLToPath(import.meta.url);
  __dirname = path.dirname(__filename);
  projectRoot = path.resolve(__dirname, '..');
  bundledPath = path.join(projectRoot, 'dist', 'cli-ink.mjs');
  srcPath = path.join(__dirname, 'ui', 'App.jsx');
} catch (e) {
  // If fileURLToPath fails, use fallback based on process.argv
  // This handles edge cases on Windows
  try {
    if (process.argv[1]) {
      __filename = path.resolve(process.argv[1]);
      __dirname = path.dirname(__filename);
      projectRoot = path.resolve(__dirname, '..');
      bundledPath = path.join(projectRoot, 'dist', 'cli-ink.mjs');
      srcPath = path.join(__dirname, 'ui', 'App.jsx');
    }
  } catch (e2) {
    // Last resort fallback
    __filename = '';
    __dirname = process.cwd();
    projectRoot = process.cwd();
    bundledPath = path.join(process.cwd(), 'dist', 'cli-ink.mjs');
    srcPath = path.join(process.cwd(), 'src', 'ui', 'App.jsx');
  }
}

// Module-level guard to prevent recursive loading
let inkUIStarted = false;

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function buildUI() {
  console.log('🔨 Building UI bundle...');
  try {
    const { execSync } = await import('child_process');
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

// ═══════════════════════════════════════════════════════════════
// Main entry point - starts the Ink UI
// ═══════════════════════════════════════════════════════════════

export async function startInkUI(options = {}) {
  if (inkUIStarted) {
    console.log('⚠️ Ink UI already started, skipping duplicate call.');
    return;
  }
  inkUIStarted = true;
  
  // Check if we're already running the bundled version to prevent recursion
  let isBundled = false;
  try {
    const bundleUrl = pathToFileURL(bundledPath).href;
    isBundled = (import.meta.url === bundleUrl);
  } catch {}
  
  // Check if bundled version exists and we're not already the bundle
  if (!isBundled && fileExists(bundledPath)) {
    try {
      // Convert path to proper file:// URL for Windows compatibility
      const bundleUrl = pathToFileURL(bundledPath).href;
      console.log(`📦 Loading bundled UI from: ${bundledPath}`);
      
      const module = await import(bundleUrl);
      
      if (module.default && typeof module.default === 'function') {
        return await module.default(options);
      }
      if (module.startInkUI && typeof module.startInkUI === 'function') {
        return await module.startInkUI(options);
      }
      return module;
    } catch (error) {
      console.error(`⚠️  Bundled UI failed to load: ${error.message}`);
      console.log('🔨 Attempting rebuild...');
      
      const built = await buildUI();
      if (built && fileExists(bundledPath)) {
        try {
          const bundleUrl = pathToFileURL(bundledPath).href;
          const module = await import(bundleUrl);
          
          if (module.default && typeof module.default === 'function') {
            return await module.default(options);
          }
          return module;
        } catch (retryError) {
          console.error(`❌ Rebuild also failed: ${retryError.message}`);
        }
      }
    }
  }

  // No bundled version - try development mode
  if (fileExists(srcPath)) {
    console.log('📦 No bundled UI found. Trying development mode...');
    console.log('   Tip: Run "npm run build" to create the bundle');
    
    try {
      const { execSync } = await import('child_process');
      execSync('npx tsx src/cli-ink.js', {
        cwd: projectRoot,
        stdio: 'inherit',
        env: { ...process.env }
      });
      return;
    } catch (tsxError) {
      // tsx not available
    }
  }

  // Last resort - show error and exit
  console.error('');
  console.error('❌ Cannot start UI:');
  console.error('   Bundle not found and source JSX cannot run directly in Node.js');
  console.error('');
  console.error('To fix, run:');
  console.error('   npm run build');
  console.error('');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// Direct execution detection - very conservative
// Only runs UI if we're 100% sure this file was executed directly
// ═══════════════════════════════════════════════════════════════

function shouldRunDirectly() {
  // Only check if we have valid paths
  if (!process.argv[1] || !__filename) {
    return false;
  }
  
  try {
    // Resolve both paths and compare (case-insensitive for Windows)
    const argPath = path.resolve(process.argv[1]).toLowerCase();
    const thisPath = path.resolve(__filename).toLowerCase();
    return argPath === thisPath;
  } catch {
    return false;
  }
}

// Only run if directly executed (not imported)
if (shouldRunDirectly()) {
  startInkUI().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
