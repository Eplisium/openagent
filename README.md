# 🚀 OpenAgent v4.0

> Production-grade AI agent with 400+ models. 2026 Edition with native fetch, AbortController, and request deduplication. On par with Claude Code, Cursor, and Codex.

[![OpenRouter](https://img.shields.io/badge/OpenRouter-API-00D9FF?style=for-the-badge)](https://openrouter.ai)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-FF006E?style=for-the-badge)](LICENSE)

---

## ✨ What is OpenAgent?

OpenAgent is a **full-featured agentic AI assistant** that runs in your terminal. Like Claude Code, Cursor, and OpenAI Codex, it can:

- 📁 **Read, write, and edit files** in your codebase
- 🖥️ **Execute shell commands** and run scripts
- 🔍 **Search codebases** with regex and semantic search
- 🌐 **Browse the web** and fetch documentation
- 🔀 **Work with git** — status, diff, commit, push, pull
- 🤖 **Use 400+ AI models** via OpenRouter
- 🤝 **Multi-agent orchestration** with specialized subagents
- 💾 **Session management** with checkpoints and history
- ⚡ **Zero-dependency HTTP** using native fetch (undici)
- 🛑 **Request cancellation** via AbortController
- 🔁 **Request deduplication** for identical in-flight requests
- 💰 **Real cost tracking** from API usage data

---

## 🚀 Quick Start

### Installation

```bash
cd "OR Test"
npm install
```

### Configuration

```bash
# Copy example env file
copy .env.example .env

# Edit .env and add your OpenRouter API key
# Get your key at: https://openrouter.ai/keys
```

### Run

```bash
# Interactive CLI (recommended)
npm start

# Or run directly
node src/cli.js
```

---

## 🎯 Features

### 🤖 Agentic Loop

OpenAgent uses the same **gather → act → verify → repeat** loop as Claude Code:

1. **Understand** your request
2. **Plan** the approach
3. **Act** using tools (file ops, shell, web, git)
4. **Verify** the results
5. **Iterate** until complete

### 🛠️ Built-in Tools

| Category | Tools |
|----------|-------|
| **File Operations** | `read_file`, `write_file`, `edit_file`, `list_directory`, `search_in_files`, `get_file_info` |
| **Shell Execution** | `exec`, `exec_background`, `process_status`, `system_info` |
| **Web Access** | `web_search`, `read_webpage`, `fetch_url` |
| **Git Operations** | `git_status`, `git_log`, `git_diff`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_info` |
| **Subagent Delegation** | `delegate_task`, `delegate_parallel`, `delegate_with_synthesis`, `subagent_status` |

### 🤝 Subagent Delegation System

The main agent can **delegate tasks to specialized subagents** for parallel execution:

- **`delegate_task`**: Send a task to a specialized subagent (coder, researcher, file_manager, tester, reviewer, general)
- **`delegate_parallel`**: Run multiple independent tasks simultaneously
- **`delegate_with_synthesis`**: Run parallel tasks and automatically combine results
- **`subagent_status`**: Monitor subagent task progress and statistics

#### Specializations

| Subagent | Best For |
|----------|----------|
| 💻 **Coder** | Writing and editing code |
| 🔍 **Researcher** | Web searches and information gathering |
| 📁 **File Manager** | File operations and organization |
| 🧪 **Tester** | Running tests and validation |
| ✅ **Reviewer** | Code quality review |
| 🤖 **General** | Any task |

### 🔄 Long-Running Task System (NEW!)

OpenAgent now supports **long-running tasks** that span multiple sessions, inspired by Anthropic's research on effective agent harnesses:

#### Key Features

- **📋 Task Planning**: Break complex tasks into specific, testable features
- **📊 Progress Tracking**: Track completion status across sessions
- **🎯 Incremental Work**: Work on ONE feature at a time for consistency
- **✅ Verification**: Require testing before marking features complete
- **💾 Session Persistence**: Resume exactly where you left off
- **🔧 Git Integration**: Use git for recovery and clean state management

#### Task Management Tools

| Tool | Description |
|------|-------------|
| `initialize_task` | Set up task environment and progress tracking |
| `create_feature_list` | Break task into prioritized, testable features |
| `get_next_feature` | Get the next feature to work on (auto-starts it) |
| `complete_feature` | Mark feature as verified and complete |
| `fail_feature` | Mark feature as failed with error details |
| `get_task_status` | View overall progress and current state |
| `get_progress_report` | Get formatted progress report |
| `save_session_progress` | Save session work for next time |

#### How It Works

1. **First Session**: Agent initializes task and creates feature list
2. **Each Session**: Agent checks progress, works on next feature
3. **Feature Completion**: Agent verifies feature works, marks complete
4. **Session End**: Agent saves progress and commits to git
5. **Next Session**: Agent loads progress and continues seamlessly

#### Example Workflow

```javascript
import { AgentSession } from './src/index.js';

const session = new AgentSession({
  workingDir: './my-project',
  model: 'your-model-id', // e.g., 'anthropic/claude-sonnet-4', 'openai/gpt-4o'
});

// First session - complex task
await session.run('Build a REST API with auth, CRUD, and tests');

// Later session - continues where left off
await session.run('Continue working on the API project');

// Check progress anytime
const status = await session.taskManager.getStatus();
console.log(`${status.progress.percentage}% complete`);
```

#### Best Practices for Long Tasks

1. **Be Specific**: Break tasks into concrete, testable features
2. **Work Incrementally**: One feature at a time, fully verified
3. **Use Git**: Commit working states for easy recovery
4. **Track Progress**: Update task status as you work
5. **Verify Everything**: Test features before marking complete
6. **Leave Clean State**: End sessions with codebase ready for next session

### 💾 Session Management

- **Checkpoints**: Save and restore conversation state
- **History**: Persistent session storage
- **Context Management**: Smart context window handling

### 🤝 Multi-Agent Orchestration

- **Pipeline Mode**: Planner → Coder → Reviewer workflow
- **Parallel Mode**: Multiple agents working simultaneously
- **Debate Mode**: Two agents arguing different perspectives
- **Shared Memory**: Agents can share context and findings

---

## 💻 CLI Commands

```
/chat <msg>      - Simple chat (no tools)
/agent <task>    - Run agentic task (with tools)
/pipeline <task> - Multi-agent pipeline (plan→code→review)
/model           - Change AI model
/stream          - Toggle streaming mode
/verbose         - Toggle verbose mode
/tools           - List available tools
/agents          - Show subagent status
/stats           - Show statistics
/clear           - Clear conversation
/save            - Save session
/load            - Load saved session
/history         - Show command history
/info            - Show session info
/help            - Show all commands
/exit            - Exit

! <cmd>          - Run shell command directly
plain text       - Run as agentic task (default)
```

---

## 📁 Project Structure

```
OR Test/
├── src/
│   ├── index.js              # Main entry point & exports
│   ├── cli.js                # Interactive CLI interface
│   ├── OpenRouterClient.js   # Core API client
│   ├── config.js             # Configuration & models
│   ├── utils.js              # UI utilities
│   ├── agent/
│   │   ├── Agent.js          # Core agentic loop engine
│   │   ├── AgentSession.js   # Session & checkpoint manager
│   │   ├── MultiAgent.js     # Multi-agent orchestrator
│   │   └── SubagentManager.js # Subagent delegation manager
│   └── tools/
│       ├── index.js          # Tool exports
│       ├── ToolRegistry.js   # Tool registration & execution
│       ├── fileTools.js      # File operation tools
│       ├── shellTools.js     # Shell execution tools
│       ├── webTools.js       # Web browsing tools
│       ├── gitTools.js       # Git integration tools
│       └── subagentTools.js  # Subagent delegation tools
├── examples/
│   ├── agent-demo.js         # Full agent capabilities demo
│   ├── demo.js               # Feature showcase
│   ├── interactive-chat.js   # CLI chat interface
│   ├── streaming-demo.js     # Streaming showcase
│   ├── tool-calling-demo.js  # Function calling
│   ├── vision-demo.js        # Vision models
│   ├── agents-demo.js        # Multi-agent workflows
│   └── subagent-demo.js      # Subagent delegation demo
├── package.json
├── .env.example
└── README.md
```

---

## 🔥 Usage Examples

### Interactive CLI

```bash
npm start
# Then type your task:
> Read all JavaScript files in src/ and find any bugs
> Create a new React component for user authentication
> Search the web for the latest Node.js security best practices
```

### Programmatic Usage

```javascript
import { Agent, createDefaultRegistry } from './src/index.js';

const registry = createDefaultRegistry();
const agent = new Agent({
  tools: registry,
  model: 'your-model-id', // Must specify a model
});

// Run an agentic task
const result = await agent.run(
  'Read package.json and tell me what dependencies this project uses'
);

console.log(result.response);
console.log(`Iterations: ${result.iterations}`);
console.log(`Tools used: ${result.stats.toolsUsed.join(', ')}`);
```

### Multi-Agent Pipeline

```javascript
import { MultiAgent } from './src/index.js';

const orchestrator = new MultiAgent();

// Plan → Code → Review pipeline
const result = await orchestrator.pipeline(
  'Create a REST API endpoint for user registration with validation'
);

console.log(result.steps.map(s => `${s.role}: ${s.result.response}`));
```

### Subagent Delegation

```javascript
import { AgentSession } from './src/index.js';

const session = new AgentSession({ workingDir: './my-project' });

// The agent can now delegate tasks to subagents automatically!
// Just ask it to do something complex:
const result = await session.run(
  'Research best practices for React performance, then optimize my components'
);
// The agent will:
// 1. Delegate research to a researcher subagent
// 2. Delegate coding to a coder subagent
// 3. Synthesize results
```

### Session Management

```javascript
import { AgentSession } from './src/index.js';

const session = new AgentSession({
  workingDir: '/path/to/project',
  model: 'your-model-id', // Must specify a model
});

// Run with automatic checkpoints
await session.run('Refactor the authentication module');

// Save session
await session.save();

// Later: restore session
const restored = await AgentSession.load('session_123');
```

---

## 🎯 Available Models

### OpenAI
- `openai/gpt-5.4` - Latest frontier model (1M+ context)
- `openai/gpt-5.2` - Fast and capable
- `openai/gpt-5-mini` - Cost-effective
- `openai/o1` - Advanced reasoning

### Anthropic
- `anthropic/claude-opus-4` - Most capable
- `anthropic/claude-sonnet-4` - Balanced (recommended)
- `anthropic/claude-haiku-3` - Fast & cheap

### Google
- `google/gemini-2.5-pro` - Latest Gemini
- `google/gemini-2-flash` - Ultra-fast

### Meta
- `meta/llama-4-maverick` - Latest Llama
- `meta/llama-4-scout` - Efficient

### Open Source
- `deepseek/deepseek-v3`
- `qwen/qwen-2.5-72b`
- `mistral/mistral-large`

See all models at [openrouter.ai/models](https://openrouter.ai/models)

---

## 🆕 What's New in v4.0 (2026 Edition)

| Feature | Description |
|---------|-------------|
| **Native Fetch** | Replaced axios with Node.js native fetch (undici) — zero HTTP dependencies |
| **AbortController** | Full support for cancelling requests and streams |
| **Request Deduplication** | Identical in-flight requests are coalesced automatically |
| **Content-Hashed Cache** | Cache keys use djb2 hash — no collisions, no truncation |
| **Real Cost Tracking** | Uses actual API usage data when available |
| **Subagent Abort** | Parent can abort all running subagents gracefully |
| **Enhanced Streaming** | Proper SSE parsing with mid-stream error handling |
| **Provider Preferences** | Configure latency-optimized provider routing |
| **Long-Running Tasks** | Multi-session task management with progress tracking and feature lists |
| **Task Planning** | Automatic task decomposition into prioritized, testable features |
| **Progress Persistence** | Resume tasks exactly where you left off across sessions |
| **Feature Verification** | Require testing before marking features complete |

---

## 🏗️ Architecture

OpenAgent follows the same architecture principles as Claude Code and Codex:

```
┌─────────────────────────────────────────────────┐
│                   User Input                     │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│              Agent Engine                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ Gather  │→ │  Act    │→ │ Verify  │→ Loop  │
│  │ Context │  │ (Tools) │  │ Results │        │
│  └─────────┘  └─────────┘  └─────────┘        │
└─────────────────────┬───────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌──────────┐ ┌─────────┐ ┌─────────┐
    │  Files   │ │  Shell  │ │   Web   │
    │  Git     │ │ System  │ │ Search  │
    └──────────┘ └─────────┘ └─────────┘
```

---

## 🔒 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | Your API key | **Required** |
| `SITE_URL` | For OpenRouter rankings | `https://localhost` |
| `SITE_NAME` | App name | `OpenAgent` |
| `DEFAULT_MODEL` | Default AI model | `anthropic/claude-sonnet-4` |
| `FALLBACK_MODEL` | Fallback for routing | `anthropic/claude-sonnet-4` |
| `MAX_RETRIES` | Retry attempts | `3` |
| `TIMEOUT_MS` | Request timeout | `300000` |
| `AGENT_MAX_ITERATIONS` | Max agent loops | `30` |
| `MAX_CONTEXT_TOKENS` | Max context window | `800000` |
| `CACHE_TTL_MS` | Cache duration | `300000` (5 min) |

---

## 🤝 Contributing

This is a demonstration project. Feel free to:
- Add new tools
- Improve the agent loop
- Add more agent capabilities
- Extend multi-agent workflows

---

## 📄 License

MIT License - Feel free to use in your projects!

---

## 🔗 Links

- [OpenRouter](https://openrouter.ai)
- [API Docs](https://openrouter.ai/docs)
- [Models](https://openrouter.ai/models)
- [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Streaming Guide](https://openrouter.ai/docs/api/reference/streaming)
- [Latency Best Practices](https://openrouter.ai/docs/guides/best-practices/latency-and-performance)

---

<p align="center">
  <strong>Built with 💙 for the AI community</strong><br>
  <sub>v4.0 - 2026 Edition - Agentic AI for Everyone</sub>
</p>
