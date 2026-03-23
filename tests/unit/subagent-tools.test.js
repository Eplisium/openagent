/**
 * Unit tests for subagent tool wrappers
 */

import { describe, expect, it, vi } from 'vitest';
import { createSubagentTools } from '../../src/tools/subagentTools.js';

describe('subagent tools', () => {
  it('delegate_parallel reports partial failure when some delegated tasks fail', async () => {
    const manager = {
      delegateParallel: vi.fn().mockResolvedValue([
        {
          success: true,
          taskId: 'task-1',
          specialization: 'researcher',
          response: 'ok',
          duration: 1200,
          iterations: 2,
        },
        {
          success: false,
          taskId: 'task-2',
          specialization: 'tester',
          error: 'stopped early',
          duration: 800,
          stopReason: 'max_iterations',
        },
      ]),
    };

    const delegateParallelTool = createSubagentTools(manager).find((tool) => tool.name === 'delegate_parallel');
    const result = await delegateParallelTool.execute({
      tasks: [
        { task: 'one' },
        { task: 'two' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.summary).toEqual({
      total: 2,
      successful: 1,
      failed: 1,
      totalDuration: 1200,
    });
    expect(result.results[1]).toEqual(expect.objectContaining({
      taskId: 'task-2',
      stopReason: 'max_iterations',
    }));
    expect(result.error).toContain('1 delegated task');
  });
});
