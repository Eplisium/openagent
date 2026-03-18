/**
 * 🔄 Long-Running Task Demo
 * Demonstrates how to use OpenAgent for complex, multi-session tasks
 * 
 * This example shows:
 * 1. Task initialization and planning
 * 2. Feature-based development
 * 3. Progress tracking across sessions
 * 4. Verification and completion
 * 5. Session persistence
 */

import { AgentSession, TaskManager } from '../src/index.js';
import chalk from 'chalk';

// Example task: Build a simple REST API
const TASK_DESCRIPTION = `
Build a REST API for a task management system with the following features:
1. User authentication (register, login, logout)
2. Task CRUD operations (create, read, update, delete)
3. Task categories and tags
4. Search and filtering
5. Due dates and reminders
6. API documentation
7. Unit tests
8. Error handling and validation
`;

// Feature list for the task
const FEATURES = [
  {
    description: 'Set up project structure and dependencies',
    category: 'infrastructure',
    priority: 10,
    steps: [
      'Initialize Node.js project with package.json',
      'Install Express, bcrypt, jsonwebtoken, etc.',
      'Set up directory structure (routes, models, middleware)',
      'Create basic server.js entry point'
    ],
    verificationSteps: [
      'Run npm start - server should start without errors',
      'Check that all dependencies are installed'
    ]
  },
  {
    description: 'Implement user authentication system',
    category: 'functional',
    priority: 9,
    steps: [
      'Create User model with email, password, name',
      'Implement password hashing with bcrypt',
      'Create register endpoint with validation',
      'Create login endpoint with JWT token generation',
      'Create logout endpoint (token invalidation)',
      'Add authentication middleware'
    ],
    verificationSteps: [
      'Test register endpoint with valid data',
      'Test login with correct credentials',
      'Test login with wrong password',
      'Test protected route with/without token'
    ],
    dependencies: ['feature_1']
  },
  {
    description: 'Implement task CRUD operations',
    category: 'functional',
    priority: 8,
    steps: [
      'Create Task model with title, description, status, dueDate',
      'Create POST /tasks endpoint (create task)',
      'Create GET /tasks endpoint (list user tasks)',
      'Create GET /tasks/:id endpoint (get single task)',
      'Create PUT /tasks/:id endpoint (update task)',
      'Create DELETE /tasks/:id endpoint (delete task)'
    ],
    verificationSteps: [
      'Create a task via API',
      'List tasks for authenticated user',
      'Update task status',
      'Delete a task'
    ],
    dependencies: ['feature_2']
  },
  {
    description: 'Add task categories and tags',
    category: 'functional',
    priority: 7,
    steps: [
      'Create Category model',
      'Create Tag model',
      'Add category field to Task model',
      'Add tags relationship to Task model',
      'Create endpoints for managing categories',
      'Create endpoints for managing tags'
    ],
    verificationSteps: [
      'Create a category',
      'Assign category to task',
      'Add tags to task',
      'Filter tasks by category'
    ],
    dependencies: ['feature_3']
  },
  {
    description: 'Implement search and filtering',
    category: 'functional',
    priority: 6,
    steps: [
      'Add query parameters for filtering (status, category, dueDate)',
      'Implement text search on task title/description',
      'Add pagination support',
      'Add sorting options'
    ],
    verificationSteps: [
      'Search tasks by keyword',
      'Filter by status',
      'Filter by due date range',
      'Test pagination'
    ],
    dependencies: ['feature_3']
  },
  {
    description: 'Add due dates and reminders',
    category: 'functional',
    priority: 5,
    steps: [
      'Add reminder field to Task model',
      'Create endpoint to set reminders',
      'Implement reminder notification system',
      'Add overdue task detection'
    ],
    verificationSteps: [
      'Set a due date for task',
      'Set a reminder',
      'Check overdue tasks endpoint'
    ],
    dependencies: ['feature_3']
  },
  {
    description: 'Create API documentation',
    category: 'documentation',
    priority: 4,
    steps: [
      'Document all endpoints with examples',
      'Add request/response schemas',
      'Include authentication instructions',
      'Add error code documentation'
    ],
    verificationSteps: [
      'Review documentation for completeness',
      'Test examples from documentation'
    ],
    dependencies: ['feature_3']
  },
  {
    description: 'Write unit tests',
    category: 'testing',
    priority: 3,
    steps: [
      'Set up testing framework (Jest/Mocha)',
      'Write tests for authentication',
      'Write tests for task CRUD',
      'Write tests for search/filtering',
      'Achieve >80% code coverage'
    ],
    verificationSteps: [
      'Run test suite - all tests should pass',
      'Check code coverage report'
    ],
    dependencies: ['feature_5']
  },
  {
    description: 'Implement error handling and validation',
    category: 'functional',
    priority: 2,
    steps: [
      'Add input validation middleware',
      'Create consistent error response format',
      'Add rate limiting',
      'Add request logging'
    ],
    verificationSteps: [
      'Test invalid input handling',
      'Test rate limiting',
      'Check error response format'
    ],
    dependencies: ['feature_3']
  }
];

async function runLongTaskDemo() {
  console.log(chalk.cyan('\n🚀 OpenAgent Long-Running Task Demo\n'));
  console.log(chalk.dim('This demo shows how to use OpenAgent for complex, multi-session tasks.\n'));

  // Check for API key
  if (!process.env.OPENROUTER_API_KEY) {
    console.log(chalk.red('❌ OPENROUTER_API_KEY not set'));
    console.log(chalk.dim('Please set your API key in .env file'));
    return;
  }

  // Create session with task management
  const session = new AgentSession({
    workingDir: process.cwd(),
    model: 'anthropic/claude-sonnet-4', // Or your preferred model
    verbose: true,
    maxIterations: 30,
  });

  console.log(chalk.yellow('📋 Task: Build a REST API for task management'));
  console.log(chalk.dim(`   Features: ${FEATURES.length}`));
  console.log(chalk.dim('   This will be a multi-session task\n'));

  // First, let's check if we have existing progress
  const status = await session.taskManager.getStatus();
  
  if (status.status === 'not_initialized') {
    console.log(chalk.cyan('🔧 Initializing new task...\n'));
    
    // Initialize the task
    await session.taskManager.initialize(TASK_DESCRIPTION);
    
    // Create feature list
    await session.taskManager.createFeatureList(FEATURES);
    
    console.log(chalk.green('✅ Task initialized with features\n'));
  } else {
    console.log(chalk.cyan('📂 Found existing task progress:'));
    console.log(chalk.dim(`   Status: ${status.status}`));
    console.log(chalk.dim(`   Progress: ${status.progress.completed}/${status.progress.total} features\n`));
  }

  // Generate progress report
  const report = await session.taskManager.generateProgressReport();
  console.log(chalk.yellow('📊 Current Progress:'));
  console.log(report);

  // Simulate working on the first feature
  console.log(chalk.cyan('\n🎯 Starting work on first feature...\n'));
  
  const result = await session.run(`
Please help me build a REST API for task management. 

First, check the task status to see where we are, then work on the highest priority pending feature.

Remember:
1. Work on ONE feature at a time
2. Verify it works before marking complete
3. Use git commits to save progress
4. Update task status as you work
`);

  console.log(chalk.green('\n✅ Session complete!'));
  console.log(chalk.dim('   Progress has been saved for next session.'));

  // Show final status
  const finalStatus = await session.taskManager.getStatus();
  console.log(chalk.yellow('\n📊 Final Status:'));
  console.log(chalk.dim(`   Completed: ${finalStatus.progress.completed}/${finalStatus.progress.total} features`));
  console.log(chalk.dim(`   Percentage: ${finalStatus.progress.percentage}%`));
}

// Run the demo
runLongTaskDemo().catch(console.error);
