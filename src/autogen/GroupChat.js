import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { OpenRouterClient } from '../OpenRouterClient.js';
import { EventBus } from './EventBus.js';
import { ConversationManager } from './ConversationManager.js';

/**
 * 👥 GroupChat
 * Multi-agent discussion loop with pluggable speaker selection.
 */
export class GroupChat {
  constructor(options = {}) {
    this.agents = new Map();
    this.maxTurns = options.maxTurns || 8;
    this.speakerSelectionMethod = options.speakerSelectionMethod || 'round_robin';
    this.eventBus = options.eventBus || new EventBus();
    this.messages = [];
    this.speakerHistory = [];
    this.currentSpeakerIndex = -1;
    this.manualSelector = options.manualSelector || null;
    this.client = options.client || new OpenRouterClient({ model: options.model || undefined });
    this.conversationManager = options.conversationManager || new ConversationManager();

    for (const agent of options.agents || []) {
      this.addAgent(agent);
    }
  }

  addAgent(agent) {
    const name = agent?.name || agent?.options?.name;
    if (!name) {
      throw new Error('GroupChat.addAgent requires an agent with a name');
    }
    this.agents.set(name, agent);
  }

  removeAgent(name) {
    this.agents.delete(name);
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
    const signal = options.signal;
    if (!this.agents.size) {
      throw new Error('GroupChat.run requires at least one agent');
    }

    // Build environment context for turn prompts
    this._workingDir = options.workingDir || process.cwd();
    this._workspaceDir = options.workspaceDir || null;
    this._platform = process.platform;
    try { this._projectTree = GroupChat._scanProjectTree(this._workingDir); } catch { this._projectTree = ''; }

    this.messages = [{ type: 'task', source: 'system', content: task, timestamp: new Date().toISOString() }];
    this.conversationManager.reset(task);
    this.conversationManager.addMessage(this.messages[0]);

    this.speakerHistory = [];
    let endedEarly = false;

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (signal?.aborted) {
        throw new Error('GroupChat run aborted');
      }

      const speaker = await this.selectNextSpeaker(this.messages, [...this.agents.values()], { signal });
      if (!speaker) break;

      const agentName = speaker.name || speaker.options?.name || 'unknown';
      this.speakerHistory.push(agentName);

      const prompt = this.buildTurnPrompt(task, speaker);
      const result = await speaker.run(prompt, { signal });
      const content = result?.response || result?.content || '';

      const msg = {
        type: 'chat_message',
        source: agentName,
        content,
        metadata: { turn: turn + 1 },
        timestamp: new Date().toISOString(),
      };

      this.messages.push(msg);
      this.conversationManager.addMessage(msg);
      await this.eventBus.publish('group_chat', msg);

      if (this.isTerminalMessage(content)) {
        endedEarly = true;
        break;
      }
    }

    const finalResult = await this.synthesize(task, { signal });

    console.log(chalk.cyan(`GroupChat complete: ${this.speakerHistory.length} turns${endedEarly ? ' (terminal message detected)' : ''}`));
    return {
      messages: this.messages,
      speakerHistory: this.speakerHistory,
      finalResult,
      conversationSummary: this.conversationManager.getConversationSummary(),
    };
  }

  async synthesize(task, options = {}) {
    const signal = options.signal;
    const candidates = [...this.agents.values()];
    const synthesisAgent = candidates.find(a => {
      const n = String(a?.name || a?.options?.name || '').toLowerCase();
      return n.includes('reviewer') || n.includes('supervisor');
    });

    if (synthesisAgent) {
      const roleName = synthesisAgent.name || synthesisAgent.options?.name || 'synthesizer';
      const synthesisPrompt = [
        `You are the final synthesizer for this group chat.`,
        `Produce one coherent final answer for the task.`,
        `Avoid markdown tables unless absolutely required. Prefer clear bullet points.`,
        '',
        this.conversationManager.buildAgentContext({
          task,
          roleName,
          roleDescription: 'review and synthesize all contributions',
          recentLimit: 10,
        }),
        '',
        'Now provide the final synthesized answer:',
      ].join('\n');

      const response = await synthesisAgent.run(synthesisPrompt, { signal });
      return response?.response || response?.content || this.conversationManager.buildSynthesisFallback();
    }

    return this.conversationManager.buildSynthesisFallback();
  }

  async selectNextSpeaker(messages, agents, options = {}) {
    const method = this.speakerSelectionMethod;
    if (!agents.length) return null;

    if (method === 'random') {
      return agents[Math.floor(Math.random() * agents.length)];
    }

    if (method === 'manual') {
      if (typeof this.manualSelector !== 'function') {
        throw new Error('GroupChat manual mode requires options.manualSelector');
      }
      const selectedName = await this.manualSelector({ messages, agents, history: this.speakerHistory });
      return agents.find(a => (a.name || a.options?.name) === selectedName) || null;
    }

    if (method === 'auto') {
      return this.selectSpeakerByLlm(messages, agents, options);
    }

    // default round_robin
    this.currentSpeakerIndex = (this.currentSpeakerIndex + 1) % agents.length;
    return agents[this.currentSpeakerIndex];
  }

  async selectSpeakerByLlm(messages, agents, options = {}) {
    const recent = this.conversationManager.getConversationSummary();
    const roster = agents
      .map(a => `- ${(a.name || a.options?.name)}: ${typeof a.getDescription === 'function' ? a.getDescription() : 'General agent'}`)
      .join('\n');

    const prompt = `You are selecting the best next speaker for a group chat task.\n\nAgents:\n${roster}\n\nConversation summary:\n${recent}\n\nReply with ONLY the agent name who should speak next.`;

    // Use the model from options, or fall back to the client's model if available
    const model = options.model || this.client?.model || undefined;

    const response = await this.client.chat([
      { role: 'system', content: 'Select the best next speaker. Return only a single exact agent name.' },
      { role: 'user', content: prompt },
    ], {
      model,
      temperature: 0,
      max_tokens: 32,
    });

    const picked = (response?.content || '').trim();
    return agents.find(a => (a.name || a.options?.name) === picked) || agents[0];
  }

  buildTurnPrompt(task, speaker) {
    const roleName = speaker?.name || speaker?.options?.name || 'agent';
    const roleDescription = typeof speaker?.getDescription === 'function'
      ? speaker.getDescription()
      : (speaker?.options?.description || 'general contributor');

    const envBlock = this._workingDir ? [
      '',
      '## Environment',
      `- Working directory: ${this._workingDir}`,
      `- Task workspace: ${this._workspaceDir || 'not set'}`,
      `- Platform: ${this._platform}`,
      '- Use project: prefix for project files (e.g., project:src/index.js)',
      '- Use workspace: for scratch files and output',
      this._projectTree ? `\n## Project Structure\n\`\`\`\n${this._projectTree}\n\`\`\`` : '',
    ].filter(Boolean).join('\n') : '';

    return [
      `You are participating in a structured multi-agent discussion.`,
      '',
      this.conversationManager.buildAgentContext({
        task,
        roleName,
        roleDescription,
        recentLimit: 8,
      }),
      '',
      'Instructions:',
      '- Build on what is already covered and avoid repeating prior points verbatim.',
      '- Contribute your highest-value next step in your role.',
      '- Be concise but specific.',
      '- If you need to read or edit files, use read_file, list_directory, edit_file tools.',
      envBlock,
    ].filter(Boolean).join('\n');
  }

  isTerminalMessage(content = '') {
    const text = String(content).toLowerCase();
    // Only match explicit terminal phrases, not casual use of 'done' or 'complete'
    return text.includes('[task complete]') || text.includes('[final answer]') || text.includes('TERMINATE');
  }

  getConversationHistory() {
    return [...this.messages];
  }
}

export default GroupChat;
