/**
 * 🤝 Subagent Delegation Demo
 * Demonstrates how the main agent can delegate tasks to subagents
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
  chalk.cyan('🤝 Subagent Delegation Demo\n\n') +
  chalk.gray('This demo shows how the main agent can delegate tasks\n') +
  chalk.gray('to specialized subagents for parallel execution.'),
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

// Register subagent tools
const subagentTools = createSubagentTools(subagentManager);
toolRegistry.registerAll(subagentTools);

// Create main agent with subagent capabilities
const mainAgent = new Agent({
  tools: toolRegistry,
  model: 'anthropic/claude-sonnet-4',
  verbose: true,
  maxIterations: 20,
  systemPrompt: `You are a helpful AI assistant with the ability to delegate tasks to specialized subagents.

## Your Subagent Tools
- **delegate_task**: Delegate a single task to a specialized subagent
  - Specializations: coder, researcher, file_manager, tester, reviewer, general
- **delegate_parallel**: Run multiple independent tasks simultaneously
- **delegate_with_synthesis**: Run parallel tasks and combine results
- **subagent_status**: Check subagent task status

## When to Use Subagents
- When you have multiple independent tasks that can run in parallel
- When you want to offload specialized work (coding, research, etc.)
- When you need to gather information from multiple sources
- When you want to break a complex task into parallel subtasks

## Guidelines
- Use delegate_parallel for independent tasks
- Use delegate_with_synthesis when you need combined results
- Be specific in your task descriptions for subagents
- Check subagent_status if you need to monitor progress`,
});

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
    `Delegate a task to a researcher subagent to find the current date and time. Use the delegate_task tool with specialization "researcher".`
  );
  
  console.log(chalk.green('\n✓ Demo 1 Complete\n'));
  console.log(chalk.gray('Response preview:'));
  console.log(chalk.white(result1.response?.substring(0, 200) + '...'));

  console.log(chalk.yellow('\n\n🚀 Demo 2: Parallel Task Delegation\n'));
  
  // Demo 2: Parallel delegation
  const result2 = await mainAgent.run(
    `Use delegate_parallel to run these 3 tasks simultaneously:
1. List the files in the current directory (file_manager)
2. Get system information (general)
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

  console.log(boxen(
    chalk.green('✨ Demo Complete!\n\n') +
    chalk.gray('The main agent successfully delegated tasks to subagents.\n') +
    chalk.gray('Subagents ran in parallel and returned their results.'),
    { padding: 1, borderStyle: 'round', borderColor: 'green' }
  ));
}

// Run the demo
runDemo().catch(error => {
  console.error(chalk.red('\n✗ Demo failed:'), error.message);
  process.exit(1);
});
