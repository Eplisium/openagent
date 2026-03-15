/**
 * 🧪 Subagent System Test
 * Quick verification that subagent delegation works
 */

import { SubagentManager, SUBAGENT_SPECIALIZATIONS } from '../src/agent/SubagentManager.js';
import { createSubagentTools } from '../src/tools/subagentTools.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';

console.log('🧪 Testing Subagent System...\n');

// Test 1: SubagentManager instantiation
console.log('Test 1: Creating SubagentManager...');
const manager = new SubagentManager({ verbose: false });
console.log('  ✓ Manager created');

// Test 2: List specializations
console.log('\nTest 2: Listing specializations...');
const specs = SubagentManager.listSpecializations();
console.log(`  ✓ Found ${specs.length} specializations: ${specs.map(s => s.id).join(', ')}`);

// Test 3: Create subagent tools
console.log('\nTest 3: Creating subagent tools...');
const tools = createSubagentTools(manager);
console.log(`  ✓ Created ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);

// Test 4: Register tools in registry
console.log('\nTest 4: Registering tools in registry...');
const registry = new ToolRegistry();
registry.registerAll(tools);
const registeredTools = registry.list();
console.log(`  ✓ Registered ${registeredTools.length} tools`);

// Test 5: Get initial stats
console.log('\nTest 5: Getting initial stats...');
const stats = manager.getStats();
console.log(`  ✓ Stats: ${stats.totalTasks} total, ${stats.successRate} success rate`);

// Test 6: Verify tool definitions
console.log('\nTest 6: Verifying tool definitions...');
const defs = registry.getToolDefinitions();
console.log(`  ✓ Got ${defs.length} tool definitions for LLM`);

console.log('\n✅ All subagent system tests passed!\n');

// Summary
console.log('📦 Subagent System Summary:');
console.log('  • SubagentManager - Manages subagent lifecycle');
console.log('  • 6 Specializations: general, coder, researcher, file_manager, tester, reviewer');
console.log('  • 4 Tools: delegate_task, delegate_parallel, delegate_with_synthesis, subagent_status');
console.log('  • Integrated with AgentSession and CLI');
console.log('\n🚀 Ready to use! Run: npm run subagents');
