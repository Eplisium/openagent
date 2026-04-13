import chalk from 'chalk';
import { EventBus } from './EventBus.js';
import { GroupChat } from './GroupChat.js';
import { Team } from './Team.js';
import { UserProxyAgent } from './UserProxyAgent.js';
import { FunctionTool } from './FunctionTool.js';
import { Agent } from '../agent/Agent.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';

/**
 * 🌉 AutoGenBridge
 * Integration point between OpenAgent AgentSession and AutoGen-style patterns.
 */
export class AutoGenBridge {
  constructor(agentSession) {
    this.agentSession = agentSession || null;
    this.eventBus = new EventBus();
    this.groupChats = new Map();
    this.teams = new Map();
    this.tempAgents = new Map();
    this.totalTeamCost = 0;
  }

  /**
   * Get cumulative stats for the AutoGen bridge
   */
  getStats() {
    return {
      totalTeamCost: this.totalTeamCost,
      teamCount: this.teams.size,
      groupChatCount: this.groupChats.size,
    };
  }

  createGroupChat(options = {}) {
    const agents = this.resolveAgents(options.agents || []);
    const groupChat = new GroupChat({ ...options, agents, eventBus: this.eventBus });
    const id = options.id || `group_${Date.now()}`;
    this.groupChats.set(id, groupChat);
    return { id, groupChat };
  }

  createTeam(options = {}) {
    const supervisor = this.resolveAgent(options.supervisor);
    const members = (options.members || []).map(m => {
      if (typeof m === 'object' && m.agent) {
        return {
          agent: this.resolveAgent(m.agent),
          capabilities: m.capabilities || this.inferCapabilities(m.agent),
        };
      }
      return {
        agent: this.resolveAgent(m),
        capabilities: this.inferCapabilities(m),
      };
    });

    const team = new Team({ ...options, supervisor, members, eventBus: this.eventBus });
    const id = options.id || `team_${Date.now()}`;
    this.teams.set(id, team);
    return { id, team };
  }

  createUserProxy(options = {}) {
    return new UserProxyAgent(options);
  }

  getEventBus() {
    return this.eventBus;
  }

  wrapTool(tool, { registerForLlm = true, registerForExecution = true } = {}) {
    const fn = async (args) => {
      if (typeof tool.execute === 'function') {
        return tool.execute(args);
      }
      if (typeof tool === 'function') {
        return tool(args);
      }
      throw new Error('wrapTool expected a function or tool object with execute(args)');
    };

    return new FunctionTool(fn, {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || { type: 'object', properties: {} },
      registerForLlm,
      registerForExecution,
    });
  }

  registerTools(registry) {
    if (!registry?.registerAll) {
      throw new Error('AutoGenBridge.registerTools requires a ToolRegistry-like object');
    }

    const tools = [
      {
        name: 'create_group_chat',
        description: 'Create an AutoGen group chat with selected agents or role descriptions.',
        category: 'autogen',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            agents: {
              type: 'array',
              items: {
                anyOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      role: { type: 'string' },
                      systemPrompt: { type: 'string' },
                    },
                  },
                ],
              },
            },
            maxTurns: { type: 'number' },
            speakerSelectionMethod: { type: 'string', enum: ['round_robin', 'random', 'auto', 'manual'] },
          },
          required: ['agents'],
        },
        execute: async ({ id, agents, maxTurns, speakerSelectionMethod }) => {
          const created = this.createGroupChat({ id, agents, maxTurns, speakerSelectionMethod });
          return { success: true, id: created.id, agentCount: created.groupChat.agents.size };
        },
      },
      {
        name: 'add_agent_to_chat',
        description: 'Add an agent (name, role description, or object) to an existing group chat.',
        category: 'autogen',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            agent: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    role: { type: 'string' },
                    systemPrompt: { type: 'string' },
                  },
                },
              ],
            },
          },
          required: ['id', 'agent'],
        },
        execute: async ({ id, agent }) => {
          const gc = this.groupChats.get(id);
          if (!gc) return { success: false, error: `Group chat not found: ${id}` };
          const resolved = this.resolveAgent(agent);
          gc.addAgent(resolved);
          return { success: true, id, agentName: resolved?.name || resolved?.options?.name, agentCount: gc.agents.size };
        },
      },
      {
        name: 'run_group_chat',
        description: 'Run a previously created group chat on a task.',
        category: 'autogen',
        timeout: 600000,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            task: { type: 'string' },
          },
          required: ['id', 'task'],
        },
        execute: async ({ id, task }) => {
          const gc = this.groupChats.get(id);
          if (!gc) return { success: false, error: `Group chat not found: ${id}` };
          const result = await gc.run(task);
          return { success: true, ...result };
        },
      },
      {
        name: 'create_team',
        description: 'Create an AutoGen supervisor team with members (agent names or role descriptions).',
        category: 'autogen',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            supervisor: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    role: { type: 'string' },
                    systemPrompt: { type: 'string' },
                  },
                },
              ],
            },
            members: {
              type: 'array',
              items: {
                anyOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      agent: { type: 'string' },
                      capabilities: { type: 'array', items: { type: 'string' } },
                    },
                  },
                ],
              },
            },
          },
          required: ['supervisor', 'members'],
        },
        execute: async ({ id, supervisor, members }) => {
          const normalizedMembers = (members || []).map(m => {
            if (typeof m === 'object' && m?.agent) {
              return { ...m, agent: this.resolveMemberNameToRoleHint(m.agent) };
            }
            return this.resolveMemberNameToRoleHint(m);
          });

          const created = this.createTeam({ id, supervisor, members: normalizedMembers });
          return { success: true, id: created.id, memberCount: created.team.members.size };
        },
      },
      {
        name: 'run_team',
        description: 'Run a previously created team on a task. Members run in parallel with 2-min timeout each. Results are synthesized by the supervisor.',
        category: 'autogen',
        timeout: 600000,
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            task: { type: 'string' },
            withFeedback: { type: 'boolean' },
          },
          required: ['id', 'task'],
        },
        execute: async ({ id, task, withFeedback }) => {
          const team = this.teams.get(id);
          if (!team) return { success: false, error: `Team not found: ${id}` };
          const result = withFeedback ? await team.runWithFeedback(task) : await team.run(task);
          if (result?.cost) this.totalTeamCost += result.cost;
          return { success: true, ...result };
        },
      },
      {
        name: 'get_autogen_status',
        description: 'Get AutoGen bridge status including active group chats and teams.',
        category: 'autogen',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => ({
          success: true,
          groupChats: this.groupChats.size,
          teams: this.teams.size,
          temporaryAgents: this.tempAgents.size,
          groupChatIds: [...this.groupChats.keys()],
          teamIds: [...this.teams.keys()],
        }),
      },
    ];

    registry.registerAll(tools);
    console.log(chalk.cyan(`AutoGenBridge: registered ${tools.length} tools`));
    return tools;
  }

  resolveAgents(items = []) {
    return items.map(item => this.resolveAgent(item)).filter(Boolean);
  }

  resolveMemberNameToRoleHint(item) {
    if (typeof item !== 'string') return item;

    const known = this.tryResolveNamedAgent(item);
    if (known) return item;

    // When the member doesn't resolve to an existing agent, keep the role hint string
    // so resolveAgent can create a temporary specialist.
    return item;
  }

  inferCapabilities(item) {
    if (typeof item === 'object' && item?.capabilities) {
      return item.capabilities;
    }

    const name = typeof item === 'string'
      ? item
      : (item?.name || item?.options?.name || item?.role || '');
    const lower = String(name).toLowerCase();

    const known = ['planner', 'coder', 'architect', 'researcher', 'reviewer', 'tester'];
    return known.filter(k => lower.includes(k));
  }

  tryResolveNamedAgent(name) {
    if (this.agentSession?.agent && (this.agentSession.agent.name === name || name === 'main')) {
      return this.agentSession.agent;
    }

    if (this.agentSession?.subagentManager?.activeSubagents instanceof Map) {
      const sub = this.agentSession.subagentManager.activeSubagents.get(name);
      if (sub?.agent) return sub.agent;
    }

    if (this.tempAgents.has(name)) {
      return this.tempAgents.get(name);
    }

    return null;
  }

  resolveAgent(item) {
    if (!item) return null;
    if (typeof item === 'object' && typeof item.run === 'function') {
      return item;
    }

    if (typeof item === 'object' && (item.name || item.role || item.systemPrompt)) {
      const rawName = item.name || item.role || 'temp_agent';
      const systemPrompt = item.systemPrompt || this.roleToSystemPrompt(item.role || item.name || 'general assistant');
      return this.createTemporaryAgent(rawName, systemPrompt);
    }

    const name = String(item);
    const resolved = this.tryResolveNamedAgent(name);
    if (resolved) return resolved;

    // Fallback: unresolved string is treated as a role/description and converted into a temporary specialist.
    const systemPrompt = this.roleToSystemPrompt(name);
    return this.createTemporaryAgent(name, systemPrompt);
  }

  roleToSystemPrompt(roleOrDescription = '') {
    const value = String(roleOrDescription || '').trim();
    const role = value.toLowerCase();

    const editingRules = `
## ✏️ File Editing Rules (CRITICAL)
The #1 cause of failures is using wrong text in edit_file. Follow these rules ALWAYS:
1. ALWAYS read_file before editing — no exceptions
2. Copy find text VERBATIM from the read_file output — exact whitespace, indentation, everything
3. If edit_file fails with "not found": Re-read the file, get exact text, retry. NEVER retry with the same text.
4. Use line-based editing (startLine/endLine) when you know line numbers
5. Use write_file for large rewrites (>30% of file)
6. Batch edits with continueOnError: true

## Path Prefixes
- Use project: for project files (e.g., project:src/index.js)
- Use workspace: for scratch files and output
- Relative paths resolve from the working directory

## Shell Commands (Platform-Aware)
- On Windows: use PowerShell equivalents (Get-Content, Select-String, Get-ChildItem)
- On Windows: NEVER use Unix-only commands (wc, head, grep, sed, ls -la)
- To count lines: (Get-Content 'file.txt').Count
- To show first N lines: Get-Content -TotalCount 50 'file.txt'`;

    const map = {
      planner: [
        'You are a senior planning specialist on a multi-agent team.',
        'Your job: break complex goals into clear, sequenced steps with dependencies, risks, and success criteria.',
        'Output format: numbered steps with brief rationale. Flag blockers early.',
        'Always consider: scope, edge cases, testing strategy, and deployment concerns.',
        'If you need to read files to understand the project, use read_file and list_directory.',
      ].join(' ') + editingRules,
      coder: [
        'You are a senior software engineer on a multi-agent team.',
        'Produce production-quality code: correct, clean, well-commented, with error handling.',
        'Always read files before editing them. Explain key decisions and tradeoffs.',
        'Prefer established patterns over clever hacks. Think about maintainability.',
      ].join(' ') + editingRules,
      architect: [
        'You are a senior software architect on a multi-agent team.',
        'Focus on system design: component boundaries, data flow, API contracts, and scalability.',
        'Evaluate tradeoffs explicitly. Recommend patterns with rationale.',
        'Consider: performance, security, observability, and long-term evolution.',
        'Read existing code to understand patterns before proposing changes.',
      ].join(' ') + editingRules,
      researcher: [
        'You are a senior research specialist on a multi-agent team.',
        'Gather evidence systematically. Compare options with pros/cons.',
        'Cite sources. Distinguish facts from opinions.',
        'Provide actionable recommendations, not just raw data.',
        'Use workspace: to save research artifacts and notes.',
      ].join(' ') + editingRules,
      reviewer: [
        'You are a senior code reviewer on a multi-agent team.',
        'Critique for: correctness, completeness, security, performance, and clarity.',
        'Be specific — cite file paths and line numbers. Suggest concrete improvements.',
        'Distinguish blocking issues from nice-to-haves. Be constructive, not pedantic.',
      ].join(' ') + editingRules,
      tester: [
        'You are a senior test engineer on a multi-agent team.',
        'Design test strategies: happy path, edge cases, error handling, integration points.',
        'Write executable test code when possible. Define clear pass/fail criteria.',
        'Think about: what could break, what is the blast radius, how to verify in production.',
      ].join(' ') + editingRules,
      supervisor: [
        'You are a supervisor coordinating a specialist team.',
        'Your job: delegate subtasks to the right specialist, track progress, synthesize results.',
        'Ensure the final output is coherent, complete, and addresses the original goal.',
        'If a specialist fails, reassign or adapt the plan. Quality over speed.',
        'When delegating, include exact file paths in subtask descriptions.',
      ].join(' ') + editingRules,
      designer: [
        'You are a senior UI/UX designer on a multi-agent team.',
        'Design interfaces that are intuitive, accessible, and visually polished.',
        'Think about: user flows, responsive layouts, component systems, and design tokens.',
        'Output concrete CSS/HTML/markup when relevant, not just descriptions.',
      ].join(' ') + editingRules,
      devops: [
        'You are a senior DevOps engineer on a multi-agent team.',
        'Focus on: CI/CD, deployment, infrastructure, monitoring, and reliability.',
        'Automate everything. Provide scripts and configs, not manual instructions.',
        'Consider: security, cost, scalability, and operational simplicity.',
      ].join(' ') + editingRules,
    };

    const matched = Object.keys(map).find(key => role.includes(key));
    if (matched) return map[matched];

    // For custom role descriptions, use the input directly as the system prompt.
    const base = value || 'You are a helpful specialist agent. Provide thorough, actionable output.';
    return base + editingRules;
  }

  createTemporaryAgent(rawName, systemPrompt) {
    const baseName = String(rawName || 'temp_agent').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') || 'temp_agent';
    const uniqueName = `${baseName}_${Date.now().toString(36).slice(-4)}`;

    const sharedRegistry = this.agentSession?.toolRegistry || this.agentSession?.agent?.tools;
    const tools = sharedRegistry instanceof ToolRegistry ? sharedRegistry : new ToolRegistry();

    const model = this.agentSession?.model || this.agentSession?.agent?.model;
    if (!model) {
      throw new Error(`Unable to create temporary agent "${uniqueName}" without a model`);
    }

    // Inherit workspace context from parent session
    const workingDir = this.agentSession?.workingDir
      || this.agentSession?.agent?.workingDir
      || process.cwd();
    const workspaceDir = this.agentSession?.activeWorkspace?.workspaceDir
      || this.agentSession?.workspaceDir
      || null;

    // Inject environment context into system prompt
    const envContext = `

## Environment
- Working directory: ${workingDir}
- Task workspace: ${workspaceDir || 'not set'}
- Platform: ${process.platform}
- You are a team member — complete your specific role contribution and return results.`;

    const enhancedPrompt = systemPrompt + envContext;

    const tempAgent = new Agent({
      name: uniqueName,
      model,
      tools,
      systemPrompt: enhancedPrompt,
      verbose: false,
      streaming: false,
      workingDir,
      workspaceDir,
      maxIterations: 30,
      maxRetries: 2,
    });

    tempAgent.name = uniqueName;
    this.tempAgents.set(uniqueName, tempAgent);
    return tempAgent;
  }
}

export default AutoGenBridge;
