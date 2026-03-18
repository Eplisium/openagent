# Autonomous Runs and Task Workspaces

OpenAgent now defaults to a more autonomous execution model and keeps its own scratch files under a dedicated `.openagent/` home instead of scattering them across the project root.

## What Changed

### 1. Run until done by default

The core agent loop no longer defaults to a fixed 30-iteration cap.

- `AGENT_MAX_ITERATIONS=0`, `auto`, `unlimited`, or unset: no fixed iteration ceiling
- The agent now stops when:
  - the model returns a final answer with no more tool calls
  - it reaches an optional runtime limit
  - it reaches an optional tool-call limit
  - it appears to be repeating the same tool workflow without progress

### 2. Dedicated OpenAgent home

OpenAgent now stores its own state under:

```text
.openagent/
├── sessions/
├── task-state/
└── workspaces/
    └── <timestamp-task-slug>/
        ├── manifest.json
        ├── notes/
        ├── artifacts/
        └── scratch/
```

This keeps session saves, task progress, and generated artifacts out of the repo root.

### 3. Task workspace path prefixes

The built-in file, shell, and git tools now understand these path prefixes:

- `workspace:` for scratch files inside the active task workspace
- `project:` for explicit project-root paths
- `workdir:` as an alias for `project:`

Relative paths still resolve from the project working directory.

## Examples

Use the task workspace for notes or generated output:

```text
write_file path="workspace:notes/plan.md"
write_file path="workspace:artifacts/summary.json"
exec cwd="workspace:scratch" command="node temp-script.js"
```

Use the project root for actual code changes:

```text
read_file path="src/index.js"
edit_file path="project:src/agent/Agent.js"
git_status cwd="project:"
```

## Optional Environment Variables

- `AGENT_MAX_ITERATIONS`: optional hard cap for reasoning/tool rounds
- `AGENT_MAX_RUNTIME_MS`: optional hard runtime limit
- `AGENT_MAX_TOOL_CALLS`: optional hard cap on tool executions
- `AGENT_MAX_STALL_ITERATIONS`: repeated identical tool rounds before OpenAgent stops as stalled
- `OPENAGENT_HOME`: move `.openagent/` somewhere else if needed

## Compatibility

- If a legacy `.openagent-tasks/` folder already exists, OpenAgent will continue using it for task-state compatibility
- New sessions and workspaces default to `.openagent/`
