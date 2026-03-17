# 🚀 OpenAgent Changelog

## v3.0.0 - Production-Grade Release

### 🎯 Major Improvements

#### Agent Engine (`Agent.js`)
- **Enhanced Error Handling**: New custom error types (`AgentError`, `ToolExecutionError`, `ContextOverflowError`)
- **Retry Logic**: Automatic retry with exponential backoff for failed tool executions
- **Performance Metrics**: Track iterations, tool calls, errors, retries, and execution times
- **State Management**: Agent now tracks state (idle, running, paused, error, completed)
- **Parallel Tool Execution**: Independent tools (reads, searches) execute in parallel for speed
- **Improved Token Estimation**: More accurate estimation that accounts for code vs text
- **Checkpoint System**: Save and restore agent state during execution
- **New Callbacks**: `onIterationStart`, `onIterationEnd`, `onError` for better monitoring

#### OpenRouter Client (`OpenRouterClient.js`)
- **Request Caching**: Automatic caching of identical requests (5min TTL, configurable)
- **Rate Limit Handling**: Tracks rate limit headers and throttles requests accordingly
- **Budget Controls**: Track spending with configurable budget limits
- **Request Queue**: Prevents overwhelming the API with too many concurrent requests
- **Jitter in Retries**: Adds random jitter to prevent thundering herd on retries
- **Enhanced Stats**: Cache size, budget usage, rate limit remaining, avg duration

#### Tool Registry (`ToolRegistry.js`)
- **Input Validation**: Validates tool arguments against schema before execution
- **Timeout Handling**: Configurable timeouts for tool execution (default 30s)
- **Error Categorization**: Tools now return specific error types for better handling
- **Execution Statistics**: Track usage count per tool, success rates, avg duration
- **Tool Enable/Disable**: Dynamically enable/disable tools at runtime
- **Category Filtering**: Get tools by category
- **Sanitized Logging**: Automatically removes sensitive data from logs

#### CLI (`cli.js`)
- **Command Aliases**: Short aliases for common commands (q=exit, c=chat, a=agent, etc.)
- **Context Usage Display**: Shows context usage percentage in the prompt
- **Cost Tracking**: New `/cost` command to view spending breakdown
- **Session Reset**: New `/reset` command to clear everything
- **Auto-Save**: Automatic session saving every 5 minutes
- **Better Error Messages**: More informative error display
- **Performance Display**: Shows retry counts and timing info

#### Configuration (`config.js`)
- **More Models**: Added GPT-4o, O1-mini, Claude 3.5 Sonnet, Qwen Coder, etc.
- **New Categories**: Added BALANCED, AGENTS categories for better model selection
- **Performance Presets**: FAST, BALANCED, QUALITY, CODING presets
- **Better Defaults**: Claude Sonnet 4 as default (best for agents)
- **Extended Timeouts**: 2 minute default timeout for complex tasks
- **More Config Options**: Tool timeout, cache TTL, request intervals, etc.

### 🛠️ New Features

#### Quick Functions
```javascript
import { quickRun, quickChat, createAgent } from 'openagent';

// Quick one-off task
const result = await quickRun('Read package.json and summarize dependencies');

// Quick chat without tools
const response = await quickChat('What is the capital of France?');

// Create custom agent
const agent = await createAgent({ model: 'anthropic/claude-opus-4' });
```

#### Performance Presets
```javascript
import { PRESETS } from 'openagent';

// Use preset configurations
const agent = new Agent(PRESETS.CODING);  // Optimized for coding
const agent = new Agent(PRESETS.FAST);    // Optimized for speed
```

#### Minimal Registry (for testing)
```javascript
import { createMinimalRegistry } from 'openagent';

// Read-only tools, no shell/network access
const registry = createMinimalRegistry();
```

### 📊 Performance Improvements

- **Parallel Tool Execution**: Up to 3x faster for multi-file operations
- **Request Caching**: Eliminates redundant API calls
- **Better Context Management**: Smarter compaction reduces token usage
- **Optimized Retry Logic**: Faster recovery from transient failures

### 🔒 Security Improvements

- **Input Validation**: Prevents malformed tool arguments
- **Sanitized Logging**: Sensitive data removed from logs
- **Timeout Protection**: Prevents runaway tool executions
- **Budget Limits**: Prevents accidental overspending

---

## v2.0.0 - Multi-Agent Release

- Subagent delegation system
- Multi-agent orchestration
- Pipeline, parallel, and debate modes
- Session management with checkpoints
- Model browser with favorites

## v1.0.0 - Initial Release

- Core agent loop
- Tool calling system
- File, shell, web, git tools
- Streaming support
- Interactive CLI
