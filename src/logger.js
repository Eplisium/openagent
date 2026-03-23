/**
 * 📝 Structured Logger for OpenAgent
 * Zero-dependency, supports JSON (files) and colored text (TTY)
 */

import { CONFIG } from './config.js';

// Log level priorities
const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get color codes for TTY output
 */
function getColors() {
  return {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
  };
}

/**
 * Format timestamp for output
 */
function formatTimestamp() {
  return new Date().toISOString();
}

/**
 * Check if we're in a TTY
 */
function isTTY() {
  return process.stdout.isTTY;
}

/**
 * Logger class
 */
export class Logger {
  constructor(options = {}) {
    this.level = options.level || CONFIG.LOG_LEVEL || 'info';
    this.prefix = options.prefix || 'openagent';
    this.timestamp = options.timestamp !== false;
    this._colors = isTTY() ? getColors() : {};
  }

  /**
   * Create child logger with additional prefix
   */
  child(additionalPrefix) {
    return new Logger({
      level: this.level,
      prefix: this.prefix + ':' + additionalPrefix,
      timestamp: this.timestamp,
    });
  }

  /**
   * Check if a level should be logged
   */
  shouldLog(level) {
    return LEVELS[level] >= LEVELS[this.level];
  }

  /**
   * Format a log entry
   */
  format(level, msg, data) {
    const entry = {
      ts: this.timestamp ? formatTimestamp() : undefined,
      level: level.toUpperCase(),
      msg,
      prefix: this.prefix,
    };

    if (data !== undefined) {
      entry.data = data;
    }

    return entry;
  }

  /**
   * Output the log entry
   */
  output(entry) {
    if (isTTY()) {
      // Human-readable colored output
      const colors = this._colors;
      let line = '';

      if (this.timestamp) {
        line += colors.dim + entry.ts + colors.reset + ' ';
      }

      const levelColor = {
        DEBUG: colors.dim,
        INFO: colors.cyan,
        WARN: colors.yellow,
        ERROR: colors.red,
      }[entry.level] || colors.dim;

      line += levelColor + entry.level.padEnd(5) + colors.reset + ' ';
      line += colors.magenta + '[' + entry.prefix + ']' + colors.reset + ' ';
      line += entry.msg;

      if (entry.data) {
        line += ' ' + colors.dim + JSON.stringify(entry.data) + colors.reset;
      }

      console.log(line);
    } else {
      // JSON output for files
      console.log(JSON.stringify(entry));
    }
  }

  /**
   * Log debug message
   */
  debug(msg, data) {
    if (this.shouldLog('debug')) {
      this.output(this.format('debug', msg, data));
    }
  }

  /**
   * Log info message
   */
  info(msg, data) {
    if (this.shouldLog('info')) {
      this.output(this.format('info', msg, data));
    }
  }

  /**
   * Log warning
   */
  warn(msg, data) {
    if (this.shouldLog('warn')) {
      this.output(this.format('warn', msg, data));
    }
  }

  /**
   * Log error
   */
  error(msg, data) {
    if (this.shouldLog('error')) {
      this.output(this.format('error', msg, data));
    }
  }

  /**
   * Log tool call (specialized)
   */
  tool(name, args, result, duration) {
    if (!this.shouldLog('debug')) return;

    const data = {
      tool: name,
    };

    if (args) data.args = args;
    if (result !== undefined) data.result = result;
    if (duration) data.duration = duration + 'ms';

    this.output(this.format('debug', 'tool call', data));
  }

  /**
   * Log API call (specialized)
   */
  api(method, url, duration, status) {
    if (!this.shouldLog('debug')) return;

    const data = {
      method,
      url: url.replace(/api-key=[^&]+/g, 'api-key=***'), // Hide API key
    };

    if (duration) data.duration = duration + 'ms';
    if (status) data.status = status;

    this.output(this.format('debug', 'api call', data));
  }
}

// Default logger instance
export const logger = new Logger();

export default logger;