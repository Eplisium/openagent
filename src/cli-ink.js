#!/usr/bin/env node
/**
 * 🎨 OpenAgent Ink CLI Entry Point
 * Smart loader that uses bundled UI when available
 * Falls back to dev mode with tsx/esbuild if needed
 */

import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
 */
export async function startInkUI(options = {}) {
  // Check if bundled version exists
  if (fileExists(bundledPath)) {
    try {
      // Dynamic import of bundled version
      const module = await import(bundledPath);
      if (module.default && typeof module.default === 'function') {
        return await module.default(options);
      }
      // Some bundles export startInkUI directly
      if (module.startInkUI && typeof module.startInkUI === 'function') {
        return await module.startInkUI(options);
      }
      return module;
    } catch (error) {
      console.error('⚠️  Bundled UI failed to load, attempting rebuild...');
      const built = await buildUI();
      if (built && fileExists(bundledPath)) {
        // Retry with newly built bundle
        const module = await import(bundledPath);
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
    
    // Try using tsx for dev mode (handles JSX natively)
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

// If run directly (not imported) - with Windows path fix
if (process.argv[1]) {
  try {
    // Try to convert process.argv[1] to a file URL if it's not already
    let.argvPath = process.argv[1];
    if (!argvPath.startsWith('file://')) {
      // On Windows, convert path to file URL properly
      try {
        argvPath = pathToFileURL(argvPath).href;
      } catch (e) {
        // If conversion fails, try direct path comparison
        const resolvedArgv = path.resolve(process.argv[1]);
        const resolvedFilename = path.resolve(__filename);
        if (resolvedArgv === resolvedFilename) {
          startInkUI().catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
          });
        }
        return;
      }
    }
    if (fileURLToPath(argvPath) === __filename) {
      startInkUI().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
      });
    }
  } catch (error) {
    // Ignore URL conversion errors when imported as a module
  }
}
