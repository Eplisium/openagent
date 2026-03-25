/**
 * 🔍 Cross-Platform OS Detection Module
 * Detects operating system, shell, and platform-specific characteristics
 */

import os from 'os';
import process from 'process';
import { execSync } from 'child_process';

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
   * @returns {'powershell' | 'bash' | 'zsh'}
   */
  getShell() {
    if (this.isWindows) {
      // Check if PowerShell is available, otherwise fallback to cmd
      try {
        execSync('powershell -Command "Write-Host test"', { stdio: 'ignore' });
        return 'powershell';
      } catch {
        return 'cmd';
      }
    }

    // Unix-like systems
    const shell = process.env.SHELL || '';
    if (shell.includes('zsh')) return 'zsh';
    if (shell.includes('bash')) return 'bash';

    // Default fallback
    return 'bash';
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
   */
  normalizeCommand(cmd) {
    if (!cmd) return '';

    // Convert path separators for Windows
    if (this.isWindows) {
      // Replace forward slashes with backslashes in file paths
      cmd = cmd.replace(/([a-zA-Z]:\/[\w\/.\-]+)/g, (match) => {
        return match.replace(/\//g, '\\');
      });

      // Convert Unix-style environment variable expansion ${VAR} to %VAR%
      cmd = cmd.replace(/\$\{(\w+)\}/g, '%$1%');
    } else {
      // Convert Windows-style environment variable expansion %VAR% to ${VAR}
      cmd = cmd.replace(/%(\w+)%/g, '$${$1}');

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
      const fs = await import('fs');
      try {
        Platform.isWSL = fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
      } catch {}
    }
  }
} catch (error) {
  // WSL detection failed, keep default
}

export default Platform;
