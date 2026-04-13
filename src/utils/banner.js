/**
 * 🎨 Banner Renderer
 * Renders ASCII art banners using figlet with the project's font files.
 * Falls back to a simple gradient banner if figlet fails.
 */

import figlet from 'figlet';
import chalk from './chalk-compat.js';
import gradient from 'gradient-string';
import fs from './fs-compat.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', '..', 'fonts');

// Cache loaded fonts
const fontCache = new Map();

/**
 * Load a FIGfont from the fonts/ directory
 */
async function loadFont(fontName) {
  if (fontCache.has(fontName)) return fontCache.get(fontName);

  const fontPath = path.join(FONTS_DIR, `${fontName}.json`);
  try {
    const data = await fs.readFile(fontPath, 'utf-8');
    const font = JSON.parse(data);
    fontCache.set(fontName, font);
    return font;
  } catch {
    return null;
  }
}

/**
 * Get list of available font names
 */
export async function getAvailableFonts() {
  try {
    const files = await fs.readdir(FONTS_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return ['simple', 'slick', 'chrome'];
  }
}

/**
 * Render text as ASCII art using a specific font
 * @param {string} text - Text to render
 * @param {string} fontName - Font name (without .json extension)
 * @returns {Promise<string>} Rendered ASCII art
 */
export async function renderAsciiArt(text, fontName = 'slick') {
  const font = await loadFont(fontName);
  if (font) {
    // Use figlet with custom font
    return new Promise((resolve, reject) => {
      figlet.text(text, { font: fontName }, (err, data) => {
        if (err) {
          // Try loading font manually
          try {
            figlet.loadFontSync(fontName, font);
            const result = figlet.textSync(text, { font: fontName });
            resolve(result);
          } catch {
            resolve(null);
          }
        } else {
          resolve(data);
        }
      });
    });
  }

  // Fallback: use a built-in figlet font
  return new Promise((resolve) => {
    figlet.text(text, { font: 'Standard' }, (err, data) => {
      resolve(err ? null : data);
    });
  });
}

/**
 * Render text with a gradient applied line-by-line
 * @param {string} asciiArt - The ASCII art text
 * @param {string[]} colors - Array of hex colors for gradient
 * @returns {string} Gradient-colored ASCII art
 */
export function applyGradient(asciiArt, colors = ['#00D9FF', '#FF006E', '#38B000']) {
  if (!asciiArt) return '';
  const grad = gradient(colors);
  return grad(asciiArt);
}

/**
 * Print a full banner with ASCII art title, subtitle, and version
 * @param {object} options
 * @param {string} options.title - Main title text (default: 'OpenAgent')
 * @param {string} options.subtitle - Subtitle line
 * @param {string} options.version - Version string
 * @param {string} options.font - Font name (default: 'slick')
 * @param {string[]} options.colors - Gradient colors
 */
export async function printBanner({
  title = 'OpenAgent',
  subtitle = 'AI Agent • 400+ Models • Cross-Platform',
  version = '',
  font = 'slick',
  colors = ['#00D9FF', '#FF006E', '#38B000'],
} = {}) {
  const asciiArt = await renderAsciiArt(title, font);

  if (asciiArt) {
    const colored = applyGradient(asciiArt, colors);
    console.log(colored);

    // Subtitle and version below
    const parts = [];
    if (version) parts.push(chalk.gray(`v${version}`));
    if (subtitle) parts.push(chalk.gray(subtitle));
    if (parts.length > 0) {
      console.log(`  ${parts.join('  •  ')}`);
    }
    console.log('');
  } else {
    // Ultimate fallback: simple gradient text
    const grad = gradient(colors);
    console.log('');
    console.log(`  ${grad('🚀 ' + title)}`);
    if (version) console.log(chalk.gray(`  v${version}`));
    if (subtitle) console.log(chalk.gray(`  ${subtitle}`));
    console.log('');
  }
}

/**
 * Print a compact banner (no ASCII art, just styled text)
 */
export function printCompactBanner(version = '') {
  const grad = gradient(['#00D9FF', '#FF006E', '#38B000']);
  console.log('');
  console.log(`  ${grad('🚀 OpenAgent')}${version ? chalk.gray(` v${version}`) : ''}`);
  console.log(chalk.gray('  AI Agent • 400+ Models • Cross-Platform'));
  console.log('');
}
