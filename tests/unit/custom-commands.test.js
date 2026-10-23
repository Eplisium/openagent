/**
 * Unit tests for markdown custom slash commands
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseFrontmatter,
  loadCustomCommands,
  expandCommand,
  commandNameFromPath,
  splitArgs,
  clearMarkdownCaches,
} from '../../src/commands/markdownLoader.js';
import { handleExtendedCommand, listExtendedCommands } from '../../src/cli/extendedCommands.js';

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
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cmd-proj-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-cmd-home-'));
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

describe('frontmatter + helpers', () => {
  it('parses frontmatter with CRLF, quotes and argument hints', () => {
    const { frontmatter, body } = parseFrontmatter('---\r\ndescription: "Review: code"\r\nargument-hint: [file] [focus]\r\nallowed-tools: Read, Grep\r\n---\r\nBody\r\n');
    expect(frontmatter.description).toBe('Review: code');
    expect(frontmatter['argument-hint']).toBe('[file] [focus]');
    expect(frontmatter['allowed-tools']).toBe('Read, Grep');
    expect(body).toBe('Body');
  });

  it('derives namespaced names from relative paths', () => {
    expect(commandNameFromPath('review.md')).toBe('review');
    expect(commandNameFromPath(path.join('git', 'commit.md'))).toBe('git:commit');
    expect(commandNameFromPath('a/b/c.md')).toBe('a:b:c');
  });

  it('splits quoted arguments', () => {
    expect(splitArgs('one "two words" \'three\'')).toEqual(['one', 'two words', 'three']);
  });
});

describe('custom commands', () => {
  it('loads project/user/.claude commands with correct precedence', () => {
    write(home, '.openagent/commands/hello.md', '---\ndescription: user hello\n---\nUser hello');
    write(home, '.openagent/commands/only-user.md', 'Only user');
    write(project, '.claude/commands/hello.md', '---\ndescription: claude hello\n---\nClaude hello');
    write(project, '.claude/commands/legacy.md', 'Legacy');
    write(project, '.openagent/commands/hello.md', '---\ndescription: project hello\n---\nProject hello');
    write(project, '.openagent/commands/git/commit.md', '---\ndescription: Commit\nmodel: fast-model\nallowed-tools: Bash(git add:*), Bash(git commit:*)\n---\nCommit $ARGUMENTS');

    const cmds = loadCustomCommands({ cwd: project });
    expect(cmds.get('hello').description).toBe('project hello');
    expect(cmds.get('hello').source).toBe('project');
    expect(cmds.get('legacy').source).toBe('project-claude');
    expect(cmds.get('only-user').source).toBe('user');
    const commit = cmds.get('git:commit');
    expect(commit.model).toBe('fast-model');
    expect(commit.allowedTools).toEqual(['Bash(git add:*)', 'Bash(git commit:*)']);
  });

  it('substitutes $ARGUMENTS and positional args', async () => {
    const out = await expandCommand({ body: 'All: $ARGUMENTS | first=$1 second=$2 missing=[$9]' }, 'foo "bar baz"', { cwd: project });
    expect(out).toBe('All: foo "bar baz" | first=foo second=bar baz missing=[]');
  });

  it('appends arguments when the template has no placeholders', async () => {
    const out = await expandCommand({ body: 'Do the thing.' }, 'extra info', { cwd: project });
    expect(out).toContain('ARGUMENTS: extra info');
  });

  it('inlines @file includes and leaves missing files untouched', async () => {
    write(project, 'src/util.js', 'export const x = 42;\n');
    const out = await expandCommand({ body: 'Review @src/util.js and @missing/file.js please' }, '', { cwd: project });
    expect(out).toContain('<file path="src/util.js">');
    expect(out).toContain('export const x = 42;');
    expect(out).toContain('@missing/file.js please');
  });

  it('refreshes the cache when a file changes', () => {
    const p = write(project, '.openagent/commands/x.md', 'v1');
    expect(loadCustomCommands({ cwd: project }).get('x').body).toBe('v1');
    fs.writeFileSync(p, 'v2 longer');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(p, future, future);
    expect(loadCustomCommands({ cwd: project }).get('x').body).toBe('v2 longer');
  });

  it('handleExtendedCommand returns {prompt} for custom commands and false for unknown', async () => {
    write(project, '.openagent/commands/git/commit.md', '---\ndescription: Commit\n---\nWrite a commit message for $1');
    const ctx = { cli: { workingDir: project }, print: () => {} };
    const res = await handleExtendedCommand('git:commit', 'feature-x', ctx);
    expect(res).toMatchObject({ prompt: 'Write a commit message for feature-x', command: 'git:commit' });
    expect(await handleExtendedCommand('nope', '', ctx)).toBe(false);
  });

  it('lists built-ins and custom commands', async () => {
    write(project, '.openagent/commands/deploy.md', '---\ndescription: Deploy it\nargument-hint: [env]\n---\nDeploy');
    const list = listExtendedCommands({ cwd: project });
    const names = list.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['rewind', 'checkpoints', 'commands', 'agents', 'deploy']));
    expect(list.find((c) => c.name === 'deploy').description).toContain('[env]');

    const lines = [];
    expect(await handleExtendedCommand('commands', '', { cli: { workingDir: project }, print: (t) => lines.push(t) })).toBe(true);
    expect(lines.join('\n')).toContain('/deploy [env]');
  });
});
