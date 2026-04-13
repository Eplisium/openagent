/**
 * 🚀 Gateway Daemon — Headless server mode for OpenAgent
 * 
 * Runs OpenAgent as an always-on service that accepts tasks from multiple
 * channels (HTTP API, Discord, Slack, Telegram, etc.) and routes them
 * to AgentSession instances via the ChannelRouter.
 * 
 * Usage:
 *   openagent --daemon
 *   openagent --daemon --port 3000
 *   openagent --daemon --channels http,discord
 */

import chalk from '../utils/chalk-compat.js';
import { SessionPool } from './SessionPool.js';
import { ChannelRouter } from './ChannelRouter.js';
import { HttpChannel } from './channels/HttpChannel.js';
import { CONFIG } from '../config.js';

export class GatewayDaemon {
  /**
   * @param {object} options
   * @param {number} options.port - HTTP port (default: from config or 3000)
   * @param {string} options.host - Bind address (default: 0.0.0.0)
   * @param {number} options.maxSessions - Max concurrent sessions
   * @param {number} options.sessionTimeoutMs - Session idle timeout
   * @param {string} options.authToken - Bearer token for HTTP API auth
   * @param {string[]} options.channels - Channel names to enable (default: ['http'])
   * @param {object} options.sessionDefaults - Default options for new sessions
   */
  constructor(options = {}) {
    this.options = {
      port: options.port || parseInt(process.env.GATEWAY_PORT, 10) || 3000,
      host: options.host || process.env.GATEWAY_HOST || '0.0.0.0',
      maxSessions: options.maxSessions || parseInt(process.env.GATEWAY_MAX_SESSIONS, 10) || 10,
      sessionTimeoutMs: options.sessionTimeoutMs || parseInt(process.env.GATEWAY_SESSION_TIMEOUT_MS, 10) || 30 * 60 * 1000,
      authToken: options.authToken || process.env.GATEWAY_AUTH_TOKEN || null,
      channels: options.channels || (process.env.GATEWAY_CHANNELS || 'http').split(',').map(s => s.trim()),
      sessionDefaults: options.sessionDefaults || {},
    };

    this.sessionPool = new SessionPool({
      maxSessions: this.options.maxSessions,
      sessionTimeoutMs: this.options.sessionTimeoutMs,
      sessionDefaults: this.options.sessionDefaults,
    });

    this.router = new ChannelRouter({
      sessionPool: this.sessionPool,
      sessionDefaults: this.options.sessionDefaults,
    });

    this._running = false;
    this._shutdownHandler = null;
  }

  /**
   * Start the gateway daemon
   */
  async start() {
    console.log(chalk.cyan.bold('\n🚀 OpenAgent Gateway Daemon'));
    console.log(chalk.dim(`   Port: ${this.options.port}`));
    console.log(chalk.dim(`   Max Sessions: ${this.options.maxSessions}`));
    console.log(chalk.dim(`   Session Timeout: ${this.options.sessionTimeoutMs / 1000}s`));
    console.log(chalk.dim(`   Channels: ${this.options.channels.join(', ')}`));
    if (this.options.authToken) {
      console.log(chalk.dim('   Auth: Bearer token enabled'));
    }
    console.log('');

    // Register channels
    for (const channelName of this.options.channels) {
      await this._registerChannel(channelName);
    }

    // Wire up router events for logging
    this.router.on('session_created', ({ sessionKey }) => {
      console.log(chalk.green(`[Gateway] Session created: ${sessionKey}`));
    });
    this.router.on('task_start', ({ sessionKey, content }) => {
      console.log(chalk.blue(`[Gateway] Task started: ${sessionKey} — "${content.slice(0, 60)}..."`));
    });
    this.router.on('task_end', ({ sessionKey, success }) => {
      const icon = success ? chalk.green('✓') : chalk.red('✗');
      console.log(`${icon} [Gateway] Task ended: ${sessionKey}`);
    });
    this.router.on('channel_error', ({ name, error }) => {
      console.error(chalk.red(`[Gateway] Channel error [${name}]: ${error}`));
    });

    // Start the router (starts all channels)
    await this.router.start();
    this._running = true;

    // Register graceful shutdown
    this._shutdownHandler = () => this.stop();
    process.on('SIGINT', this._shutdownHandler);
    process.on('SIGTERM', this._shutdownHandler);

    console.log(chalk.green.bold('\n✅ Gateway is running. Press Ctrl+C to stop.\n'));

    // Print status periodically
    this._statusTimer = setInterval(() => {
      const status = this.router.getStatus();
      const active = status.sessions.activeSessions;
      if (active > 0) {
        console.log(chalk.dim(`[Gateway] Active sessions: ${active}/${status.sessions.maxSessions}`));
      }
    }, 30000);
    if (this._statusTimer.unref) this._statusTimer.unref();
  }

  /**
   * Stop the gateway daemon
   */
  async stop() {
    if (!this._running) return;
    this._running = false;

    console.log(chalk.yellow('\n🛑 Shutting down gateway...'));

    if (this._statusTimer) {
      clearInterval(this._statusTimer);
    }

    if (this._shutdownHandler) {
      process.off('SIGINT', this._shutdownHandler);
      process.off('SIGTERM', this._shutdownHandler);
    }

    await this.router.stop();
    console.log(chalk.green('✅ Gateway stopped.\n'));
  }

  /**
   * Register a channel by name
   * @private
   */
  async _registerChannel(channelName) {
    switch (channelName) {
      case 'http': {
        const httpChannel = new HttpChannel({
          port: this.options.port,
          host: this.options.host,
          authToken: this.options.authToken,
        });
        this.router.registerChannel(httpChannel);
        break;
      }

      case 'stdio': {
        // Dynamic import to avoid circular deps
        const { StdioChannel } = await import('./channels/StdioChannel.js');
        this.router.registerChannel(new StdioChannel());
        break;
      }

      // Future channels:
      // case 'discord': {
      //   const { DiscordChannel } = await import('./channels/DiscordChannel.js');
      //   this.router.registerChannel(new DiscordChannel(this.options.discord || {}));
      //   break;
      // }
      // case 'slack': { ... }
      // case 'telegram': { ... }

      default:
        console.warn(chalk.yellow(`[Gateway] Unknown channel: ${channelName} (skipping)`));
    }
  }

  /**
   * Get daemon status
   */
  getStatus() {
    return {
      running: this._running,
      options: {
        port: this.options.port,
        maxSessions: this.options.maxSessions,
        channels: this.options.channels,
      },
      router: this.router.getStatus(),
    };
  }
}

export default GatewayDaemon;
