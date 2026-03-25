/**
 * 🖥️ Shell Execution Tools
 * Execute commands, manage processes, and interact with the system
 * Cross-platform compatible using cross-spawn
 */

import { exec as execCb } from 'child_process';
import crossSpawn from 'cross-spawn';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { buildOpenAgentEnv, createPathContext, resolveAgentPath } from '../paths.js';
import { CONFIG } from '../config.js';
import { ProcessManager } from './ProcessManager.js';
import { Platform } from '../utils/platform.js';

const defaultProcessManager = new ProcessManager();

const execAsync = promisify(execCb);
const PATH_PREFIX_NOTE = 'Supports project:, workdir:, and workspace: prefixes.';

/**
 * Sanitize command to prevent shell injection
 *
 * Only blocks TRULY dangerous patterns — allows normal PowerShell syntax.
 * This is a Windows-first implementation that understands PowerShell semantics.
 */
function sanitizeCommand(command) {
  if (!command || typeof command !== 'string') {
    throw new Error('Command must be a non-empty string');
  }
  
  // Normalize for checking
  const lower = command.toLowerCase().trim();
  
  // ═══════════════════════════════════════════════════════════════
  // 🚫 HARD BLOCKS — Truly dangerous, never allow
  // ═══════════════════════════════════════════════════════════════
  
  // Destructive operations on root filesystem
  if (/rm\s+-rf\s+[\/\\]\s*$/i.test(lower)) return block(command, 'Recursive delete on root');
  if (/rm\s+-r\s+[\/\\]\s*$/i.test(lower)) return block(command, 'Recursive delete on root');
  
  // Format drive (with force flags)
  if (/format\s+[a-z]:\s*\/[yq]/i.test(lower)) return block(command, 'Format drive with force');
  
  // System shutdown/reboot (with force flags)
  if (/\bshutdown\s+\/[sf]\b/i.test(lower)) return block(command, 'Force shutdown');
  if (/restart-computer\s+-force/i.test(lower)) return block(command, 'Force restart');
  
  // Fork bombs
  if (/:\(\)\s*\{/.test(lower)) return block(command, 'Fork bomb');
  if (/:\(\)\|:/.test(lower)) return block(command, 'Fork bomb');
  
  // Infinite loops that consume resources
  if (/while\s*\(\s*true\s*\)\s*\{.*write/i.test(lower)) return block(command, 'Infinite write loop');
  if (/while\s*\(\s*1\s*\)\s*\{.*write/i.test(lower)) return block(command, 'Infinite write loop');
  
  // Download and execute (malware pattern) — but allow Invoke-WebRequest/Invoke-RestMethod for data
  if (/iex\s*\(\s*(new-object\s+net\.webclient|irm|curl.*\|\s*iex)/i.test(lower)) {
    return block(command, 'Download and execute');
  }
  if (/Invoke-Expression\s*\(\s*(New-Object\s+Net\.WebClient|irm|curl)/i.test(lower)) {
    return block(command, 'Download and execute');
  }
  
  // Pipe to shell from network
  if (/\|\s*(bash|sh)\s*$/i.test(lower)) return block(command, 'Pipe to shell');
  if (/\|\s*iex\s*$/i.test(lower)) return block(command, 'Pipe to Invoke-Expression');
  
  // Mass file deletion
  if (/remove-item\s+.*-recurse\s+-force/i.test(lower)) return block(command, 'Mass delete with force');
  if (/rm\s+-rf\s+\*/i.test(lower)) return block(command, 'Delete all files');
  
  // Registry destruction
  if (/remove-item\s+.*HKLM:\\SYSTEM/i.test(lower)) return block(command, 'Delete system registry');
  if (/remove-item\s+.*HKLM:\\SOFTWARE/i.test(lower)) return block(command, 'Delete software registry');
  
  // Process killing sprees
  if (/stop-process\s+-name\s+\*/i.test(lower)) return block(command, 'Kill all processes');
  if (/taskkill\s+\/f\s+\/im\s+\*/i.test(lower)) return block(command, 'Kill all processes');
  
  // All clear — command is safe
  return command;
}

/**
 * Block a command with a reason
 */
function block(command, reason) {
  throw new Error(`🛡️ Blocked: ${reason}. Command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`);
}

/**
 * Detect if a command needs PowerShell
 */
export function detectPowerShell(command) {
  // On non-Windows, PowerShell detection doesn't apply
  if (!Platform.isWindows) {
    return false;
  }
  
  const psPatterns = [
    /^Get-/i, /^Set-/i, /^New-/i, /^Remove-/i, /^Invoke-/i,
    /^Start-/i, /^Stop-/i, /^Test-/i, /^Write-/i, /^Read-/i,
    /^Import-/i, /^Export-/i, /^Out-/i, /^Select-/i, /^Where-/i,
    /^ForEach-/i, /^Sort-/i, /^Measure-/i, /^Compare-/i,
    /\|\s*(Format-|Select-|Where-|Sort-|Measure-|ConvertTo-|ConvertFrom-)/i,
    /@\{/, /\$\(/, /\$_\./,
    /-AutoSize/, /-List/, /-Table/, /-Property/,
    /\[math\]::Round/, /\[math\]::Floor/, /\[math\]::Ceiling/,
    /Get-CimInstance/i, /Get-WmiObject/i, /Get-PSDrive/i,
    /Get-Process/i, /Get-Service/i, /Get-EventLog/i,
    /Get-Counter/i, /Get-NetAdapter/i, /Get-NetIPAddress/i,
  ];

  return psPatterns.some(pattern => pattern.test(command));
}

/**
 * Escape a path for safe shell usage on the current platform
 * @param {string} filePath - The path to escape
 * @returns {string}
 */
export function escapeShellPath(filePath) {
  if (!filePath) return '';
  
  if (Platform.isWindows) {
    // Windows: wrap in double quotes if contains spaces
    if (filePath.includes(' ') || filePath.includes('(') || filePath.includes(')')) {
      return `"${filePath}"`;
    }
    return filePath;
  } else {
    // Unix: escape special characters and wrap in single quotes
    return `'${filePath.replace(/'/g, "'\''")}'`;
  }
}

/**
 * Get the appropriate shell for executing commands
 * @returns {{ shell: string, args: string[] }}
 */
export function getExecutionShell() {
  if (Platform.isWindows) {
    // On Windows, try PowerShell first, fallback to cmd.exe
    const shell = Platform.getShell();
    if (shell === 'powershell') {
      return { shell: 'powershell.exe', args: ['-NoProfile', '-Command'] };
    }
    return { shell: 'cmd.exe', args: ['/c'] };
  } else {
    // On Unix, use the default shell
    return { shell: process.env.SHELL || '/bin/sh', args: ['-c'] };
  }
}

export function createShellTools(options = {}) {
  const processManager = options.processManager || defaultProcessManager;
  const pathContext = createPathContext(options);
  const resolvePathForAgent = pathContext.resolvePath;
  const buildToolEnv = (extraEnv = {}) => ({
    ...process.env,
    ...buildOpenAgentEnv({
      baseDir: pathContext.getBaseDir(),
      workspaceDir: pathContext.getWorkspaceDir(),
    }),
    ...extraEnv,
  });

  const execTool = {
    name: 'exec',
    description: `Execute a shell command and return the output. Use for running scripts, builds, or tests. ${PATH_PREFIX_NOTE}`,
    category: 'shell',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: `Working directory for the command (default: project root). ${PATH_PREFIX_NOTE}`,
        },
        timeout: {
          type: 'integer',
          description: 'Timeout in milliseconds (default: 30000)',
        },
        env: {
          type: 'object',
          description: 'Environment variables to set',
        },
      },
      required: ['command'],
    },
    async execute({ command, cwd = '.', timeout = CONFIG.EXEC_DEFAULT_TIMEOUT_MS, env = {} }) {
      try {
        // Validate and sanitize command
        const sanitizedCommand = sanitizeCommand(command);
        
        const resolvedCwd = resolvePathForAgent(cwd);

        // Get platform-appropriate shell configuration
        const { shell, args } = getExecutionShell();
        const isPowerShell = Platform.isWindows && shell.includes('powershell');
        
        // Create abort controller for timeout
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, timeout);
        
        try {
          const result = await execAsync(sanitizedCommand, {
            cwd: resolvedCwd,
            timeout,
            env: buildToolEnv(env),
            maxBuffer: CONFIG.EXEC_MAX_BUFFER_BYTES,
            encoding: 'utf-8',
            shell,
          });
          
          clearTimeout(timeoutId);

          return {
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            command,
            cwd: resolvedCwd,
            exitCode: 0,
            shell: isPowerShell ? 'powershell' : Platform.isWindows ? 'cmd' : 'unix',
          };
        } catch (error) {
          clearTimeout(timeoutId);
          
          // Check if it was a timeout
          if (error.killed || error.code === 'ETIMEDOUT') {
            return {
              success: false,
              stdout: error.stdout || '',
              stderr: error.stderr || '',
              error: `Command timed out after ${timeout}ms`,
              command,
              exitCode: 124, // Standard timeout exit code
              timedOut: true,
            };
          }
          
          return {
            success: false,
            stdout: error.stdout || '',
            stderr: error.stderr || '',
            error: error.message,
            command,
            exitCode: error.code || 1,
          };
        }
      } catch (error) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          error: error.message,
          command,
          exitCode: 1,
        };
      }
    },
  };

/**
 * Execute a command in the background
 */
  const execBackgroundTool = {
    name: 'exec_background',
    description: `Start a long-running process in the background (servers, watchers, etc). ${PATH_PREFIX_NOTE}`,
    category: 'shell',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to run in background',
        },
        cwd: {
          type: 'string',
          description: `Working directory (default: project root). ${PATH_PREFIX_NOTE}`,
        },
        label: {
          type: 'string',
          description: 'Label for the process',
        },
      },
      required: ['command'],
    },
    async execute({ command, cwd = '.', label }) {
      try {
        // Validate and sanitize command
        const sanitizedCommand = sanitizeCommand(command);
        
        const resolvedCwd = resolvePathForAgent(cwd);
        
        // Use cross-spawn for cross-platform process spawning
        // cross-spawn handles Windows cmd.exe quirks automatically
        const proc = crossSpawn(sanitizedCommand, [], {
          cwd: resolvedCwd,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: buildToolEnv(),
          // Windows-specific options
          windowsVerbatimArguments: Platform.isWindows,
        });

        const pid = proc.pid;
        const procLabel = label || `bg_${pid}`;

        processManager.add(procLabel, {
          pid,
          proc,
          command: sanitizedCommand,
          cwd: resolvedCwd,
          startTime: Date.now(),
          label: procLabel,
        });

        let output = '';
        
        // Handle stdout
        proc.stdout.on('data', data => {
          output += data.toString();
          if (output.length > CONFIG.BG_PROCESS_OUTPUT_LIMIT) output = output.slice(-CONFIG.BG_PROCESS_OUTPUT_TRIM);
          const p = processManager.get(procLabel);
          if (p) {
            p.output = output;
          }
        });
        
        // Handle stderr
        proc.stderr.on('data', data => {
          output += data.toString();
          if (output.length > CONFIG.BG_PROCESS_OUTPUT_LIMIT) output = output.slice(-CONFIG.BG_PROCESS_OUTPUT_TRIM);
          const p = processManager.get(procLabel);
          if (p) {
            p.output = output;
          }
        });
        
        // Handle process errors
        proc.on('error', err => {
          const p = processManager.get(procLabel);
          if (p) {
            p.error = err.message;
            p.output = (p.output || '') + `\n[ERROR] ${err.message}`;
          }
        });
        
        // Handle process exit
        proc.on('exit', (code, signal) => {
          const p = processManager.get(procLabel);
          if (p) {
            p.exitCode = code;
            p.signal = signal;
            p.running = false;
          }
        });

        return {
          success: true,
          pid,
          label: procLabel,
          command: sanitizedCommand,
          cwd: resolvedCwd,
          message: `Process started with PID ${pid}`,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

/**
 * Check background process status
 */
  const processStatusTool = {
    name: 'process_status',
    description: 'Check status of background processes, get their output, or kill them.',
    category: 'shell',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'status', 'output', 'kill'],
          description: 'Action to perform',
        },
        label: {
          type: 'string',
          description: 'Process label (for status/output/kill)',
        },
      },
      required: ['action'],
    },
    async execute({ action, label }) {
      switch (action) {
        case 'list': {
          const list = processManager.list().map(p => ({
            label: p.label,
            pid: p.pid,
            command: p.command,
            running: p.proc ? !p.proc.killed : false,
            uptime: Math.round((Date.now() - p.startTime) / 1000) + 's',
          }));
          return { success: true, processes: list };
        }

        case 'status': {
          const p = processManager.get(label);
          if (!p) return { success: false, error: `Process "${label}" not found` };
          return {
            success: true,
            label: p.label,
            pid: p.pid,
            running: p.proc ? !p.proc.killed : false,
            uptime: Math.round((Date.now() - p.startTime) / 1000) + 's',
          };
        }

        case 'output': {
          const p = processManager.get(label);
          if (!p) return { success: false, error: `Process "${label}" not found` };
          return {
            success: true,
            label: p.label,
            output: p.output || 'No output captured',
          };
        }

        case 'kill': {
          const p = processManager.get(label);
          if (!p) return { success: false, error: `Process "${label}" not found` };
          try {
            // Use platform-appropriate kill signal
            if (Platform.isWindows) {
              // On Windows, taskkill is more reliable
              p.proc.kill('SIGTERM');
            } else {
              // On Unix, use SIGTERM followed by SIGKILL if needed
              p.proc.kill('SIGTERM');
            }
            processManager.remove(label);
            return { success: true, message: `Process "${label}" killed` };
          } catch (error) {
            return { success: false, error: error.message };
          }
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    },
  };

/**
 * Get system information
 */
  const systemInfoTool = {
    name: 'system_info',
    description: 'Get information about the system: OS, CPU, memory, disk, network.',
    category: 'shell',
    parameters: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['all', 'os', 'cpu', 'memory', 'disk', 'network', 'env'],
          description: 'What info to retrieve (default: all)',
        },
      },
    },
    async execute({ what = 'all' }) {
      const info = {};

      if (what === 'all' || what === 'os') {
        info.os = {
          platform: os.platform(),
          type: os.type(),
          release: os.release(),
          arch: os.arch(),
          hostname: os.hostname(),
          uptime: Math.round(os.uptime() / 3600) + 'h',
          isWindows: Platform.isWindows,
          isMac: Platform.isMac,
          isLinux: Platform.isLinux,
          isWSL: Platform.isWSL,
        };
      }

      if (what === 'all' || what === 'cpu') {
        const cpus = os.cpus();
        info.cpu = {
          model: cpus[0]?.model || 'Unknown',
          cores: cpus.length,
          speed: cpus[0]?.speed + 'MHz',
        };
      }

      if (what === 'all' || what === 'memory') {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        info.memory = {
          total: Math.round(totalMem / 1024 / 1024 / 1024) + 'GB',
          free: Math.round(freeMem / 1024 / 1024 / 1024) + 'GB',
          used: Math.round((totalMem - freeMem) / 1024 / 1024 / 1024) + 'GB',
          usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100) + '%',
        };
      }

      if (what === 'all' || what === 'env') {
        info.env = {
          user: os.userInfo().username,
          home: os.homedir(),
          tmpdir: os.tmpdir(),
          shell: process.env.SHELL || process.env.COMSPEC || 'Unknown',
          path: process.env.PATH?.split(path.delimiter).slice(0, 5).join(', ') + '...',
          openagentWorkingDir: pathContext.getBaseDir(),
          openagentWorkspaceDir: pathContext.getWorkspaceDir(),
          platform: Platform.getPlatformInfo(),
        };
      }

      return { success: true, ...info };
    },
  };

  return [
    execTool,
    execBackgroundTool,
    processStatusTool,
    systemInfoTool,
  ];
}

const defaultShellTools = createShellTools();

export const [
  execTool,
  execBackgroundTool,
  processStatusTool,
  systemInfoTool,
] = defaultShellTools;

export const shellTools = defaultShellTools;

export { ProcessManager, defaultProcessManager };
