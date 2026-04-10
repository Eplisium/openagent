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
- 🔍 **Search codebases** with regex-based search (ripgrep-accelerated)
- 🌐 **Browse the web** and fetch documentation
- 🔀 **Work with git** — status, diff, commit, push, pull, branch
- 🤖 **Use 400+ AI models** via OpenRouter
- 🤝 **Multi-agent orchestration** with specialized subagents and parallel execution
- 💾 **Session management** with checkpoints and history
- ⚡ **Zero-dependency HTTP** using native fetch (undici)
- 🛑 **Request cancellation** via AbortController
- 💰 **Real cost tracking** from API usage data
- 🔌 **Protocol support** — MCP, A2A, and AG-UI
- 🧩 **Skills system** with hot-reloading and templates
- 🔌 **Plugin architecture** with manifest validation
- 📊 **Workflow graphs** with HITL interrupts and parallel execution
- 🧠 **AutoGen integration** for multi-agent group chats and teams

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

Skills are filesystem-based instructions loaded on-demand. They support **global** and **project** scopes:

- **Global skills** (`~/.openagent/skills/`) — Available across **all projects** automatically
- **Project skills** (`.openagent/skills/`) — Project-specific, override global with same name

```bash
# List all skills (global + project)
openagent skills list

# List only global or project skills
openagent skills list --global
openagent skills list --project

# Show skill details
openagent skills info code-review

# Create a new skill
openagent skills create my-skill
openagent skills create my-skill --global  # Create as global skill

# Remove a skill (from project only by default — global copy stays)
openagent skills remove my-skill
openagent skills remove my-skill --project  # Remove from project scope only
openagent skills remove my-skill --global   # Remove from global scope only
openagent skills remove my-skill --all      # Remove from ALL scopes (complete delete)

# Transfer a skill between scopes
openagent skills transfer my-skill --from project --to global
openagent skills transfer my-skill --from global --to project

# Transfer between projects
openagent skills transfer my-skill --from project --to /path/to/other-project
openagent skills transfer my-skill --from /path/to/projectA --to /path/to/projectB
```

Built-in skills: `code-review`, `debug`, `refactor`, `testing` — loaded via `use_skill` tool.

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

OpenAgent uses the same **Explore → Plan → Code → Verify** loop as Claude Code:

1. **Explore** — Understand project structure, read relevant files, search for patterns
2. **Plan** — State approach in numbered steps, identify files to modify
3. **Code** — Make minimal, correct changes matching existing style
4. **Verify** — Run tests, lint, type-check, verify compilation
5. **Iterate** — Repeat until complete

Includes circuit breaker, stall detection, no-action trap detection, and automatic retry with backoff.

### 🛠️ Built-in Tools

| Category | Tools |
|----------|-------|
| **File Operations** | `read_file`, `read_files`, `write_file`, `edit_file`, `list_directory`, `search_in_files`, `get_file_info`, `search_and_replace`, `find_files`, `diff_files`, `preview_edit`, `move_file`, `delete_file`, `file_tree` |
| **Shell Execution** | `exec`, `exec_background`, `process_status`, `system_info` |
| **Web Access** | `web_search`, `read_webpage`, `fetch_url` |
| **Git Operations** | `git_status`, `git_log`, `git_diff`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_info` |
| **Subagent Delegation** | `delegate_task`, `delegate_parallel`, `delegate_with_synthesis`, `delegate_pipeline`, `delegate_background`, `delegate_fanout`, `get_background_result`, `await_background`, `list_background_tasks`, `subagent_status`, `send_subagent_message`, `get_subagent_messages`, `set_shared_context`, `get_shared_context` |
| **Memory** | `save_memory`, `get_memory`, `init_memory`, `validate_memory`, `check_retrieval` |
| **Skills** | `use_skill`, `list_skills`, `create_skill` |
| **Task Management** | `initialize_task`, `create_feature_list`, `get_next_feature`, `complete_feature`, `fail_feature`, `get_task_status`, `get_progress_report`, `save_session_progress` |
| **MCP** | `mcp_connect`, `mcp_disconnect`, `mcp_list_tools`, `mcp_call_tool`, `mcp_list_connections` |
| **A2A** | `a2a_start_server`, `a2a_stop_server`, `a2a_discover`, `a2a_send_task`, `a2a_get_task_status`, `a2a_list_tasks`, `a2a_cancel_task`, `a2a_get_status` |
| **AG-UI** | `agui_start`, `agui_stop`, `agui_emit`, `agui_emit_text`, `agui_emit_tool_call`, `agui_emit_run_started`, `agui_emit_run_ended`, `agui_emit_run_error`, `agui_get_subscribers`, `agui_get_status` |
| **Graph** | `graph_list_workflows`, `graph_run`, `graph_resume`, `graph_status`, `graph_list_checkpoints`, `graph_visualize`, `graph_abort` |
| **AutoGen** | `create_group_chat`, `add_agent_to_chat`, `run_group_chat`, `create_team`, `run_team`, `get_autogen_status` |
| **Checkpoints** | Session save/load/export/undo via CLI commands |
| **Plugins** | Plugin lifecycle management |

### 🤝 Subagent Delegation System

The main agent can **delegate tasks to specialized subagents** for parallel execution:

- **`delegate_task`**: Send a task to a specialized subagent (coder, architect, researcher, file_manager, tester, reviewer, general)
- **`delegate_parallel`**: Run multiple independent tasks simultaneously
- **`delegate_with_synthesis`**: Run parallel tasks and automatically combine results
- **`delegate_pipeline`**: Sequential pipeline where each stage uses the previous output (`{{previous}}` references)
- **`delegate_background`**: Fire-and-forget delegation with `get_background_result` / `await_background`
- **`delegate_fanout`**: Fan-out a large task across multiple file groups, each with its own subagent
- **`subagent_status`**: Monitor subagent task progress and statistics
- **`send_subagent_message`** / **`get_subagent_messages`**: Inter-subagent communication
- **`set_shared_context`** / **`get_shared_context`**: Shared data between subagents

#### Specializations

| Subagent | Best For |
|----------|----------|
| 💻 **Coder** | Writing and editing code |
| 🏗️ **Architect** | System design, refactoring plans, project structure |
| 🔍 **Researcher** | Web searches and information gathering |
| 📁 **File Manager** | File operations and organization |
| 🧪 **Tester** | Running tests and validation |
| ✅ **Reviewer** | Code quality review, security audit |
| 🤖 **General** | Any task |

### 🧠 Memory System

OpenAgent includes a persistent memory system inspired by Claude Code:

- **AGENTS.md hierarchy** — Global → project → subdirectory levels
- **OPENAGENT.md** — OpenAgent-specific configuration
- **MEMORY.md** — Agent-written learnings (auto-memory, first 200 lines auto-load)
- **@imports** — Modular context references (up to 5 levels deep)
- **CLAUDE.md** compatibility — Reads existing CLAUDE.md files
- **Memory validation** — MemMA-inspired backward-path validation with probe QA

### 📊 Workflow Graph System

LangGraph-style workflow graphs with HITL (Human-in-the-Loop) interrupts:

```javascript
import { GraphState, WorkflowGraph, START, END } from './src/graph/index.js';

const schema = GraphState.define({
  messages: { default: () => [], reducer: (cur, upd) => [...cur, ...upd] },
  status: { default: 'idle' },
});

const graph = new WorkflowGraph(schema)
  .addNode('agent', agentFn)
  .addNode('tools', toolFn)
  .setEntryPoint('agent')
  .addConditionalEdge('agent', routeFn, { continue: 'tools', end: END })
  .addEdge('tools', 'agent');

const compiled = graph.compile({ verbose: true });
const result = await compiled.invoke({ messages: [{ role: 'user', content: 'Hello' }] });
```

Features: parallel execution, cycle detection, Mermaid visualization, checkpointing, interrupt before/after nodes.

### 🧠 AutoGen Integration

Native AutoGen reimplementation (no Python dependency) for multi-agent orchestration:

- **GroupChat** — Round-robin, random, auto, or manual speaker selection
- **Team** — Supervisor-based team with parallel member execution
- **AutoGenBridge** — Connect to external AutoGen agents
- **EventBus** — Decoupled event-driven communication
- **ConversationManager** — Multi-turn conversation tracking

### 🪝 Hooks System

Deterministic rules that fire at specific lifecycle points (inspired by Claude Code):

- **PreToolUse** — Run before a tool executes (validation, blocking)
- **PostToolUse** — Run after a tool executes (formatting, logging)
- **Stop** — Run when agent stops (cleanup, notifications)

Hooks are MANDATORY — the agent cannot override them. Configured in `.openagent/hooks.json`.

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
/skills          - Manage skills (list/info/create/remove --all/transfer cross-project)
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
│   │   ├── SubagentManager.js    # Subagent lifecycle & parallel execution
│   │   ├── TaskManager.js        # Task tracking & feature lists
│   │   ├── GitCheckpoint.js      # Git-based checkpoints
│   │   ├── WorkspaceManager.js   # Workspace management
│   │   ├── ContextManager.js     # Context window management
│   │   ├── contextAllocator.js   # Hierarchical context allocation
│   │   └── subagents/            # Subagent specializations & UI
│   ├── autogen/                  # AutoGen integration
│   │   ├── AutoGenBridge.js      # External AutoGen connectivity
│   │   ├── GroupChat.js          # Multi-agent group conversations
│   │   ├── Team.js               # Supervisor-based teams
│   │   ├── EventBus.js           # Event-driven communication
│   │   ├── ConversationManager.js # Multi-turn tracking
│   │   ├── FunctionTool.js       # Tool wrapping
│   │   └── UserProxyAgent.js     # Human-in-the-loop agent
│   ├── tools/                    # Built-in tools (40+)
│   │   ├── ToolRegistry.js       # Tool registration & permissions
│   │   ├── ToolGuard.js          # Safety guardrails
│   │   ├── fileTools.js          # File operations (14 tools)
│   │   ├── shellTools.js         # Shell execution
│   │   ├── webTools.js           # Web search & fetch
│   │   ├── gitTools.js           # Git operations
│   │   ├── subagentTools.js      # Subagent delegation (14 tools)
│   │   ├── mcpTools.js           # MCP protocol
│   │   ├── a2aTools.js           # A2A protocol
│   │   ├── aguiTools.js          # AG-UI protocol
│   │   ├── graphTools.js         # Workflow graph control
│   │   ├── memoryTools.js        # Memory operations
│   │   ├── skillTools.js         # Skills management
│   │   ├── taskTools.js          # Task management
│   │   ├── checkpointTools.js    # Session checkpoints
│   │   ├── pluginTools.js        # Plugin management
│   │   ├── fileCache.js          # Stat cache with TTL
│   │   ├── searchCache.js        # Search result caching
│   │   ├── ProcessManager.js     # Background process management
│   │   └── xmlToolParser.js      # XML tool call parser
│   ├── graph/                    # Workflow graph engine
│   │   ├── WorkflowGraph.js      # Graph builder (LangGraph-style)
│   │   ├── CompiledGraph.js      # Runtime execution engine
│   │   ├── GraphState.js         # State schema & management
│   │   ├── ParallelExecutor.js   # Parallel node execution
│   │   ├── InterruptManager.js   # HITL interrupt handling
│   │   ├── checkpointers/        # State persistence
│   │   └── nodes/                # Node types (Agent, Tool, Planning, Subagent, Subgraph)
│   ├── skills/                   # Skills system
│   │   ├── SkillManager.js       # Skill lifecycle
│   │   ├── SkillRegistry.js      # Registry API integration
│   │   ├── EnhancedSkillParser.js # Advanced YAML parsing
│   │   ├── SkillHotReloader.js   # File watcher with debouncing
│   │   └── templates/            # 4 skill templates
│   ├── memory/                   # Memory system
│   │   ├── MemoryManager.js      # Store & retrieve with @imports
│   │   ├── MemoryValidator.js    # MemMA-inspired validation
│   │   └── RetrievalChecker.js   # Relevance scoring
│   ├── protocols/                # Communication protocols
│   │   ├── a2a.js                # Agent-to-Agent protocol
│   │   └── agui.js               # Agent-User Interface (SSE)
│   ├── plugins/                  # Plugin system
│   │   ├── PluginManager.js      # Plugin lifecycle
│   │   ├── Plugin.js             # Plugin base class
│   │   └── PluginManifest.js     # Manifest validation
│   ├── hooks/                    # Lifecycle hooks
│   │   └── HookManager.js        # PreToolUse, PostToolUse, Stop
│   ├── cli/                      # CLI modules
│   │   ├── commands.js           # Command registry & aliases
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
│   │   ├── multilineInput.js     # Multi-line input handling
│   │   ├── markdown.js           # Markdown rendering
│   │   ├── diffViewer.js         # Inline diff display
│   │   ├── syntaxHighlight.js    # Code syntax highlighting
│   │   ├── health.js             # Environment health checks
│   │   ├── stats.js              # Statistics tracking
│   │   ├── ui.js                 # UI components
│   │   ├── templates.js          # Workflow templates
│   │   ├── skills-handler.js     # Skills CLI handler (list/create/remove/transfer)
│   │   └── terminal.js           # Terminal capabilities
│   ├── cli.js                    # CLI entry point (42KB)
│   ├── index.js                  # Library entry point
│   ├── config.js                 # Configuration (170+ settings)
│   ├── OpenRouterClient.js       # API client (undici)
│   ├── ModelBrowser.js           # Interactive model browser
│   ├── inputHandler.js           # Input processing & drag-drop
│   ├── vision.js                 # Multimodal/vision support
│   ├── paths.js                  # Path utilities & protection
│   ├── errors.js                 # Error classes
│   ├── logger.js                 # Logging
│   └── utils.js                  # Shared utilities
├── tests/
│   ├── unit/                     # Unit tests
│   └── ui/                       # UI component tests
├── docs/                         # Documentation (36 files)
├── examples/                     # Usage examples
│   ├── graphs/                   # Workflow graph examples
│   ├── demo.js                   # Basic demo
│   ├── agents-demo.js            # Multi-agent demo
│   ├── streaming-demo.js         # Streaming demo
│   ├── subagent-demo.js          # Subagent delegation demo
│   ├── tool-calling-demo.js      # Tool calling demo
│   └── ...
├── plugins/                      # Built-in plugins
│   └── hello-world/              # Example plugin
├── prompts/                      # Prompt templates
│   └── agent-system.md           # System prompt template
├── fonts/                        # ASCII art fonts
├── express-jwt-api/              # Example JWT API project
├── package.json
├── vitest.config.js
├── eslint.config.js
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
# List all skills (global + project)
openagent skills list

# Show skill details
openagent skills info code-review

# Create a new skill
openagent skills create my-skill
openagent skills create my-skill --global

# Remove a skill (from project only by default — global copy stays)
openagent skills remove my-skill
openagent skills remove my-skill --project   # Remove from project scope only
openagent skills remove my-skill --global    # Remove from global scope only
openagent skills remove my-skill --all       # Remove from ALL scopes (complete delete)

# Transfer between scopes
openagent skills transfer my-skill --from project --to global
openagent skills transfer my-skill --from global --to project

# Transfer between projects
openagent skills transfer my-skill --from project --to /path/to/other-project
```

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

### Workflow Graphs

```javascript
import { GraphState, WorkflowGraph, END } from './src/graph/index.js';

const schema = GraphState.define({
  plan: { default: '' },
  code: { default: '' },
  review: { default: '' },
});

const graph = new WorkflowGraph(schema)
  .addNode('planner', async (state) => ({ plan: 'Implementation plan...' }))
  .addNode('coder', async (state) => ({ code: 'Generated code...' }))
  .addNode('reviewer', async (state) => ({ review: 'Review passed!' }))
  .setEntryPoint('planner')
  .addEdge('planner', 'coder')
  .addEdge('coder', 'reviewer')
  .addEdge('reviewer', END)
  .interruptBefore(['coder']); // Human approval before coding

const compiled = graph.compile();
const result = await compiled.invoke({});
console.log(compiled.toMermaid()); // Visualize the graph
```

### AutoGen Teams

```javascript
import { createTeam, runTeam } from './src/index.js';

const team = createTeam('code-team', {
  supervisor: { name: 'Lead', role: 'Coordinate code review tasks' },
  members: [
    { agent: 'Security Expert', capabilities: ['security', 'vulnerability'] },
    { agent: 'Performance Expert', capabilities: ['optimization', 'profiling'] },
    { agent: 'Style Expert', capabilities: ['linting', 'conventions'] },
  ],
});

const result = await runTeam('code-team', 'Review src/agent/Agent.js for issues');
```

---

## 📊 Quality Metrics

| Metric | Value |
|--------|-------|
| **Dependencies** | 15 production, 3 dev |
| **Model Support** | 400+ AI models via OpenRouter |
| **Cross-Platform** | Windows, macOS, Linux, WSL |
| **Skill Templates** | 4 types (Basic, Tool, Workflow, Agent) |
| **Built-in Tools** | 60+ across 14 categories |
| **Protocols** | MCP, A2A, AG-UI |
| **Source Files** | 111 files, ~1.4MB |
| **Test Coverage** | 137+ tests (Vitest) |

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
│  │ Explore │→ │  Plan   │→ │  Code   │→ Verify │
│  │ Context │  │         │  │ (Tools) │         │
│  └─────────┘  └─────────┘  └─────────┘         │
└─────────────────────┬───────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌──────────┐ ┌─────────┐ ┌─────────┐
    │  Files   │ │  Shell  │ │   Web   │
    │  Git     │ │ System  │ │ Search  │
    └──────────┘ └─────────┘ └─────────┘
          │           │           │
          └───────────┼───────────┘
                      ▼
          ┌───────────────────────┐
          │   Subagent Manager    │
          │  ┌─────┐ ┌─────┐    │
          │  │ Coder│ │Test │    │  Parallel
          │  └─────┘ └─────┘    │  Execution
          │  ┌─────┐ ┌─────┐    │
          │  │ Rev. │ │ Res.│    │
          │  └─────┘ └─────┘    │
          └───────────────────────┘
```

### Key Design Decisions

- **Native fetch (undici)** — Zero axios dependency, better streaming
- **AbortController** — Request/stream cancellation
- **Request deduplication** — Coalesce identical in-flight requests
- **Content-hashed cache keys** — No cache collisions
- **XML tool call parsing** — Reliable tool invocation from any model
- **Hierarchical context allocation** — Smart context window management
- **Circuit breaker** — Graceful degradation on repeated failures
- **Stat cache with TTL** — Eliminate double file stat() calls
- **File tree injection** — Project structure auto-injected into subagent prompts
- **No-action trap detection** — Detects when model describes actions but makes no tool calls
- **Installation protection** — Blocks writes to OpenAgent's own source code

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
| `AGENT_MAX_RUNTIME_MS` | Max runtime per task | `null` (unlimited) |
| `AGENT_MAX_TOOL_CALLS` | Max tool calls per task | `null` (unlimited) |
| `AGENT_MAX_STALL_ITERATIONS` | Stall detection threshold | `10` |
| `MAX_CONTEXT_TOKENS` | Max context window | `800000` |
| `CACHE_TTL_MS` | Cache duration | `600000` (10 min) |
| `DAILY_BUDGET_USD` | Daily spending limit | `50.00` |
| `MAX_COST_PER_REQUEST_USD` | Per-request cost cap | `1.00` |
| `OPENAGENT_HOME` | Override config directory | `~/.openagent` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `CIRCUIT_BREAKER_THRESHOLD` | Consecutive failures before trip | `3` |

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Watch mode
npm run test:watch
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
- CLI regressions

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
