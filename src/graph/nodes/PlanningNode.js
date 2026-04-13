/**
 * PlanningNode.js
 * Factory for MemMA-inspired Meta-Thinker planning nodes.
 *
 * A planning node sits BEFORE execution nodes in the graph and produces structured
 * strategic guidance — mirroring MemMA's Meta-Thinker, which generates plans to steer
 * both memory construction and retrieval. Supports three modes:
 *
 *  - 'strategy'     — overall approach, steps, risks, confidence
 *  - 'retrieval'    — queries to run, missing info, sufficiency check (supports iterative refinement)
 *  - 'construction' — what to remember, importance, conflicts, recommendation
 *
 * The node calls the LLM via config.parentAgent if available, otherwise falls back to
 * spawning a minimal AgentSession (following the AgentNode.js pattern).
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import AgentSession from '../../agent/AgentSession.js';

// ─── Mode Definitions ────────────────────────────────────────────────────────

/**
 * Default system prompts per planning mode.
 * @type {Record<string, string>}
 */
const MODE_SYSTEM_PROMPTS = {
  strategy: `You are a strategic planning agent. Your role is to analyse the current situation and produce a structured plan of action.

Always respond with valid JSON matching this schema exactly:
{
  "approach": "<concise description of the overall strategy>",
  "steps": ["<step 1>", "<step 2>", "..."],
  "risks": ["<risk 1>", "..."],
  "confidence": <float 0.0–1.0>
}

Be specific and actionable. Do not include any text outside the JSON object.`,

  retrieval: `You are a retrieval planning agent. Your role is to determine what information needs to be retrieved to answer the current question or complete the task.

Always respond with valid JSON matching this schema exactly:
{
  "queries": ["<search query 1>", "<search query 2>", "..."],
  "missingInfo": ["<piece of missing information>", "..."],
  "sufficient": <true|false>,
  "reasoning": "<why the current information is or is not sufficient>"
}

If the existing context is already sufficient, set "sufficient" to true and leave "queries" and "missingInfo" as empty arrays.
Do not include any text outside the JSON object.`,

  construction: `You are a memory construction planning agent. Your role is to identify what information from the current context is worth storing in long-term memory.

Always respond with valid JSON matching this schema exactly:
{
  "toRemember": ["<item to remember>", "..."],
  "importance": ["high"|"medium"|"low", "..."],
  "conflicts": ["<conflict with existing memory>", "..."],
  "recommendation": "<brief overall recommendation>"
}

The "importance" array must have exactly the same length as "toRemember", with one importance level per item.
If nothing is worth remembering, return empty arrays and explain in "recommendation".
Do not include any text outside the JSON object.`,
};

/**
 * Human-readable labels for logging.
 * @type {Record<string, string>}
 */
const MODE_LABELS = {
  strategy: 'Strategy',
  retrieval: 'Retrieval',
  construction: 'Construction',
};

// ─── JSON Extraction ─────────────────────────────────────────────────────────

/**
 * Extract the first valid JSON object from a string.
 * Handles LLM responses that wrap JSON in markdown code fences or add surrounding prose.
 *
 * @param {string} text - Raw LLM output.
 * @returns {Object} Parsed JSON object.
 * @throws {SyntaxError} If no valid JSON object is found.
 */
function extractJSON(text) {
  if (typeof text !== 'string') {
    throw new TypeError(`extractJSON: expected string, got ${typeof text}`);
  }

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (e) {
      throw new SyntaxError(`extractJSON: invalid JSON in code fence: ${e.message}`);
    }
  }

  // Find the first '{' and match its closing '}'
  const start = text.indexOf('{');
  if (start === -1) {
    throw new SyntaxError('extractJSON: no JSON object found in response');
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }

  throw new SyntaxError('extractJSON: unbalanced JSON object in response');
}

// ─── LLM Call Abstraction ─────────────────────────────────────────────────────

/**
 * Extract the OpenRouter API key from environment or .env file.
 * @returns {string|null}
 */
function getApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/OPENROUTER_API_KEY=(.+)/);
      if (match) return match[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Call an LLM directly via OpenRouter API (preferred) or via parentAgent fallback.
 *
 * Direct API calls avoid the AgentSession system prompt which includes tool definitions
 * that cause the LLM to call tools instead of returning JSON.
 *
 * @param {string} prompt - The user-facing planning prompt.
 * @param {string} systemPrompt - System prompt describing the task.
 * @param {Object} config - Graph engine runtime config.
 * @param {string|undefined} model - Model identifier for direct API calls.
 * @returns {Promise<string>} Raw text response from the LLM.
 */
async function callLLM(prompt, systemPrompt, config, model) {
  // Prefer the graph's parent agent — avoids spawning extra sessions
  if (config?.parentAgent) {
    const agent = config.parentAgent;
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;
    if (typeof agent.run === 'function') {
      const result = await agent.run(fullPrompt);
      return extractTextResponse(result);
    }
    if (typeof agent.chat === 'function') {
      const result = await agent.chat(fullPrompt);
      return extractTextResponse(result);
    }
  }

  // Direct API call — clean, no tool definitions, pure JSON response
  if (model) {
    const apiKey = await getApiKey();
    if (apiKey) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Direct LLM call failed (${response.status}): ${errBody}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? '';
    }
  }

  // Last resort: create AgentSession (may include tool definitions)
  const sessionOptions = { ...(model ? { model } : {}), systemPrompt };
  const session = new AgentSession(sessionOptions);
  if (typeof session.init === 'function') await session.init();
  let result;
  try {
    result = await session.run(prompt);
  } finally {
    if (typeof session.destroy === 'function') await session.destroy();
  }
  return extractTextResponse(result);
}

/**
 * Extract text content from an agent result, stripping tool-call responses.
 * Planning nodes need pure text (JSON), not tool calls.
 *
 * @param {string|Object} result - Raw agent result.
 * @returns {string} Text content only.
 */
function extractTextResponse(result) {
  if (typeof result === 'string') return result;
  if (!result) return '';

  // If result has messages array, find the last assistant message with text content
  if (Array.isArray(result.messages)) {
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
        // Skip messages that are primarily tool calls
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          return msg.content;
        }
      }
    }
    // If all assistant messages had tool calls, try to find text among them
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim().length > 10) {
        return msg.content;
      }
    }
  }

  // Object with .content or .response
  if (typeof result.content === 'string') return result.content;
  if (typeof result.response === 'string') return result.response;

  return JSON.stringify(result);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a MemMA-inspired Meta-Thinker planning node.
 *
 * @param {Object} options - Node configuration.
 * @param {function(Object): string} options.inputMapper
 *   Maps current graph state to a planning prompt string.
 * @param {function(Object, Object): Object} options.outputMapper
 *   Maps (parsedPlan, state) → partial state update to merge into graph state.
 * @param {'strategy'|'retrieval'|'construction'} options.mode
 *   Planning mode; controls the system prompt and output schema.
 * @param {string} [options.systemPrompt]
 *   Override the default system prompt for this mode.
 * @param {number} [options.maxIterations=3]
 *   Maximum refinement iterations (only used in 'retrieval' mode).
 * @param {function(Object, Object): boolean} [options.planEvaluator]
 *   Returns true when the plan is sufficient to stop iterating (retrieval mode).
 *   Receives (parsedPlan, state). Defaults to checking plan.sufficient.
 * @param {string} [options.model]
 *   Model identifier forwarded to AgentSession when no parentAgent is available.
 * @param {Array} [options.tools=[]]
 *   Tools available during planning (forwarded to AgentSession fallback).
 *
 * @returns {{ type: 'function', execute: function(Object, Object): Promise<Object>, destroy: function(): Promise<void> }}
 *
 * @example
 * // Strategy planning node
 * const planner = createPlanningNode({
 *   mode: 'strategy',
 *   inputMapper: (state) => `Task: ${state.userRequest}`,
 *   outputMapper: (plan, _state) => ({ plan }),
 * });
 *
 * @example
 * // Retrieval planning node with iterative refinement
 * const retriever = createPlanningNode({
 *   mode: 'retrieval',
 *   maxIterations: 4,
 *   inputMapper: (state) => `Question: ${state.question}\nFetched so far: ${JSON.stringify(state.results)}`,
 *   outputMapper: (plan, _state) => ({ retrievalPlan: plan }),
 *   planEvaluator: (plan) => plan.sufficient === true,
 * });
 */
export function createPlanningNode(options = {}) {
  const {
    inputMapper,
    outputMapper,
    mode,
    systemPrompt: systemPromptOverride,
    maxIterations = 3,
    planEvaluator,
    model,
    tools = [],
  } = options;

  // ── Validation ──────────────────────────────────────────────────────────────

  if (typeof inputMapper !== 'function') {
    throw new TypeError('createPlanningNode: options.inputMapper must be a function');
  }
  if (typeof outputMapper !== 'function') {
    throw new TypeError('createPlanningNode: options.outputMapper must be a function');
  }

  const validModes = ['strategy', 'retrieval', 'construction'];
  if (!validModes.includes(mode)) {
    throw new TypeError(
      `createPlanningNode: options.mode must be one of ${validModes.map((m) => `'${m}'`).join(', ')}`
    );
  }

  if (planEvaluator !== undefined && typeof planEvaluator !== 'function') {
    throw new TypeError('createPlanningNode: options.planEvaluator must be a function');
  }

  // ── Resolved config ─────────────────────────────────────────────────────────

  const resolvedSystemPrompt = systemPromptOverride ?? MODE_SYSTEM_PROMPTS[mode];
  const modeLabel = MODE_LABELS[mode];

  /**
   * Default evaluator for retrieval mode: checks plan.sufficient.
   * @param {Object} plan
   * @returns {boolean}
   */
  const defaultRetrieverEvaluator = (plan) => plan?.sufficient === true;
  const resolvedEvaluator = planEvaluator ?? (mode === 'retrieval' ? defaultRetrieverEvaluator : null);

  // ── Execute ─────────────────────────────────────────────────────────────────

  /**
   * Run one planning iteration: prompt → LLM → parse JSON.
   *
   * @param {Object} state
   * @param {Object} config
   * @param {number} iteration - Current iteration index (1-based), for logging.
   * @returns {Promise<Object>} Parsed plan object.
   */
  async function runIteration(state, config, iteration) {
    const prompt = inputMapper(structuredClone(state));

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('PlanningNode: inputMapper must return a non-empty string');
    }

    const label = chalk.cyan(`[PlanningNode:${modeLabel}]`);

    if (mode === 'retrieval' && maxIterations > 1) {
      console.log(`${label} ${chalk.gray(`Iteration ${iteration}/${maxIterations}`)}`);
    } else {
      console.log(`${label} ${chalk.gray('Planning...')}`);
    }

    const rawResponse = await callLLM(prompt, resolvedSystemPrompt, config, model, tools);

    let plan;
    try {
      plan = extractJSON(rawResponse);
    } catch (err) {
      console.warn(
        `${label} ${chalk.yellow('Warning: failed to parse JSON response, retrying may help.')}`,
        err.message
      );
      throw new Error(`PlanningNode: could not parse structured plan from LLM response — ${err.message}`);
    }

    console.log(
      `${label} ${chalk.green('Plan produced.')}`,
      mode === 'retrieval'
        ? chalk.gray(`sufficient=${plan.sufficient}, queries=${plan.queries?.length ?? 0}`)
        : mode === 'strategy'
        ? chalk.gray(`steps=${plan.steps?.length ?? 0}, confidence=${plan.confidence ?? '?'}`)
        : chalk.gray(`toRemember=${plan.toRemember?.length ?? 0}`)
    );

    return plan;
  }

  // ── Public node interface ────────────────────────────────────────────────────

  return {
    type: 'function',

    /**
     * Execute the planning node.
     *
     * In 'retrieval' mode with a planEvaluator (or the default sufficient-check),
     * this will iterate up to maxIterations times, passing the accumulated plan
     * back into the state (via outputMapper) between iterations so the inputMapper
     * can incorporate prior results.
     *
     * @param {Object} state - Current graph state.
     * @param {Object} [config={}] - Runtime config from the graph engine.
     * @param {Object} [config.parentAgent] - If present, used for LLM calls directly.
     * @param {string} [config.threadId] - Thread identifier (passed through, not consumed).
     * @param {AbortSignal} [config.signal] - Abort signal for cancellation.
     * @returns {Promise<Object>} Partial state update to merge into graph state.
     */
    async execute(state, config = {}) {
      const label = chalk.cyan(`[PlanningNode:${modeLabel}]`);

      // Check for abort before starting
      if (config?.signal?.aborted) {
        throw new Error('PlanningNode: aborted before execution');
      }

      // Non-retrieval modes: single pass
      if (mode !== 'retrieval' || !resolvedEvaluator) {
        const plan = await runIteration(state, config, 1);
        return outputMapper(plan, state);
      }

      // Retrieval mode: iterative refinement loop
      let currentState = state;
      let lastPlan = null;

      for (let i = 1; i <= maxIterations; i++) {
        // Check abort between iterations
        if (config?.signal?.aborted) {
          throw new Error('PlanningNode: aborted during retrieval iteration');
        }

        lastPlan = await runIteration(currentState, config, i);
        const stateUpdate = outputMapper(lastPlan, currentState);

        // Merge the plan result into state so the next iteration has updated context
        currentState = { ...currentState, ...stateUpdate };

        const sufficient = resolvedEvaluator(lastPlan, currentState);
        if (sufficient) {
          console.log(
            `${label} ${chalk.green(`Sufficient after ${i} iteration(s). Stopping.`)}`
          );
          break;
        }

        if (i === maxIterations) {
          console.warn(
            `${label} ${chalk.yellow(`Reached maxIterations (${maxIterations}) without sufficient plan.`)}`
          );
        }
      }

      // Return only the delta compared to the original state
      const originalKeys = Object.keys(state);
      const delta = {};
      for (const [key, value] of Object.entries(currentState)) {
        if (!originalKeys.includes(key) || currentState[key] !== state[key]) {
          delta[key] = value;
        }
      }
      return delta;
    },

    /**
     * No persistent resources to release (AgentSession instances created during
     * execute are destroyed inline). Provided for interface parity with AgentNode.
     *
     * @returns {Promise<void>}
     */
    async destroy() {
      // Nothing to clean up — transient sessions are destroyed in callLLM.
    },
  };
}

export default createPlanningNode;
ngNode;
