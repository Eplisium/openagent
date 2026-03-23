/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          Human Approval Workflow — OpenAgent Graph Engine               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT THIS DEMONSTRATES:
 *   • A deployment pipeline with explicit Human-in-the-Loop (HITL) approval
 *   • interruptBefore('deploy') — the graph PAUSES before the deploy node
 *     runs, waits for a human to call compiled.resume(), then continues
 *   • Full pause/resume/abort lifecycle using event listeners
 *   • Checkpoint persistence with FileCheckpointer so the workflow can be
 *     resumed from a different process after the human responds
 *   • How to inject human decisions into state via the humanInput argument
 *     of compiled.resume()
 *
 * HOW TO RUN:
 *   node examples/graphs/human-approval-workflow.js
 *
 * HITL PAUSE/RESUME PATTERN:
 *
 *   ┌──────┐    ┌──────────────┐    ┌──────┐    ┌───────────────────┐    ┌────────┐
 *   │ plan │───►│ code_changes │───►│ test │───►│ ⏸️  HUMAN APPROVAL │───►│ deploy │
 *   └──────┘    └──────────────┘    └──────┘    └───────────────────┘    └────────┘
 *                                                        │
 *                                                 interruptBefore('deploy')
 *                                                 ── graph pauses here ──
 *                                                 Human inspects state, then:
 *                                                   compiled.resume(threadId)           → approved
 *                                                   compiled.resume(threadId, {approved:false}) → rejected
 *                                                   compiled.interruptManager.abort(threadId) → cancelled
 *
 * STATE SCHEMA:
 *   task        string  – Deployment task description
 *   plan        string  – Deployment plan (from plan node)
 *   changes     string  – Code / infra changes made (from code_changes node)
 *   testsPassed boolean – Whether automated tests passed
 *   approved    boolean – Human's deployment approval decision
 *   deployed    boolean – Whether the deployment was executed
 *   deployLog   string  – Output from the deploy node
 *
 * HOW TO RESUME FROM A DIFFERENT PROCESS:
 *   Save the threadId that is logged when the workflow pauses, then:
 *
 *     import { buildDeployGraph } from './human-approval-workflow.js';
 *     const compiled = buildDeployGraph();
 *     await compiled.resume('YOUR_THREAD_ID', { approved: true });
 */

// ─── Imports ───────────────────────────────────────────────────────────────

import { WorkflowGraph, GraphState } from '../../src/graph/index.js';
import { FileCheckpointer } from '../../src/graph/checkpointers/FileCheckpointer.js';
import { createAgentNode } from '../../src/graph/nodes/AgentNode.js';
import { START, END } from '../../src/graph/constants.js';
import readline from 'readline';

// ─── State Schema ───────────────────────────────────────────────────────────

/**
 * Deployment workflow state.
 */
const stateSchema = GraphState.define({
  /** The deployment task requested by the user */
  task: { default: '' },

  /** High-level deployment plan produced by the plan node */
  plan: { default: null },

  /** Description of code/infra changes made by code_changes node */
  changes: { default: null },

  /** true if automated tests pass, false otherwise */
  testsPassed: { default: false },

  /**
   * Human approval decision.
   * Set by the human via compiled.resume(threadId, { approved: true/false }).
   * Defaults to false; the deploy node will not run if still false.
   */
  approved: { default: false },

  /** true once the deploy node has actually executed the deployment */
  deployed: { default: false },

  /** Output/log produced by the deploy node */
  deployLog: { default: null },
});

// ─── Node Definitions ───────────────────────────────────────────────────────

/**
 * PLAN NODE
 * Analyses the task and creates a deployment plan with risk assessment.
 */
const planNode = createAgentNode({
  inputMapper: (state) =>
    `You are a DevOps architect. Create a detailed deployment plan for:\n\n${state.task}\n\n` +
    `Include: pre-deployment checks, steps, rollback strategy, and risk level (LOW/MEDIUM/HIGH).`,

  outputMapper: (result, _state) => ({
    plan: result.response,
  }),
});

/**
 * CODE CHANGES NODE
 * Implements the changes described in the plan (infrastructure-as-code,
 * config files, migration scripts, etc.).
 */
const codeChangesNode = createAgentNode({
  inputMapper: (state) =>
    `You are a DevOps engineer. Implement the following deployment plan.\n\n` +
    `PLAN:\n${state.plan}\n\n` +
    `Produce: updated config files, migration scripts, or infrastructure changes. ` +
    `Be specific and production-ready. Include any environment variable changes.`,

  outputMapper: (result, _state) => ({
    changes: result.response,
  }),
});

/**
 * TEST NODE
 * Runs automated checks: unit tests, integration tests, smoke tests,
 * config validation, etc.
 */
const testNode = createAgentNode({
  inputMapper: (state) =>
    `You are a QA engineer running pre-deployment checks.\n\n` +
    `DEPLOYMENT CHANGES:\n${state.changes}\n\n` +
    `Simulate running: unit tests, integration tests, config validation, security scans. ` +
    `Report PASS or FAIL for each check. Set overall status to PASSED or FAILED.`,

  outputMapper: (result, _state) => {
    const response = result.response ?? '';
    // Simple heuristic: if "FAILED" appears in results, mark tests as failed
    const testsPassed = !response.toUpperCase().includes('FAILED');
    // Return only the fields we want to update — omitting 'changes' leaves it
    // unchanged (last-write-wins: the engine keeps the existing value)
    return {
      testsPassed,
    };
  },
});

/**
 * DEPLOY NODE
 * ⚠️  This is the dangerous node that actually deploys to production.
 *     It is protected by interruptBefore('deploy') — the graph WILL NOT
 *     execute this node until a human explicitly calls compiled.resume().
 *
 * If the human set approved=false during resume, deployment is skipped.
 */
const deployNode = createAgentNode({
  inputMapper: (state) => {
    // If the human rejected, produce a no-op prompt
    if (!state.approved) {
      return `Deployment was REJECTED by the human approver. Write a brief rejection notice explaining no deployment occurred.`;
    }

    return (
      `You are a deployment system executing a production rollout.\n\n` +
      `PLAN:\n${state.plan}\n\n` +
      `CHANGES:\n${state.changes}\n\n` +
      `Simulate executing the deployment. Report each step as it completes ` +
      `with status (✅ SUCCESS / ❌ FAILED). End with a deployment summary.`
    );
  },

  outputMapper: (result, state) => ({
    deployed: state.approved,   // only truly deployed if approved
    deployLog: result.response,
  }),
});

// ─── Graph Construction ─────────────────────────────────────────────────────

/**
 * Build and compile the human-approval deployment workflow.
 *
 * Exported so it can be imported by other modules for resuming paused threads.
 *
 * @returns {import('../../src/graph/CompiledGraph.js').CompiledGraph}
 */
export function buildDeployGraph() {
  const graph = new WorkflowGraph(stateSchema);

  // ── Register nodes ──────────────────────────────────────────────────────
  graph.addNode('plan', planNode);
  graph.addNode('code_changes', codeChangesNode);
  graph.addNode('test', testNode);
  graph.addNode('deploy', deployNode);

  // ── Edges ───────────────────────────────────────────────────────────────
  //   START → plan → code_changes → test → [PAUSE FOR HUMAN] → deploy → END
  graph.setEntryPoint('plan');
  graph.addEdge('plan', 'code_changes');
  graph.addEdge('code_changes', 'test');
  graph.addEdge('test', 'deploy');
  graph.addEdge('deploy', END);

  // ── HITL: pause BEFORE deploy ────────────────────────────────────────────
  //   The graph calls interruptManager.pause(threadId, 'deploy', state) here.
  //   Execution is suspended (the Promise returned by invoke() stays pending).
  //   A human must call compiled.resume(threadId, humanInput) to unblock it.
  graph.interruptBefore(['deploy']);

  // ── Compile ──────────────────────────────────────────────────────────────
  return graph.compile({
    // FileCheckpointer persists to disk so the workflow can be resumed
    // even after the originating process exits.
    checkpointer: new FileCheckpointer(),
    maxCycles: 15,
    verbose: true,
  });
}

// ─── Interactive Resume Helper ───────────────────────────────────────────────

/**
 * Prompt the user interactively and return their answer via readline.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Entry point — demonstrates the full HITL deployment pipeline.
 *
 * What happens:
 *  1. plan → code_changes → test nodes execute automatically
 *  2. The graph pauses before 'deploy' and logs the thread ID
 *  3. The human is prompted interactively: approve or reject?
 *  4. compiled.resume() is called with the human's decision
 *  5. deploy node executes (or skips if rejected)
 *  6. Final state is printed
 */
async function main() {
  console.log('🚀 Human Approval Workflow — OpenAgent Graph Engine\n');
  console.log('This workflow demonstrates the pause/resume HITL pattern.\n');

  const compiled = buildDeployGraph();
  const threadId = `deploy-${Date.now()}`;

  // Tracks whether the workflow is currently waiting for a human
  let waitingForHuman = false;

  // ── Register lifecycle event listeners ─────────────────────────────────

  /**
   * 'paused' fires when the graph hits an interruptBefore point.
   * This is where your integration (CLI, Discord, web UI) should notify
   * the human and wait for their decision.
   */
  compiled.interruptManager.on('paused', async ({ threadId: tid, nodeName, state }) => {
    waitingForHuman = true;

    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log(`│  ⏸️  WORKFLOW PAUSED — awaiting human approval             │`);
    console.log('└─────────────────────────────────────────────────────────┘');
    console.log(`\n  Thread ID   : ${tid}`);
    console.log(`  Paused at   : node "${nodeName}"`);
    console.log(`  Tests passed: ${state.testsPassed ? '✅ YES' : '❌ NO'}`);
    console.log('\n  Deployment Plan Preview:');
    console.log('  ' + (state.plan ?? '').substring(0, 300).replace(/\n/g, '\n  ') + '…');

    console.log('\n  ── Options ─────────────────────────────────────────────');
    console.log('  [A] Approve — proceed with deployment');
    console.log('  [R] Reject  — skip deployment (workflow ends gracefully)');
    console.log('  [X] Abort   — cancel and throw an error\n');

    try {
      const answer = await prompt('  Your decision [A/R/X]: ');

      if (answer.toLowerCase() === 'a') {
        console.log('\n  ✅ APPROVED — resuming workflow with deployment enabled…\n');
        // Pass approved:true so the deploy node knows to proceed
        await compiled.resume(tid, { approved: true });
      } else if (answer.toLowerCase() === 'r') {
        console.log('\n  🚫 REJECTED — resuming workflow without deployment…\n');
        // Pass approved:false (the deploy node will produce a rejection notice)
        await compiled.resume(tid, { approved: false });
      } else {
        console.log('\n  🛑 ABORTING workflow…\n');
        // abort() rejects the pending Promise in invoke(), causing an error
        compiled.interruptManager.abort(tid, 'User chose to abort at approval step');
      }
    } catch (err) {
      console.error('  Error during human input:', err.message);
    } finally {
      waitingForHuman = false;
    }
  });

  /**
   * 'resumed' fires immediately when compiled.resume() is called.
   */
  compiled.interruptManager.on('resumed', ({ threadId: tid, node, humanInput }) => {
    const decision = humanInput?.approved ? 'APPROVED' : 'REJECTED';
    console.log(`▶️  Thread "${tid}" resumed (decision: ${decision}) — continuing from "${node}"\n`);
  });

  /**
   * 'aborted' fires when interruptManager.abort() is called.
   */
  compiled.interruptManager.on('aborted', ({ threadId: tid, reason }) => {
    console.log(`\n🛑 Thread "${tid}" ABORTED`);
    console.log(`   Reason: ${reason}\n`);
  });

  // ── Start the workflow ──────────────────────────────────────────────────

  const task =
    'Deploy the new authentication service (v2.3.1) to production. ' +
    'This includes migrating the user database schema, updating environment ' +
    'variables, and restarting the API gateway.';

  console.log(`📋 Task      : ${task.substring(0, 80)}…`);
  console.log(`🔑 Thread ID : ${threadId}\n`);
  console.log('Running automated pipeline: plan → code_changes → test → [PAUSE] → deploy\n');

  try {
    const finalState = await compiled.invoke({ task }, { threadId });

    // ── Print results ──────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Workflow Complete');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Tests passed : ${finalState.testsPassed ? '✅ YES' : '❌ NO'}`);
    console.log(`Approved     : ${finalState.approved ? '✅ YES' : '❌ NO'}`);
    console.log(`Deployed     : ${finalState.deployed ? '✅ YES' : '🚫 NO'}`);

    if (finalState.deployLog) {
      console.log('\nDeploy Log:');
      console.log(finalState.deployLog.substring(0, 800));
    }

    if (!finalState.deployed) {
      console.log(
        '\nℹ️  Deployment was not executed (either rejected by human or tests failed).',
      );
    }
  } catch (error) {
    // Distinguish abort from unexpected errors
    if (error?.name === 'GraphAbortError') {
      console.log(`\n🛑 Workflow aborted: ${error.message}`);
      process.exit(0);
    }
    console.error('\n❌ Workflow failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
main();
