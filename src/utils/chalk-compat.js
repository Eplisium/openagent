/**
 * Chalk-compatible wrapper around picocolors.
 * Supports chalk's chained API: chalk.red.bold('text')
 * Drop-in replacement — just change the import.
 */

import pc from 'picocolors';

// Map chalk style names to picocolors functions
const STYLES = {
  // Colors
  black: pc.black,
  red: pc.red,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  magenta: pc.magenta,
  cyan: pc.cyan,
  white: pc.white,
  gray: pc.gray,
  grey: pc.gray,
  // Modifiers
  bold: pc.bold,
  dim: pc.dim,
  italic: pc.italic,
  underline: pc.underline,
  inverse: pc.inverse,
  hidden: pc.hidden,
  strikethrough: pc.strikethrough,
};

// Background colors (picocolors uses bgX naming)
const BG_STYLES = {
  bgBlack: pc.bgBlack,
  bgRed: pc.bgRed,
  bgGreen: pc.bgGreen,
  bgYellow: pc.bgYellow,
  bgBlue: pc.bgBlue,
  bgMagenta: pc.bgMagenta,
  bgCyan: pc.bgCyan,
  bgWhite: pc.bgWhite,
};

const ALL_STYLES = { ...STYLES, ...BG_STYLES };

function createChainedStyle(appliedFns = []) {
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'toJSON') return () => '';
      // Handle chalk methods not available in picocolors (hex, rgb, ansi256 + bg variants)
      if (prop === 'hex') return () => (text) => text;
      if (prop === 'bgHex') return () => (text) => text;
      if (prop === 'rgb') return () => (text) => text;
      if (prop === 'bgRgb') return () => (text) => text;
      if (prop === 'ansi256') return () => (text) => text;
      if (prop === 'bgAnsi256') return () => (text) => text;
      const fn = ALL_STYLES[prop];
      if (fn) {
        return createChainedStyle([...appliedFns, fn]);
      }
      return undefined;
    },
    apply(_, thisArg, args) {
      if (appliedFns.length === 0) return args[0] || '';
      const text = args[0] || '';
      // Apply styles innermost-first: last accessed = outermost wrapper
      return appliedFns.reduce((val, fn) => fn(val), text);
    },
  });
}

const chalk = createChainedStyle();

export default chalk;
export { chalk };
