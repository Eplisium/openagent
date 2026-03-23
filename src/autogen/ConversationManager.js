/**
 * 🧠 ConversationManager
 * Builds progressive summaries and agent-facing context for multi-agent flows.
 */
export class ConversationManager {
  constructor(options = {}) {
    this.maxSummaryPointsPerSpeaker = options.maxSummaryPointsPerSpeaker || 6;
    this.reset();
  }

  reset(task = '') {
    this.task = task || '';
    this.messages = [];
    this.speakerSummaries = new Map(); // speaker -> string[]
  }

  addMessage(message) {
    if (!message) return;
    this.messages.push(message);

    if (message.type === 'task' || message.source === 'system') {
      return;
    }

    const speaker = message.source || 'unknown';
    const summary = this.summarizeContribution(message.content);
    if (!summary) return;

    const existing = this.speakerSummaries.get(speaker) || [];
    existing.push(summary);
    this.speakerSummaries.set(speaker, existing.slice(-this.maxSummaryPointsPerSpeaker));
  }

  summarizeContribution(content = '') {
    const text = String(content || '').trim();
    if (!text) return '';

    // Extract first meaningful section — up to 500 chars for richer context
    const cleaned = text
      .replace(/```[\s\S]*?```/g, ' [code block] ')
      .replace(/\|\s*\|/g, ' ')
      .replace(/[\r\n]{3,}/g, '\n\n')
      .trim();

    // Try to get the first paragraph or bullet list
    const paragraphs = cleaned.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    const firstSection = paragraphs[0] || cleaned;

    // Allow up to 500 chars for meaningful summaries (was 220)
    const top = firstSection.slice(0, 500).trim();
    return top;
  }

  getSpeakerSummaries() {
    return [...this.speakerSummaries.entries()].map(([speaker, points]) => ({
      speaker,
      points: [...points],
    }));
  }

  getConversationSummary() {
    const entries = this.getSpeakerSummaries();
    if (!entries.length) {
      return '- No prior contributions yet.';
    }

    return entries
      .map(({ speaker, points }) => {
        const bullets = points.map(p => `  - ${p}`).join('\n');
        return `- ${speaker}:\n${bullets}`;
      })
      .join('\n');
  }

  getRecentTranscript(limit = 8) {
    const recent = this.messages.slice(-limit);
    if (!recent.length) return '- No messages yet.';

    return recent
      .map(m => `[${m.source || 'system'}] ${String(m.content || '').trim()}`)
      .join('\n');
  }

  buildAgentContext({ task, roleName, roleDescription, recentLimit = 8 } = {}) {
    return [
      `Original task:\n${task || this.task || '(none provided)'}`,
      `\nYour role:\n${roleName || 'agent'}${roleDescription ? ` — ${roleDescription}` : ''}`,
      `\nConversation summary (key points only):\n${this.getConversationSummary()}`,
      `\nRecent full transcript:\n${this.getRecentTranscript(recentLimit)}`,
    ].join('\n');
  }

  buildSynthesisFallback() {
    const entries = this.getSpeakerSummaries();
    if (!entries.length) {
      return this.messages.at(-1)?.content || '';
    }

    const lines = ['Final synthesis (combined key points):'];
    for (const { speaker, points } of entries) {
      if (!points.length) continue;
      lines.push(`\n${speaker}:`);
      for (const point of points) {
        lines.push(`- ${point}`);
      }
    }

    return lines.join('\n').trim();
  }
}

export default ConversationManager;
