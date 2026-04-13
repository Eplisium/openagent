import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from '../src/utils/fs-compat.js';
import { Agent } from '../src/agent/Agent.js';
import { TaskManager } from '../src/agent/TaskManager.js';
import { WorkspaceManager } from '../src/agent/WorkspaceManager.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { resolveAgentPath } from '../src/paths.js';

class StubClient {
  constructor(roundsBeforeDone = 35) {
    this.roundsBeforeDone = roundsBeforeDone;
    this.callCount = 0;
  }

  async chatWithTools() {
    this.callCount++;

    if (this.callCount <= this.roundsBeforeDone) {
      return {
        content: `step ${this.callCount}`,
        toolCalls: [{
          id: `tool_${this.callCount}`,
          name: 'noop',
          arguments: { step: this.callCount },
        }],
        usage: { total_tokens: 1 },
      };
    }

    return {
      content: 'done',
      toolCalls: [],
      usage: { total_tokens: 1 },
    };
  }
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openagent-workspace-test-'));

  try {
    const projectDir = path.join(tempRoot, 'project');
    await fs.ensureDir(projectDir);

    const workspaceManager = new WorkspaceManager({ workingDir: projectDir, verbose: false });
    const workspace = await workspaceManager.prepareTaskWorkspace('Create a release checklist', {
      sessionId: 'test-session',
      source: 'test',
    });

    assert.equal(
      resolveAgentPath('src/index.js', { baseDir: projectDir, workspaceDir: workspace.workspaceDir }),
      path.join(projectDir, 'src', 'index.js'),
      'Relative paths should resolve from the project working directory'
    );
    assert.equal(
      resolveAgentPath('workspace:notes/todo.md', { baseDir: projectDir, workspaceDir: workspace.workspaceDir }),
      path.join(workspace.workspaceDir, 'notes', 'todo.md'),
      'workspace: paths should resolve inside the task workspace'
    );

    assert.ok(await fs.pathExists(path.join(workspace.workspaceDir, 'manifest.json')), 'Workspace manifest should exist');
    assert.ok(await fs.pathExists(path.join(workspace.workspaceDir, 'notes')), 'Workspace notes folder should exist');
    assert.ok(await fs.pathExists(path.join(workspace.workspaceDir, 'artifacts')), 'Workspace artifacts folder should exist');
    assert.ok(await fs.pathExists(path.join(workspace.workspaceDir, 'scratch')), 'Workspace scratch folder should exist');

    const taskManager = new TaskManager({
      workingDir: projectDir,
      workspaceDir: workspace.workspaceDir,
      verbose: false,
    });
    await taskManager.initialize('Finish the autonomous workspace feature');
    const progress = await taskManager.loadProgress();

    assert.equal(
      taskManager.taskDir,
      path.join(projectDir, '.openagent', 'task-state'),
      'Task state should default to .openagent/task-state'
    );
    assert.equal(
      progress.workspaceDir,
      workspace.workspaceDir,
      'Task progress should remember the active task workspace'
    );

    const registry = new ToolRegistry();
    registry.register({
      name: 'noop',
      description: 'A test tool that succeeds.',
      parameters: {
        type: 'object',
        properties: {
          step: { type: 'integer' },
        },
      },
      async execute() {
        return { success: true };
      },
    });

    const agent = new Agent({
      client: new StubClient(35),
      tools: registry,
      model: 'test/model',
      verbose: false,
      streaming: false,
      maxIterations: 0,
    });

    const result = await agent.run('Keep going until the work is done.');

    assert.equal(agent.maxIterations, null, 'maxIterations=0 should mean no fixed cap');
    assert.equal(result.stopReason, 'completed', 'The agent should stop because it completed the task');
    assert.equal(result.response, 'done', 'The agent should return the model final response');
    assert.ok(result.iterations > 30, 'The agent should be able to run for more than 30 iterations');
    assert.equal(result.history.length, 35, 'The run history should only contain the tool-using iterations');

    console.log('✅ Agent workspace and autonomy tests passed');
  } finally {
    await fs.remove(tempRoot);
  }
}

main().catch(error => {
  console.error('❌ Agent workspace test failed');
  console.error(error);
  process.exit(1);
});
