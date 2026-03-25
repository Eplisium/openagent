# 🚀 OpenAgent v4.2

> Production-grade AI agent with 400+ models, comprehensive Skills System, cross-platform support, and modern Ink UI. On par with Cursor, OpenClaw, and Claude Code.

[![OpenRouter](https://img.shields.io/badge/OpenRouter-API-00D9FF?style=for-the-badge)](https://openrouter.ai)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-FF006E?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20WSL-333)](https://github.com/Eplisium/openagent)
[![Tests](https://img.shields.io/badge/Tests-202%2F202%20Passing-00C853)](https://github.com/Eplisium/openagent)

---

## ✨ What is OpenAgent?

OpenAgent is a **full-featured agentic AI assistant** that runs in your terminal. Like Claude Code, Cursor, and OpenClaw, it can:

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
- 🔌 **Protocol support** — MCP, A2A, and AG-UI

## 🆕 New in v4.2

### 🧩 Skills System (ClawHub-compatible)
- **Registry System** — Discover, install, and manage skills from remote repositories
- **Hot-Reloading** — Automatic skill reloading during development
- **4 Skill Templates** — Basic, Tool, Workflow, and Agent templates
- **Enhanced SKILL.md** — YAML frontmatter with hooks, dependencies, compatibility
- **CLI Commands** — `openagent skills list/search/install/remove/update/create`

### 🌐 Cross-Platform Support (Windows, macOS, Linux, WSL)
- **Platform Detection** — Automatic OS and environment detection
- **Cross-Spawn** — Reliable process spawning on all platforms
- **Path Normalization** — Cross-platform path handling
- **Terminal Capabilities** — Color, Unicode, TTY detection
- **WSL Integration** — Automatic Windows Subsystem for Linux support

### 🖥️ Modern Ink UI (React for CLI)
- **Interactive Chat** — Real-time streaming with markdown rendering
- **5 Themes** — Dark, Light, High Contrast, Monokai, Nord
- **Model Selector** — 400+ models with favorites and cost estimation
- **Skills Browser** — Marketplace interface for skill discovery
- **Memory Viewer** — Graph/list views with search and CRUD
- **Status Dashboard** — Live cost tracking and token usage
- **Keyboard Shortcuts** — Ctrl+N (new), Ctrl+S (save), Ctrl+P (palette), etc.

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
# Modern Ink UI (recommended)
npm run ui

# Or with openagent command
openagent --ui

# Traditional CLI (unchanged)
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

### 🧩 Skills Marketplace

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

### 🖥️ Modern UI

```bash
# Launch with options
openagent --ui --model gpt-4 --theme dark

# Keyboard shortcuts
Ctrl+P    # Command palette
Ctrl+N    # New chat
Ctrl+S    # Save session
Ctrl+B    # Toggle sidebar
Ctrl+T    # Cycle themes
```

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
- **📋 All Models** — Full list with relative release dates

Model cache refreshes every 15 minutes (configurable via `MODEL_CACHE_TTL_MS`).

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
| **Skills Management** | `skill_list`, `skill_search`, `skill_install`, `skill_remove`, `skill_update`, `skill_create` |

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
/ui              - Switch to Ink UI
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
openagent/
├── src/
│   ├── ui/                    # Ink React components (NEW in v4.2)
│   │   ├── App.jsx            # Main application component
│   │   ├── Chat.jsx           # Chat interface
│   │   ├── Layout.jsx         # Layout with sidebar
│   │   ├── ModelSelector.jsx  # Interactive model browser
│   │   ├── SkillsBrowser.jsx  # Skills marketplace
│   │   ├── MemoryViewer.jsx   # Memory visualization
│   │   └── Theme.js           # Theme system (5 themes)
│   ├── skills/                # Skills system (NEW in v4.2)
│   │   ├── SkillRegistry.js   # Registry API integration
│   │   ├── EnhancedSkillParser.js # Advanced YAML parsing
│   │   ├── SkillHotReloader.js # File watcher with debouncing
│   │   └── templates/         # 4 skill templates
│   ├── utils/                 # Cross-platform utilities (NEW in v4.2)
│   │   ├── platform.js        # OS detection module
│   │   └── terminal.js        # Terminal capabilities detection
│   ├── cli.js                 # Traditional CLI entry point
│   ├── cli-ink.js             # Ink UI entry point (NEW in v4.2)
│   ├── config.js              # Configuration & models
│   ├── paths.js               # Cross-platform path utilities
│   └── tools/                 # Built-in tools
├── tests/
│   ├── ui/                    # UI component tests (NEW in v4.2)
│   └── unit/                  # Unit tests (202 total)
├── dist/
│   └── cli-ink.mjs            # Bundled UI (420kb, NEW in v4.2)
├── package.json               # Version 4.2.0
└── README.md                  # This file
```

---

## 🔥 Usage Examples

### Modern Ink UI

```bash
# Launch the interactive UI
openagent --ui

# With custom model and theme
openagent --ui --model gpt-4 --theme monokai

# Keyboard shortcuts
Ctrl+P    # Command palette
Ctrl+N    # New chat
Ctrl+S    # Save session
Ctrl+B    # Toggle sidebar
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

### Traditional CLI

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

---

## 📊 Quality Metrics

| Metric | Value |
|--------|-------|
| **Test Success Rate** | 100% (202/202) |
| **Dependencies** | 358 packages, 0 vulnerabilities |
| **UI Bundle Size** | 420kb (optimized) |
| **Model Support** | 400+ AI models |
| **Cross-Platform** | Windows, macOS, Linux, WSL |
| **Skill Templates** | 4 types (Basic, Tool, Workflow, Agent) |
| **Themes** | 5 options (Dark, Light, High Contrast, Monokai, Nord) |

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
  <sub>v4.2 - 2026 Edition - Agentic AI for Everyone</sub>
</p>
