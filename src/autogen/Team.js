import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { EventBus } from './EventBus.js';
import { ConversationManager } from './ConversationManager.js';

/**
 * 🧭 Team
 * Supervisor + member orchestration with delegation and optional handoff.
 */
export class Team {
  constructor(options = {}) {
    this.supervisor = options.supervisor;
    this.eventBus = options.eventBus || new EventBus();
    this.handoffStrategy = options.handoffStrategy || 'fallback';
    this.conversationManager = options.conversationManager || new ConversationManager();
    /** @type {Map<string, {agent:any, capabilities:string[]}>} */
    this.members = new Map();

    for (const item of options.members || []) {
      if (item?.agent) {
        this.addMember(item.agent, item.capabilities || []);
      } else {
        this.addMember(item);
      }
    }

    if (this.supervisor) {
      this.registerDelegateTool();
    }
  }

  addMember(agent, capabilities = []) {
    const name = agent?.name || agent?.options?.name;
    if (!name) throw new Error('Team.addMember requires named agent');
    this.members.set(name, { agent, capabilities: capabilities || [] });
  }

  removeMember(name) {
    this.members.delete(name);
  }

  scoreMembersForTask(task, excluded = []) {
    const words = String(task).toLowerCase();
    const entries = [...this.members.entries()].filter(([name]) => !excluded.includes(name));

    return entries
      .map(([name, meta]) => {
        const caps = (meta.capabilities || []).map(c => c.toLowerCase());
        const score = caps.reduce((n, cap) => n + (words.includes(cap) ? 1 : 0), 0);
        return { name, ...meta, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  pickFallbackMember(task, excluded = []) {
    const scored = this.scoreMembersForTask(task, excluded);
    return scored[0] || null;
  }

  registerDelegateTool() {
    if (!this.supervisor?.tools?.register) return;

    const existing = this.supervisor.tools.get?.('delegate_to_member');
    if (existing) return;

    this.supervisor.tools.register({
      name: 'delegate_to_member',
      description: 'Delegate a subtask to a team member by name.',
      category: 'autogen',
      parameters: {
        type: 'object',
        properties: {
          memberName: { type: 'string' },
          subtask: { type: 'string' },
        },
        required: ['memberName', 'subtask'],
      },
      execute: async ({ memberName, subtask }) => {
        const entry = this.members.get(memberName);
        if (!entry) {
          return { success: false, error: `Unknown member: ${memberName}` };
        }
        const result = await entry.agent.run(subtask);
        return { success: true, member: memberName, result: result?.response || result };
      },
    });
  }

  // ─── Project Context Scanner ───────────────────────────────────
  static _scanProjectTree(dir, maxDepth = 3, maxEntries = 60) {
    const SKIP_DIRS = new Set([
      'node_modules', '.git', 'dist', 'build', '.next', '.openagent',
      '.openagent-tasks', '.sessions', '.tool-cache', '.windop-backups',
      '__pycache__', '.venv', 'venv', '.env', 'coverage', '.nyc_output',
    ]);
    const SKIP_EXTENSIONS = new Set(['.log', '.bak', '.tmp', '.swp', '.lock']);
    const lines = [];
    let entryCount = 0;

    function walk(currentDir, prefix, depth) {
      if (depth > maxDepth || entryCount >= maxEntries) return;
      let entries;
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      const filtered = entries.filter(e => {
        if (SKIP_DIRS.has(e.name)) return false;
        if (e.name.startsWith('.') && e.name !== '.' && !e.name.endsWith('.env') && e.name !== '.gitignore') return false;
        if (e.isFile() && SKIP_EXTENSIONS.has(path.extname(e.name).toLowerCase())) return false;
        return true;
      });
      filtered.forEach((entry, index) => {
        if (entryCount >= maxEntries) return;
        const isLast = index === filtered.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const name = entry.isDirectory() ? entry.name + '/' : entry.name;
        lines.push(prefix + connector + name);
        entryCount++;
        if (entry.isDirectory()) walk(path.join(currentDir, entry.name), prefix + (isLast ? '    ' : '│   '), depth + 1);
      });
    }
    try {
      lines.push(path.basename(dir) || dir);
      walk(dir, '', 0);
    } catch { return ''; }
    if (entryCount >= maxEntries) lines.push('  ... (truncated)');
    return lines.join('\n');
  }

  async run(task, options = {}) {
    if (!this.supervisor) throw new Error('Team.run requires a supervisor agent');
    if (!this.members.size) throw new Error('Team.run requires at least one member');
    if (options.signal?.aborted) throw new Error('Team run aborted');

    this.conversationManager.reset(task);

    const scoredMembers = this.scoreMembersForTask(task);
    const bestMember = scoredMembers[0] || null;
    const memberOverview = scoredMembers
      .map((meta, idx) => `- ${meta.name}: ${(meta.capabilities || []).join(', ') || 'generalist'} (score: ${meta.score}${idx === 0 ? ', suggested first' : ''})`)
      .join('\n');

    // Build project context for all agents
    const workingDir = options.workingDir || this.supervisor?.workingDir || process.cwd();
    const workspaceDir = options.workspaceDir || this.supervisor?.workspaceDir || null;
    let projectTree = '';
    try { projectTree = Team._scanProjectTree(workingDir); } catch {}
    const envBlock = [
      '',
      '## Environment',
      `- Working directory: ${workingDir}`,
      `- Task workspace: ${workspaceDir || 'not set'}`,
      `- Platform: ${process.platform}`,
      '- Use project: prefix for project files (e.g., project:src/index.js)',
      '- Use workspace: for scratch files and output',
      projectTree ? `\n## Project Structure\n\`\`\`\n${projectTree}\n\`\`\`` : '',
    ].filter(Boolean).join('\n');

    const initialPlanPrompt = [
      'You are supervising a specialist team.',
      `Task: ${task}`,
      '',
      'Team members and capabilities:',
      memberOverview,
      '',
      `Suggested first delegate: ${bestMember?.name || 'none'}${bestMember ? ` (score ${bestMember.score})` : ''}`,
      '',
      'Use delegate_to_member for subtasks. You may delegate multiple times.',
      'After each delegation, keep track of:',
      '- completed work',
      '- remaining work',
      '- what to delegate next',
      '',
      'Return your current plan before/while delegating.',
      envBlock,
    ].join('\n');

    const supervisorResult = await this.supervisor.run(initialPlanPrompt, options);
    const supervisorPlan = supervisorResult?.response || '';

    const memberContributions = [];
    const completed = [];
    const remaining = ['Deliver final, integrated answer'];
    const MEMBER_TIMEOUT_MS = 300000; // 5 minutes per member

    // Run all members in parallel with individual timeouts
    const memberPromises = scoredMembers.map(async (memberMeta) => {
      if (options.signal?.aborted) throw new Error('Team run aborted');

      const memberName = memberMeta.name;
      const caps = (memberMeta.capabilities || []).join(', ') || 'general problem solving';
      const otherMembers = scoredMembers
        .filter(m => m.name !== memberName)
        .map(m => `- ${m.name}: ${(m.capabilities || []).join(', ') || 'generalist'}`)
        .join('\n') || '- (none)';

      const subtask = [
        `You are ${memberName}, a specialist on a multi-agent team.`,
        '',
        `## Original Task`,
        task,
        '',
        `## Your Capabilities`,
        caps,
        '',
        `## Your Focus`,
        `Focus on the aspects of this task that match your capabilities.`,
        `You do NOT need to do everything — other specialists will handle their parts.`,
        '',
        `## Other Team Members`,
        otherMembers,
        '',
        `## Output Requirements`,
        `- Be thorough and specific in your area of expertise`,
        `- Include code, configs, or concrete examples when relevant`,
        `- Structure your output clearly with headings`,
        `- Your output will be synthesized with other specialists' work`,
        envBlock,
      ].join('\n');

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Member ${memberName} timed out after ${MEMBER_TIMEOUT_MS / 1000}s`)), MEMBER_TIMEOUT_MS)
      );

      try {
        const result = await Promise.race([
          memberMeta.agent.run(subtask, options),
          timeoutPromise,
        ]);
        const content = result?.response || result?.content || '';
        const summary = this.conversationManager.summarizeContribution(content);
        return { member: memberName, task: subtask, result: content, summary, error: null };
      } catch (err) {
        return { member: memberName, task: subtask, result: '', summary: null, error: err.message };
      }
    });

    const memberResults = await Promise.all(memberPromises);

    for (const entry of memberResults) {
      memberContributions.push(entry);
      if (entry.error) {
        completed.push(`${entry.member}: [ERROR] ${entry.error}`);
      } else {
        completed.push(`${entry.member}: ${entry.summary || 'completed contribution'}`);
      }
      if (entry.result) {
        this.conversationManager.addMessage({ type: 'chat_message', source: entry.member, content: entry.result });
      }
    }

    remaining.length = 0;
    remaining.push('Synthesize all member contributions into a coherent final answer');

    // Build full contribution sections (not just summaries)
    const fullContributions = memberContributions
      .filter(c => c.result)
      .map(c => `### ${c.member}\n${c.result}`)
      .join('\n\n---\n\n') || '(no contributions received)';

    const synthesisPrompt = [
      'You are the supervisor synthesizing a final team response.',
      '',
      `## Original Task`,
      task,
      '',
      '## Your Initial Planning Notes',
      supervisorPlan || '(none)',
      '',
      '## Member Contributions (Full Text)',
      fullContributions,
      '',
      '## Your Job',
      'Produce ONE coherent final answer that:',
      '1. Directly addresses the original task',
      '2. Integrates the best ideas from each specialist',
      '3. Resolves any conflicts between specialists',
      '4. Is complete and actionable on its own',
      '5. Uses clear structure (headings, bullet points, code blocks)',
      '',
      'Do NOT just concatenate specialist outputs — synthesize them into a unified answer.',
    ].join('\n');

    const synthesisResult = await this.supervisor.run(synthesisPrompt, options);
    let finalSynthesis = synthesisResult?.response || '';

    if (this.handoffStrategy !== 'none' && this.looksLikeFailure(finalSynthesis)) {
      const next = this.pickFallbackMember(task, memberContributions.map(c => c.member));
      if (next) {
        const retry = await next.agent.run(task, options);
        finalSynthesis = retry?.response || finalSynthesis;
      }
    }

    const payload = {
      type: 'team_result',
      source: this.supervisor.name || 'supervisor',
      content: finalSynthesis,
      metadata: { task, memberContributions },
      timestamp: new Date().toISOString(),
    };
    await this.eventBus.publish('team', payload);

    console.log(chalk.cyan(`Team completed task with ${this.members.size} members available`));
    return {
      success: true,
      supervisor: this.supervisor.name || 'supervisor',
      result: finalSynthesis, // backward compatible
      memberContributions,
      finalSynthesis,
      members: [...this.members.keys()],
    };
  }

  async runWithFeedback(task, options = {}) {
    const initial = await this.run(task, options);

    if (!this.looksLikeHelpRequest(initial.result)) {
      return { ...initial, feedbackLoopUsed: false };
    }

    const followupPrompt = `Team requested help. Original task: ${task}\nCurrent result: ${initial.result}\nProvide clarifications and complete the task.`;
    const followup = await this.supervisor.run(followupPrompt, options);

    return {
      ...initial,
      feedbackLoopUsed: true,
      result: followup?.response || initial.result,
      finalSynthesis: followup?.response || initial.finalSynthesis,
    };
  }

  getTeamStatus() {
    return {
      supervisor: this.supervisor?.name || null,
      memberCount: this.members.size,
      members: [...this.members.entries()].map(([name, meta]) => ({
        name,
        capabilities: meta.capabilities || [],
      })),
      handoffStrategy: this.handoffStrategy,
    };
  }

  looksLikeFailure(text = '') {
    const s = String(text).toLowerCase();
    // Only trigger on explicit failure declarations, not mentions of errors in code/docs
    return s.includes('i cannot') || s.includes('i was unable to') || s.includes('task failed')
      || s.includes('completely failed') || s.includes('unable to complete');
  }

  looksLikeHelpRequest(text = '') {
    const s = String(text).toLowerCase();
    // Only trigger on explicit help requests, not casual mentions
    return s.includes('[help needed]') || s.includes('i need clarification on') || s.includes('cannot proceed without');
  }
}

export default Team;
