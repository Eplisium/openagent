/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║              Code Review Workflow — OpenAgent Graph Engine              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT THIS DEMONSTRATES:
 *   • A four-node plan → code → test → review loop
 *   • Conditional routing back to 'code' if the review rejects the work
 *   • An iteration guard (max 3 loops) to prevent infinite revision cycles
 *   • An interruptBefore('review') point so a human can inspect the code
 *     before the LLM reviewer runs
 *   • createAgentNode() from src/graph/nodes/AgentNode.js for LLM nodes
 *   • FileCheckpointer so the workflow survives process restarts
 *
 * HOW TO RUN:
 *   node examples/graphs/code-review-workflow.js
 *
 * HOW TO RESUME AFTER INTERRUPT:
 *   The process will log the threadId when it pauses. In a second terminal:
 *
 *     node -e "
 *       import('./src/graph/index.js').then(async ({ WorkflowGraph, GraphState, FileCheckpointer }) => {
 *         // Rebuild the same compiled graph, then call:
 *         await compiled.resume('YOUR_THREAD_ID');
 *       });
 *     "
 *
 *   Or simply press Enter in the running process — main() wires up stdin for demo.
 *
 * STATE SCHEMA:
 *   task           string  – The original coding task
 *   plan           string  – High-level implementation plan (from planner)
 *   code           string  – Generated source code (from coder)
 *   testResults    string  – Test output (from tester)
 *   reviewComments string  – Reviewer feedback
 *   approved       boolean – true when reviewer is satisfied
 *   iterations     number  – How many code/test/review loops have occurred
 *   messages       array   – Accumulated message history
 */

// ─── Imports ───────────────────────────────────────────────────────────────

import { WorkflowGraph, GraphState } from '../../src/graph/index.js';
import { FileCheckpointer } from '../../src/graph/checkpointers/FileCheckpointer.js';
import { createAgentNode } from '../../src/graph/nodes/AgentNode.js';
import { START, END } from '../../src/graph/constants.js';

// ─── State Schema ───────────────────────────────────────────────────────────

/**
 * Define the shared state for the code-review workflow.
 *
 * Fields marked with a reducer accumulate values across nodes;
 * all others use last-write-wins semantics.
 */
const stateSchema = GraphState.define({
  /** The original task description supplied by the user */
  task: { default: '' },

  /** Implementation plan produced by the 'plan' node */
  plan: { default: null },

  /** Source code produced by the 'code' node */
  code: { default: null },

  /** Test execution results produced by the 'test' node */
  testResults: { default: null },

  /** Reviewer feedback produced by the 'review' node */
  reviewComments: { default: null },

  /** Set to true by the review node when it approves the code */
  approved: { default: false },

  /**
   * Tracks how many times the code→test→review loop has run.
   * Uses an additive reducer so the counter accumulates across iterations.
   */
  iterations: {
    default: 0,
    reducer: (current, increment) => current + increment,
  },

  /**
   * Append-only message log.  Each node pushes one entry of the form
   * { role: string, content: string, timestamp: string }.
   */
  messages: {
    default: [],
    reducer: (existing, incoming) => [...existing, ...incoming],
  },
});

// ─── Node Definitions ───────────────────────────────────────────────────────

/**
 * PLAN NODE
 * Receives the raw task and produces a structured implementation plan.
 * This node runs only once (before the code→test→review loop).
 */
const planNode = createAgentNode({
  // Map the current state → a prompt string for the LLM
  inputMapper: (state) =>
    `You are a senior software architect. Produce a clear, step-by-step implementation plan for the following task:\n\n${state.task}\n\nKeep the plan concise (5-10 bullet points). Focus on structure, not code.`,

  // Map the LLM's response → partial state update
  outputMapper: (result, _state) => ({
    plan: result.response,
    messages: [
      {
        role: 'planner',
        content: result.response,
        timestamp: new Date().toISOString(),
      },
    ],
  }),
});

/**
 * CODE NODE
 * Implements the plan (or revises code based on reviewer feedback).
 * Runs at least once, then loops back here if the reviewer rejects.
 */
const codeNode = createAgentNode({
  inputMapper: (state) => {
    // First iteration: implement from the plan
    if (!state.reviewComments) {
      return (
        `You are an expert JavaScript developer. Implement the following plan:\n\n${state.plan}\n\n` +
        'Write clean, well-commented code. Include JSDoc for all public functions.'
      );
    }
    // Subsequent iterations: incorporate reviewer feedback
    return (
      `You are an expert JavaScript developer. Revise the code below based on the reviewer's feedback.\n\n` +
      `CURRENT CODE:\n${state.code}\n\n` +
      `REVIEWER FEEDBACK:\n${state.reviewComments}\n\n` +
      'Address every issue raised. Return the complete revised file.'
    );
  },

  outputMapper: (result, _state) => ({
    code: result.response,
    // Signal one completed iteration (the reducer sums these up)
    iterations: 1,
    messages: [
      {
        role: 'coder',
        content: `Code iteration complete (${result.response.length} chars)`,
        timestamp: new Date().toISOString(),
      },
    ],
  }),
});

/**
 * TEST NODE
 * Writes and "runs" (simulates) unit tests for the generated code.
 * In a real workflow you would shell out to a test runner here instead.
 */
const testNode = createAgentNode({
  inputMapper: (state) =>
    `You are a QA engineer. Write comprehensive unit tests for the following code, then simulate running them and report the results (PASS/FAIL with details):\n\n${state.code}`,

  outputMapper: (result, _state) => ({
    testResults: result.response,
    messages: [
      {
        role: 'tester',
        content: result.response,
        timestamp: new Date().toISOString(),
      },
    ],
  }),
});

/**
 * REVIEW NODE
 * Reviews the code and tests, then decides whether to approve.
 *
 * ⚠️  This node is configured as an interruptBefore point.
 *     The graph will PAUSE before this node runs, giving a human
 *     the opportunity to inspect the code and override the review.
 */
const reviewNode = createAgentNode({
  inputMapper: (state) =>
    `You are a strict code reviewer. Review the following code and its test results.\n\n` +
    `CODE:\n${state.code}\n\n` +
    `TEST RESULTS:\n${state.testResults}\n\n` +
    `Reply with:\n` +
    `- APPROVED if the code meets production quality standards\n` +
    `- REJECTED: <specific issues> if revisions are needed\n\n` +
    `Be concise and actionable.`,

  outputMapper: (result, _state) => {
    const response = result.response ?? '';
    const approved = response.trim().toUpperCase().startsWith('APPROVED');
    return {
      reviewComments: response,
      approved,
      messages: [
        {
          role: 'reviewer',
          content: response,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  },
});

// ─── Graph Construction ─────────────────────────────────────────────────────

/**
 * Build and compile the code-review workflow graph.
 *
 * @returns {import('../../src/graph/CompiledGraph.js').CompiledGraph}
 */
function buildCodeReviewGraph() {
  const graph = new WorkflowGraph(stateSchema);

  // ── Register nodes ──────────────────────────────────────────────────────
  graph.addNode('plan', planNode);
  graph.addNode('code', codeNode);
  graph.addNode('test', testNode);
  graph.addNode('review', reviewNode);

  // ── Simple (unconditional) edges ────────────────────────────────────────
  //   START → plan → code → test → review
  graph.setEntryPoint('plan');    // also adds START → plan
  graph.addEdge('plan', 'code');
  graph.addEdge('code', 'test');
  graph.addEdge('test', 'review');

  // ── Conditional edge from review ─────────────────────────────────────────
  //   • approved           → END
  //   • iterations >= 3    → END  (max-iteration guard)
  //   • otherwise          → code (loop back for revision)
  graph.addConditionalEdge(
    'review',
    (state) => {
      if (state.approved) return 'approved';
      if (state.iterations >= 3) return 'maxIterations';
      return 'revise';
    },
    {
      approved: END,
      maxIterations: END,
      revise: 'code',   // ← this is the loop-back
    },
  );

  // ── Human-in-the-loop: pause BEFORE review runs ─────────────────────────
  //   The graph will call interruptManager.pause() here, emit a 'paused'
  //   event, and wait until compiled.resume(threadId) is called.
  graph.interruptBefore(['review']);

  // ── Compile the graph ────────────────────────────────────────────────────
  return graph.compile({
    checkpointer: new FileCheckpointer(),
    maxCycles: 25,   // safety net against routing bugs
    verbose: true,
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Entry point — demonstrates the full workflow end-to-end.
 *
 * What happens:
 *  1. Graph starts: plan → code → test
 *  2. Before 'review' runs, execution pauses and logs the threadId
 *  3. We auto-resume after 5 seconds (simulating human approval)
 *  4. Review decides: approved or loop back
 *  5. Final state is printed
 */
async function main() {
  console.log('🚀 Code Review Workflow — OpenAgent Graph Engine\n');

  const compiled = buildCodeReviewGraph();

  // Generate a stable thread ID for this run
  const threadId = `code-review-${Date.now()}`;

  // ── Wire up event listeners before invoking ────────────────────────────

  compiled.interruptManager.on('paused', ({ threadId: tid, nodeName, state }) => {
    console.log(`\n⏸️  Paused before node "${nodeName}"`);
    console.log(`   Thread ID : ${tid}`);
    console.log(`   Iteration : ${state.iterations}`);
    console.log(`   Code preview:\n${(state.code ?? '').substring(0, 300)}…`);
    console.log('\n   [Demo] Auto-resuming in 5 seconds…');
    console.log(`   (In production: call compiled.resume('${tid}') when ready)\n`);

    // Simulate human approval after a short delay
    setTimeout(async () => {
      try {
        console.log('✅ Human approved — resuming workflow…\n');
        // Pass null to continue with unchanged state, or pass an object
        // like { approved: true } to force-override the reviewer's decision.
        await compiled.resume(tid, null);
      } catch (err) {
        console.error('Resume failed:', err.message);
      }
    }, 5_000);
  });

  compiled.interruptManager.on('resumed', ({ threadId: tid, node }) => {
    console.log(`▶️  Resumed thread "${tid}" at node "${node}"\n`);
  });

  compiled.interruptManager.on('aborted', ({ threadId: tid, reason }) => {
    console.log(`🛑 Thread "${tid}" aborted: ${reason}\n`);
  });

  // ── Start the workflow ──────────────────────────────────────────────────

  try {
    console.log(`📋 Task: Build a JWT authentication middleware for Express.js`);
    console.log(`🔑 Thread ID: ${threadId}\n`);

    const finalState = await compiled.invoke(
      { task: 'Build a JWT authentication middleware for Express.js' },
      { threadId },
    );

    // ── Print results ──────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════');
    console.log('✅ Workflow Complete');
    console.log('═══════════════════════════════════════');
    console.log(`Approved      : ${finalState.approved}`);
    console.log(`Iterations    : ${finalState.iterations}`);
    console.log(`Messages      : ${finalState.messages.length} entries`);
    console.log('\nReview Comments:');
    console.log(finalState.reviewComments ?? '(none)');

    if (finalState.iterations >= 3 && !finalState.approved) {
      console.log('\n⚠️  Reached maximum iterations without approval.');
    }
  } catch (error) {
    console.error('\n❌ Workflow failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
main();
