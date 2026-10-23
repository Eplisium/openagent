export const DANGEROUS_SHELL_COMMANDS = [
  'rm -rf /', 'rm -r /', 'format c:', 'shutdown /s', 'shutdown /f',
  'restart-computer', 'shutdown /r',
  'git push --force', 'git push -f', 'git reset --hard'
];

// Removed C:\ and D:\ patterns — this is a Windows machine!
// Only block truly dangerous system paths
export const DANGEROUS_FILE_PATTERNS = [
  /^C:\\Windows\\System32/i,
  /^C:\\Windows\\SysWOW64/i,
  /^C:\\Windows\\System/i,
  /^\/etc\//,
  /^\/var\//,
  /^\/usr\/bin\//,
];

export const DANGEROUS_TOOL_NAMES = [
  'delete_file', 'delete_folder',
  'git_force_push',
  'sudo'
];

// Only block truly dangerous arg patterns — allow normal PowerShell syntax
export const DANGEROUS_ARG_PATTERNS = [
  /;\s*rm\s+-rf/i,  // chained destructive rm
  />\s*\/etc\//,     // overwrite system config
  /iex\s*\(/i,       // Invoke-Expression from network
];

export const DEFAULT_PATTERNS = {
  shell: DANGEROUS_SHELL_COMMANDS,
  file: DANGEROUS_FILE_PATTERNS,
  tools: DANGEROUS_TOOL_NAMES,
  args: DANGEROUS_ARG_PATTERNS
};

export function matchesAny(str, patterns) {
  if (!str || !patterns) return false;
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (str.toLowerCase().includes(p.toLowerCase())) return true;
    } else if (p instanceof RegExp) {
      if (p.test(str)) return true;
    }
  }
  return false;
}

export function getDangerReason(toolName, args) {
  const s = typeof args === 'string' ? args : JSON.stringify(args || '');
  if (matchesAny(toolName, DANGEROUS_TOOL_NAMES)) {
    return 'Tool "' + toolName + '" is in the dangerous tools list';
  }
  if (matchesAny(s, DANGEROUS_SHELL_COMMANDS)) {
    return 'Command contains dangerous shell operation';
  }
  return 'Operation flagged by security guard';
}

// ═══════════════════════════════════════════════════════════════════
// Permission-engine integration
//   HARD DENY: catastrophic operations, refused in every mode (incl. auto).
//   GUARDED:   risky operations, always require approval unless the mode is
//              'auto' or an explicit allow rule covers them.
// ═══════════════════════════════════════════════════════════════════

/** Shell commands that are never allowed. */
export const HARD_DENY_SHELL_PATTERNS = [
  /(^|[\s;&|])rm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*r[a-zA-Z]*\s+(-[a-zA-Z]+\s+)*(\/|\/\*|~|~\/|\$HOME)(\s|$)/,
  /(^|[\s;&|])rm\s+(-[a-zA-Z]*\s+)*--no-preserve-root/,
  /(^|[\s;&|])format(\.com)?\s+[a-z]:/i,
  /(^|[\s;&|])mkfs(\.[a-z0-9]+)?\s/i,
  /(^|[\s;&|])dd\s+.*of=\/dev\/(sd|hd|nvme|disk)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /(^|[\s;&|])shutdown(\.exe)?\s+(\/|-)[srhp]/i,
  /(^|[\s;&|])(Stop|Restart)-Computer\b/i,
  /Remove-Item\s+.*-Recurse.*\s['"]?[a-z]:\\?['"]?(\s|$)/i,
  /(^|[\s;&|])(rd|rmdir)\s+\/s\s+(\/q\s+)?[a-z]:\\?(\s|$)/i,
  /(^|[\s;&|])del\s+\/[a-z]\s+.*[a-z]:\\\*?(\s|$)/i,
  /(^|[\s;&|])diskpart\b/i,
  /(^|[\s;&|])bcdedit\b/i,
  /(^|[\s;&|])vssadmin\s+delete\s+shadows/i,
];

/** File paths that tools may never write to. */
export const HARD_DENY_PATH_PATTERNS = [
  /^[a-z]:[\\/]windows[\\/](system32|syswow64|system)([\\/]|$)/i,
  /^\/(etc|usr\/bin|usr\/sbin|bin|sbin|boot)(\/|$)/,
];

/** Shell commands that always need approval outside 'auto' mode. */
export const GUARDED_SHELL_PATTERNS = [
  /\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*r/i,
  /\bRemove-Item\b.*-Recurse/i,
  /(^|[\s;&|])(rd|rmdir)\s+\/s/i,
  /\biex\s*\(|\bInvoke-Expression\b/i,
  /\b(curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(sh|bash|iex|powershell|pwsh)\b/i,
  /\bsudo\b/,
];

/** Returns the command string carried by a call, or null. */
function commandOf(args) {
  return args && typeof args.command === 'string' ? args.command : null;
}

/** Path-like argument values of a call. */
function pathsOf(args) {
  if (!args || typeof args !== 'object') return [];
  return ['path', 'filePath', 'file_path', 'destination', 'target', 'source']
    .map(k => args[k])
    .filter(v => typeof v === 'string' && v);
}

/**
 * Check for catastrophic operations that are refused in every mode.
 * @param {string} toolName
 * @param {object} args
 * @param {{permissionClass?: string}} [ctx]
 * @returns {{denied: boolean, reason: string}}
 */
export function checkHardDeny(toolName, args, ctx = {}) {
  const command = commandOf(args);
  if (command) {
    for (const pattern of HARD_DENY_SHELL_PATTERNS) {
      if (pattern.test(command)) {
        return { denied: true, reason: `Command matches hard-deny guard rule ${pattern}` };
      }
    }
  }
  const cls = ctx.permissionClass;
  if (cls && cls !== 'read') {
    for (const p of pathsOf(args)) {
      if (HARD_DENY_PATH_PATTERNS.some(re => re.test(p))) {
        return { denied: true, reason: `Writes to protected system path "${p}" are never allowed` };
      }
    }
  }
  return { denied: false, reason: '' };
}

/**
 * Check for risky operations that always need explicit approval (or 'auto').
 * @param {string} toolName
 * @param {object} args
 * @returns {{guarded: boolean, reason: string}}
 */
export function checkGuarded(toolName, args) {
  if (matchesAny(toolName, DANGEROUS_TOOL_NAMES.filter(n => n !== 'sudo'))) {
    return { guarded: true, reason: getDangerReason(toolName, args) };
  }
  if (toolName === 'git_push' && args?.force) {
    return { guarded: true, reason: 'Force push rewrites remote history' };
  }
  const command = commandOf(args);
  if (command) {
    for (const pattern of GUARDED_SHELL_PATTERNS) {
      if (pattern.test(command)) {
        return { guarded: true, reason: 'Command contains a dangerous shell operation' };
      }
    }
    if (matchesAny(command, DANGEROUS_SHELL_COMMANDS)) {
      return { guarded: true, reason: 'Command contains a dangerous shell operation' };
    }
  }
  return { guarded: false, reason: '' };
}
