import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

/**
 * 👤 UserProxyAgent
 * Human-in-the-loop bridge that matches agent-like interfaces.
 */
export class UserProxyAgent {
  constructor(options = {}) {
    this.name = options.name || 'user_proxy';
    this.description = options.description || 'Human proxy agent for approvals, clarifications, and feedback.';
    this.inputHandler = options.inputHandler || 'cli';
    this.onInputRequest = options.onInputRequest;
    this.autoReply = options.autoReply ?? null;
    this.messages = [];
  }

  /**
   * Receive a message and optionally auto-reply.
   * @param {object} message
   */
  async receiveMessage(message) {
    this.messages.push({ ...message, receivedAt: new Date().toISOString() });

    if (typeof this.autoReply === 'function') {
      return this.autoReply(message);
    }
    if (typeof this.autoReply === 'string') {
      return this.autoReply;
    }

    return null;
  }

  /**
   * Prompt human input using configured handler.
   * @param {string} prompt
   */
  async getInput(prompt = 'Input required:') {
    if (typeof this.inputHandler === 'function') {
      return this.inputHandler(prompt);
    }

    if (this.inputHandler === 'callback') {
      if (typeof this.onInputRequest !== 'function') {
        throw new Error('UserProxyAgent inputHandler="callback" requires options.onInputRequest');
      }
      return this.onInputRequest(prompt);
    }

    // default: CLI
    const rl = readline.createInterface({ input, output });
    try {
      return await rl.question(`${prompt} `);
    } finally {
      rl.close();
    }
  }

  getDescription() {
    return this.description;
  }

  /**
   * Agent-like run API so this can participate in GroupChat/Team.
   */
  async run(task, options = {}) {
    if (this.autoReply && typeof this.autoReply === 'string') {
      return {
        response: this.autoReply,
        messages: [{ role: 'assistant', content: this.autoReply }],
        source: this.name,
      };
    }

    const prompt = `Task for ${this.name}: ${task}`;
    const response = await this.getInput(prompt, options);
    return {
      response,
      messages: [{ role: 'assistant', content: response }],
      source: this.name,
    };
  }
}

export default UserProxyAgent;
