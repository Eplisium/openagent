/**
 * 🕸️ Graph Management Tools
 *
 * Exposes the WorkflowGraph / CompiledGraph engine as callable agent tools.
 * Supports two modes:
 *   1. Registry mode (AgentSession) — look up workflows by name from session.registry
 *   2. Single graph mode (CompiledGraph) — direct access to one compiled graph
 *
 * Use `createGraphTools(agentSession)` or `createGraphTools(compiledGraph)`.
 *
 * Tools provided:
 *   graph_run              – Start a named workflow
 *   graph_resume           – Resume a paused workflow
 *   graph_status           – Inspect thread status
 *   graph_list_checkpoints – List saved checkpoints
 *   graph_visualize        – Generate Mermaid diagram
 *   graph_abort            – Abort a paused workflow
 *   graph_list_workflows   – List registered workflows (registry mode only)
 *
 * @module graphTools
 */

/**
 * Safely extract a compact summary from a graph state object.
 * Avoids returning huge raw state blobs to the LLM.
 */
function summariseState(state) {
  if (!state || typeof state !== 'object') return { empty: true };
  const summary = {};
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith('_')) continue;
    if (value === null || value === undefined) {
      summary[key] = null;
    } else if (typeof value === 'string') {
      summary[key] = value.length > 200 ? value.substring(0, 200) + '…' : value;
    } else if (Array.isArray(value)) {
      summary[key] = `[Array(${value.length})]`;
    } else if (typeof value === 'object') {
      summary[key] = '[Object]';
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Resolve a CompiledGraph from the engine.
 * Supports both registry mode (AgentSession) and single-graph mode.
 */
function resolveCompiledGraph(engine, graphName) {
  // Registry mode: AgentSession with workflowRegistry
  if (engine.workflowRegistry instanceof Map) {
    if (!graphName) {
      // Return first available if only one workflow registered
      if (engine.workflowRegistry.size === 1) {
        const entry = engine.workflowRegistry.values().next().value;
        return { compiled: entry.compiled, name: [...engine.workflowRegistry.keys()][0] };
      }
      return { error: 'graphName is required when multiple workflows are registered. Available: ' + [...engine.workflowRegistry.keys()].join(', ') };
    }
    const entry = engine.workflowRegistry.get(graphName);
    if (!entry) {
      return { error: `Workflow "${graphName}" not found. Available: ${[...engine.workflowRegistry.keys()].join(', ')}` };
    }
    return { compiled: entry.compiled, name: graphName };
  }

  // Single graph mode: directly a CompiledGraph
  if (engine.invoke && engine.resume) {
    return { compiled: engine, name: graphName || 'default' };
  }

  return { error: 'graphEngine must be an AgentSession or CompiledGraph instance' };
}

/**
 * Find any CompiledGraph that has a paused thread (for resume/status/abort when graphName is unknown).
 */
function findCompiledForThread(engine, threadId) {
  // Registry mode
  if (engine.workflowRegistry instanceof Map) {
    for (const [name, entry] of engine.workflowRegistry) {
      if (entry.compiled.interruptManager?.isPaused?.(threadId)) {
        return { compiled: entry.compiled, name };
      }
    }
    // Also check checkpoint storage — the graph might be paused but we can't tell from isPaused alone
    for (const [name, entry] of engine.workflowRegistry) {
      const state = entry.compiled.checkpointer?.load?.(threadId);
      if (state) return { compiled: entry.compiled, name };
    }
  }
  // Single graph mode
  if (engine.invoke && engine.resume) {
    return { compiled: engine, name: 'default' };
  }
  return null;
}

/**
 * Create graph management tools bound to an AgentSession or CompiledGraph.
 *
 * @param {object} graphEngine - AgentSession (registry mode) or CompiledGraph (single mode)
 * @returns {Array<object>} Array of tool definitions for ToolRegistry
 */
export function createGraphTools(graphEngine) {
  if (!graphEngine) {
    throw new Error('createGraphTools: graphEngine is required');
  }

  // ─── graph_list_workflows ────────────────────────────────────────

  const graphListWorkflowsTool = {
    name: 'graph_list_workflows',
    description: 'List all registered workflow graphs with their node counts. Shows which workflows are available to run.',
    category: 'graph',
    parameters: { type: 'object', properties: {}, required: [] },
    timeout: 5000,
    async execute() {
      try {
        if (!(graphEngine.workflowRegistry instanceof Map)) {
          return { success: true, mode: 'single_graph', message: 'Using single graph mode (no registry)' };
        }
        const workflows = [];
        for (const [name, entry] of graphEngine.workflowRegistry) {
          workflows.push({
            name,
            nodeCount: entry.graph._nodes.size,
            registered: entry.registered,
          });
        }
        return { success: true, count: workflows.length, workflows };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─── graph_run ───────────────────────────────────────────────────

  const graphRunTool = {
    name: 'graph_run',
    description: 'Start a workflow graph. Provide the workflow name (if multiple registered) and initial input. ' +
      'Returns a summary of the final state when complete, or pause info if the workflow hits an interrupt point.',
    category: 'graph',
    parameters: {
      type: 'object',
      properties: {
        graphName: {
          type: 'string',
          description: 'Name of the registered workflow. Omit if only one workflow is registered.',
        },
        input: {
          type: 'object',
          description: 'Initial state input for the workflow.',
        },
        threadId: {
          type: 'string',
          description: 'Optional unique thread ID. Auto-generated if omitted.',
        },
      },
      required: ['input'],
    },
    timeout: 300_000,
    async execute({ graphName, input, threadId }) {
      try {
        if (!input || typeof input !== 'object') {
          return { success: false, error: 'input must be a non-null object' };
        }

        const resolved = resolveCompiledGraph(graphEngine, graphName);
        if (resolved.error) return { success: false, error: resolved.error };
        const { compiled, name } = resolved;

        const resolvedThreadId = threadId || `${name}_${Date.now()}`;

        // Track active graph on session if in registry mode
        if (graphEngine.activeGraphs instanceof Map) {
          graphEngine.activeGraphs.set(resolvedThreadId, compiled);
        }

        try {
          const finalState = await compiled.invoke(input, { threadId: resolvedThreadId });
          return {
            success: true,
            graphName: name,
            threadId: resolvedThreadId,
            stateSummary: summariseState(finalState),
            executionLog: finalState?._executionLog ?? [],
          };
        } finally {
          graphEngine.activeGraphs?.delete(resolvedThreadId);
        }
      } catch (error) {
        if (error?.name === 'GraphInterruptError' || error?.isPause) {
          return {
            success: true,
            paused: true,
            threadId,
            message: `Workflow paused at interrupt point: ${error.message}`,
          };
        }
        return { success: false, error: error.message };
      }
    },
  };

  // ─── graph_resume ────────────────────────────────────────────────

  const graphResumeTool = {
    name: 'graph_resume',
    description: 'Resume a paused workflow. Optionally supply humanInput to inject state updates (e.g., { "approved": true }).',
    category: 'graph',
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Thread ID of the paused workflow.' },
        humanInput: { type: 'object', description: 'Optional state updates to apply before resuming.' },
      },
      required: ['threadId'],
    },
    timeout: 300_000,
    async execute({ threadId, humanInput }) {
      try {
        if (!threadId) return { success: false, error: 'threadId is required' };

        // Find the right compiled graph
        let compiled = null;
        // Check active graphs first
        if (graphEngine.activeGraphs instanceof Map) {
          compiled = graphEngine.activeGraphs.get(threadId);
        }
        // Search registry
        if (!compiled) {
          const found = findCompiledForThread(graphEngine, threadId);
          if (found) compiled = found.compiled;
        }
        if (!compiled) {
          return { success: false, error: `No workflow found for thread "${threadId}". It may have completed or never existed.` };
        }

        const isPaused = compiled.interruptManager?.isPaused?.(threadId);
        if (isPaused === false) {
          return { success: false, error: `Thread "${threadId}" is not paused. Use graph_status to check.` };
        }

        if (graphEngine.activeGraphs instanceof Map) {
          graphEngine.activeGraphs.set(threadId, compiled);
        }

        const result = await compiled.resume(threadId, humanInput ?? null);
        return {
          success: true,
          threadId,
          stateSummary: summariseState(result),
          executionLog: result?._executionLog ?? [],
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─── graph_status ────────────────────────────────────────────────

  const graphStatusTool = {
    name: 'graph_status',
    description: 'Check the current status of a workflow thread — whether paused, which node it last executed, checkpoint count, and state summary.',
    category: 'graph',
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The thread ID to inspect.' },
      },
      required: ['threadId'],
    },
    timeout: 10_000,
    async execute({ threadId }) {
      try {
        if (!threadId) return { success: false, error: 'threadId is required' };

        let compiled = graphEngine.activeGraphs?.get?.(threadId);
        if (!compiled) {
          const found = findCompiledForThread(graphEngine, threadId);
          if (found) compiled = found.compiled;
        }
        if (!compiled) {
          return { success: false, error: `No workflow found for thread "${threadId}"` };
        }

        const isPaused = compiled.interruptManager?.isPaused?.(threadId) ?? false;
        const pendingInfo = isPaused ? compiled.interruptManager?.getPendingInfo?.(threadId) : null;
        const snapshot = await compiled.checkpointer?.load?.(threadId);
        const checkpoints = await compiled.checkpointer?.list?.(threadId);
        const checkpointCount = Array.isArray(checkpoints) ? checkpoints.length : 0;

        return {
          success: true,
          threadId,
          isPaused,
          currentNode: pendingInfo?.node ?? snapshot?.currentNode ?? null,
          pausedAt: pendingInfo?.pausedAt ?? null,
          cycleCount: snapshot?.cycleCount ?? null,
          checkpointCount,
          stateSummary: summariseState(snapshot?.state ?? null),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─── graph_list_checkpoints ──────────────────────────────────────

  const graphListCheckpointsTool = {
    name: 'graph_list_checkpoints',
    description: 'List all saved checkpoints for a workflow thread (oldest to newest). Each entry includes checkpoint ID, active node, and timestamp.',
    category: 'graph',
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The thread ID whose checkpoints to list.' },
      },
      required: ['threadId'],
    },
    timeout: 10_000,
    async execute({ threadId }) {
      try {
        if (!threadId) return { success: false, error: 'threadId is required' };

        let compiled = graphEngine.activeGraphs?.get?.(threadId);
        if (!compiled) {
          const found = findCompiledForThread(graphEngine, threadId);
          if (found) compiled = found.compiled;
        }
        if (!compiled) return { success: false, error: `No workflow found for thread "${threadId}"` };

        const checkpoints = await compiled.checkpointer?.list?.(threadId);
        if (!Array.isArray(checkpoints)) return { success: false, error: 'Checkpointer.list() did not return an array' };

        return {
          success: true,
          threadId,
          count: checkpoints.length,
          checkpoints: checkpoints.map(cp => ({
            checkpointId: cp.checkpointId ?? cp.id ?? '(unknown)',
            currentNode: cp.currentNode ?? cp.node ?? null,
            timestamp: cp.timestamp ?? null,
          })),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─── graph_visualize ─────────────────────────────────────────────

  const graphVisualizeTool = {
    name: 'graph_visualize',
    description: 'Generate a Mermaid flowchart diagram of a workflow graph. Paste into mermaid.live to render. ' +
      'HITL interrupt points are highlighted in yellow.',
    category: 'graph',
    parameters: {
      type: 'object',
      properties: {
        graphName: { type: 'string', description: 'Optional workflow name to visualize.' },
      },
      required: [],
    },
    timeout: 10_000,
    async execute({ graphName } = {}) {
      try {
        let workflowGraph = null;

        // Registry mode
        if (graphEngine.workflowRegistry instanceof Map) {
          if (graphName) {
            const entry = graphEngine.workflowRegistry.get(graphName);
            workflowGraph = entry?.graph;
          } else if (graphEngine.workflowRegistry.size === 1) {
            workflowGraph = graphEngine.workflowRegistry.values().next().value.graph;
          } else {
            return { success: false, error: 'graphName is required when multiple workflows are registered' };
          }
        }
        // Single graph mode
        if (!workflowGraph && graphEngine.graph) {
          workflowGraph = graphEngine.graph;
        }

        if (!workflowGraph) {
          return { success: false, error: 'No graph found to visualize' };
        }

        if (typeof workflowGraph.toMermaid === 'function') {
          return {
            success: true,
            format: 'mermaid',
            graphName: graphName ?? '(unnamed)',
            diagram: workflowGraph.toMermaid(),
            tip: 'Paste into https://mermaid.live to render.',
          };
        }

        // Fallback: build Mermaid from internals
        const lines = ['flowchart TD'];
        const label = n => n.replace(/[^a-zA-Z0-9_]/g, '_');
        const nodes = workflowGraph._nodes || workflowGraph.nodes;
        const edges = workflowGraph._edges || workflowGraph.edges;
        const condEdges = workflowGraph._conditionalEdges || workflowGraph.conditionalEdges;

        if (nodes instanceof Map) {
          for (const [name, def] of nodes) {
            const type = def.type ?? 'function';
            lines.push(`  ${label(name)}["${name} (${type})"]`);
          }
        }
        if (edges instanceof Map) {
          for (const [from, targets] of edges) {
            if (typeof targets === 'string') {
              lines.push(`  ${label(from)} --> ${label(targets)}`);
            } else if (Array.isArray(targets)) {
              for (const to of targets) lines.push(`  ${label(from)} --> ${label(to)}`);
            }
          }
        }
        if (condEdges instanceof Map) {
          for (const [from, { mapping }] of condEdges) {
            for (const [key, to] of Object.entries(mapping)) {
              lines.push(`  ${label(from)} -. "${key}" .-> ${label(to)}`);
            }
          }
        }
        const intBefore = workflowGraph._interruptBefore;
        if (intBefore instanceof Set) {
          for (const n of intBefore) {
            lines.push(`  style ${label(n)} fill:#ffcc00,stroke:#cc8800,color:#000`);
          }
        }

        return {
          success: true,
          format: 'mermaid',
          graphName: graphName ?? '(unnamed)',
          diagram: lines.join('\n'),
          tip: 'Yellow nodes have interruptBefore (HITL pause points).',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  // ─── graph_abort ─────────────────────────────────────────────────

  const graphAbortTool = {
    name: 'graph_abort',
    description: 'Abort a paused workflow permanently. The thread cannot be resumed after aborting. Only works on paused threads.',
    category: 'graph',
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Thread ID of the paused workflow to abort.' },
        reason: { type: 'string', description: 'Optional reason (logged to audit trail).' },
      },
      required: ['threadId'],
    },
    timeout: 10_000,
    async execute({ threadId, reason }) {
      try {
        if (!threadId) return { success: false, error: 'threadId is required' };

        let compiled = graphEngine.activeGraphs?.get?.(threadId);
        if (!compiled) {
          const found = findCompiledForThread(graphEngine, threadId);
          if (found) compiled = found.compiled;
        }
        if (!compiled) return { success: false, error: `No workflow found for thread "${threadId}"` };

        const isPaused = compiled.interruptManager?.isPaused?.(threadId);
        if (isPaused === false) {
          return { success: false, error: `Thread "${threadId}" is not paused. Only paused workflows can be aborted.` };
        }

        compiled.interruptManager.abort(threadId, reason ?? 'Aborted via graph_abort tool');
        return {
          success: true,
          threadId,
          aborted: true,
          reason: reason ?? 'Aborted via graph_abort tool',
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };

  return [
    graphListWorkflowsTool,
    graphRunTool,
    graphResumeTool,
    graphStatusTool,
    graphListCheckpointsTool,
    graphVisualizeTool,
    graphAbortTool,
  ];
}

export default createGraphTools;
