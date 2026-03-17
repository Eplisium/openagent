/**
 * 🚀 OpenAgent v3.0 - Main Entry Point
 * The Ultimate AI Agent with 400+ Models
 * 
 * A production-grade agentic AI assistant on par with Claude Code, Cursor, and Codex.
 * 
 * New in v3.0:
 * - Enhanced error handling and retry logic
 * - Performance metrics and cost tracking
 * - Improved context management
 * - Better tool validation
 * - Auto-save sessions
 * - Command aliases
 * - Request caching
 */

// Core client
export { 
  OpenRouterClient, 
  OpenRouterError, 
  RateLimitError, 
  AuthenticationError 
} from './OpenRouterClient.js';

// Configuration
export { 
  CONFIG, 
  PLUGINS, 
  UI 
} from './config.js';

// Utilities
export * from './utils.js';

// Agent system
export { 
  Agent, 
  AgentError, 
  ToolExecutionError, 
  ContextOverflowError 
} from './agent/Agent.js';
export { AgentSession } from './agent/AgentSession.js';
export { MultiAgent, AGENT_ROLES } from './agent/MultiAgent.js';
export { SubagentManager, SUBAGENT_SPECIALIZATIONS } from './agent/SubagentManager.js';

// Tools
export {
  ToolRegistry,
  ToolErrorType,
  createDefaultRegistry,
  fileTools,
  shellTools,
  webTools,
  gitTools,
  createSubagentTools,
} from './tools/index.js';

// CLI
export { CLI } from './cli.js';

// Main function
import { CLI } from './cli.js';
import { CONFIG } from './config.js';

/**
 * Create a quick agent instance for programmatic use
 * Model must be specified in options
 */
export async function createAgent(options = {}) {
  if (!options.model) {
    throw new Error('Model must be specified when creating an agent. Use ModelBrowser to select a model first.');
  }
  
  const { Agent } = await import('./agent/Agent.js');
  const { ToolRegistry } = await import('./tools/ToolRegistry.js');
  const { fileTools } = await import('./tools/fileTools.js');
  const { shellTools } = await import('./tools/shellTools.js');
  const { webTools } = await import('./tools/webTools.js');
  const { gitTools } = await import('./tools/gitTools.js');
  
  const registry = new ToolRegistry();
  registry.registerAll([...fileTools, ...shellTools, ...webTools, ...gitTools]);
  
  return new Agent({
    tools: registry,
    ...options,
  });
}

/**
 * Run a quick task without setting up full session
 */
export async function quickRun(task, options = {}) {
  const agent = await createAgent(options);
  return agent.run(task);
}

/**
 * Chat without tools
 */
export async function quickChat(message, options = {}) {
  const { OpenRouterClient } = await import('./OpenRouterClient.js');
  const client = new OpenRouterClient(options);
  return client.chat([{ role: 'user', content: message }], options);
}

async function main() {
  const cli = new CLI({
    workingDir: process.cwd(),
    autoSave: true,
  });
  
  await cli.start();
}

// Run if called directly (robust Windows/Linux detection)
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (argvPath && __filename === argvPath) {
  main().catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}
