import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { CLI } from '../src/cli.js';
import { Agent } from '../src/agent/Agent.js';
import { AgentSession } from '../src/agent/AgentSession.js';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('CLI syncs selected model context window', () => {
  const cli = new CLI({ autoSave: false });
  const agent = new Agent({
    model: 'demo/original',
    systemPrompt: 'system',
    verbose: false,
    maxContextTokens: 800000,
  });

  cli.modelBrowser = {
    getContextLength: (modelId) => modelId === 'demo/fast' ? 32000 : 128000,
    getModel: (modelId) => ({ id: modelId }),
  };
  cli.session = {
    model: null,
    sessionId: 'session_test',
    activeWorkspace: null,
    agent,
  };

  const synced = cli.syncSessionModelState('demo/fast');

  assert.equal(cli.session.model, 'demo/fast');
  assert.equal(cli.session.agent.model, 'demo/fast');
  assert.equal(cli.session.agent.maxContextTokens, 32000);
  assert.equal(synced.contextLength, 32000);
  assert.match(cli.buildPromptStatusLine(), /ctx est/i);
});

test('CLI createSession generates a fresh session identity', () => {
  const cli = new CLI({ autoSave: false });
  cli.modelBrowser = {
    getContextLength: () => 128000,
    getModel: (modelId) => ({ id: modelId }),
  };

  const first = cli.createSession({ modelId: 'demo/one' });
  first.activeWorkspace = { workspaceDir: 'C:\\temp\\workspace-one' };

  const second = cli.createSession({ modelId: 'demo/one' });

  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(second.activeWorkspace, null);
  assert.equal(cli.session.sessionId, second.sessionId);
});

test('Agent compaction produces a real summary marker', async () => {
  const agent = new Agent({
    model: 'demo/test',
    systemPrompt: 'system',
    verbose: false,
    maxContextTokens: 220,
    compactThreshold: 0.5,
  });

  agent.history.push({
    iteration: 1,
    toolCalls: ['read_file', 'search_in_files'],
  });

  for (let index = 0; index < 12; index++) {
    agent.pushMessage({ role: 'user', content: `User message ${index} ${'A'.repeat(40)}` });
    agent.pushMessage({ role: 'assistant', content: `Assistant message ${index} ${'B'.repeat(40)}` });
  }

  await agent.maybeCompactContext();

  assert.equal(agent.messages[0].role, 'system');
  assert.ok(
    agent.messages.some(
      (message) =>
        typeof message.content === 'string' &&
        message.content.includes('[Context compacted to preserve headroom.]')
    ),
    'Expected a compaction summary message'
  );
  assert.equal(agent.getStats().contextCompactions, 1);
});

test('AgentSession reuses active workspace for follow-up tasks', async () => {
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openagent-session-'));

  try {
    const session = new AgentSession({
      workingDir,
      model: 'demo/test',
      verbose: false,
      streaming: false,
    });

    const activeWorkspace = {
      workspaceDir: path.join(workingDir, '.openagent', 'workspaces', 'existing-workspace'),
    };

    session.activeWorkspace = activeWorkspace;
    session.taskManager.loadProgress = async () => ({
      status: 'not_initialized',
      workspaceDir: null,
    });

    let receivedWorkspaceDir = null;
    session.workspaceManager.prepareTaskWorkspace = async (task, options) => {
      receivedWorkspaceDir = options.workspaceDir;
      return {
        workspaceDir: options.workspaceDir || path.join(workingDir, '.openagent', 'workspaces', 'new-workspace'),
        task,
      };
    };

    await session.prepareTaskWorkspace('Follow-up refinement task');

    assert.equal(receivedWorkspaceDir, activeWorkspace.workspaceDir);
    assert.equal(session.activeWorkspace.workspaceDir, activeWorkspace.workspaceDir);
  } finally {
    await fs.remove(workingDir);
  }
});

let failed = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed++;
    console.error(`not ok - ${name}`);
    console.error(error instanceof Error ? error.stack : error);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`All ${tests.length} regression tests passed.`);
