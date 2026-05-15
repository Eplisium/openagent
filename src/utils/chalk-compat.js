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

function parseHexColor(hex) {
  const clean = String(hex || '').replace(/^#/, '').trim();
  const expanded = clean.length === 3
    ? clean.split('').map(ch => ch + ch).join('')
    : clean;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function ansiColor(open, close) {
  return (text) => {
    const value = text || '';
    if (!value) return '';
    return `${open}${value}${close}`;
  };
}

function fgHex(hex) {
  const rgb = parseHexColor(hex);
  return rgb ? ansiColor(`\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`, '\x1b[39m') : (text) => text || '';
}

function bgHex(hex) {
  const rgb = parseHexColor(hex);
  return rgb ? ansiColor(`\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`, '\x1b[49m') : (text) => text || '';
}

function fgRgb(r, g, b) {
  return ansiColor(`\x1b[38;2;${r};${g};${b}m`, '\x1b[39m');
}

function bgRgb(r, g, b) {
  return ansiColor(`\x1b[48;2;${r};${g};${b}m`, '\x1b[49m');
}

function createChainedStyle(appliedFns = []) {
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'toJSON') return () => '';
      // Handle chalk methods not available in picocolors (hex, rgb, ansi256 + bg variants)
      if (prop === 'hex') return (hex) => createChainedStyle([...appliedFns, fgHex(hex)]);
      if (prop === 'bgHex') return (hex) => createChainedStyle([...appliedFns, bgHex(hex)]);
      if (prop === 'rgb') return (r, g, b) => createChainedStyle([...appliedFns, fgRgb(r, g, b)]);
      if (prop === 'bgRgb') return (r, g, b) => createChainedStyle([...appliedFns, bgRgb(r, g, b)]);
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
