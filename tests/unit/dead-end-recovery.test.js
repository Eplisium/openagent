/**
 * Integration tests for dead-end recovery improvements
 * Tests Tasks 1-5 from the reliability improvement plan:
 * - edit_file line-number validation (Task 1)
 * - VALIDATION_ERROR / NOT_GIT_REPO error categories (Task 2)
 * - Dead-end detector with success-rate awareness (Task 3)
 * - Targeted self-correction in reflectOnToolResults (Task 4)
 * - Git tools graceful failure on non-git dirs (Task 5)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a minimal Agent instance for testing methods that don't need a real LLM.
 * We mock the client and tools to avoid external dependencies.
 */
function createTestAgent(overrides = {}) {
  // Dynamic import to avoid issues with ESM module loading
  return import('../../src/agent/Agent.js').then(({ Agent }) => {
    return new Agent({
      model: 'test-model',
      client: {
        chat: vi.fn().mockResolvedValue({ content: '', tool_calls: [] }),
      },
      tools: { execute: vi.fn() },
      ...overrides,
    });
  });
}

/**
 * Create a temporary test file and return its path
 */
async function createTempFile(content, name = 'test-file.js') {
  const tmpDir = path.join(os.tmpdir(), 'openagent-test-' + Date.now());
  await fs.mkdir(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, content, 'utf-8');
  return { filePath, tmpDir };
}

/**
 * Clean up temp directory
 */
async function cleanupTmp(tmpDir) {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
}

// ─── Task 1: edit_file line-number validation ───────────────────────────────

describe('Task 1: edit_file line-number validation', () => {
  let editFileExecute;
  let tmpDir;

  beforeEach(async () => {
    // Import the tool creator and create edit_file
    const { createFileTools } = await import('../../src/tools/fileTools.js');
    const tmp = path.join(os.tmpdir(), 'openagent-edit-test-' + Date.now());
    tmpDir = tmp;
    await fs.mkdir(tmp, { recursive: true });

    const tools = createFileTools({
      workingDir: tmp,
      getBaseDir: () => tmp,
    });

    // Find the edit_file tool
    const editTool = tools.find(t => t.name === 'edit_file');
    editFileExecute = editTool.execute;
  });

  it('should reject startLine=0 with clear 1-indexed message', async () => {
    const { filePath } = await createTempFile('line 1\nline 2\nline 3', 'test.js');
    tmpDir = path.dirname(filePath);

    const result = await editFileExecute({
      path: filePath,
      startLine: 0,
      endLine: 1,
      replace: 'replaced',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('1-indexed');
    expect(result.error).toContain('startLine');
    await cleanupTmp(tmpDir);
  });

  it('should reject endLine=0 with clear 1-indexed message', async () => {
    const { filePath, tmpDir: dir } = await createTempFile('line 1\nline 2\nline 3', 'test.js');

    const result = await editFileExecute({
      path: filePath,
      startLine: 1,
      endLine: 0,
      replace: 'replaced',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('1-indexed');
    expect(result.error).toContain('endLine');
    await cleanupTmp(dir);
  });

  it('should reject negative startLine', async () => {
    const { filePath, tmpDir: dir } = await createTempFile('line 1\nline 2\nline 3', 'test.js');

    const result = await editFileExecute({
      path: filePath,
      startLine: -1,
      endLine: 1,
      replace: 'replaced',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('1-indexed');
    await cleanupTmp(dir);
  });

  it('should default endLine=startLine when only startLine is provided', async () => {
    const { filePath, tmpDir: dir } = await createTempFile('line 1\nline 2\nline 3', 'test.js');

    const result = await editFileExecute({
      path: filePath,
      startLine: 2,
      replace: 'replaced line 2',
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('replaced line 2');
    expect(content).toContain('line 1');
    expect(content).toContain('line 3');
    await cleanupTmp(dir);
  });

  it('should accept valid line numbers (startLine=1)', async () => {
    const { filePath, tmpDir: dir } = await createTempFile('line 1\nline 2\nline 3', 'test.js');

    const result = await editFileExecute({
      path: filePath,
      startLine: 1,
      endLine: 1,
      replace: 'replaced line 1',
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);
    await cleanupTmp(dir);
  });
});

// ─── Task 2: Error categorization ───────────────────────────────────────────

describe('Task 2: Error categorization', () => {
  let agent;

  beforeEach(async () => {
    agent = await createTestAgent();
  });

  describe('VALIDATION_ERROR category', () => {
    it('should categorize "must be greater" as VALIDATION_ERROR', () => {
      expect(agent.categorizeError({ message: 'endLine (0) must be greater than startLine (0)' }))
        .toBe('VALIDATION_ERROR');
    });

    it('should categorize "1-indexed" as VALIDATION_ERROR', () => {
      expect(agent.categorizeError({ message: 'startLine must be ≥ 1 (lines are 1-indexed)' }))
        .toBe('VALIDATION_ERROR');
    });

    it('should categorize "exceeds file length" as VALIDATION_ERROR', () => {
      expect(agent.categorizeError({ message: 'startLine 500 exceeds file length (10 lines)' }))
        .toBe('VALIDATION_ERROR');
    });

    it('should still categorize generic "invalid" as VALIDATION_ERROR', () => {
      expect(agent.categorizeError({ message: 'invalid value for parameter startLine' }))
        .toBe('VALIDATION_ERROR');
    });

    it('should NOT categorize unrelated messages as VALIDATION_ERROR', () => {
      expect(agent.categorizeError({ message: 'file not found' }))
        .not.toBe('VALIDATION_ERROR');
    });
  });

  describe('NOT_GIT_REPO category', () => {
    it('should categorize "not a git repository" correctly', () => {
      expect(agent.categorizeError({ message: 'fatal: not a git repository' }))
        .toBe('NOT_GIT_REPO');
    });

    it('should categorize "not a git repo" correctly', () => {
      expect(agent.categorizeError({ message: 'Not a git repo' }))
        .toBe('NOT_GIT_REPO');
    });
  });

  describe('Recovery suggestions', () => {
    it('should provide targeted suggestion for VALIDATION_ERROR', () => {
      const suggestion = agent.getRecoverySuggestion(
        'startLine must be ≥ 1 (lines are 1-indexed)',
        'edit_file'
      );
      expect(suggestion).toContain('1-indexed');
      expect(suggestion).toContain('read_file');
    });

    it('should provide targeted suggestion for NOT_GIT_REPO', () => {
      const suggestion = agent.getRecoverySuggestion(
        'Not a git repository',
        'git_status'
      );
      expect(suggestion).toContain('git repository');
      expect(suggestion).toContain('Skip git');
    });
  });

  describe('isRetryableToolFailure', () => {
    it('should mark VALIDATION_ERROR as non-retryable', () => {
      expect(agent.isRetryableToolFailure('edit_file', {
        success: false,
        error: 'startLine must be ≥ 1 (lines are 1-indexed)',
      })).toBe(false);
    });

    it('should mark NOT_GIT_REPO as non-retryable', () => {
      expect(agent.isRetryableToolFailure('git_status', {
        success: false,
        error: 'Not a git repository',
      })).toBe(false);
    });

    it('should still mark network errors as retryable', () => {
      expect(agent.isRetryableToolFailure('web_search', {
        success: false,
        error: 'Network timeout',
      })).toBe(true);
    });
  });
});

// ─── Task 3: Dead-end detector with success-rate awareness ──────────────────

describe('Task 3: Dead-end detector success-rate awareness', () => {
  let agent;

  beforeEach(async () => {
    agent = await createTestAgent();
    agent.recentErrorCategories = [];
    agent.successfulToolCalls = 0;
    agent.failedToolCalls = 0;
  });

  it('should not trigger dead-end when success rate > 70%', () => {
    // Simulate: 30 successes, 4 failures (88% success rate)
    agent.successfulToolCalls = 30;
    agent.failedToolCalls = 4;

    // Fill the error window with the same category
    agent.recentErrorCategories = ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'];

    expect(agent.hasDeadEnded()).toBeNull();
  });

  it('should not trigger dead-end for VALIDATION_ERROR category', () => {
    agent.successfulToolCalls = 5;
    agent.failedToolCalls = 10;

    agent.recentErrorCategories = [
      'VALIDATION_ERROR', 'VALIDATION_ERROR', 'VALIDATION_ERROR',
      'VALIDATION_ERROR', 'VALIDATION_ERROR',
    ];

    expect(agent.hasDeadEnded()).toBeNull();
  });

  it('should not trigger dead-end for NOT_GIT_REPO category', () => {
    agent.successfulToolCalls = 5;
    agent.failedToolCalls = 10;

    agent.recentErrorCategories = [
      'NOT_GIT_REPO', 'NOT_GIT_REPO', 'NOT_GIT_REPO',
      'NOT_GIT_REPO', 'NOT_GIT_REPO',
    ];

    expect(agent.hasDeadEnded()).toBeNull();
  });

  it('should NOT trigger dead-end with fewer than 5 errors', () => {
    agent.successfulToolCalls = 2;
    agent.failedToolCalls = 5;

    agent.recentErrorCategories = ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'];

    expect(agent.hasDeadEnded()).toBeNull();
  });

  it('should trigger dead-end when success rate < 70% and errors dominate', () => {
    agent.successfulToolCalls = 3;
    agent.failedToolCalls = 10;

    agent.recentErrorCategories = [
      'TIMEOUT', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT',
      'TIMEOUT', 'TIMEOUT', 'TIMEOUT',
    ];

    expect(agent.hasDeadEnded()).toBe('TIMEOUT');
  });
});

// ─── Task 4: Targeted self-correction in reflectOnToolResults ───────────────

describe('Task 4: Targeted self-correction in reflectOnToolResults', () => {
  let agent;

  beforeEach(async () => {
    agent = await createTestAgent();
    agent.toolFailureCounts = {};
  });

  it('should inject 1-indexed guidance for line-number validation errors', () => {
    const toolResults = [{
      toolName: 'edit_file',
      result: {
        success: false,
        error: 'endLine (0) must be greater than startLine (0)',
      },
    }];

    const messagesBefore = agent.messages.length;
    agent.reflectOnToolResults(toolResults, [{ name: 'edit_file' }]);

    expect(agent.messages.length).toBeGreaterThan(messagesBefore);
    const systemMsg = agent.messages.find(
      m => m.role === 'user' && m.content?.includes('TARGETED FIX') && m.content?.includes('1-indexed')
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('read_file');
  });

  it('should inject git skip guidance for NOT_GIT_REPO errors', () => {
    const toolResults = [{
      toolName: 'git_status',
      result: {
        success: false,
        error: 'fatal: not a git repository',
      },
    }];

    const messagesBefore = agent.messages.length;
    agent.reflectOnToolResults(toolResults, [{ name: 'git_status' }]);

    const systemMsg = agent.messages.find(
      m => m.role === 'user' && m.content?.includes('TARGETED FIX') && m.content?.includes('not a git repository')
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('Skip git');
  });

  it('should NOT inject targeted guidance for unrelated errors', () => {
    const toolResults = [{
      toolName: 'web_search',
      result: {
        success: false,
        error: 'Network timeout',
      },
    }];

    const messagesBefore = agent.messages.length;
    agent.reflectOnToolResults(toolResults, [{ name: 'web_search' }]);

    // Should still inject a generic reflection, but NOT a targeted fix
    const targetedMsg = agent.messages.find(
      m => m.role === 'user' && m.content?.includes('TARGETED FIX')
    );
    expect(targetedMsg).toBeUndefined();
  });
});

// ─── Task 5: Git tools graceful failure ─────────────────────────────────────

describe('Task 5: Git tools graceful failure on non-git directories', () => {
  let gitStatusExecute;
  let tmpDir;

  beforeEach(async () => {
    const { createGitTools } = await import('../../src/tools/gitTools.js');
    tmpDir = path.join(os.tmpdir(), 'openagent-git-test-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });

    const tools = createGitTools({
      workingDir: tmpDir,
      getBaseDir: () => tmpDir,
    });

    const statusTool = tools.find(t => t.name === 'git_status');
    gitStatusExecute = statusTool.execute;
  });

  it('should return NOT_GIT_REPO error on non-git directory', async () => {
    const result = await gitStatusExecute({ cwd: tmpDir });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not a git repository');
    expect(result.errorType).toBe('NOT_GIT_REPO');
  });

  it('should not return raw stderr for non-git directories', async () => {
    const result = await gitStatusExecute({ cwd: tmpDir });

    expect(result.success).toBe(false);
    // Should NOT contain raw git stderr like "fatal: not a git repository..."
    // The error should be the clean, normalized message
    expect(result.error).not.toContain('fatal:');
    expect(result.errorType).toBeDefined();
  });
});
