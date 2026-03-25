/**
 * 🖥️ Terminal Detection & Handling
 * Detects TTY, color support, Unicode, and terminal capabilities
 */

import process from 'process';
import os from 'os';
import { Platform } from './platform.js';

/**
 * Terminal detection and capabilities object
 */
export const Terminal = {
  /**
   * Check if stdout is a TTY (interactive terminal)
   * @returns {boolean}
   */
  isTTY() {
    return Boolean(process.stdout.isTTY);
  },

  /**
   * Check if running in a CI environment
   * @returns {boolean}
   */
  isCI() {
    return Boolean(
      process.env.CI ||
      process.env.CONTINUOUS_INTEGRATION ||
      process.env.TF_BUILD ||
      process.env.GITHUB_ACTIONS ||
      process.env.TRAVIS ||
      process.env.CIRCLECI ||
      process.env.JENKINS_URL
    );
  },

  /**
   * Check if terminal is "dumb" (limited capabilities)
   * @returns {boolean}
   */
  isDumbTerminal() {
    const term = process.env.TERM || '';
    return term === 'dumb' || term === 'cons25';
  },

  /**
   * Detect color support level
   * @returns {number} 0 = no color, 1 = basic, 2 = 256 colors, 16M = truecolor
   */
  getColorSupport() {
    // Check NO_COLOR environment variable (https://no-color.org/)
    if (process.env.NO_COLOR !== undefined) {
      return 0;
    }

    // Check FORCE_COLOR environment variable
    if (process.env.FORCE_COLOR !== undefined) {
      const forceColor = process.env.FORCE_COLOR;
      if (forceColor === '0' || forceColor === 'false') return 0;
      if (forceColor === '1' || forceColor === 'true') return 1;
      if (forceColor === '2') return 2;
      if (forceColor === '3') return 16;
    }

    // Check terminal type
    const term = process.env.TERM || '';
    const termProgram = process.env.TERM_PROGRAM || '';
    const termVersion = process.env.TERM_PROGRAM_VERSION || '';

    // Windows Terminal and ConPTY support truecolor
    if (Platform.isWindows) {
      // Windows Terminal (version 1.18+ supports truecolor)
      if (process.env.WT_SESSION) {
        return 16;
      }
      // ConPTY (Windows 10 1809+)
      if (process.env.CONEMUANSI === 'ON') {
        return 16;
      }
      // Traditional Windows console has limited color
      return 1;
    }

    // macOS Terminal.app and iTerm2
    if (Platform.isMac) {
      if (termProgram === 'Apple_Terminal') {
        return 2; // 256 colors
      }
      if (termProgram === 'iTerm.app') {
        return 16; // truecolor
      }
    }

    // Linux and other Unix-like
    if (term.includes('256color')) return 2;
    if (term.includes('truecolor') || term.includes('xterm-256')) return 16;
    if (term.includes('color') || term.includes('xterm')) return 1;

    // Default to basic color support if TTY
    return this.isTTY() ? 1 : 0;
  },

  /**
   * Check if terminal supports Unicode
   * @returns {boolean}
   */
  supportsUnicode() {
    // Check locale for UTF-8 support
    const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '';
    if (locale.includes('UTF-8') || locale.includes('utf8')) {
      return true;
    }

    // Windows 10+ supports Unicode in console
    if (Platform.isWindows) {
      // Windows 10 version 1903+ supports Unicode
      const version = os.release();
      const [major] = version.split('.').map(Number);
      if (major >= 10) {
        // Check if console supports UTF-8
        return process.env.WT_SESSION !== undefined || // Windows Terminal
               process.env.CONEMUANSI === 'ON'; // ConEmu
      }
      return false;
    }

    // macOS and Linux typically support Unicode
    return Platform.isMac || Platform.isLinux;
  },

  /**
   * Get terminal width in columns
   * @returns {number}
   */
  getWidth() {
    if (process.stdout.columns) {
      return process.stdout.columns;
    }

    // Fallback: try to get from environment
    const columns = process.env.COLUMNS;
    if (columns && !isNaN(parseInt(columns, 10))) {
      return parseInt(columns, 10);
    }

    // Default fallback
    return 80;
  },

  /**
   * Get terminal height in rows
   * @returns {number}
   */
  getHeight() {
    if (process.stdout.rows) {
      return process.stdout.rows;
    }

    // Fallback: try to get from environment
    const rows = process.env.LINES;
    if (rows && !isNaN(parseInt(rows, 10))) {
      return parseInt(rows, 10);
    }

    // Default fallback
    return 24;
  },

  /**
   * Check if terminal supports emoji
   * @returns {boolean}
   */
  supportsEmoji() {
    // Windows 10+ supports emoji in Terminal
    if (Platform.isWindows) {
      return process.env.WT_SESSION !== undefined;
    }

    // macOS and Linux generally support emoji
    return this.supportsUnicode();
  },

  /**
   * Get terminal capabilities as an object
   * @returns {Object}
   */
  getCapabilities() {
    return {
      isTTY: this.isTTY(),
      isCI: this.isCI(),
      isDumb: this.isDumbTerminal(),
      colorSupport: this.getColorSupport(),
      supportsUnicode: this.supportsUnicode(),
      supportsEmoji: this.supportsEmoji(),
      width: this.getWidth(),
      height: this.getHeight(),
      term: process.env.TERM || 'unknown',
      termProgram: process.env.TERM_PROGRAM || 'unknown',
    };
  },

  /**
   * Get appropriate spinner style based on terminal capabilities
   * @returns {string}
   */
  getSpinnerStyle() {
    const caps = this.getCapabilities();

    if (!caps.isTTY || caps.isDumb) {
      return 'none';
    }

    if (caps.colorSupport >= 2) {
      return 'dots'; // Modern terminals with color
    }

    return 'line'; // Basic terminals
  },

  /**
   * Get box drawing characters based on Unicode support
   * @returns {Object}
   */
  getBoxDrawingChars() {
    if (this.supportsUnicode()) {
      return {
        topLeft: '┌',
        topRight: '┐',
        bottomLeft: '└',
        bottomRight: '┘',
        horizontal: '─',
        vertical: '│',
        left: '├',
        right: '┤',
        top: '┬',
        bottom: '┴',
        cross: '┼',
      };
    }

    // Fallback ASCII characters
    return {
      topLeft: '+',
      topRight: '+',
      bottomLeft: '+',
      bottomRight: '+',
      horizontal: '-',
      vertical: '|',
      left: '+',
      right: '+',
      top: '+',
      bottom: '+',
      cross: '+',
    };
  }
};

export default Terminal;
