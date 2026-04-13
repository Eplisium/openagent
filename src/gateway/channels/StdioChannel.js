/**
 * 📟 Stdio Channel Adapter — stdin/stdout pipe for scripting
 * 
 * Reads JSON messages from stdin (one per line) and writes responses to stdout.
 * Useful for piping OpenAgent into other tools or scripting workflows.
 * 
 * Input format (one JSON object per line):
 *   {"message": "Write a hello world function", "sessionId": "my-session"}
 * 
 * Output format (one JSON object per line):
 *   {"type": "response", "content": "...", "sessionId": "my-session"}
 */

import { ChannelAdapter } from '../ChannelAdapter.js';
import readline from 'readline';

export class StdioChannel extends ChannelAdapter {
  constructor(config = {}) {
    super('stdio', config);
    this.rl = null;
    this._lineBuffer = '';
  }

  async start() {
    this._running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const data = JSON.parse(trimmed);
        const message = data.message || data.content || data.text || trimmed;
        const sessionId = data.sessionId || data.session || 'stdio-default';
        const model = data.model || null;

        this._emitMessage({
          targetId: sessionId,
          content: message,
          metadata: { model, source: 'stdio' },
        });

      } catch {
        // Not JSON — treat the whole line as a message
        this._emitMessage({
          targetId: 'stdio-default',
          content: trimmed,
          metadata: { source: 'stdio' },
        });
      }
    });

    this.rl.on('close', () => {
      this._running = false;
    });
  }

  async stop() {
    this._running = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  async sendMessage(targetId, content, metadata = {}) {
    const output = JSON.stringify({
      type: metadata.type || 'response',
      content,
      sessionId: targetId,
      ...metadata,
      timestamp: new Date().toISOString(),
    });

    process.stdout.write(output + '\n');
  }

  getInfo() {
    return {
      ...super.getInfo(),
      mode: 'pipe',
    };
  }
}

export default StdioChannel;
