/**
 * 🔍 Retrieval Quality Checker
 * MemMA-inspired retrieval quality gate with iterative refinement.
 *
 * Inspired by the "Query Reasoner" agent in MemMA (arXiv:2603.18718),
 * which evaluates whether retrieved context is sufficient and refines
 * queries iteratively until the answer can be grounded.
 *
 * Works entirely rule-based (no LLM required), but can use an LLM
 * for deeper evaluation when one is available.
 */

import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════════
// 📋 Constants
// ═══════════════════════════════════════════════════════════════════

/** Minimum content length to not penalize as "too short" */
const MIN_CONTENT_LENGTH = 50;

/** Content length considered "rich" (bonus territory) */
const RICH_CONTENT_LENGTH = 500;

/** Score threshold to consider retrieval sufficient */
const SUFFICIENT_THRESHOLD = 0.6;

/** Penalty per missing key term */
const MISSING_TERM_PENALTY = 0.3;

/** Penalty for very short content */
const SHORT_CONTENT_PENALTY = 0.5;

/** Bonus for rich content with good term coverage */
const RICH_CONTENT_BONUS = 0.2;

/** Phrases that indicate empty/failed retrieval */
const PLACEHOLDER_PHRASES = [
  'no results',
  'not found',
  'no information',
  'nothing found',
  'no data',
  'no matches',
  'empty result',
  'could not find',
  'unable to find',
  'no relevant',
];

// ═══════════════════════════════════════════════════════════════════
// 🔍 Retrieval Checker
// ═══════════════════════════════════════════════════════════════════

export class RetrievalChecker {
  /**
   * @param {Object} options
   * @param {Function|null} options.llmCallFn - async (prompt: string) => Promise<string>, optional LLM for deep checks
   * @param {boolean} options.verbose - Whether to log progress (default: true)
   */
  constructor(options = {}) {
    this.llmCallFn = options.llmCallFn || null;
    this.verbose = options.verbose !== false;
  }

  // ─────────────────────────────────────────────────────────────────
  // 🔬 evaluateRetrieval — primary entry point
  // ─────────────────────────────────────────────────────────────────

  /**
   * Evaluate whether retrieved content is sufficient for answering a query.
   * Runs a quick rule-based check by default; uses LLM deepCheck if
   * `options.deep` is true AND an llmCallFn is available.
   *
   * @param {Object} params
   * @param {string} params.query              - The original question/task
   * @param {string} params.retrievedContent   - The content that was retrieved
   * @param {Object} [params.options]          - Additional options
   * @param {boolean} [params.options.deep]    - Force LLM deep check
   * @returns {Promise<{sufficient: boolean, score: number, missingAspects: string[], refinedQuery: string|null, reasoning: string}>}
   */
  async evaluateRetrieval({ query, retrievedContent, options = {} }) {
    const useDeep = options.deep === true && this.llmCallFn !== null;

    if (useDeep) {
      if (this.verbose) {
        console.log(chalk.cyan('🔍 [RetrievalChecker] Running LLM deep check...'));
      }
      return this.deepCheck(query, retrievedContent);
    }

    if (this.verbose) {
      console.log(chalk.cyan('🔍 [RetrievalChecker] Running rule-based quick check...'));
    }

    const result = this.quickCheck(query, retrievedContent);
    return { ...result, refinedQuery: null };
  }

  // ─────────────────────────────────────────────────────────────────
  // ⚡ quickCheck — rule-based, no LLM
  // ─────────────────────────────────────────────────────────────────

  /**
   * Rule-based quality check (no LLM needed).
   * Checks: content length, query term coverage, generic placeholder detection.
   *
   * Scoring:
   *   - Starts at 1.0
   *   - Very short content (< 50 chars): −0.5
   *   - Each missing key query term: −0.3
   *   - Generic placeholder phrases: score → 0.0
   *   - Rich content (> 500 chars) with > 50% term coverage: +0.2
   *   - Clamped to [0.0, 1.0]
   *
   * @param {string} query
   * @param {string} retrievedContent
   * @returns {{sufficient: boolean, score: number, missingAspects: string[], reasoning: string}}
   */
  quickCheck(query, retrievedContent) {
    const content = (retrievedContent || '').trim();
    const queryLower = (query || '').toLowerCase();
    const contentLower = content.toLowerCase();
    const missingAspects = [];
    const reasoningParts = [];

    // ── Placeholder / empty result detection ──────────────────────
    const isPlaceholder = PLACEHOLDER_PHRASES.some(phrase => contentLower.includes(phrase));
    if (isPlaceholder) {
      if (this.verbose) {
        console.log(chalk.yellow('⚠️  [RetrievalChecker] Placeholder content detected — score 0.0'));
      }
      return {
        sufficient: false,
        score: 0.0,
        missingAspects: ['Retrieved content indicates no results were found'],
        reasoning: 'Content contains placeholder phrases indicating failed retrieval (e.g., "no results", "not found").',
      };
    }

    let score = 1.0;

    // ── Length check ──────────────────────────────────────────────
    if (content.length < MIN_CONTENT_LENGTH) {
      score -= SHORT_CONTENT_PENALTY;
      missingAspects.push('Content is very short and likely incomplete');
      reasoningParts.push(`Content is only ${content.length} characters (minimum: ${MIN_CONTENT_LENGTH}), −${SHORT_CONTENT_PENALTY}`);
    } else {
      reasoningParts.push(`Content length OK (${content.length} chars)`);
    }

    // ── Query term coverage ───────────────────────────────────────
    const keyTerms = extractKeyTerms(queryLower);
    const missingTerms = keyTerms.filter(term => !contentLower.includes(term));
    const coveredTerms = keyTerms.filter(term => contentLower.includes(term));

    if (missingTerms.length > 0) {
      const penalty = missingTerms.length * MISSING_TERM_PENALTY;
      score -= penalty;
      missingTerms.forEach(term => missingAspects.push(`Missing coverage of query term: "${term}"`));
      reasoningParts.push(
        `Missing ${missingTerms.length}/${keyTerms.length} key terms: [${missingTerms.join(', ')}] — −${penalty.toFixed(2)}`
      );
    }

    if (coveredTerms.length > 0) {
      reasoningParts.push(`Covered terms: [${coveredTerms.join(', ')}]`);
    }

    // ── Rich content bonus ────────────────────────────────────────
    const coverageRatio = keyTerms.length > 0 ? coveredTerms.length / keyTerms.length : 1;
    if (content.length > RICH_CONTENT_LENGTH && coverageRatio > 0.5) {
      score += RICH_CONTENT_BONUS;
      reasoningParts.push(`Rich content bonus: > ${RICH_CONTENT_LENGTH} chars with > 50% term coverage +${RICH_CONTENT_BONUS}`);
    }

    // ── Clamp ─────────────────────────────────────────────────────
    score = Math.min(1.0, Math.max(0.0, score));

    const sufficient = score >= SUFFICIENT_THRESHOLD;

    if (this.verbose) {
      const icon = sufficient ? chalk.green('✅') : chalk.red('❌');
      console.log(`${icon} [RetrievalChecker] Score: ${score.toFixed(2)} | Sufficient: ${sufficient}`);
    }

    return {
      sufficient,
      score: parseFloat(score.toFixed(3)),
      missingAspects,
      reasoning: reasoningParts.join('. ') || 'No issues detected.',
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 🧠 deepCheck — LLM-powered evaluation
  // ─────────────────────────────────────────────────────────────────

  /**
   * LLM-powered deep quality check.
   * Asks the LLM to evaluate if the content is sufficient and identify gaps.
   * Falls back to quickCheck if LLM call fails or llmCallFn is unavailable.
   *
   * @param {string} query
   * @param {string} retrievedContent
   * @returns {Promise<{sufficient: boolean, score: number, missingAspects: string[], refinedQuery: string|null, reasoning: string}>}
   */
  async deepCheck(query, retrievedContent) {
    if (!this.llmCallFn) {
      if (this.verbose) {
        console.log(chalk.yellow('⚠️  [RetrievalChecker] No llmCallFn provided — falling back to quickCheck'));
      }
      return { ...this.quickCheck(query, retrievedContent), refinedQuery: null };
    }

    const prompt = buildDeepCheckPrompt(query, retrievedContent);

    try {
      if (this.verbose) {
        console.log(chalk.cyan('🧠 [RetrievalChecker] Calling LLM for deep check...'));
      }

      const rawResponse = await this.llmCallFn(prompt);
      const parsed = parseDeepCheckResponse(rawResponse);

      if (this.verbose) {
        const icon = parsed.sufficient ? chalk.green('✅') : chalk.red('❌');
        console.log(`${icon} [RetrievalChecker] LLM score: ${parsed.score} | Sufficient: ${parsed.sufficient}`);
        if (parsed.refinedQuery) {
          console.log(chalk.blue(`🔄 Refined query: "${parsed.refinedQuery}"`));
        }
      }

      return parsed;
    } catch (error) {
      if (this.verbose) {
        console.log(chalk.red(`❌ [RetrievalChecker] LLM call failed: ${error.message} — falling back to quickCheck`));
      }
      return { ...this.quickCheck(query, retrievedContent), refinedQuery: null };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 🔄 iterativeRetrieve — MemMA Refine-and-Probe loop
  // ─────────────────────────────────────────────────────────────────

  /**
   * Iterative retrieval loop implementing MemMA's Refine-and-Probe pattern.
   * Calls retrieveFn repeatedly, checking quality after each attempt.
   * Refines the query using the check result until sufficient or maxIterations reached.
   *
   * @param {Object} params
   * @param {string} params.query             - Original query
   * @param {Function} params.retrieveFn      - async (query: string) => Promise<string>
   * @param {number} [params.maxIterations=5] - Max refinement iterations
   * @returns {Promise<{content: string, iterations: number, history: Array<{query: string, content: string, check: Object}>}>}
   */
  async iterativeRetrieve({ query, retrieveFn, maxIterations = 5 }) {
    const history = [];
    let currentQuery = query;
    let bestContent = '';
    let bestScore = -1;

    if (this.verbose) {
      console.log(chalk.blue(`🔄 [RetrievalChecker] Starting iterative retrieval (max ${maxIterations} iterations)`));
      console.log(chalk.blue(`   Original query: "${query}"`));
    }

    for (let i = 0; i < maxIterations; i++) {
      if (this.verbose) {
        console.log(chalk.cyan(`\n🔍 [RetrievalChecker] Iteration ${i + 1}/${maxIterations}: "${currentQuery}"`));
      }

      // Retrieve content with the current query
      let content;
      try {
        content = await retrieveFn(currentQuery);
      } catch (error) {
        if (this.verbose) {
          console.log(chalk.red(`❌ [RetrievalChecker] retrieveFn failed on iteration ${i + 1}: ${error.message}`));
        }
        content = '';
      }

      // Evaluate quality — use deepCheck if LLM available, else quickCheck
      const check = await this.evaluateRetrieval({
        query,
        retrievedContent: content,
        options: { deep: this.llmCallFn !== null },
      });

      history.push({ query: currentQuery, content, check });

      // Track best result so far
      if (check.score > bestScore) {
        bestScore = check.score;
        bestContent = content;
      }

      if (this.verbose) {
        console.log(
          chalk.cyan(`   Score: ${check.score} | Sufficient: ${check.sufficient}`) +
          (check.refinedQuery ? chalk.blue(` | Next query: "${check.refinedQuery}"`) : '')
        );
      }

      // Success — we have sufficient context
      if (check.sufficient) {
        if (this.verbose) {
          console.log(chalk.green(`✅ [RetrievalChecker] Sufficient context found after ${i + 1} iteration(s)`));
        }
        return { content, iterations: i + 1, history };
      }

      // If no refined query available and we're not on the last iteration, generate one
      const nextQuery = check.refinedQuery || buildRefinedQuery(query, currentQuery, check.missingAspects, i);

      // Avoid infinite loops — stop if query hasn't changed
      if (nextQuery === currentQuery) {
        if (this.verbose) {
          console.log(chalk.yellow('⚠️  [RetrievalChecker] Query unchanged — stopping early to avoid loop'));
        }
        break;
      }

      currentQuery = nextQuery;
    }

    if (this.verbose) {
      console.log(chalk.yellow(`⚠️  [RetrievalChecker] Max iterations reached. Returning best result (score: ${bestScore.toFixed(3)})`));
    }

    return { content: bestContent, iterations: history.length, history };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🛠️  Private Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract meaningful key terms from a query string.
 * Strips common stop words and returns tokens ≥ 3 chars.
 *
 * @param {string} queryLower - Lowercased query
 * @returns {string[]}
 */
function extractKeyTerms(queryLower) {
  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
    'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has',
    'him', 'his', 'how', 'its', 'may', 'now', 'old', 'see', 'two',
    'way', 'who', 'did', 'let', 'put', 'say', 'she', 'too', 'use',
    'what', 'when', 'with', 'from', 'this', 'that', 'have', 'will',
    'your', 'they', 'been', 'were', 'said', 'each', 'which', 'their',
    'time', 'than', 'into', 'made', 'then', 'some', 'most', 'them',
    'would', 'there', 'could', 'about', 'other', 'these', 'those',
    'should', 'where', 'after', 'before', 'while', 'being',
  ]);

  return queryLower
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
}

/**
 * Build the LLM prompt for deep evaluation.
 *
 * @param {string} query
 * @param {string} retrievedContent
 * @returns {string}
 */
function buildDeepCheckPrompt(query, retrievedContent) {
  const truncated = retrievedContent.length > 3000
    ? retrievedContent.slice(0, 3000) + '\n...[truncated]'
    : retrievedContent;

  return `You are a retrieval quality evaluator. Your job is to determine whether the retrieved content provides sufficient information to answer the given query.

QUERY:
${query}

RETRIEVED CONTENT:
${truncated}

Evaluate the retrieval quality and respond with a JSON object ONLY (no prose, no markdown fences) in exactly this format:
{
  "sufficient": true|false,
  "score": 0.0-1.0,
  "missingAspects": ["aspect1", "aspect2"],
  "refinedQuery": "improved query to find missing info" | null,
  "reasoning": "Brief explanation of the evaluation"
}

Rules:
- "sufficient" = true if the content can substantially answer the query
- "score" = 0.0 (no useful info) to 1.0 (complete answer)
- "missingAspects" = specific gaps in the retrieved content (empty array if sufficient)
- "refinedQuery" = a more targeted query to find missing info (null if sufficient)
- "reasoning" = 1-2 sentences explaining your evaluation`;
}

/**
 * Parse the LLM's JSON response into a structured result.
 * Tolerant of minor formatting issues (bare JSON, light markdown).
 *
 * @param {string} rawResponse
 * @returns {{sufficient: boolean, score: number, missingAspects: string[], refinedQuery: string|null, reasoning: string}}
 */
function parseDeepCheckResponse(rawResponse) {
  // Strip optional markdown fences
  const cleaned = rawResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    // Try to extract a JSON object from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error(`LLM response JSON extraction failed: ${e.message}`);
      }
    } else {
      throw new Error('LLM response did not contain valid JSON');
    }
  }

  return {
    sufficient: Boolean(parsed.sufficient),
    score: parseFloat(parseFloat(parsed.score ?? 0).toFixed(3)),
    missingAspects: Array.isArray(parsed.missingAspects) ? parsed.missingAspects : [],
    refinedQuery: typeof parsed.refinedQuery === 'string' && parsed.refinedQuery ? parsed.refinedQuery : null,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided.',
  };
}

/**
 * Generate a fallback refined query when no LLM is available.
 * Appends missing aspect keywords to the original query.
 *
 * @param {string} originalQuery - The initial query from the user
 * @param {string} currentQuery  - The query used in the last iteration
 * @param {string[]} missingAspects - Gaps identified by quickCheck
 * @param {number} iteration     - Current iteration index (0-based)
 * @returns {string}
 */
function buildRefinedQuery(originalQuery, currentQuery, missingAspects, iteration) {
  if (missingAspects.length > 0) {
    // Extract short keyword hints from missing aspects
    const hints = missingAspects
      .map(aspect => aspect.replace(/missing coverage of query term: "/i, '').replace(/"$/, '').trim())
      .filter(h => h.length > 0 && h.length < 60)
      .slice(0, 2);

    if (hints.length > 0) {
      return `${originalQuery} ${hints.join(' ')}`.trim();
    }
  }

  // Last resort: append iteration modifier to broaden scope
  const modifiers = ['details', 'more information', 'context', 'explanation', 'overview'];
  const modifier = modifiers[iteration % modifiers.length];
  return `${originalQuery} ${modifier}`;
}
