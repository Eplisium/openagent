/**
 * 🤖 OpenAgent Demo
 * Demonstrates the full agentic capabilities
 */

import { Agent, AgentSession, MultiAgent } from '../src/index.js';
import { createDefaultRegistry } from '../src/tools/index.js';
import { MODELS } from '../src/config.js';
import chalk from 'chalk';

async function runAgentDemo() {
  console.clear();
  console.log(chalk.cyan('\n🚀 OpenAgent Demo - Full Agentic Capabilities\n'));
  
  // ========================================
  // Demo 1: Simple Agentic Task
  // ========================================
  console.log(chalk.yellow('📍 DEMO 1: File System Exploration\n'));
  
  const registry = createDefaultRegistry();
  const agent = new Agent({
    tools: registry,
    model: MODELS.CLAUDE_SONNET_4,
    verbose: true,
    maxIterations: 10,
  });
  
  const result1 = await agent.run(
    'List the files in the current directory, then read the package.json file and tell me what this project is about.'
  );
  
  console.log(chalk.green('\n✓ Task complete'));
  console.log(chalk.gray(`  Iterations: ${result1.iterations}`));
  console.log(chalk.gray(`  Tools used: ${result1.stats.toolsUsed.join(', ')}`));
  console.log(chalk.cyan('\nResponse:'));
  console.log(result1.response);
  
  // ========================================
  // Demo 2: Code Search and Analysis
  // ========================================
  console.log(chalk.yellow('\n\n📍 DEMO 2: Code Search & Analysis\n'));
  
  agent.clear();
  
  const result2 = await agent.run(
    'Search for all JavaScript files in the src directory, find any TODO comments, and summarize what features are planned.'
  );
  
  console.log(chalk.green('\n✓ Task complete'));
  console.log(chalk.gray(`  Iterations: ${result2.iterations}`));
  console.log(chalk.cyan('\nResponse:'));
  console.log(result2.response);
  
  // ========================================
  // Demo 3: Web Research
  // ========================================
  console.log(chalk.yellow('\n\n📍 DEMO 3: Web Research\n'));
  
  agent.clear();
  
  const result3 = await agent.run(
    'Search the web for the latest news about AI coding assistants in 2026 and summarize the top 3 developments.'
  );
  
  console.log(chalk.green('\n✓ Task complete'));
  console.log(chalk.cyan('\nResponse:'));
  console.log(result3.response);
  
  // ========================================
  // Demo 4: Multi-Agent Pipeline
  // ========================================
  console.log(chalk.yellow('\n\n📍 DEMO 4: Multi-Agent Pipeline\n'));
  
  const multiAgent = new MultiAgent();
  
  const pipelineResult = await multiAgent.pipeline(
    'Create a simple Express.js REST API endpoint that handles user authentication with JWT tokens'
  );
  
  console.log(chalk.green('\n✓ Pipeline complete'));
  console.log(chalk.gray(`  Duration: ${Math.round(pipelineResult.duration / 1000)}s`));
  console.log(chalk.gray(`  Total iterations: ${pipelineResult.totalIterations}`));
  
  // ========================================
  // Demo 5: Agent Session with Checkpoints
  // ========================================
  console.log(chalk.yellow('\n\n📍 DEMO 5: Session Management\n'));
  
  const session = new AgentSession({
    workingDir: process.cwd(),
    model: MODELS.GPT_5_MINI,
    verbose: false,
  });
  
  console.log(chalk.cyan('Running task with checkpoint support...'));
  
  const sessionResult = await session.run(
    'What operating system am I running? Show me some system information.'
  );
  
  console.log(chalk.green('\n✓ Session task complete'));
  console.log(chalk.gray(`  Checkpoints: ${session.checkpoints.length}`));
  console.log(chalk.cyan('\nResponse:'));
  console.log(sessionResult.response);
  
  // Show session info
  const info = session.getInfo();
  console.log(chalk.gray(`\n  Session ID: ${info.sessionId}`));
  console.log(chalk.gray(`  Tools available: ${info.tools.length}`));
  
  // ========================================
  // Demo 6: Agent Debate
  // ========================================
  console.log(chalk.yellow('\n\n📍 DEMO 6: Multi-Agent Debate\n'));
  
  const debateResult = await multiAgent.debate(
    'TypeScript is better than JavaScript for large projects',
    2
  );
  
  console.log(chalk.green('\n✓ Debate complete'));
  console.log(chalk.cyan('\nSummary:'));
  console.log(debateResult.summary);
  
  // ========================================
  // Final Stats
  // ========================================
  console.log(chalk.cyan('\n\n═══════════════════════════════════════'));
  console.log(chalk.cyan('📊 Demo Complete - Final Statistics'));
  console.log(chalk.cyan('═══════════════════════════════════════\n'));
  
  const toolStats = registry.getStats();
  console.log(chalk.gray(`Tool executions: ${toolStats.totalExecutions}`));
  console.log(chalk.gray(`Success rate: ${toolStats.successRate}`));
  console.log(chalk.gray(`Available tools: ${toolStats.registeredTools}`));
  
  console.log(chalk.green('\n✨ All demos completed successfully!\n'));
}

runAgentDemo().catch(error => {
  console.error(chalk.red(`\n❌ Demo failed: ${error.message}`));
  console.error(error.stack);
  process.exit(1);
});
