/**
 * 🤝 Subagent Delegation Demo v3.2
 * Demonstrates the enhanced subagent system with:
 * - Single task delegation
 * - Parallel execution
 * - Pipeline workflows (Plan → Code → Review)
 * - Synthesis of parallel results
 */

import chalk from 'chalk';
import boxen from 'boxen';
import { Agent } from '../src/agent/Agent.js';
import { SubagentManager, SUBAGENT_SPECIALIZATIONS } from '../src/agent/SubagentManager.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { fileTools } from '../src/tools/fileTools.js';
import { shellTools } from '../src/tools/shellTools.js';
import { webTools } from '../src/tools/webTools.js';
import { gitTools } from '../src/tools/gitTools.js';
import { createSubagentTools } from '../src/tools/subagentTools.js';

console.log(boxen(
  chalk.cyan.bold('🤝 Subagent Delegation Demo v3.2\n\n') +
  chalk.gray('This demo shows the enhanced subagent system:\n') +
  chalk.gray('• Clean visual separation between parent/subagent output\n') +
  chalk.gray('• Parallel execution with progress tracking\n') +
  chalk.gray('• Pipeline workflows (Plan → Code → Review)\n') +
  chalk.gray('• Result synthesis from parallel tasks'),
  { padding: 1, borderStyle: 'round', borderColor: 'cyan' }
));

// Create shared tool registry
const toolRegistry = new ToolRegistry();
toolRegistry.registerAll([
  ...fileTools,
  ...shellTools,
  ...webTools,
  ...gitTools,
]);

// Create subagent manager
const subagentManager = new SubagentManager({
  workingDir: process.cwd(),
  verbose: true,
  maxConcurrent: 3,
});

// Register subagent tools (includes new pipeline tool)
const subagentTools = createSubagentTools(subagentManager);
toolRegistry.registerAll(subagentTools);

// Create main agent with subagent capabilities
// Model must be specified - set DEFAULT_MODEL in .env
const mainAgent = new Agent({
  tools: toolRegistry,
  model: process.env.DEFAULT_MODEL,
  verbose: true,
  maxIterations: 20,
  systemPrompt: `You are a helpful AI assistant with the ability to delegate tasks to specialized subagents.

## Your Subagent Tools
- **delegate_task**: Delegate a single task to a specialized subagent
  - Specializations: coder, architect, researcher, file_manager, tester, reviewer, general
- **delegate_parallel**: Run multiple independent tasks simultaneously
- **delegate_with_synthesis**: Run parallel tasks and combine results
- **delegate_pipeline**: Run sequential stages where each can reference the previous
- **subagent_status**: Check subagent task status

## When to Use Subagents
- When you have multiple independent tasks that can run in parallel
- When you want to offload specialized work (coding, research, etc.)
- When you need a multi-step workflow (Plan → Code → Test → Review)
- When you want to gather information from multiple sources

## CRITICAL: After delegation, present the subagent results. Do NOT redo their work.`,
});

// Set parent agent reference
subagentManager.parentAgent = mainAgent;

// ═══════════════════════════════════════════════════════════════
// Demo Scenarios
// ═══════════════════════════════════════════════════════════════

async function runDemo() {
  console.log(chalk.yellow('\n📋 Available Subagent Specializations:\n'));
  
  const specs = SubagentManager.listSpecializations();
  for (const spec of specs) {
    console.log(`  ${chalk.cyan(spec.id.padEnd(15))} ${chalk.white(spec.name)} ${chalk.gray('- ' + spec.description)}`);
  }

  console.log(chalk.yellow('\n\n🚀 Demo 1: Single Task Delegation\n'));
  
  // Demo 1: Single task delegation
  const result1 = await mainAgent.run(
    `Delegate a task to a file_manager subagent to list the files in the current directory and describe the project structure. Use the delegate_task tool.`
  );
  
  console.log(chalk.green('\n✓ Demo 1 Complete\n'));
  console.log(chalk.gray('Response preview:'));
  console.log(chalk.white(result1.response?.substring(0, 300) + '...'));

  console.log(chalk.yellow('\n\n🚀 Demo 2: Parallel Task Delegation\n'));
  
  // Demo 2: Parallel delegation
  const result2 = await mainAgent.run(
    `Use delegate_parallel to run these 3 tasks simultaneously:
1. List the files in the current directory (file_manager)
2. Get system information using exec (general)  
3. Check git status if available (general)

Report back what you found from all three tasks.`
  );
  
  console.log(chalk.green('\n✓ Demo 2 Complete\n'));
  console.log(chalk.gray('Response preview:'));
  console.log(chalk.white(result2.response?.substring(0, 300) + '...'));

  console.log(chalk.yellow('\n\n🚀 Demo 3: Check Subagent Status\n'));
  
  // Demo 3: Status check
  const result3 = await mainAgent.run(
    `Use subagent_status to show me the statistics of all subagent tasks that have been run.`
  );
  
  console.log(chalk.green('\n✓ Demo 3 Complete\n'));
  console.log(chalk.gray('Response preview:'));
  console.log(chalk.white(result3.response?.substring(0, 300) + '...'));

  // Show final stats
  console.log(chalk.cyan('\n\n📊 Final Statistics:\n'));
  const stats = subagentManager.getStats();
  console.log(`  ${chalk.gray('Total Tasks:')}    ${stats.totalTasks}`);
  console.log(`  ${chalk.gray('Completed:')}      ${stats.completedTasks}`);
  console.log(`  ${chalk.gray('Failed:')}         ${stats.failedTasks}`);
  console.log(`  ${chalk.gray('Success Rate:')}   ${stats.successRate}`);
  console.log(`  ${chalk.gray('Avg Duration:')}   ${stats.avgDuration}`);
  console.log(`  ${chalk.gray('Total Retries:')}  ${stats.totalRetries}`);
  
  if (Object.keys(stats.bySpecialization).length > 0) {
    console.log(`\n  ${chalk.gray('By Specialization:')}`);
    for (const [spec, specStats] of Object.entries(stats.bySpecialization)) {
      console.log(`    ${chalk.cyan(spec)}: ${specStats.total} total, ${specStats.completed} ok, ${specStats.failed} fail`);
    }
  }

  console.log(boxen(
    chalk.green('✨ Demo Complete!\n\n') +
    chalk.gray('The main agent successfully delegated tasks to subagents.\n') +
    chalk.gray('Subagents ran with clean visual separation and progress tracking.\n') +
    chalk.gray('New features: architect specialization, pipeline workflows, retry logic.'),
    { padding: 1, borderStyle: 'round', borderColor: 'green' }
  ));
}

// Run the demo
runDemo().catch(error => {
  console.error(chalk.red('\n✗ Demo failed:'), error.message);
  console.error(chalk.dim(error.stack));
  process.exit(1);
});
