# 🔄 Long-Running Task System - Implementation Guide

## Overview

This document describes the new long-running task system added to OpenAgent, inspired by Anthropic's research on "Effective harnesses for long-running agents." This system enables OpenAgent to handle complex tasks that span multiple sessions with consistent progress tracking and verification.

## Problem Statement

From Anthropic's research, AI agents face two key failure modes with long-running tasks:

1. **One-shotting**: The agent tries to do everything at once, runs out of context, and leaves work half-done
2. **Premature completion**: Later sessions see partial progress and declare the job done

## Solution Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Long-Running Task System                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ TaskManager  │    │ LongRunning  │    │  Task Tools  │  │
│  │              │◄───│    Agent     │───►│              │  │
│  │ - Features   │    │              │    │ - initialize │  │
│  │ - Progress   │    │ - Planning   │    │ - plan       │  │
│  │ - Sessions   │    │ - Execution  │    │ - track      │  │
│  │ - State      │    │ - Verify     │    │ - complete   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│           │                   │                   │         │
│           ▼                   ▼                   ▼         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              .openagent-tasks/                       │   │
│  │  - progress.json  (session state)                   │   │
│  │  - features.json  (feature list with status)        │   │
│  │  - plan.md        (human-readable plan)             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── agent/
│   ├── TaskManager.js      # Core task management logic
│   ├── LongRunningAgent.js  # Enhanced agent with task support
│   └── AgentSession.js      # Updated with task integration
└── tools/
    └── taskTools.js         # Task management tools for agent

.openagent-tasks/            # Created in working directory
├── progress.json            # Session progress tracking
├── features.json            # Feature list with status
└── plan.md                  # Human-readable plan
```

## Key Concepts

### 1. Feature-Based Development

Tasks are broken down into specific, testable features:

```json
{
  "id": "feature_1",
  "description": "Set up project structure and dependencies",
  "category": "infrastructure",
  "priority": 10,
  "status": "pending",
  "steps": [...],
  "verificationSteps": [...],
  "dependencies": []
}
```

### 2. Feature Status States

| Status | Description |
|--------|-------------|
| `pending` | Not yet started |
| `in_progress` | Currently being worked on |
| `passing` | Completed and verified |
| `failing` | Failed after attempts |
| `blocked` | Waiting on dependencies |
| `skipped` | Intentionally skipped |

### 3. Incremental Work Pattern

```
Session Start
    │
    ▼
┌─────────────────┐
│ Load Progress   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Get Next Feature│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Implement       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Verify & Test   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Mark Complete   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Save Progress   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Git Commit      │
└─────────────────┘
```

## Usage Guide

### Programmatic Usage

```javascript
import { AgentSession } from './src/index.js';

// Create session with task management
const session = new AgentSession({
  workingDir: './my-project',
  model: 'anthropic/claude-sonnet-4',
  verbose: true,
});

// First session - complex task
const result = await session.run(`
Build a REST API with:
1. User authentication
2. CRUD operations
3. Input validation
4. Unit tests
`);

// Check progress
const status = await session.taskManager.getStatus();
console.log(`${status.progress.percentage}% complete`);

// Later session - continues automatically
const result2 = await session.run('Continue working on the API');
```

### CLI Usage

The task management tools are automatically available in the CLI:

```
> Build a web scraper that handles pagination and saves to JSON
```

The agent will:
1. Initialize task tracking
2. Create a feature list
3. Work on features incrementally
4. Save progress between sessions

### Direct Task Manager Usage

```javascript
import { TaskManager } from './src/index.js';

const tm = new TaskManager({ workingDir: './my-project' });

// Initialize
await tm.initialize('Build a CLI tool for file conversion');

// Create features
await tm.createFeatureList([
  {
    description: 'Set up project structure',
    priority: 10,
    steps: ['Create package.json', 'Install dependencies'],
    verificationSteps: ['Run npm start']
  },
  // ... more features
]);

// Get next feature
const feature = await tm.getNextFeature();

// Start working
await tm.startFeature(feature.id);

// Complete with verification
await tm.completeFeature(feature.id, {
  tested: true,
  testResults: 'All tests passing'
});

// Get status
const status = await tm.getStatus();
```

## Task Management Tools

### initialize_task

Initialize a new task environment.

```json
{
  "task": "Build a REST API with authentication and CRUD operations"
}
```

### create_feature_list

Create a prioritized feature list.

```json
{
  "features": [
    {
      "description": "Set up Express server",
      "category": "infrastructure",
      "priority": 10,
      "steps": ["Initialize project", "Install Express"],
      "verificationSteps": ["Server starts without errors"]
    }
  ]
}
```

### get_next_feature

Get and start the next pending feature.

```json
{}
```

### complete_feature

Mark a feature as complete and verified.

```json
{
  "featureId": "feature_1",
  "verification": {
    "tested": true,
    "testResults": "All tests passing",
    "notes": "Added error handling for edge cases"
  }
}
```

### fail_feature

Mark a feature as failed.

```json
{
  "featureId": "feature_2",
  "error": "Database connection failed - need to configure credentials"
}
```

### get_task_status

Get current task status.

```json
{}
```

Response:
```json
{
  "status": "in_progress",
  "task": "Build REST API...",
  "progress": {
    "total": 8,
    "completed": 3,
    "percentage": 38
  },
  "statusCounts": {
    "pending": 4,
    "in_progress": 1,
    "passing": 3,
    "failing": 0
  },
  "currentFeature": {
    "id": "feature_4",
    "description": "Implement user authentication"
  },
  "nextFeature": {
    "id": "feature_5",
    "description": "Add input validation"
  }
}
```

### get_progress_report

Get formatted progress report.

```
## Task Progress Report

**Task**: Build REST API with auth
**Status**: in_progress
**Progress**: 3/8 features (38%)

### Feature Status
- ✅ Passing: 3
- 🔄 In Progress: 1
- ⏳ Pending: 4
- ❌ Failing: 0

### Currently Working On
- **Implement user authentication** (attempt 1)

### All Features
- ✅ **feature_1**: Set up project structure
- ✅ **feature_2**: Create database models
- ✅ **feature_3**: Set up Express server
- 🔄 **feature_4**: Implement user authentication
- ⏳ **feature_5**: Add input validation
...
```

### save_session_progress

Save session progress for next time.

```json
{
  "summary": "Completed authentication system with JWT tokens"
}
```

## Best Practices

### 1. Feature Decomposition

- **Good**: "Implement user registration endpoint with email validation"
- **Bad**: "Build the entire auth system"

### 2. Verification Steps

Always include specific verification steps:
```
"verificationSteps": [
  "Test registration with valid email",
  "Test registration with duplicate email",
  "Test registration with invalid password"
]
```

### 3. Dependencies

Use dependencies to ensure correct order:
```json
{
  "id": "feature_3",
  "dependencies": ["feature_1", "feature_2"]
}
```

### 4. Priority Levels

| Priority | Use For |
|----------|---------|
| 10 | Critical infrastructure |
| 8-9 | Core functionality |
| 5-7 | Important features |
| 3-4 | Nice-to-have features |
| 1-2 | Polish and optimization |

### 5. Git Integration

Always commit after completing features:
```bash
git add .
git commit -m "feat: complete user authentication (feature_4)"
```

### 6. Session Boundaries

Good session ending:
1. Complete current feature (or mark as in-progress if stopping mid-work)
2. Run tests to verify nothing broken
3. Commit changes
4. Save session progress

## Integration with Existing Features

### Subagent Delegation

Task management works seamlessly with subagents:

```javascript
await session.run(`
Use the coder subagent to implement the database models.
After it completes, verify the models work correctly,
then mark feature_2 as complete.
`);
```

### Multi-Agent Pipeline

Combine with pipeline for complex workflows:

```javascript
await session.run(`
Use delegate_pipeline with:
1. architect: Design the API structure
2. coder: Implement the endpoints
3. tester: Write and run tests
4. reviewer: Review the code

After each stage completes, update the feature status.
`);
```

## Troubleshooting

### Task Not Resuming

If task doesn't resume:
1. Check `.openagent-tasks/` directory exists
2. Verify `progress.json` and `features.json` are valid
3. Check working directory is correct

### Features Stuck in Progress

If a feature is stuck:
1. Use `fail_feature` to mark it as failed
2. Try a different approach
3. Break it into smaller sub-features

### Lost Progress

Progress is saved to disk, but also:
1. Use git commits as backup
2. Check `.openagent-tasks/progress.json` for session history
3. Can manually edit feature status if needed

## Future Enhancements

Potential improvements:
- [ ] Automatic feature decomposition from task description
- [ ] Dependency graph visualization
- [ ] Time estimates for features
- [ ] Parallel feature execution
- [ ] Feature templates for common patterns
- [ ] Integration with CI/CD pipelines
- [ ] Collaborative task management (multiple agents)

## References

- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Claude 4 Prompting Guide](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)

---

*Implementation by OpenAgent v4.0 - 2026 Edition*
