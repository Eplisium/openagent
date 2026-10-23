/**
 * Unit tests for markdown subagent definitions
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadMarkdownAgents, clearMarkdownCaches } from '../../src/commands/markdownLoader.js';
import {
  getAllSpecializations,
  getSpecialization,
  resolveToolNames,
  SUBAGENT_SPECIALIZATIONS,
} from '../../src/agent/subagents/specializations.js';
import { SubagentManager } from '../../src/agent/SubagentManager.js';
import { handleExtendedCommand } from '../../src/cli/extendedCommands.js';

let project;
let home;
let prevHome;

function write(base, rel, content) {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-agents-proj-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-agents-home-'));
  prevHome = process.env.OPENAGENT_HOME_DIR;
  process.env.OPENAGENT_HOME_DIR = home;
  clearMarkdownCaches();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.OPENAGENT_HOME_DIR;
  else process.env.OPENAGENT_HOME_DIR = prevHome;
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe('markdown agents', () => {
  it('loads agents from all sources with project precedence', () => {
    write(home, '.openagent/agents/helper.md', '---\nname: helper\ndescription: user helper\n---\nUser prompt');
    write(project, '.claude/agents/security.md', '---\nname: security-auditor\ndescription: Audits\ntools: Read, Grep, Glob\nmodel: sonnet\n---\nYou audit code.');
    write(project, '.openagent/agents/helper.md', '---\nname: helper\ndescription: project helper\ntools: read_file, exec\n---\nProject prompt');

    const agents = loadMarkdownAgents({ cwd: project });
    expect(agents.helper.description).toBe('project helper');
    expect(agents.helper.tools).toEqual(['read_file', 'exec']);
    expect(agents.helper.systemPrompt).toContain('Project prompt');
    expect(agents['security-auditor']).toMatchObject({ model: 'sonnet', source: 'project-claude' });
    expect(agents['security-auditor'].tools).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('uses file name when name is missing and treats model: inherit as no override', () => {
    write(project, '.openagent/agents/doc-writer.md', '---\ndescription: Docs\nmodel: inherit\n---\nWrite docs.');
    const agents = loadMarkdownAgents({ cwd: project });
    expect(agents['doc-writer'].model).toBeNull();
    expect(agents['doc-writer'].tools).toBeNull();
  });

  it('merges with built-ins and lets markdown override same id', () => {
    write(project, '.openagent/agents/coder.md', '---\nname: coder\ndescription: My coder\n---\nCustom coder prompt');
    const all = getAllSpecializations({ cwd: project });
    expect(all.coder.description).toBe('My coder');
    expect(all.architect).toBe(SUBAGENT_SPECIALIZATIONS.architect);
    expect(getSpecialization('does-not-exist', { cwd: project })).toBe(SUBAGENT_SPECIALIZATIONS.general);
    // Built-ins untouched
    expect(SUBAGENT_SPECIALIZATIONS.coder.description).not.toBe('My coder');
  });

  it('maps Claude-Code tool names to OpenAgent tools', () => {
    expect(resolveToolNames(null)).toBeNull();
    const tools = resolveToolNames(['Read', 'Bash(git diff:*)', 'web_search']);
    expect(tools).toEqual(expect.arrayContaining(['read_file', 'exec', 'web_search']));
    expect(tools).not.toContain('write_file');
  });

  it('SubagentManager restricts tools and resolves markdown agents', () => {
    write(project, '.openagent/agents/reader.md', '---\nname: reader\ndescription: Read only\ntools: Read, Grep\nmodel: some/model\n---\nOnly read.');
    const mgr = new SubagentManager({ workingDir: project, verbose: false });
    try {
      const spec = mgr.getSpecialization('reader');
      expect(spec.description).toBe('Read only');
      const registry = mgr.getToolsForSpec(spec);
      const names = [...registry.tools.keys()];
      expect(names).toContain('read_file');
      expect(names).toContain('search_in_files');
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('exec');
      expect(mgr.getToolsForSpec(mgr.getSpecialization('coder'))).toBe(mgr.sharedTools);

      const agent = mgr.createSubagent('reader');
      expect(agent.model).toBe('some/model');
      expect(agent.tools).toBe(registry);

      const ids = mgr.listSpecializations().map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(['general', 'coder', 'reader']));
    } finally {
      for (const timer of mgr.subagentTimers?.values?.() || []) clearTimeout(timer);
    }
  });

  it('/agents lists markdown agents', async () => {
    write(project, '.openagent/agents/reader.md', '---\nname: reader\ndescription: Read only agent\n---\nOnly read.');
    const out = [];
    const handled = await handleExtendedCommand('agents', '', { cli: { workingDir: project }, print: (t) => out.push(t) });
    expect(handled).toBe(true);
    expect(out.join('\n')).toContain('Read only agent');
    expect(out.join('\n')).toContain('coder');
  });
});
