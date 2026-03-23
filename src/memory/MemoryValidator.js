/**
 * 🔍 Memory Validator v1.0
 * MemMA-inspired self-evolving memory validation and repair.
 *
 * Implements the "backward path" from MemMA (arXiv:2603.18718):
 *   1. Generate probe QA pairs from the session transcript
 *   2. Verify current memory can answer each probe
 *   3. Repair failures via SKIP / MERGE / INSERT
 *
 * Works in two modes:
 *   - Quick (no LLM): rule-based structural checks via quickCheck()
 *   - Deep  (LLM)   : full probe-generate → verify → repair cycle
 */

import chalk from 'chalk';

// ─────────────────────────────────────────────
// Prompt templates
// ─────────────────────────────────────────────

const PROBE_GENERATION_PROMPT = (transcript) => `
You are a memory quality assessor for an AI agent. Given the following session transcript, generate probe questions that test whether the agent's memory correctly captures key information from this session.

Generate 3-7 probe QA pairs covering:
1. FACTUAL: Specific facts, names, values, or decisions mentioned
2. CROSS_SESSION: Information that should be retained for future sessions
3. TEMPORAL: Time-sensitive information or sequences of events

Output ONLY valid JSON (no markdown, no prose) in this exact format:
[
  {
    "question": "What specific value/fact was discussed?",
    "expectedAnswer": "The specific answer",
    "category": "factual"
  },
  {
    "question": "What should be remembered for next session?",
    "expectedAnswer": "The thing to remember",
    "category": "cross_session"
  }
]

Categories must be exactly: "factual", "cross_session", or "temporal"

SESSION TRANSCRIPT:
${transcript}
`.trim();

const VERIFY_MEMORY_PROMPT = (question, expectedAnswer, memoryContent) => `
You are checking whether an agent's memory can correctly answer a probe question.

PROBE QUESTION: ${question}
EXPECTED ANSWER: ${expectedAnswer}

CURRENT MEMORY CONTENT:
${memoryContent || '(empty — no memory content found)'}

Can the current memory content answer this question correctly?

Respond with ONLY valid JSON:
{
  "passed": true,
  "confidence": 0.9,
  "actualAnswer": "The answer found in memory",
  "reason": "Brief explanation"
}

Or if it fails:
{
  "passed": false,
  "confidence": 0.8,
  "actualAnswer": null,
  "reason": "Why the memory is insufficient"
}
`.trim();

const REPAIR_PROMPT = (question, expectedAnswer, memoryContent, reason) => `
You are a memory repair agent. A probe question failed because the agent's memory is missing or incorrect.

PROBE QUESTION: ${question}
EXPECTED ANSWER: ${expectedAnswer}
FAILURE REASON: ${reason}

CURRENT MEMORY (excerpt):
${memoryContent ? memoryContent.slice(0, 2000) : '(empty)'}

Propose the best repair action. Choose ONE:
- SKIP: The probe question was poorly formed or the expected answer is wrong — memory is actually fine
- MERGE: Similar information exists in memory but needs consolidation or correction
- INSERT: This information is genuinely missing and should be added

Respond with ONLY valid JSON:
{
  "action": "insert",
  "details": "Brief explanation of what to do",
  "newContent": "The exact markdown content to insert into MEMORY.md (for insert/merge actions only)"
}
`.trim();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Safely parse JSON from LLM output (strips markdown fences if present).
 * @param {string} raw
 * @returns {any|null}
 */
function safeParseJSON(raw) {
  if (!raw) return null;
  // Strip ```json ... ``` fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try extracting the first JSON object / array via a simple heuristic
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const candidate = arrayMatch?.[0] ?? objMatch?.[0];
    if (candidate) {
      try { return JSON.parse(candidate); } catch { /* fall through */ }
    }
    return null;
  }
}

// ─────────────────────────────────────────────
// MemoryValidator
// ─────────────────────────────────────────────

export class MemoryValidator {
  /**
   * @param {object} opts
   * @param {import('./MemoryManager.js').MemoryManager} opts.memoryManager
   * @param {((prompt: string) => Promise<string>)|null} [opts.llmCallFn]
   * @param {boolean} [opts.verbose]
   */
  constructor({ memoryManager, llmCallFn = null, verbose = true }) {
    this.memoryManager = memoryManager;
    this.llmCallFn = llmCallFn;
    this.verbose = verbose;
  }

  // ── logging helpers ──────────────────────────────────────

  _log(msg) {
    if (this.verbose) console.log(msg);
  }

  _ok(msg)   { this._log(chalk.green(`  ✓ ${msg}`)); }
  _warn(msg) { this._log(chalk.yellow(`  ⚠ ${msg}`)); }
  _info(msg) { this._log(chalk.cyan(`  ℹ ${msg}`)); }
  _err(msg)  { this._log(chalk.red(`  ✗ ${msg}`)); }

  // ─────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────

  /**
   * Main entry point: generate probes → verify → repair.
   * Requires `llmCallFn` to be set.
   *
   * @param {string} sessionTranscript
   * @param {object} [opts]
   * @param {boolean} [opts.dryRun=false] - Report failures without applying repairs
   * @returns {Promise<{probes: Probe[], failures: VerifyResult[], repairs: RepairResult[], summary: string}>}
   */
  async validateAndRepair(sessionTranscript, { dryRun = false } = {}) {
    if (!this.llmCallFn) {
      throw new Error('MemoryValidator: llmCallFn is required for deep validation');
    }

    this._log(chalk.bold.blue('\n🔍 MemMA Backward-Path Validation'));

    // Phase 1 — Generate probes
    this._info('Phase 1: Generating probe QA pairs from session…');
    const probes = await this.generateProbes(sessionTranscript);
    this._info(`Generated ${probes.length} probe(s)`);

    // Phase 2 — Verify
    this._info('Phase 2: Verifying memory against probes…');
    const verifyResults = await this.verifyMemory(probes);
    const failures = verifyResults.filter(r => !r.passed);
    const passes   = verifyResults.filter(r =>  r.passed);
    this._ok(`Passed: ${passes.length}/${verifyResults.length}`);
    if (failures.length) this._warn(`Failed: ${failures.length}/${verifyResults.length}`);

    // Phase 3 — Repair
    let repairs = [];
    if (failures.length > 0) {
      this._info('Phase 3: Repairing failed probes…');
      repairs = await this.repairMemory(failures, { dryRun });
    }

    const summary = this._buildSummary(probes, failures, repairs, dryRun);
    this._log(chalk.bold.blue('\n' + summary));

    return { probes, failures, repairs, summary };
  }

  /**
   * Phase 1 — Generate probe QA pairs from session transcript.
   *
   * @param {string} sessionTranscript
   * @returns {Promise<Probe[]>}
   */
  async generateProbes(sessionTranscript) {
    if (!this.llmCallFn) {
      throw new Error('MemoryValidator: llmCallFn is required to generate probes');
    }

    const prompt = PROBE_GENERATION_PROMPT(sessionTranscript);
    let raw;
    try {
      raw = await this.llmCallFn(prompt);
    } catch (err) {
      this._err(`LLM call failed during probe generation: ${err.message}`);
      return [];
    }

    const parsed = safeParseJSON(raw);
    if (!Array.isArray(parsed)) {
      this._warn('Could not parse probes from LLM output — returning empty array');
      return [];
    }

    // Validate shape and normalise category
    const validCategories = new Set(['factual', 'cross_session', 'temporal']);
    return parsed
      .filter(p => p && typeof p.question === 'string' && typeof p.expectedAnswer === 'string')
      .map(p => ({
        question: p.question.trim(),
        expectedAnswer: p.expectedAnswer.trim(),
        category: validCategories.has(p.category) ? p.category : 'factual',
      }));
  }

  /**
   * Phase 2 — Verify memory against each probe.
   *
   * @param {Probe[]} probes
   * @returns {Promise<VerifyResult[]>}
   */
  async verifyMemory(probes) {
    if (!probes.length) return [];

    let memoryContent;
    try {
      memoryContent = await this.memoryManager.getMemoryContent();
    } catch (err) {
      this._warn(`Could not read memory content: ${err.message}`);
      memoryContent = '';
    }

    const results = [];

    for (const probe of probes) {
      if (this.verbose) {
        this._info(`  Checking: "${probe.question.slice(0, 80)}…"`);
      }

      let result;
      if (this.llmCallFn) {
        result = await this._verifyWithLLM(probe, memoryContent);
      } else {
        result = this._verifyHeuristic(probe, memoryContent);
      }

      results.push({ probe, ...result });
    }

    return results;
  }

  /**
   * Phase 3 — Repair failed probes.
   *
   * @param {VerifyResult[]} failedProbes
   * @param {object} [opts]
   * @param {boolean} [opts.dryRun=false]
   * @returns {Promise<RepairResult[]>}
   */
  async repairMemory(failedProbes, { dryRun = false } = {}) {
    if (!failedProbes.length) return [];
    if (!this.llmCallFn) {
      this._warn('llmCallFn not set — skipping repair proposals');
      return [];
    }

    let memoryContent;
    try {
      memoryContent = await this.memoryManager.getMemoryContent();
    } catch {
      memoryContent = '';
    }

    const repairs = [];

    for (const failedResult of failedProbes) {
      const { probe, reason } = failedResult;
      this._info(`  Repairing: "${probe.question.slice(0, 60)}…"`);

      const prompt = REPAIR_PROMPT(probe.question, probe.expectedAnswer, memoryContent, reason);
      let raw;
      try {
        raw = await this.llmCallFn(prompt);
      } catch (err) {
        this._err(`LLM repair call failed: ${err.message}`);
        repairs.push({ probe, action: 'skip', details: `LLM error: ${err.message}`, applied: false });
        continue;
      }

      const parsed = safeParseJSON(raw);
      if (!parsed || !parsed.action) {
        this._warn('Could not parse repair proposal — skipping');
        repairs.push({ probe, action: 'skip', details: 'Parse failure', applied: false });
        continue;
      }

      const action = (parsed.action || '').toLowerCase();
      const repair = {
        probe,
        action,
        details: parsed.details || '',
        newContent: parsed.newContent || null,
        applied: false,
      };

      if (!dryRun && (action === 'insert' || action === 'merge') && parsed.newContent) {
        try {
          await this.memoryManager.applyRepair({
            action,
            content: parsed.newContent,
          });
          repair.applied = true;
          this._ok(`Repair applied (${action})`);

          // Refresh local copy for subsequent probes
          try {
            memoryContent = await this.memoryManager.getMemoryContent();
          } catch { /* ignore */ }
        } catch (err) {
          this._err(`Failed to apply repair: ${err.message}`);
        }
      } else if (action === 'skip') {
        this._info(`  → SKIP (probe was bad or memory is fine)`);
        repair.applied = true;
      } else if (dryRun) {
        this._info(`  → DRY-RUN: would apply ${action}`);
      }

      repairs.push(repair);
    }

    return repairs;
  }

  /**
   * Quick structural validation — no LLM required.
   * Checks basic memory health: file existence, minimum content, freshness, etc.
   *
   * @returns {Promise<QuickCheckResult>}
   */
  async quickCheck() {
    this._log(chalk.bold.cyan('\n⚡ Quick Memory Check'));

    const issues = [];
    const checks = [];

    // 1. Memory file exists?
    let content;
    try {
      content = await this.memoryManager.getMemoryContent();
    } catch (err) {
      issues.push(`Cannot read memory file: ${err.message}`);
      content = '';
    }

    if (!content || content.trim().length === 0) {
      issues.push('Memory file is empty or missing');
      checks.push({ name: 'Memory file exists', passed: false });
    } else {
      checks.push({ name: 'Memory file exists', passed: true });
    }

    // 2. Minimum length check
    const MIN_CHARS = 100;
    if (content.length < MIN_CHARS) {
      issues.push(`Memory is very short (${content.length} chars) — may be incomplete`);
      checks.push({ name: 'Minimum content length', passed: false });
    } else {
      checks.push({ name: 'Minimum content length', passed: true });
    }

    // 3. Has headings?
    const hasHeadings = /^#{1,3} .+/m.test(content);
    if (!hasHeadings) {
      issues.push('Memory has no markdown headings — structure may be missing');
    }
    checks.push({ name: 'Has markdown headings', passed: hasHeadings });

    // 4. Stats via getMemoryStats
    let stats;
    try {
      stats = await this.memoryManager.getMemoryStats();
    } catch {
      stats = null;
    }

    if (stats) {
      if (stats.totalEntries === 0) {
        issues.push('No memory entries found (no ## dated sections)');
      }
      checks.push({ name: 'Has memory entries', passed: stats.totalEntries > 0 });
    }

    // 5. Freshness: check if memory was updated within 30 days
    if (stats?.lastUpdated) {
      const daysSince = (Date.now() - new Date(stats.lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
      const fresh = daysSince < 30;
      if (!fresh) {
        issues.push(`Memory was last updated ${Math.round(daysSince)} days ago — consider refreshing`);
      }
      checks.push({ name: 'Memory updated within 30 days', passed: fresh });
    }

    const passed = issues.length === 0;
    const score = checks.length > 0
      ? checks.filter(c => c.passed).length / checks.length
      : 0;

    if (passed) {
      this._ok('All quick checks passed');
    } else {
      issues.forEach(i => this._warn(i));
    }

    return { passed, score, issues, checks, stats };
  }

  // ─────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Verify a single probe using the LLM.
   */
  async _verifyWithLLM(probe, memoryContent) {
    const prompt = VERIFY_MEMORY_PROMPT(probe.question, probe.expectedAnswer, memoryContent);
    let raw;
    try {
      raw = await this.llmCallFn(prompt);
    } catch (err) {
      return { passed: false, confidence: 0, actualAnswer: null, reason: `LLM error: ${err.message}` };
    }

    const parsed = safeParseJSON(raw);
    if (!parsed) {
      return { passed: false, confidence: 0, actualAnswer: null, reason: 'Could not parse LLM verify response' };
    }

    return {
      passed:        Boolean(parsed.passed),
      confidence:    typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      actualAnswer:  parsed.actualAnswer ?? null,
      reason:        parsed.reason || '',
    };
  }

  /**
   * Heuristic verify — simple keyword/phrase matching when no LLM available.
   */
  _verifyHeuristic(probe, memoryContent) {
    if (!memoryContent) {
      return { passed: false, confidence: 0.3, actualAnswer: null, reason: 'Memory is empty' };
    }

    const haystack = memoryContent.toLowerCase();
    const needles = probe.expectedAnswer
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4); // skip short words

    if (needles.length === 0) {
      return { passed: true, confidence: 0.4, actualAnswer: null, reason: 'Expected answer too short to verify' };
    }

    const found = needles.filter(n => haystack.includes(n));
    const ratio = found.length / needles.length;

    const passed = ratio >= 0.6;
    return {
      passed,
      confidence: parseFloat(ratio.toFixed(2)),
      actualAnswer: passed ? probe.expectedAnswer : null,
      reason: passed
        ? `${found.length}/${needles.length} keywords found`
        : `Only ${found.length}/${needles.length} keywords found in memory`,
    };
  }

  /**
   * Build a human-readable summary string.
   */
  _buildSummary(probes, failures, repairs, dryRun) {
    const passed   = probes.length - failures.length;
    const applied  = repairs.filter(r => r.applied && r.action !== 'skip').length;
    const skipped  = repairs.filter(r => r.action === 'skip').length;

    const lines = [
      `Memory Validation Summary`,
      `  Probes generated : ${probes.length}`,
      `  Passed           : ${passed}`,
      `  Failed           : ${failures.length}`,
      `  Repairs proposed : ${repairs.length}`,
      `  Repairs applied  : ${dryRun ? 'N/A (dry-run)' : applied}`,
      `  Probes skipped   : ${skipped}`,
    ];

    return lines.join('\n');
  }
}

// ─────────────────────────────────────────────
// JSDoc typedefs (for IDE support)
// ─────────────────────────────────────────────

/**
 * @typedef {{ question: string, expectedAnswer: string, category: 'factual'|'cross_session'|'temporal' }} Probe
 * @typedef {{ probe: Probe, passed: boolean, confidence: number, actualAnswer: string|null, reason: string }} VerifyResult
 * @typedef {{ probe: Probe, action: 'skip'|'merge'|'insert', details: string, newContent?: string|null, applied: boolean }} RepairResult
 * @typedef {{ passed: boolean, issues: string[], checks: {name:string,passed:boolean}[], stats: object|null }} QuickCheckResult
 */

export default MemoryValidator;
