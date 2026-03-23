/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║              Research Workflow — OpenAgent Graph Engine                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT THIS DEMONSTRATES:
 *   • Fan-out (parallel execution): a single search_node fans out to three
 *     independent analysis nodes that run CONCURRENTLY via Promise.allSettled
 *   • Three parallel analysis tracks:
 *       deep_analysis  – in-depth thematic analysis
 *       source_check   – credibility / source quality assessment
 *       fact_verify    – fact-checking & cross-referencing
 *   • Fan-in via a 'synthesize' node that merges all three analyses into a
 *     cohesive final report
 *   • createToolNode for the web_search step (no LLM, pure tool call)
 *   • createAgentNode for all LLM-powered analysis steps
 *   • Array reducers on 'searches' and 'analyses' so parallel nodes can
 *     safely write results without overwriting each other
 *
 * HOW TO RUN:
 *   node examples/graphs/research-workflow.js
 *
 * PARALLEL EXECUTION MODEL:
 *   In the OpenAgent graph engine the 'search_node' has multiple outgoing
 *   simple edges (to deep_analysis, source_check, and fact_verify).
 *   The CompiledGraph detects this fan-out and executes them concurrently
 *   using Promise.allSettled(), merging state updates through the reducers.
 *
 * STATE SCHEMA:
 *   query        string   – Original research query
 *   searches     string[] – Raw search results (accumulated)
 *   analyses     object[] – Analysis results from parallel nodes (accumulated)
 *   finalReport  string   – Synthesised final report
 *
 * FLOW:
 *   START → search_node → [deep_analysis, source_check, fact_verify] → synthesize → END
 */

// ─── Imports ───────────────────────────────────────────────────────────────

import { WorkflowGraph, GraphState } from '../../src/graph/index.js';
import { MemoryCheckpointer } from '../../src/graph/checkpointers/MemoryCheckpointer.js';
import { createAgentNode } from '../../src/graph/nodes/AgentNode.js';
import { createToolNode } from '../../src/graph/nodes/ToolNode.js';
import { START, END } from '../../src/graph/constants.js';

// ─── State Schema ───────────────────────────────────────────────────────────

/**
 * State schema for the research workflow.
 *
 * The 'searches' and 'analyses' fields use append reducers so that multiple
 * parallel nodes can independently push results without conflict.
 */
const stateSchema = GraphState.define({
  /** The user's research question */
  query: { default: '' },

  /**
   * Raw search result strings.
   * The search_node pushes one entry; the reducer appends it to the array.
   */
  searches: {
    default: [],
    reducer: (existing, incoming) => {
      // incoming might be a single string or an array — normalise to array
      const items = Array.isArray(incoming) ? incoming : [incoming];
      return [...existing, ...items];
    },
  },

  /**
   * Analysis objects from each parallel analysis node.
   * Each node pushes { track, content, timestamp }.
   */
  analyses: {
    default: [],
    reducer: (existing, incoming) => {
      const items = Array.isArray(incoming) ? incoming : [incoming];
      return [...existing, ...items];
    },
  },

  /** Final synthesised report produced by the synthesize node */
  finalReport: { default: null },
});

// ─── Node Definitions ───────────────────────────────────────────────────────

/**
 * SEARCH NODE (tool node — no LLM)
 * Calls the 'web_search' tool directly using the query from state.
 * createToolNode wraps ToolRegistry.execute() so no LLM call is needed.
 *
 * Note: The ToolRegistry must have 'web_search' registered and be supplied
 * via config.toolRegistry when invoking the compiled graph.
 */
const searchNode = createToolNode('web_search', {
  // Map state → tool arguments
  argsMapper: (state) => ({
    query: state.query,
    count: 5,        // request 5 results
  }),

  // Map tool result → partial state update
  outputMapper: (result, _state) => {
    // result is whatever web_search returns — normalise to a string snippet
    const text =
      typeof result === 'string'
        ? result
        : result?.results?.map((r) => `[${r.title}] ${r.snippet}`).join('\n') ??
          JSON.stringify(result);

    return {
      searches: text,   // reducer will append this to the searches array
    };
  },
});

/**
 * DEEP ANALYSIS NODE
 * Performs an in-depth thematic analysis of the search results.
 * Runs in parallel with source_check and fact_verify.
 */
const deepAnalysisNode = createAgentNode({
  inputMapper: (state) =>
    `You are a research analyst specialising in deep thematic analysis.\n\n` +
    `QUERY: ${state.query}\n\n` +
    `SEARCH RESULTS:\n${state.searches.join('\n\n')}\n\n` +
    `Provide a thorough thematic analysis: identify key themes, patterns, contradictions, and gaps in the literature.`,

  outputMapper: (result, _state) => ({
    analyses: {
      track: 'deep_analysis',
      content: result.response,
      timestamp: new Date().toISOString(),
    },
  }),
});

/**
 * SOURCE CHECK NODE
 * Evaluates the credibility and quality of the sources found.
 * Runs in parallel with deep_analysis and fact_verify.
 */
const sourceCheckNode = createAgentNode({
  inputMapper: (state) =>
    `You are a fact-checking expert specialising in source evaluation.\n\n` +
    `QUERY: ${state.query}\n\n` +
    `SEARCH RESULTS:\n${state.searches.join('\n\n')}\n\n` +
    `Evaluate each source: assess credibility, bias, recency, and authority. ` +
    `Flag any unreliable or questionable sources.`,

  outputMapper: (result, _state) => ({
    analyses: {
      track: 'source_check',
      content: result.response,
      timestamp: new Date().toISOString(),
    },
  }),
});

/**
 * FACT VERIFY NODE
 * Cross-references claims in the search results for factual accuracy.
 * Runs in parallel with deep_analysis and source_check.
 */
const factVerifyNode = createAgentNode({
  inputMapper: (state) =>
    `You are a rigorous fact-checker.\n\n` +
    `QUERY: ${state.query}\n\n` +
    `SEARCH RESULTS:\n${state.searches.join('\n\n')}\n\n` +
    `Identify and verify the key factual claims. Note any discrepancies, ` +
    `unverified assertions, or claims that contradict each other.`,

  outputMapper: (result, _state) => ({
    analyses: {
      track: 'fact_verify',
      content: result.response,
      timestamp: new Date().toISOString(),
    },
  }),
});

/**
 * SYNTHESIZE NODE
 * Fan-in point: merges all three parallel analyses into one final report.
 * Runs only after deep_analysis, source_check, AND fact_verify all complete.
 */
const synthesizeNode = createAgentNode({
  inputMapper: (state) => {
    // Build a structured prompt from all three analysis tracks
    const analysisByTrack = {};
    for (const a of state.analyses) {
      analysisByTrack[a.track] = a.content;
    }

    return (
      `You are a senior research editor. Synthesise the following three parallel analyses ` +
      `into a single, cohesive, well-structured research report.\n\n` +
      `ORIGINAL QUERY: ${state.query}\n\n` +
      `THEMATIC ANALYSIS:\n${analysisByTrack.deep_analysis ?? '(pending)'}\n\n` +
      `SOURCE EVALUATION:\n${analysisByTrack.source_check ?? '(pending)'}\n\n` +
      `FACT VERIFICATION:\n${analysisByTrack.fact_verify ?? '(pending)'}\n\n` +
      `Produce a report with: Executive Summary, Key Findings, Source Assessment, ` +
      `Verified Facts, and Conclusions.`
    );
  },

  outputMapper: (result, _state) => ({
    finalReport: result.response,
  }),
});

// ─── Graph Construction ─────────────────────────────────────────────────────

/**
 * Build and compile the research workflow graph.
 *
 * Fan-out is achieved by adding multiple simple edges from 'search_node'.
 * The CompiledGraph runtime detects this and executes the targets in parallel.
 *
 * @returns {import('../../src/graph/CompiledGraph.js').CompiledGraph}
 */
function buildResearchGraph() {
  const graph = new WorkflowGraph(stateSchema);

  // ── Register nodes ──────────────────────────────────────────────────────
  graph.addNode('search_node', searchNode);
  graph.addNode('deep_analysis', deepAnalysisNode);
  graph.addNode('source_check', sourceCheckNode);
  graph.addNode('fact_verify', factVerifyNode);
  graph.addNode('synthesize', synthesizeNode);

  // ── Edges ───────────────────────────────────────────────────────────────
  //
  //   START → search_node
  //                 ├──► deep_analysis ──┐
  //                 ├──► source_check   ─┼──► synthesize → END
  //                 └──► fact_verify   ──┘
  //
  graph.setEntryPoint('search_node');

  // Fan-out: search_node → [deep_analysis, source_check, fact_verify]
  // Multiple addEdge calls from the same node signal parallel execution.
  graph.addEdge('search_node', 'deep_analysis');
  graph.addEdge('search_node', 'source_check');
  graph.addEdge('search_node', 'fact_verify');

  // Fan-in: all three analysis nodes feed into synthesize
  graph.addEdge('deep_analysis', 'synthesize');
  graph.addEdge('source_check', 'synthesize');
  graph.addEdge('fact_verify', 'synthesize');

  // Synthesize → END
  graph.addEdge('synthesize', END);

  // ── Compile ──────────────────────────────────────────────────────────────
  return graph.compile({
    checkpointer: new MemoryCheckpointer(),   // in-memory is fine for research
    maxCycles: 15,
    verbose: true,
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Entry point — runs a sample research query through the parallel workflow.
 */
async function main() {
  console.log('🔬 Research Workflow — OpenAgent Graph Engine (Fan-out/Fan-in)\n');

  const compiled = buildResearchGraph();
  const threadId = `research-${Date.now()}`;

  // Example research query
  const query = 'What are the latest advances in quantum computing error correction?';

  console.log(`📝 Query     : ${query}`);
  console.log(`🔑 Thread ID : ${threadId}\n`);
  console.log('Step 1: search_node  → fetching results');
  console.log('Step 2: Fan-out      → deep_analysis + source_check + fact_verify (parallel)');
  console.log('Step 3: synthesize   → merging all analyses into final report\n');

  try {
    const finalState = await compiled.invoke(
      { query },
      {
        threadId,
        // In a real deployment, pass your ToolRegistry here:
        //   toolRegistry: myRegistry,
      },
    );

    // ── Print results ──────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════');
    console.log('✅ Research Complete');
    console.log('═══════════════════════════════════════');
    console.log(`\nSearch results collected : ${finalState.searches.length}`);
    console.log(`Analysis tracks completed: ${finalState.analyses.length}/3`);

    for (const analysis of finalState.analyses) {
      console.log(`\n── ${analysis.track.toUpperCase()} ─────────────────────────`);
      console.log((analysis.content ?? '').substring(0, 400) + '…');
    }

    console.log('\n── FINAL REPORT ─────────────────────────────────────────────');
    console.log(finalState.finalReport ?? '(no report generated)');
  } catch (error) {
    console.error('\n❌ Research workflow failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
main();
