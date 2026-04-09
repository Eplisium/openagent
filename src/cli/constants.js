/**
 * 📋 CLI Constants
 * Workflow templates, command definitions, health checks, and UI constants.
 */

import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════════
// 🎯 Workflow Templates
// ═══════════════════════════════════════════════════════════════════

export const WORKFLOW_TEMPLATES = {
  'code-review': {
    name: '🔍 Code Review',
    description: 'Comprehensive code analysis and improvement suggestions',
    steps: [
      'Analyze the codebase structure and architecture',
      'Review code quality, patterns, and best practices',
      'Check for security vulnerabilities and performance issues',
      'Suggest improvements and refactoring opportunities',
      'Generate a detailed review report'
    ],
    prompt: 'Please perform a comprehensive code review of this project. Focus on code quality, security, performance, and best practices.'
  },
  'bug-fix': {
    name: '🐛 Bug Investigation',
    description: 'Systematic debugging and issue resolution',
    steps: [
      'Analyze error logs and stack traces',
      'Identify root cause of the issue',
      'Examine related code and dependencies',
      'Propose and implement fixes',
      'Test the solution and verify resolution'
    ],
    prompt: 'Help me debug and fix this issue. Please analyze the error, identify the root cause, and provide a working solution.'
  },
  'feature-dev': {
    name: '⚡ Feature Development',
    description: 'End-to-end feature implementation',
    steps: [
      'Understand requirements and scope',
      'Design the feature architecture',
      'Implement core functionality',
      'Add error handling and validation',
      'Write tests and documentation'
    ],
    prompt: 'Help me develop this new feature from start to finish. Please design, implement, test, and document the solution.'
  },
  'refactor': {
    name: '🔧 Code Refactoring',
    description: 'Improve code structure and maintainability',
    steps: [
      'Analyze current code structure',
      'Identify refactoring opportunities',
      'Plan the refactoring strategy',
      'Implement improvements incrementally',
      'Ensure functionality is preserved'
    ],
    prompt: 'Please refactor this code to improve its structure, readability, and maintainability while preserving all functionality.'
  },
  'docs': {
    name: '📚 Documentation',
    description: 'Generate comprehensive project documentation',
    steps: [
      'Analyze project structure and functionality',
      'Create API documentation',
      'Write user guides and tutorials',
      'Generate code comments',
      'Create README and setup instructions'
    ],
    prompt: 'Please create comprehensive documentation for this project including API docs, user guides, and setup instructions.'
  },
  'test-suite': {
    name: '🧪 Test Suite Creation',
    description: 'Build comprehensive test coverage',
    steps: [
      'Analyze code to identify test scenarios',
      'Create unit tests for core functions',
      'Add integration tests',
      'Implement edge case testing',
      'Set up test automation'
    ],
    prompt: 'Please create a comprehensive test suite for this project with unit tests, integration tests, and edge case coverage.'
  }
};

// ═══════════════════════════════════════════════════════════════════
// 🎯 Smart Prompt Suggestions
// ═══════════════════════════════════════════════════════════════════

export const PROMPT_SUGGESTIONS = {
  coding: [
    "Review and improve this code",
    "Debug this error and fix it",
    "Add comprehensive tests",
    "Refactor for better performance",
    "Add error handling and validation",
    "Create documentation for this code",
    "Optimize this algorithm",
    "Add TypeScript types"
  ],
  files: [
    "Analyze this project structure",
    "Find and fix security issues",
    "Clean up unused files",
    "Organize project structure",
    "Create a build system",
    "Add configuration files",
    "Set up development environment"
  ],
  general: [
    "Explain how this works",
    "What are the best practices here?",
    "How can I improve this?",
    "What are potential issues?",
    "Create a step-by-step guide",
    "Compare different approaches"
  ]
};

// ═══════════════════════════════════════════════════════════════════
// 📋 Command & Shortcut Definitions
// ═══════════════════════════════════════════════════════════════════

export const COMMAND_ENTRIES = [
  ['/agent <task>', 'Run agentic task (with tools)'],
  ['/chat <msg>', 'Simple chat (no tools)'],
  ['/templates', 'Browse workflow templates'],
  ['/doctor', 'Environment health check'],
  ['/model', 'Change AI model'],
  ['/model <id>', 'Switch to specific model'],
  ['/stream', 'Toggle chat streaming'],
  ['/verbose', 'Toggle verbose mode'],
  ['/render', 'Toggle markdown rendering'],
  ['/tools', 'List available tools'],
  ['/agents', 'Show subagent system status'],
  ['/stats', 'Show statistics'],
  ['/context', 'Show context usage'],
  ['/new', 'Start a fresh session'],
  ['/clear', 'Clear conversation history'],
  ['/session save [name]', 'Save session checkpoint'],
  ['/session restore <id>', 'Restore session checkpoint'],
  ['/session list', 'List saved sessions'],
  ['/save', 'Save session (alias)'],
  ['/load', 'Load session'],
  ['/history', 'Show command history'],
  ['/paste', 'Capture large multi-line input'],
  ['/cost', 'Show cost breakdown'],
  ['/undo', 'Undo last file change'],
  ['/diff', 'Show pending file changes'],
  ['/export', 'Export conversation as markdown'],
  ['/skills', 'Manage skills (list/create/remove/transfer)'],
  ['/help', 'Show all commands'],
  ['/exit', 'Exit'],
];

export const SHORTCUT_ENTRIES = [
  'q=exit',
  'c=chat',
  'a=agent',
  'n=new',
  'm=model',
  's=stats',
  'h=help',
  'tmp=templates',
  'doc=doctor',
  'u=undo',
  'd=diff',
  'co=cost',
  'ex=export',
];

export const INPUT_SHORTCUT_ENTRIES = [
  '↵ send',
  'Ctrl+O newline',
  'Ctrl+L clear screen',
  'Ctrl+T cycle theme',
  'Ctrl+P session stats',
  'Ctrl+V paste',
  'Ctrl+C copy',
  'Ctrl+K exit',
  'Ctrl+Z undo',
  'Ctrl+A select all',
];

// ═══════════════════════════════════════════════════════════════════
// 🏥 Health Check Diagnostics
// ═══════════════════════════════════════════════════════════════════

export const HEALTH_CHECKS = {
  api: {
    name: 'API Connection',
    check: async (session) => {
      if (!session?.agent?.client) {
        return { status: 'error', message: 'API client not initialized' };
      }
      try {
        await session.agent.client.getModels();
        return { status: 'healthy', message: 'API connection successful' };
      } catch (error) {
        return { status: 'error', message: `API Error: ${error.message}` };
      }
    }
  },
  model: {
    name: 'Model Availability',
    check: async (session) => {
      if (!session?.agent) {
        return { status: 'error', message: 'Agent not initialized' };
      }
      try {
        const model = session.agent.model;
        if (!model) {
          return { status: 'error', message: 'No model selected' };
        }
        return { status: 'healthy', message: `Model: ${model}` };
      } catch (error) {
        return { status: 'error', message: `Model Error: ${error.message}` };
      }
    }
  },
  tools: {
    name: 'Tool Registry',
    check: async (session) => {
      try {
        const registry = session?.toolRegistry || session?.agent?.tools;
        if (!registry) {
          return { status: 'error', message: 'Tool registry not found' };
        }
        const tools = registry.list();
        return {
          status: 'healthy',
          message: `${tools.length} tools available`,
          details: tools.map(t => t.name).join(', ')
        };
      } catch (error) {
        return { status: 'error', message: `Tools Error: ${error.message}` };
      }
    }
  },
  memory: {
    name: 'Memory Usage',
    check: async () => {
      const usage = process.memoryUsage();
      const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const totalMB = Math.round(usage.heapTotal / 1024 / 1024);

      if (usedMB > 500) {
        return { status: 'warning', message: `High memory usage: ${usedMB}MB/${totalMB}MB` };
      }
      return { status: 'healthy', message: `Memory usage: ${usedMB}MB/${totalMB}MB` };
    }
  },
  disk: {
    name: 'Disk Space',
    check: async () => {
      try {
        const fs = await import('fs-extra');
        await fs.default.stat(process.cwd());
        return { status: 'healthy', message: 'Disk access OK' };
      } catch (error) {
        return { status: 'error', message: `Disk Error: ${error.message}` };
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// 🎨 UI Constants
// ═══════════════════════════════════════════════════════════════════

export const DIVIDER = chalk.dim('─'.repeat(Math.max(40, (process.stdout.columns || 80) - 2)));
