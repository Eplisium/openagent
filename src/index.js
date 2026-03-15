/**
 * 🚀 OpenAgent - Main Entry Point
 * The Ultimate AI Agent with 400+ Models
 * 
 * A production-grade agentic AI assistant on par with Claude Code, Cursor, and Codex.
 */

// Core client
export { OpenRouterClient, OpenRouterError, RateLimitError, AuthenticationError } from './OpenRouterClient.js';

// Configuration
export { MODELS, MODEL_CATEGORIES, CONFIG, PLUGINS, UI } from './config.js';

// Utilities
export * from './utils.js';

// Agent system
export { Agent } from './agent/Agent.js';
export { AgentSession } from './agent/AgentSession.js';
export { MultiAgent, AGENT_ROLES } from './agent/MultiAgent.js';
export { SubagentManager, SUBAGENT_SPECIALIZATIONS } from './agent/SubagentManager.js';

// Tools
export {
  ToolRegistry,
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

async function main() {
  const cli = new CLI({
    workingDir: process.cwd(),
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
