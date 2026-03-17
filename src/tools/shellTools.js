/**
 * 🖥️ Shell Execution Tools
 * Execute commands, manage processes, and interact with the system
 */

import { exec as execCb, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execAsync = promisify(execCb);

/**
 * Execute a shell command
 */
export const execTool = {
  name: 'exec',
  description: 'Execute a shell command and return the output. Use for running scripts, building projects, installing packages, etc.',
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
        description: 'Working directory for the command (default: current directory)',
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
  async execute({ command, cwd = '.', timeout = 30000, env = {} }) {
    try {
      const resolvedCwd = path.resolve(cwd);
      
      // Auto-detect PowerShell vs CMD
      const isPowerShell = detectPowerShell(command);
      const shell = isPowerShell ? 'powershell.exe' : undefined;
      
      const result = await execAsync(command, {
        cwd: resolvedCwd,
        timeout,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024, // 10MB
        encoding: 'utf-8',
        shell,
      });
      
      return {
        success: true,
        stdout: result.stdout,
        stderr: result.stderr,
        command,
        cwd: resolvedCwd,
        exitCode: 0,
        shell: isPowerShell ? 'powershell' : 'cmd',
      };
    } catch (error) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        error: error.message,
        command,
        exitCode: error.code || 1,
      };
    }
  },
};

/**
 * Detect if a command needs PowerShell
 */
export function detectPowerShell(command) {
  // PowerShell-specific commands and patterns
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
 * Execute a command in the background
 */
export const execBackgroundTool = {
  name: 'exec_background',
  description: 'Start a long-running process in the background (servers, watchers, etc). Returns a process ID.',
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
        description: 'Working directory',
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
      const resolvedCwd = path.resolve(cwd);
      const proc = spawn(command, [], {
        cwd: resolvedCwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      
      const pid = proc.pid;
      const procLabel = label || `bg_${pid}`;
      
      // Store process reference globally (simplified)
      if (!global.__bgProcesses) global.__bgProcesses = {};
      global.__bgProcesses[procLabel] = {
        pid,
        proc,
        command,
        cwd: resolvedCwd,
        startTime: Date.now(),
        label: procLabel,
      };
      
      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
        if (output.length > 50000) output = output.slice(-25000);
      });
      proc.stderr.on('data', (data) => {
        output += data.toString();
        if (output.length > 50000) output = output.slice(-25000);
      });
      
      return {
        success: true,
        pid,
        label: procLabel,
        command,
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
export const processStatusTool = {
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
    const processes = global.__bgProcesses || {};
    
    switch (action) {
      case 'list': {
        const list = Object.values(processes).map(p => ({
          label: p.label,
          pid: p.pid,
          command: p.command,
          running: p.proc ? !p.proc.killed : false,
          uptime: Math.round((Date.now() - p.startTime) / 1000) + 's',
        }));
        return { success: true, processes: list };
      }
      
      case 'status': {
        const p = processes[label];
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
        const p = processes[label];
        if (!p) return { success: false, error: `Process "${label}" not found` };
        return {
          success: true,
          label: p.label,
          output: p.output || 'No output captured',
        };
      }
      
      case 'kill': {
        const p = processes[label];
        if (!p) return { success: false, error: `Process "${label}" not found` };
        try {
          p.proc.kill();
          delete processes[label];
          return { success: true, message: `Process "${label}" killed` };
        } catch (e) {
          return { success: false, error: e.message };
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
export const systemInfoTool = {
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
      };
    }
    
    return { success: true, ...info };
  },
};

export const shellTools = [
  execTool,
  execBackgroundTool,
  processStatusTool,
  systemInfoTool,
];

export default shellTools;
