import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { CLI } from '../src/cli.js';
import { ModelBrowser } from '../src/ModelBrowser.js';
import { MultilineInput, multilinePrompt } from '../src/cli/multilineInput.js';
import { promptWithTerminalReset, resetTerminalInput } from '../src/cli/terminal.js';
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
  assert.match(cli.buildPromptStatusLine(), /demo\/fast.*\d+%/i);
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

test('CLI loadState restores history even when verbose is off', async () => {
  const cli = new CLI({ autoSave: false });
  cli.verbose = false;

  const originalEnsureDir = fs.ensureDir;
  const originalPathExists = fs.pathExists;
  const originalReadJson = fs.readJson;

  fs.ensureDir = async () => {};
  fs.pathExists = async () => true;
  fs.readJson = async () => ({
    history: [
      { type: 'agent', task: 'Restored task', timestamp: '2026-03-19T12:00:00.000Z' },
    ],
  });

  try {
    await cli.loadState();
    assert.equal(cli.history.length, 1);
    assert.equal(cli.history[0].task, 'Restored task');
  } finally {
    fs.ensureDir = originalEnsureDir;
    fs.pathExists = originalPathExists;
    fs.readJson = originalReadJson;
  }
});

test('CLI auto-save runs at the exact interval and stays quiet while prompting', async () => {
  const cli = new CLI({ autoSave: true, autoSaveInterval: 1000 });
  cli.verbose = true;
  cli.promptActive = true;
  cli.lastSaveTime = Date.now() - cli.autoSaveInterval;

  let saves = 0;
  cli.session = {
    save: async () => {
      saves++;
      return { success: true };
    },
  };

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalConsoleLog = console.log;

  let intervalHandler = null;
  const logs = [];
  global.setInterval = (handler) => {
    intervalHandler = handler;
    return { unref() {} };
  };
  global.clearInterval = () => {};
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    cli.startAutoSave();
    await intervalHandler();
    assert.equal(saves, 1);
    assert.equal(logs.length, 0);
  } finally {
    console.log = originalConsoleLog;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    cli.stopAutoSave();
  }
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

test('MultilineInput treats CRLF as submit on Windows terminals', () => {
  const input = new MultilineInput();
  input._active = true;

  let submitted = 0;
  input._submit = () => {
    submitted++;
  };
  input._insertText = () => {
    throw new Error('CRLF should submit, not be inserted as pasted text');
  };

  input._onData('\r\n');

  assert.equal(submitted, 1);
});

test('MultilineInput treats LF as submit on terminals without carriage return', () => {
  const input = new MultilineInput();
  input._active = true;

  let submitted = 0;
  input._submit = () => {
    submitted++;
  };
  input._newline = () => {
    throw new Error('LF should submit, not insert a newline');
  };

  input._onData('\n');

  assert.equal(submitted, 1);
});

test('MultilineInput uses Ctrl+O as the portable newline shortcut', () => {
  const input = new MultilineInput();
  input._active = true;

  let newlines = 0;
  input._newline = () => {
    newlines++;
  };
  input._submit = () => {
    throw new Error('Ctrl+O should insert a newline');
  };

  input._onData('\x0f');

  assert.equal(newlines, 1);
});

test('MultilineInput clears the full rendered block from cursor position', () => {
  const input = new MultilineInput();
  const writes = [];

  input.stdout = {
    write(chunk) {
      writes.push(chunk);
      return true;
    },
  };

  input._rendered = 3;
  input._cursorRenderLine = 1;

  input._clearRenderedBlock();

  assert.deepEqual(writes, [
    '\x1b[1A',
    '\r\x1b[2K',
    '\x1b[1B',
    '\r\x1b[2K',
    '\x1b[1B',
    '\r\x1b[2K',
    '\x1b[2A',
    '\r',
  ]);
  assert.equal(input._rendered, 0);
  assert.equal(input._cursorRenderLine, 0);
});

test('resetTerminalInput drains pending stdin bytes and disables raw mode', async () => {
  const states = [];
  const buffered = ['\r', '\n', null];
  const input = {
    isTTY: true,
    pause() {
      states.push('pause');
    },
    setRawMode(value) {
      states.push(`raw:${value}`);
    },
    resume() {
      states.push('resume');
    },
    read() {
      return buffered.length > 0 ? buffered.shift() : null;
    },
  };

  await resetTerminalInput(input);

  assert.deepEqual(states, ['pause', 'raw:false', 'resume']);
  assert.equal(buffered.length, 0);
});

test('resetTerminalInput preserves buffered printable input after stray enter bytes', async () => {
  const buffered = ['\r', 'next command', null];
  const input = {
    isTTY: true,
    pause() {},
    setRawMode() {},
    resume() {},
    read() {
      return buffered.length > 0 ? buffered.shift() : null;
    },
    unshift(chunk) {
      buffered.unshift(chunk);
    },
  };

  await resetTerminalInput(input);

  assert.equal(input.read(), 'next command');
});

test('promptWithTerminalReset uses a fresh prompt module after terminal reset', async () => {
  const events = [];
  const input = {
    isTTY: true,
    pause() {
      events.push('pause');
    },
    setRawMode(value) {
      events.push(`raw:${value}`);
    },
    resume() {
      events.push('resume');
    },
    read() {
      events.push('read');
      return null;
    },
  };

  const promptModule = {
    createPromptModule({ input: promptInput, output }) {
      events.push(promptInput === input ? 'prompt:input-ok' : 'prompt:input-bad');
      events.push(output === process.stdout ? 'prompt:output-ok' : 'prompt:output-bad');
      return async (questions) => {
        events.push(`questions:${questions.length}`);
        return { ok: true };
      };
    },
  };

  const result = await promptWithTerminalReset([{ type: 'confirm', name: 'ok' }], {
    input,
    output: process.stdout,
    promptModule,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, [
    'pause',
    'raw:false',
    'resume',
    'read',
    'read',
    'prompt:input-ok',
    'prompt:output-ok',
    'questions:1',
  ]);
});

test('multilinePrompt resets terminal state before starting the raw input widget', async () => {
  const events = [];
  const stdin = {
    isTTY: true,
    isRaw: false,
    pause() {
      events.push('pause');
    },
    setRawMode(value) {
      events.push(`raw:${value}`);
    },
    resume() {
      events.push('resume');
    },
    read() {
      events.push('read');
      return null;
    },
  };
  const stdout = {
    write() {
      return true;
    },
  };

  const originalStart = MultilineInput.prototype.start;
  MultilineInput.prototype.start = function startStub() {
    events.push('start');
    return Promise.resolve('ok');
  };

  try {
    const result = await multilinePrompt({ stdin, stdout });
    assert.equal(result, 'ok');
  } finally {
    MultilineInput.prototype.start = originalStart;
  }

  assert.deepEqual(events, [
    'pause',
    'raw:false',
    'resume',
    'read',
    'read',
    'start',
  ]);
});

test('ModelBrowser uses terminal-safe prompt wrapper for model selection', async () => {
  const browser = new ModelBrowser();
  browser.models = [{ id: 'demo/model', name: 'Demo', provider: 'Demo' }];

  let promptCalls = 0;
  browser.pickFromList = async (models) => {
    assert.equal(models.length, 1);
    return models[0].id;
  };

  const originalPrompt = globalThis.__OPENAGENT_TEST_PROMPT__;
  globalThis.__OPENAGENT_TEST_PROMPT__ = async () => {
    promptCalls++;
    return { sortMode: 'all' };
  };

  try {
    const selected = await browser.pickModel();
    assert.equal(selected, 'demo/model');
    assert.equal(promptCalls, 1);
  } finally {
    globalThis.__OPENAGENT_TEST_PROMPT__ = originalPrompt;
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
process.exit(0);
