/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║        Enhanced Research Workflow — MemMA-Inspired Graph Engine         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT THIS DEMONSTRATES:
 *   All three MemMA-inspired components working together in one workflow:
 *
 *   1. PlanningNode (Meta-Thinker forward path)
 *      • Strategy mode: decides the research approach before searching
 *      • Retrieval mode: decides what queries to run and evaluates sufficiency
 *
 *   2. RetrievalChecker (Iterative Refine-and-Probe)
 *      • Evaluates search result quality after retrieval
 *      • Can trigger a refined search if results are insufficient
 *
 *   3. MemoryValidator (Backward-path self-evolution)
 *      • Post-workflow memory validation
 *      • Generates probe QAs from the session, verifies, repairs
 *
 *   Plus the existing parallel fan-out: analysis nodes run concurrently.
 *
 * FLOW:
 *   START → plan_strategy → evaluate_plan → search → check_retrieval
 *           → [deep_analysis, source_check, fact_verify] → synthesize
 *           → validate_memory → END
 *
 * HOW TO RUN:
 *   node examples/graphs/enhanced-research-workflow.js
 */

// ─── Imports ───────────────────────────────────────────────────────────────

import { WorkflowGraph, GraphState } from '../../src/graph/index.js';
import { MemoryCheckpointer } from '../../src/graph/checkpointers/MemoryCheckpointer.js';
import { createAgentNode } from '../../src/graph/nodes/AgentNode.js';
import { createPlanningNode } from '../../src/graph/nodes/PlanningNode.js';
import { MemoryValidator } from '../../src/memory/MemoryValidator.js';
import { RetrievalChecker } from '../../src/memory/RetrievalChecker.js';
import fs from 'fs-extra';
import { START, END } from '../../src/graph/constants.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Get OpenRouter API key from environment or .env file */
function getApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const envPath = new URL('../../.env', import.meta.url).pathname;
    const content = fs.readFileSync(
      process.platform === 'win32' ? envPath.slice(1) : envPath,
      'utf-8'
    );
    const match = content.match(/OPENROUTER_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  return null;
}

// ─── Config ───────────────────────────────────────────────────────────────

/**
 * Model to use for planning and analysis nodes.
 * In production, pass via config.parentAgent instead.
 */
const DEMO_MODEL = 'google/gemini-2.0-flash-001';

// ─── State Schema ───────────────────────────────────────────────────────────

const stateSchema = GraphState.define({
  /** The user's research question */
  query: { default: '' },

  /** Strategy plan from the Meta-Thinker */
  strategy: { default: null },

  /** Retrieval plan (what to search for) */
  retrievalPlan: { default: null },

  /** Search queries to execute (from retrieval planning) */
  searchQueries: {
    default: [],
    reducer: (existing, incoming) => {
      const items = Array.isArray(incoming) ? incoming : [incoming];
      return [...existing, ...items];
    },
  },

  /** Raw search results */
  searches: {
    default: [],
    reducer: (existing, incoming) => {
      const items = Array.isArray(incoming) ? incoming : [incoming];
      return [...existing, ...items];
    },
  },

  /** Retrieval quality check results */
  retrievalQuality: { default: null },

  /** Whether retrieval results are sufficient */
  retrievalSufficient: { default: false },

  /** Analysis results from parallel nodes */
  analyses: {
    default: [],
    reducer: (existing, incoming) => {
      const items = Array.isArray(incoming) ? incoming : [incoming];
      return [...existing, ...items];
    },
  },

  /** Final synthesised report */
  finalReport: { default: null },

  /** Memory validation results */
  memoryValidation: { default: null },
});

// ─── Node Definitions ───────────────────────────────────────────────────────

/**
 * STRATEGY PLANNING NODE (Meta-Thinker)
 * Decides the overall research approach before any search happens.
 * This is MemMA's forward-path strategic guidance.
 */
const strategyNode = createPlanningNode({
  mode: 'strategy',
  model: DEMO_MODEL,
  inputMapper: (state) =>
    `You are a research strategist. Analyze the following query and produce a strategy.\n\n` +
    `QUERY: ${state.query}\n\n` +
    `Decide: what approach to take, what aspects to investigate, what risks/gaps to watch for.`,
  outputMapper: (result, state) => {
    let plan = result.plan ?? result;
    if (typeof plan === 'string') {
      try { plan = JSON.parse(plan); } catch { plan = { approach: plan, steps: [], risks: [], confidence: 0.5 }; }
    }
    return { strategy: plan };
  },
});

/**
 * RETRIEVAL PLANNING NODE (Meta-Thinker — retrieval mode)
 * Decides what specific queries to run based on the strategy.
 * This is MemMA's iterative retrieval guidance.
 */
const retrievalPlanNode = createPlanningNode({
  mode: 'retrieval',
  model: DEMO_MODEL,
  maxIterations: 3,
  inputMapper: (state) => {
    const strategy = state.strategy ?? {};
    return (
      `You are a search query planner. Based on the research strategy, generate specific search queries.\n\n` +
      `ORIGINAL QUERY: ${state.query}\n\n` +
      `STRATEGY: ${JSON.stringify(strategy, null, 2)}\n\n` +
      `Produce 3-5 specific search queries that will yield the best results. ` +
      `Flag any information still missing.`
    );
  },
  outputMapper: (result, state) => {
    let plan = result.plan ?? result;
    if (typeof plan === 'string') {
      try { plan = JSON.parse(plan); } catch { plan = { queries: [state.query], sufficient: true }; }
    }
    const queries = plan.queries || [state.query];
    return {
      retrievalPlan: plan,
      searchQueries: queries,
    };
  },
  planEvaluator: (plan, _state) => {
    const p = typeof plan === 'string' ? (() => { try { return JSON.parse(plan); } catch { return {}; } })() : plan;
    return p.sufficient === true || (p.queries && p.queries.length > 0);
  },
});

/**
 * SEARCH NODE (function node — direct web search, no ToolRegistry needed)
 * Calls the web search API directly from the graph node.
 */
const searchNode = {
  type: 'function',
  async execute(state) {
    const query = (state.searchQueries && state.searchQueries[0]) || state.query;
    console.log(`[search] Searching: "${query}"`);

    console.log(`[search] Searching: "${query}"`);

    try {
      const resp = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'perplexity/sonar',
          messages: [{ role: 'user', content: `Search for: ${query}. Provide detailed results.` }],
        }),
      });
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
      return { searches: text };
    } catch (err) {
      console.warn(`[search] Direct search failed (${err.message}), using placeholder results`);
      return { searches: `Search results for "${query}": [placeholder — web search requires ToolRegistry in production]` };
    }
  },
};

/**
 * REFINED SEARCH NODE (function node)
 */
const refinedSearchNode = {
  type: 'function',
  async execute(state) {
    const refinedQuery = state.retrievalQuality?.refinedQuery ||
      `${state.query} detailed research analysis 2026`;
    console.log(`[refined-search] Searching: "${refinedQuery}"`);

    try {
      const resp = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'perplexity/sonar',
          messages: [{ role: 'user', content: `Search for: ${refinedQuery}. Provide detailed results.` }],
        }),
      });
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
      return { searches: text };
    } catch (err) {
      console.warn(`[refined-search] Search failed (${err.message}), using placeholder results`);
      return { searches: `Refined search results for "${refinedQuery}": [placeholder]` };
    }
  },
};

/**
 * RETRIEVAL QUALITY CHECK NODE
 * Evaluates whether search results are sufficient for the research task.
 * Uses RetrievalChecker.quickCheck() — rule-based, no LLM needed.
 */
const retrievalCheckNode = {
  type: 'function',
  async execute(state) {
    const checker = new RetrievalChecker({ verbose: true });
    const query = state.query;
    const content = (state.searches || []).join('\n');

    const check = await checker.evaluateRetrieval({
      query,
      retrievedContent: content,
      options: { deep: false },
    });

    console.log(`[retrieval-check] Score: ${check.score.toFixed(2)}, Sufficient: ${check.sufficient}`);
    if (check.missingAspects.length > 0) {
      console.log(`[retrieval-check] Missing: ${check.missingAspects.join(', ')}`);
    }

    return {
      retrievalQuality: check,
      retrievalSufficient: check.sufficient,
    };
  },
};

/**
 * DEEP ANALYSIS NODE — parallel track 1
 */
const deepAnalysisNode = createAgentNode({
  model: DEMO_MODEL,
  inputMapper: (state) =>
    `You are a research analyst specialising in deep thematic analysis.\n\n` +
    `QUERY: ${state.query}\n\n` +
    `STRATEGY: ${state.strategy?.approach ?? 'general analysis'}\n\n` +
    `SEARCH RESULTS:\n${state.searches.join('\n\n')}\n\n` +
    `Provide a thorough thematic analysis: identify key themes, patterns, contradictions, and gaps.`,
  outputMapper: (result, _state) => ({
    analyses: {
      track: 'deep_analysis',
      content: result.response,
      timestamp: new Date().toISOString(),
    },
  }),
});

/**
 * SOURCE CHECK NODE — parallel track 2
 */
const sourceCheckNode = createAgentNode({
  model: DEMO_MODEL,
  inputMapper: (state) =>
    `You are a fact-checking expert specialising in source evaluation.\n\n` +
    `QUERY: ${state.query}\n\n` +
    `SEARCH RESULTS:\n${state.searches.join('\n\n')}\n\n` +
    `Evaluate each source: assess credibility, bias, recency, and authority.`,
  outputMapper: (result, _state) => ({
    analyses: {
      track: 'source_check',
      content: result.response,
      timestamp: new Date().toISOString(),
    },
  }),
});

/**
 * FACT VERIFY NODE — parallel track 3
 */
const factVerifyNode = createAgentNode({
  model: DEMO_MODEL,
  inputMapper: (state) =>
    `You are a rigorous fact-checker.\n\n` +
    `QUERY: ${state.query}\n\n` +
    `SEARCH RESULTS:\n${state.searches.join('\n\n')}\n\n` +
    `Identify and verify the key factual claims. Note discrepancies and unverified assertions.`,
  outputMapper: (result, _state) => ({
    analyses: {
      track: 'fact_verify',
      content: result.response,
      timestamp: new Date().toISOString(),
    },
  }),
});

/**
 * SYNTHESIZE NODE — merges all analyses into final report
 */
const synthesizeNode = createAgentNode({
  model: DEMO_MODEL,
  inputMapper: (state) => {
    const byTrack = {};
    for (const a of state.analyses) byTrack[a.track] = a.content;
    return (
      `You are a senior research editor. Synthesise the following analyses into a cohesive report.\n\n` +
      `ORIGINAL QUERY: ${state.query}\n\n` +
      `STRATEGY: ${state.strategy?.approach ?? 'N/A'}\n\n` +
      `THEMATIC ANALYSIS:\n${byTrack.deep_analysis ?? '(pending)'}\n\n` +
      `SOURCE EVALUATION:\n${byTrack.source_check ?? '(pending)'}\n\n` +
      `FACT VERIFICATION:\n${byTrack.fact_verify ?? '(pending)'}\n\n` +
      `Produce a report with: Executive Summary, Key Findings, Source Assessment, Verified Facts, and Conclusions.`
    );
  },
  outputMapper: (result, _state) => ({
    finalReport: result.response,
  }),
});

/**
 * MEMORY VALIDATION NODE (MemMA backward path)
 * After the workflow completes, validates memory with probe generation.
 * Uses quickCheck (rule-based) to avoid extra LLM calls in the demo.
 */
const memoryValidationNode = {
  type: 'function',
  async execute(state, _config) {
    // In production, pass an llmCallFn for deep validation.
    // For the demo, use quickCheck (rule-based, no LLM).
    const validator = new MemoryValidator({
      memoryManager: null,  // Pass a MemoryManager instance in production
      verbose: true,
    });

    const quickResult = await validator.quickCheck();

    console.log(`[memory-validation] Health score: ${quickResult.score.toFixed(2)}`);
    if (quickResult.issues.length > 0) {
      console.log(`[memory-validation] Issues: ${quickResult.issues.join(', ')}`);
    }

    return {
      memoryValidation: quickResult,
    };
  },
};

// ─── Graph Construction ─────────────────────────────────────────────────────

function buildEnhancedResearchGraph() {
  const graph = new WorkflowGraph(stateSchema);

  // ── Register nodes ──────────────────────────────────────────────────────
  graph.addNode('plan_strategy', strategyNode);
  graph.addNode('plan_retrieval', retrievalPlanNode);
  graph.addNode('search', searchNode);
  graph.addNode('check_retrieval', retrievalCheckNode);
  graph.addNode('refined_search', refinedSearchNode);
  graph.addNode('deep_analysis', deepAnalysisNode);
  graph.addNode('source_check', sourceCheckNode);
  graph.addNode('fact_verify', factVerifyNode);
  graph.addNode('synthesize', synthesizeNode);
  graph.addNode('validate_memory', memoryValidationNode);

  // ── Edges ───────────────────────────────────────────────────────────────
  //
  //   START → plan_strategy → plan_retrieval → search → check_retrieval
  //                                                        ├─(good)→ [deep_analysis, source_check, fact_verify]
  //                                                        └─(bad) → refined_search → [deep_analysis, source_check, fact_verify]
  //           → synthesize → validate_memory → END

  // ── Register all nodes first ───────────────────────────────────────────
  graph.addNode('fan_out_analysis', {
    type: 'function',
    async execute(state) { return {}; },  // no-op routing hub
  });

  // ── Edges ───────────────────────────────────────────────────────────────
  graph.setEntryPoint('plan_strategy');
  graph.addEdge('plan_strategy', 'plan_retrieval');
  graph.addEdge('plan_retrieval', 'search');
  graph.addEdge('search', 'check_retrieval');

  // Retrieval quality gate: good results → fan-out, bad results → refine first
  graph.addConditionalEdge(
    'check_retrieval',
    (state) => state.retrievalSufficient ? 'sufficient' : 'insufficient',
    {
      sufficient: 'fan_out_analysis',
      insufficient: 'refined_search',
    },
  );

  // Refined search feeds into the same fan-out hub
  graph.addEdge('refined_search', 'fan_out_analysis');

  // Parallel fan-out: fan_out_analysis → [deep_analysis, source_check, fact_verify] → synthesize
  graph.addParallelEdges(
    'fan_out_analysis',
    ['deep_analysis', 'source_check', 'fact_verify'],
    'synthesize',
  );

  // Synthesize → memory validation → END
  graph.addEdge('synthesize', 'validate_memory');
  graph.addEdge('validate_memory', END);

  // ── Compile ──────────────────────────────────────────────────────────────
  return graph.compile({
    checkpointer: new MemoryCheckpointer(),
    maxCycles: 20,
    verbose: true,
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔬 Enhanced Research Workflow — MemMA-Inspired Graph Engine\n');
  console.log('Components:');
  console.log('  🧠 PlanningNode (Meta-Thinker) — strategy + retrieval planning');
  console.log('  🔍 RetrievalChecker — quality gate with refine loop');
  console.log('  ✅ MemoryValidator — post-workflow memory health check');
  console.log('  ⚡ Parallel fan-out — concurrent analysis tracks\n');

  const compiled = buildEnhancedResearchGraph();
  const threadId = `enhanced-research-${Date.now()}`;

  const query = 'What are the latest advances in quantum computing error correction?';

  console.log(`📝 Query     : ${query}`);
  console.log(`🔑 Thread ID : ${threadId}\n`);

  try {
    const finalState = await compiled.invoke(
      { query },
      { threadId },
    );

    console.log('\n═══════════════════════════════════════');
    console.log('✅ Enhanced Research Complete');
    console.log('═══════════════════════════════════════');

    console.log(`\n── STRATEGY ─────────────────────────`);
    console.log(JSON.stringify(finalState.strategy, null, 2));

    console.log(`\n── RETRIEVAL PLAN ───────────────────`);
    console.log(JSON.stringify(finalState.retrievalPlan, null, 2));

    console.log(`\n── SEARCH QUALITY ───────────────────`);
    console.log(`Score: ${finalState.retrievalQuality?.score?.toFixed(2) ?? 'N/A'}`);
    console.log(`Sufficient: ${finalState.retrievalSufficient}`);

    console.log(`\n── ANALYSES (${finalState.analyses.length} tracks) ───`);
    for (const a of finalState.analyses) {
      console.log(`  [${a.track}] ${(a.content ?? '').substring(0, 200)}…`);
    }

    console.log(`\n── FINAL REPORT ─────────────────────`);
    console.log((finalState.finalReport ?? '(none)').substring(0, 500) + '…');

    console.log(`\n── MEMORY HEALTH ────────────────────`);
    const mv = finalState.memoryValidation;
    if (mv) {
      console.log(`Score: ${mv.score?.toFixed(2)}`);
      console.log(`Issues: ${mv.issues?.length ?? 0}`);
    }

  } catch (error) {
    console.error('\n❌ Enhanced research workflow failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

main();
