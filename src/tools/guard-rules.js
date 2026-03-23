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