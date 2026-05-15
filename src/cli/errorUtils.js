/**
 * ❌ Error Utilities
 * Error categorization, smart suggestions, and error display.
 */

import chalk from '../utils/chalk-compat.js';
import { themes } from './themes.js';

const theme = themes.catppuccin;
const c = {
  error: chalk.hex(theme.error),
  warning: chalk.hex(theme.warning),
  success: chalk.hex(theme.success),
  text: chalk.hex(theme.text),
  muted: chalk.hex(theme.muted),
  accent: chalk.hex(theme.accent),
};

function divider(label = '') {
  const width = Math.min(process.stdout.columns || 80, 72);
  if (!label) return c.muted(`  ${'─'.repeat(width)}`);
  return c.muted(`  ── ${label} ${'─'.repeat(Math.max(1, width - label.length - 5))}`);
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 Error Categorization
// ═══════════════════════════════════════════════════════════════════

/**
 * Categorize error and provide appropriate suggestions
 */
export function categorizeError(errorType, message, errorData) {
  const msg = (message || '').toLowerCase();
  const dataStr = typeof errorData === 'string' ? errorData : JSON.stringify(errorData || {}).toLowerCase();
  const combinedMsg = msg + ' ' + dataStr;

  // Common command typos
  const commandTypos = {
    '/hel': '/help',
    '/hlp': '/help',
    '/hep': '/help',
    '/hel p': '/help',
    '/exi': '/exit',
    '/exot': '/exit',
    '/qui': '/quit',
    '/qit': '/quit',
    '/stat': '/stats',
    '/satats': '/stats',
    '/modle': '/model',
    '/histroy': '/history',
    '/histoy': '/history',
    '/histry': '/history',
  };

  for (const [typo, correct] of Object.entries(commandTypos)) {
    if (msg.includes(typo)) {
      return {
        statusCode: null,
        suggestions: [],
        commandHint: `Did you mean ${c.accent(correct)}?`,
      };
    }
  }

  // API errors (401, 403, 429, 500, etc.)
  if (combinedMsg.includes('api key') || combinedMsg.includes('unauthorized') ||
      combinedMsg.includes('401') || combinedMsg.includes('403') || combinedMsg.includes('invalid key')) {
    return {
      statusCode: combinedMsg.includes('401') ? '401' : combinedMsg.includes('403') ? '403' : null,
      suggestions: [
        'Check OPENROUTER_API_KEY in your .env file',
        'Get a new key → https://openrouter.ai/keys',
        'Run /doctor to diagnose',
      ],
    };
  }

  // Rate limit errors
  if (combinedMsg.includes('rate limit') || combinedMsg.includes('429') || combinedMsg.includes('too many requests')) {
    return {
      statusCode: '429',
      suggestions: [
        'Wait a moment and try again',
        'Consider using a different model',
        'Check your API quota at https://openrouter.ai/accounts',
      ],
    };
  }

  // Network errors
  if (combinedMsg.includes('network') || combinedMsg.includes('fetch') ||
      combinedMsg.includes('econnrefused') || combinedMsg.includes('timeout') || combinedMsg.includes('enotfound')) {
    return {
      statusCode: null,
      suggestions: [
        'Check your internet connection',
        'Verify the API endpoint is accessible',
        'Try again in a few seconds',
      ],
    };
  }

  // File errors
  if (combinedMsg.includes('enoent') || combinedMsg.includes('eacces') ||
      combinedMsg.includes('permission') || combinedMsg.includes('not found') || combinedMsg.includes('no such file')) {
    const pathMatch = dataStr.match(/"path":\s*"([^"]+)"/) || msg.match(/([A-Za-z]:\\[^\s]+|\/[^\s]+\/[^\s]+)/);
    const filePath = pathMatch ? pathMatch[1] : 'the file';

    return {
      statusCode: null,
      suggestions: [
        `Check that ${c.accent(filePath)} exists`,
        'Verify file permissions',
        'Use absolute paths instead of relative paths',
      ],
    };
  }

  // Agent errors (iteration limits, tool limits)
  if (combinedMsg.includes('iteration') || combinedMsg.includes('max iterations') ||
      combinedMsg.includes('tool call') || combinedMsg.includes('max tools')) {
    return {
      statusCode: null,
      suggestions: [
        'Break your task into smaller steps',
        'Use /clear to reset the conversation',
        'Try a simpler request first',
      ],
    };
  }

  // Context/token errors
  if (combinedMsg.includes('context') || combinedMsg.includes('token') || combinedMsg.includes('max tokens')) {
    return {
      statusCode: null,
      suggestions: [
        'Use /clear to reset conversation context',
        'Try a model with larger context window',
        'Break long conversations into shorter ones',
      ],
    };
  }

  // Server errors
  if (combinedMsg.includes('500') || combinedMsg.includes('502') || combinedMsg.includes('503') ||
      combinedMsg.includes('internal error') || combinedMsg.includes('server error')) {
    return {
      statusCode: '5xx',
      suggestions: [
        'This is a server-side issue, not your fault',
        'Wait a moment and try again',
        'Check https://status.openrouter.ai for outages',
      ],
    };
  }

  // Default fallback
  return {
    statusCode: null,
    suggestions: [
      'Try /doctor to check your environment',
      'Use /clear and try again',
      'Check the error details above',
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
// 📋 Error Suggestions
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate error suggestions based on error type
 */
export function generateErrorSuggestions(error, _task) {
  const suggestions = [];
  const errorMsg = error.message?.toLowerCase() || '';

  if (errorMsg.includes('api key') || errorMsg.includes('unauthorized') || errorMsg.includes('401')) {
    suggestions.push('Check your OPENROUTER_API_KEY in .env file');
    suggestions.push('Get a key at https://openrouter.ai/keys');
  }

  if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
    suggestions.push('Wait a moment and try again');
    suggestions.push('Consider using a different model');
  }

  if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
    suggestions.push('Try a simpler task or break it into steps');
    suggestions.push('Check your internet connection');
  }

  if (errorMsg.includes('context') || errorMsg.includes('token')) {
    suggestions.push('Use /clear to reset conversation context');
    suggestions.push('Try a model with larger context window');
  }

  if (suggestions.length === 0) {
    suggestions.push('Try /doctor to check your environment');
    suggestions.push('Use /clear and try again');
    suggestions.push('Check the error details above');
  }

  return suggestions;
}

// ═══════════════════════════════════════════════════════════════════
// 🖥️ Error Display
// ═══════════════════════════════════════════════════════════════════

/**
 * Show smart error with suggestions
 */
export function showSmartError(errorType, details = {}) {
  const { message, suggestions = [], httpStatus, errorData, context } = details;

  const errorCategory = categorizeError(errorType, message, errorData);

  let title = 'Error';
  const fixSuggestions = suggestions.length > 0 ? suggestions : errorCategory.suggestions;

  if (httpStatus) {
    title += ` ${c.warning('⚠')} ${c.text(httpStatus)}`;
  } else if (errorCategory.statusCode) {
    title += ` ${c.warning('⚠')} ${c.text(errorCategory.statusCode)}`;
  }

  console.log('');
  console.log(divider('error'));
  console.log(`  ${c.error('✗')} ${chalk.bold(title)}`);
  console.log('');
  console.log(`  ${c.text(message || 'An error occurred')}`);

  if (fixSuggestions.length > 0) {
    console.log('');
    console.log(`  ${chalk.bold('Suggestions:')}`);
    for (const suggestion of fixSuggestions) {
      console.log(`  ${c.success('•')} ${suggestion}`);
    }
  }

  if (errorData) {
    const detailsStr = typeof errorData === 'string' ? errorData : JSON.stringify(errorData, null, 2);
    const truncatedDetails = detailsStr.length > 500 ? detailsStr.substring(0, 500) + '...' : detailsStr;
    console.log('');
    console.log(`  ${chalk.bold('Details:')}`);
    for (const line of truncatedDetails.split('\n')) {
      console.log(`  ${c.muted(line)}`);
    }
  }

  if (context) {
    console.log('');
    console.log(`  ${c.muted('Context: ' + context)}`);
  }

  console.log(divider());

  if (errorCategory.commandHint) {
    console.log(c.muted(`\n  ${errorCategory.commandHint}`));
  }
}
