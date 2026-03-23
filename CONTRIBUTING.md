# Contributing to OpenAgent

Thanks for your interest in contributing! This guide covers how to set up development and add new features.

## Development Setup

```bash
# Clone and install
git clone https://github.com/your-fork/OpenAgent.git
cd OpenAgent
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your API keys
```

## Running Tests

```bash
# Run integration tests
npm test

# Run unit tests
npm run test:unit

# Run regression tests
npm run test:regressions
```

## Code Style

- Use ES modules (`import`/`export`)
- Use **camelCase** for variables and functions
- Use **PascalCase** for classes and constructors
- Add JSDoc comments for public APIs
- Test with `node --check <file>` before committing

## Project Structure

```
src/
├── agent/           # Core agent engine
│   ├── Agent.js     # Main agent loop
│   ├── AgentSession.js
│   ├── ContextManager.js
│   ├── SubagentManager.js
│   └── TaskManager.js
├── tools/           # Tool implementations
│   ├── fileTools.js
│   ├── shellTools.js
│   ├── webTools.js
│   └── ...
├── cli.js           # CLI entry point
├── config.js        # Configuration
├── OpenRouterClient.js  # API client
└── logger.js        # Structured logging
```

## Adding a New Tool

1. Create a new file in `src/tools/` (e.g., `myTool.js`)
2. Export an array of tool definitions:

```js
export const myTools = [
  {
    name: 'my_tool',
    description: 'Does something useful',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input description' }
      },
      required: ['input']
    },
    handler: async (args, context) => {
      // Your implementation
      return { result: 'done' };
    }
  }
];
```

3. Register in `src/tools/index.js`

## Adding a New Plugin

Plugins extend core functionality. Create `src/plugins/myPlugin.js`:

```js
export class MyPlugin {
  constructor(client, options = {}) {
    this.client = client;
    this.enabled = options.enabled !== false;
  }

  async onRequest(messages, options) {
    // Pre-request hook
    return { messages, options };
  }

  async onResponse(response) {
    // Post-response hook
    return response;
  }
}
```

## PR Guidelines

1. **Branch** from `main` or `develop`
2. **Test** your changes locally
3. **Document** new features in relevant docs
4. **PR description** should explain:
   - What the change does
   - Why it's needed
   - How to test it

## Common Commands

```bash
npm run cli           # Run CLI
npm run demo          # Run demo
npm run agent         # Agent demo
npm run subagents     # Subagent demo
npm run tools         # Tool calling demo
```