/**
 * 🔍 Cross-Platform OS Detection Module
 * Detects operating system, shell, and platform-specific characteristics
 */

import os from 'os';
import process from 'process';
import { execSync } from 'child_process';
import fs from 'fs';

// Cache shell detection result to avoid repeated blocking execSync calls
let _cachedShell = null;

/**
 * Platform detection object with boolean flags and utility functions
 */
export const Platform = {
  // Boolean platform flags
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isWSL: false,  // Will be determined below

  /**
   * Get the appropriate shell for the current platform
   * @returns {'powershell' | 'pwsh' | 'bash' | 'zsh' | 'cmd'}
   */
  getShell() {
    // Return cached result to avoid repeated blocking execSync calls
    if (_cachedShell !== null) {
      return _cachedShell;
    }

    if (this.isWindows) {
      // Check for PowerShell Core (pwsh) first — it's cross-platform and preferred
      try {
        execSync('where pwsh 2>NUL', { stdio: 'ignore', timeout: 3000 });
        _cachedShell = 'pwsh';
        return _cachedShell;
      } catch {
        // Fall back to Windows PowerShell
        try {
          execSync('powershell -Command "Write-Host test"', { stdio: 'ignore', timeout: 3000 });
          _cachedShell = 'powershell';
          return _cachedShell;
        } catch {
          _cachedShell = 'cmd';
          return _cachedShell;
        }
      }
    }

    // Unix-like systems
    const shell = process.env.SHELL || '';
    if (shell.includes('zsh')) _cachedShell = 'zsh';
    else if (shell.includes('bash')) _cachedShell = 'bash';
    else if (shell.includes('fish')) _cachedShell = 'fish';
    else _cachedShell = 'bash'; // Default fallback

    return _cachedShell;
  },

  /**
   * Check if shell is any PowerShell variant (pwsh or powershell)
   * @returns {boolean}
   */
  isPowerShell() {
    const shell = this.getShell();
    return shell === 'powershell' || shell === 'pwsh';
  },

  /**
   * Get executable extension for the current platform
   * @returns {string}
   */
  getExecutableExtension() {
    return this.isWindows ? '.exe' : '';
  },

  /**
   * Normalize a command for the current platform
   * Handles path separators, command syntax, and special characters
   * @param {string} cmd - The command to normalize
   * @returns {string}
  normalizeCommand(cmd) {
    if (!cmd) return '';

    if (this.isWindows) {
      // Replace forward slashes with backslashes in file paths
      // Matches drive-letter paths like C:/foo/bar or D:/path/to/file
      cmd = cmd.replace(/[a-zA-Z]:\/[\w\/.\-]+/g, (match) => {
        return match.replace(/\//g, '\\');
      });
      // Also handle UNC paths: //server/share -> \\server\share
      cmd = cmd.replace(/^\/\/([\w\-\.]+)\//g, '\\\\$1\\');
      // Convert Unix-style environment variable expansion ${VAR} to %VAR%
      cmd = cmd.replace(/\$\{(\w+)\}/g, '%$1%');
    } else {
      // Convert Windows-style environment variable expansion %VAR% to ${VAR}
      cmd = cmd.replace(/%(\w+)%/g, '${$1}');
      // Convert backslashes to forward slashes in file paths (but not in regex)
      cmd = cmd.replace(/\\/g, '/');
    }
    return cmd;
  },

  /**
   * Get the path separator for the current platform
   * @returns {string}
   */
  getPathSeparator() {
    return this.isWindows ? ';' : ':';
  },

  /**
   * Get the end-of-line character(s) for the current platform
   * @returns {string}
   */
  getEOL() {
    return this.isWindows ? '\r\n' : '\n';
  },

  /**
   * Normalize line endings to the platform's native format
   * Handles \r\n (Windows), \r (old Mac), and \n (Unix)
   * @param {string} text - Text to normalize
   * @returns {string}
   */
  normalizeLineEndings(text) {
    if (!text) return '';
    // First normalize everything to \n
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Then convert to platform EOL if Windows
    if (this.isWindows) {
      return normalized.replace(/\n/g, '\r\n');
    }
    return normalized;
  },

  /**
   * Split text into lines handling all line ending formats
   * @param {string} text - Text to split
   * @returns {string[]}
   */
  splitLines(text) {
    if (!text) return [];
    return text.split(/\r?\n/);
  },

  /**
   * Get detailed platform information
   * @returns {Object}
   */
  getPlatformInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      osType: os.type(),
      osRelease: os.release(),
      homeDir: os.homedir(),
      tmpDir: os.tmpdir(),
      user: os.userInfo().username,
      shell: this.getShell(),
      eol: this.getEOL(),
      pathSeparator: this.getPathSeparator(),
      isWSL: this.isWSL,
    };
  }
};

// Detect WSL (Windows Subsystem for Linux) after module loads
try {
  if (Platform.isLinux) {
    const release = os.release().toLowerCase();
    const version = os.version?.() || "";
    Platform.isWSL = release.includes("microsoft") || version.includes("microsoft") ||
                     release.includes("WSL") || version.includes("WSL");

    // Alternative detection: check for WSL-specific files
    if (!Platform.isWSL) {
      try {
        Platform.isWSL = fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
      } catch { /* /proc/version not readable — not WSL */ }
    }
  }
} catch (_error) {
  // WSL detection failed, keep default
}

export default Platform;
