/**
 * 👋 Hello World Plugin
 * Example plugin demonstrating the OpenAgent plugin API
 */

import { Plugin } from '../../src/plugins/Plugin.js';

/**
 * Hello World Plugin
 * A simple demonstration plugin with greeting tools
 */
class HelloWorldPlugin extends Plugin {
  /**
   * @inheritdoc
   */
  constructor(manifest, context) {
    super(manifest, context);
    this.greetCount = 0;
  }

  /**
   * @inheritdoc
   */
  async initialize() {
    await super.initialize();
    console.log(`[HelloWorld] Plugin initialized: ${this.name} v${this.version}`);
    
    // Register our tools with the manager
    if (this.manager?.toolRegistry) {
      this.manager.toolRegistry.registerAll([
        this.createGreetTool(),
        this.createEchoTool(),
      ]);
    }
  }

  /**
   * Create the greet tool
   * @private
   */
  createGreetTool() {
    return {
      name: 'hello_greet',
      description: 'Greet a user with a friendly message',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the person to greet',
          },
        },
        required: ['name'],
      },
      handler: async (params) => {
        this.greetCount++;
        const greeting = this.getConfig('greeting', 'Hello');
        const suffix = this.getConfig('exclamation', true) ? '!' : '.';
        
        return {
          success: true,
          message: `${greeting}, ${params.name}!${suffix}`,
          greetCount: this.greetCount,
        };
      },
    };
  }

  /**
   * Create the echo tool
   * @private
   */
  createEchoTool() {
    return {
      name: 'hello_echo',
      description: 'Echo back a message with a prefix',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to echo',
          },
          prefix: {
            type: 'string',
            description: 'Prefix to add to the message',
          },
        },
        required: ['message'],
      },
      handler: async (params) => {
        const prefix = params.prefix || this.getConfig('defaultPrefix', 'You said:');
        return {
          success: true,
          echo: `${prefix} ${params.message}`,
        };
      },
    };
  }

  /**
   * Hook: Called when agent starts
   * @param {Object} context - Agent context
   */
  async onAgentStart(context) {
    console.log(`[HelloWorld] Agent started with task: ${context.task?.substring(0, 50)}...`);
  }

  /**
   * Hook: Called when task completes
   * @param {Object} result - Task result
   */
  async onTaskComplete(result) {
    console.log(`[HelloWorld] Task completed with status: ${result.success ? 'success' : 'error'}`);
  }

  /**
   * @inheritdoc
   */
  async cleanup() {
    console.log(`[HelloWorld] Plugin cleanup: ${this.name}`);
    await super.cleanup();
  }
}

export default HelloWorldPlugin;