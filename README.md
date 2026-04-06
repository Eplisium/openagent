# 🚀 OpenAgent v0.1.20

> Production-grade AI agent with 400+ models, comprehensive Skills System, cross-platform support, and powerful CLI. On par with Cursor, OpenClaw, and Claude Code.

[![OpenRouter](https://img.shields.io/badge/OpenRouter-API-00D9FF?style=for-the-badge)](https://openrouter.ai)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-FF006E?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20WSL-333)](https://github.com/Eplisium/openagent)

---

## ✨ What is OpenAgent?

OpenAgent is a **full-featured agentic AI assistant** that runs in your terminal. Like Claude Code, Cursor, and OpenClaw, it can:

- 📁 **Read, write, and edit files** in your codebase
- 🖥️ **Execute shell commands** and run scripts
- 🔍 **Search codebases** with regex-based search
- 🌐 **Browse the web** and fetch documentation
- 🔀 **Work with git** — status, diff, commit, push, pull, branch
- 🤖 **Use 400+ AI models** via OpenRouter
- 🤝 **Multi-agent orchestration** with specialized subagents
- 💾 **Session management** with checkpoints and history
- ⚡ **Zero-dependency HTTP** using native fetch (undici)
- 🛑 **Request cancellation** via AbortController
- 💰 **Real cost tracking** from API usage data
- 🔌 **Protocol support** — MCP, A2A, and AG-UI
- 🧩 **Skills system** with hot-reloading and templates
- 🔌 **Plugin architecture** with manifest validation

---

## 🚀 Quick Start

### Installation

```bash
git clone https://github.com/Eplisium/openagent.git
cd openagent
npm install
```

### Configuration

```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your OpenRouter API key
# Get your key at: https://openrouter.ai/keys
```

### Run

```bash
# Start the interactive CLI
npm start

# Or run directly
node src/cli.js
```

### Global Install (use anywhere)

```bash
npm link
openagent    # or just: oagent
```

---

## 🎯 Features

### 🧩 Skills System

```bash
# List installed skills
openagent skills list

# Search for skills
openagent skills search "code review"

# Install a skill
openagent skills install skill-id

# Update all skills
openagent skills update

# Create a new skill
openagent skills create my-skill --type tool
```

Four skill templates available: **Basic**, **Tool**, **Workflow**, and **Agent**.

### 🤖 Model Browser

OpenAgent dynamically fetches **all available models** directly from the OpenRouter API — no hardcoded lists:

- **⭐ Favorites** — Pin your most-used models
- **🕐 Recently Used** — Quick access to your last 20 models
- **🆕 Recently Released** — Browse by newest models first
- **💰 Cheapest** — Sort by input price (includes free models)
- **📏 Largest Context** — Sort by context window size
- **🛠️ Best for Tools** — Filter to tool-calling capable models
- **🏢 Company** — Browse by provider (OpenAI, Anthropic, Google, etc.)
- **🔍 Search** — Fuzzy search across model IDs and names

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
| **File Operations** | `read_file`, `write_file`, `edit_file`, `list_directory`, `search_in_files`, `get_file_info`, `search_and_replace` |
| **Shell Execution** | `exec`, `exec_background`, `process_status`, `system_info` |
| **Web Access** | `web_search`, `read_webpage`, `fetch_url` |
| **Git Operations** | `git_status`, `git_log`, `git_diff`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_info` |
| **Subagent Delegation** | `delegate_task`, `delegate_parallel`, `delegate_with_synthesis`, `subagent_status` |
| **Memory** | `memory_search`, `memory_add`, `memory_list`, `memory_stats` |
| **Skills** | `skill_list`, `skill_search`, `skill_install`, `skill_remove`, `skill_update`, `skill_create` |
| **MCP** | Model Context Protocol tool integration |
| **A2A** | Agent-to-Agent communication |
| **AG-UI** | Agent-User Interface protocol |
| **Graph** | Knowledge graph operations |
| **Checkpoints** | Session checkpoint management |
| **Plugins** | Plugin lifecycle management |

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

### 🧠 Memory System

OpenAgent includes a persistent memory system with:
- **MemoryManager** — Store, retrieve, and search memories
- **MemoryValidator** — Validate memory structure and content
- **RetrievalChecker** — Smart retrieval with relevance scoring

### 🔌 Plugin System

Extend OpenAgent with plugins:
- **PluginManager** — Load, unload, and manage plugin lifecycle
- **PluginManifest** — Validate plugin metadata and dependencies
- **HookManager** — Register hooks for lifecycle events

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
/skills          - Manage skills
/cost            - Show cost breakdown
/context         - Show context usage
/save            - Save session
/load            - Load saved session
/export          - Export session
/undo            - Undo last action
/diff            - Show diff of changes
/history         - Show command history
/templates       - List workflow templates
/doctor          - Health check
/clear           - Clear conversation
/help            - Show all commands
/exit            - Exit

! <cmd>          - Run shell command directly
plain text       - Run as agentic task (default)
```

### Command Aliases

| Alias | Command | Alias | Command |
|-------|---------|-------|---------|
| `q` | exit | `c` | chat |
| `a` | agent | `n` | new |
| `m` | model | `s` | stats |
| `h` | help | `t` | tools |
| `cl` | clear | `st` | stream |
| `v` | verbose | `tmp` | templates |
| `doc` | doctor | `u` | undo |
| `d` | diff | `ex` | export |
| `co` | cost | `ctx` | context |

---

## 📁 Project Structure

```
openagent/
├── src/
│   ├── agent/                    # Agent system
│   │   ├── Agent.js              # Core agent with agentic loop
│   │   ├── AgentSession.js       # Session management
│   │   ├── MultiAgent.js         # Multi-agent orchestration
│   │   ├── SubagentManager.js    # Subagent lifecycle
│   │   ├── TaskManager.js        # Task tracking
│   │   ├── GitCheckpoint.js      # Git-based checkpoints
│   │   ├── WorkspaceManager.js   # Workspace management
│   │   ├── ContextManager.js     # Context window management
│   │   ├── contextAllocator.js   # Hierarchical context allocation
│   │   └── subagents/            # Subagent specializations
│   ├── tools/                    # Built-in tools
│   │   ├── ToolRegistry.js       # Tool registration & permissions
│   │   ├── ToolGuard.js          # Safety guardrails
│   │   ├── fileTools.js          # File operations
│   │   ├── shellTools.js         # Shell execution
│   │   ├── webTools.js           # Web search & fetch
│   │   ├── gitTools.js           # Git operations
│   │   ├── subagentTools.js      # Subagent delegation
│   │   ├── mcpTools.js           # MCP protocol
│   │   ├── a2aTools.js           # A2A protocol
│   │   ├── aguiTools.js          # AG-UI protocol
│   │   ├── graphTools.js         # Knowledge graph
│   │   ├── memoryTools.js        # Memory operations
│   │   ├── skillTools.js         # Skills management
│   │   ├── checkpointTools.js    # Session checkpoints
│   │   ├── pluginTools.js        # Plugin management
│   │   └── xmlToolParser.js      # XML tool call parser
│   ├── skills/                   # Skills system
│   │   ├── SkillManager.js       # Skill lifecycle
│   │   ├── SkillRegistry.js      # Registry API integration
│   │   ├── EnhancedSkillParser.js # Advanced YAML parsing
│   │   ├── SkillHotReloader.js   # File watcher with debouncing
│   │   └── templates/            # 4 skill templates
│   │       ├── basic/
│   │       ├── tool/
│   │       ├── workflow/
│   │       └── agent/
│   ├── memory/                   # Memory system
│   │   ├── MemoryManager.js      # Store & retrieve
│   │   ├── MemoryValidator.js    # Structure validation
│   │   └── RetrievalChecker.js   # Relevance scoring
│   ├── protocols/                # Communication protocols
│   │   ├── a2a.js                # Agent-to-Agent protocol
│   │   └── agui.js               # Agent-User Interface
│   ├── plugins/                  # Plugin system
│   ├── hooks/                    # Lifecycle hooks
│   ├── cli/                      # CLI modules
│   │   ├── commands.js           # Command registry & aliases
│   │   ├── constants.js          # Templates & health checks
│   │   ├── display.js            # Visual output & panels
│   │   ├── sessionOps.js         # Save/load/export/undo
│   │   ├── stateOps.js           # Persistent local state
│   │   ├── formatting.js         # Number/text formatting
│   │   ├── errorUtils.js         # Error categorization
│   │   ├── themes.js             # Theme system
│   │   ├── onboarding.js         # First-run setup
│   │   └── ...
│   ├── utils/                    # Cross-platform utilities
│   │   ├── platform.js           # OS detection
│   │   └── terminal.js           # Terminal capabilities
│   ├── cli.js                    # CLI entry point
│   ├── index.js                  # Library entry point
│   ├── config.js                 # Configuration
│   ├── OpenRouterClient.js       # API client (undici)
│   ├── ModelBrowser.js           # Interactive model browser
│   ├── inputHandler.js           # Input processing
│   ├── vision.js                 # Multimodal/vision support
│   └── paths.js                  # Path utilities
├── tests/
│   ├── unit/                     # Unit tests
│   └── ui/                       # UI component tests (WIP)
├── docs/                         # Documentation
├── examples/                     # Usage examples
├── plugins/                      # Built-in plugins
├── prompts/                      # Prompt templates
├── package.json
├── vitest.config.js
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

### Skills System

```bash
# Search for skills in the marketplace
openagent skills search "docker"

# Install a skill
openagent skills install docker-management

# List installed skills
openagent skills list

# Create your own skill
openagent skills create my-api-wrapper --type tool
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

### Quick Run (no setup)

```javascript
import { quickRun, quickChat } from './src/index.js';

// Agentic task with tools
const result = await quickRun('Summarize all .md files in this directory', {
  model: 'anthropic/claude-sonnet-4',
});

// Simple chat without tools
const reply = await quickChat('What is the capital of France?', {
  model: 'anthropic/claude-sonnet-4',
});
```

---

## 📊 Quality Metrics

| Metric | Value |
|--------|-------|
| **Dependencies** | 17 production, 2 dev |
| **Model Support** | 400+ AI models via OpenRouter |
| **Cross-Platform** | Windows, macOS, Linux, WSL |
| **Skill Templates** | 4 types (Basic, Tool, Workflow, Agent) |
| **Built-in Tools** | 30+ across 12 categories |
| **Protocols** | MCP, A2A, AG-UI |

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

### Key Design Decisions

- **Native fetch (undici)** — Zero axios dependency, better streaming
- **AbortController** — Request/stream cancellation
- **Request deduplication** — Coalesce identical in-flight requests
- **Content-hashed cache keys** — No cache collisions
- **XML tool call parsing** — Reliable tool invocation from any model
- **Hierarchical context allocation** — Smart context window management
- **Circuit breaker** — Graceful degradation on repeated failures

---

## 🔒 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | Your API key | **Required** |
| `SITE_URL` | For OpenRouter rankings | `https://localhost` |
| `SITE_NAME` | App name | `OpenAgent` |
| `FALLBACK_MODEL` | Fallback for routing | `null` |
| `MAX_RETRIES` | Retry attempts | `3` |
| `TIMEOUT_MS` | Request timeout | `120000` (2 min) |
| `AGENT_MAX_ITERATIONS` | Max agent loops | `null` (unlimited) |
| `MAX_CONTEXT_TOKENS` | Max context window | `800000` |
| `CACHE_TTL_MS` | Cache duration | `600000` (10 min) |
| `DAILY_BUDGET_USD` | Daily spending limit | `50.00` |
| `MAX_COST_PER_REQUEST_USD` | Per-request cost cap | `1.00` |
| `OPENAGENT_HOME` | Override config directory | `~/.openagent` |
| `LOG_LEVEL` | Logging verbosity | `info` |

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit
```

Tests use [Vitest](https://vitest.dev/) with 137+ tests covering:
- Tool registry & permissions
- Skill management & registry
- Platform detection
- Web tools
- Memory management
- Hooks system
- XML tool parsing
- Path utilities
- Subagent tools

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

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
  <sub>v0.1.20 - 2026 Edition - Agentic AI for Everyone</sub>
</p>
