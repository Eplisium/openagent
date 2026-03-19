/**
 * Workflow templates and prompt suggestions for OpenAgent CLI
 */

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
// 💡 Smart Prompt Suggestions
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
