/**
 * Markdown rendering for OpenAgent CLI terminal display.
 * Configures marked with marked-terminal for rich terminal output.
 */

import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// Configure marked with terminal renderer
marked.use(markedTerminal({
  // Pass chalk for color support
  chalk,
  // Don't reflow text to a fixed width - let the terminal handle it
  reflowText: false,
  // Show URLs inline for links (terminals can't click markdown links)
  showSectionPrefix: false,
  // Unescape HTML entities
  unescape: true,
}));

/**
 * Render markdown text for terminal display.
 * Falls back to plain text if rendering fails.
 * @param {string} text - Raw markdown text
 * @returns {string} Terminal-formatted text
 */
export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';
  try {
    const result = marked.parse(text);
    // marked-terminal returns a string; trim trailing whitespace from the render
    return typeof result === 'string' ? result.trimEnd() : text;
  } catch {
    // Fallback: return plain text if markdown rendering fails
    return text;
  }
}
