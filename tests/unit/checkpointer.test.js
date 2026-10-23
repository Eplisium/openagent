/**
 * Unit tests for TurnCheckpointer (automatic per-turn checkpoints + rewind)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as cp from '../../src/agent/TurnCheckpointer.js';
import { createFileTools } from '../../src/tools/fileTools.js';
import { createAdvancedEditTools } from '../../src/tools/advancedEditTools.js';

let dir;

function write(rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function read(rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf-8');
}

function exists(rel) {
  return fs.existsSync(path.join(dir, rel));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-ckpt-'));
  cp.reset();
  cp.configure({ rootDir: dir, sessionId: 'test-session', enabled: true });
});

afterEach(() => {
  cp.reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('TurnCheckpointer', () => {
  it('is a no-op before beginTurn()', async () => {
    const p = write('a.txt', 'one');
    expect(await cp.capture(p)).toBeNull();
    expect(fs.existsSync(path.join(dir, '.openagent', 'checkpoints'))).toBe(false);
  });

  it('captures only the first version per turn and restores it', async () => {
    const p = write('a.txt', 'original');
    const turn = await cp.beginTurn('edit a');
    await cp.capture(p);
    fs.writeFileSync(p, 'second');
    await cp.capture(p);
    fs.writeFileSync(p, 'third');

    const result = await cp.rewind(turn.id);
    expect(result.success).toBe(true);
    expect(read('a.txt')).toBe('original');
    expect(result.restored.map((x) => path.basename(x))).toEqual(['a.txt']);
  });

  it('deletes files that did not exist before the turn', async () => {
    const turn = await cp.beginTurn('create b');
    const p = path.join(dir, 'sub', 'b.txt');
    await cp.capture(p);
    write('sub/b.txt', 'new file');

    const result = await cp.rewind(turn.id);
    expect(exists('sub/b.txt')).toBe(false);
    expect(result.deleted).toHaveLength(1);
  });

  it('rewinds the target turn and every later turn in reverse order', async () => {
    const a = write('a.txt', 'v0');
    const t1 = await cp.beginTurn('turn 1');
    await cp.capture(a);
    fs.writeFileSync(a, 'v1');

    const t2 = await cp.beginTurn('turn 2');
    await cp.capture(a);
    fs.writeFileSync(a, 'v2');
    const c = path.join(dir, 'c.txt');
    await cp.capture(c);
    fs.writeFileSync(c, 'created in t2');

    const t3 = await cp.beginTurn('turn 3');
    await cp.capture(a);
    fs.writeFileSync(a, 'v3');

    const turns = await cp.listTurns();
    expect(turns.map((t) => t.id)).toEqual([t1.id, t2.id, t3.id]);

    // Rewind to before turn 2 → a = v1, c gone, turns 2-3 dropped.
    const r = await cp.rewind(t2.id);
    expect(r.turnsRewound).toEqual([t2.id, t3.id]);
    expect(read('a.txt')).toBe('v1');
    expect(exists('c.txt')).toBe(false);
    expect((await cp.listTurns()).map((t) => t.id)).toEqual([t1.id]);

    // Then rewind turn 1 → v0
    await cp.rewind(t1.id);
    expect(read('a.txt')).toBe('v0');
  });

  it('supports dry-run (code:false) without touching files', async () => {
    const a = write('a.txt', 'v0');
    const t = await cp.beginTurn('t');
    await cp.capture(a);
    fs.writeFileSync(a, 'v1');
    const r = await cp.rewind(t.id, { code: false });
    expect(r.dryRun).toBe(true);
    expect(r.restored).toHaveLength(1);
    expect(read('a.txt')).toBe('v1');
    expect((await cp.listTurns()).length).toBe(1);
  });

  it('skips binary and oversized files', async () => {
    const bin = path.join(dir, 'img.bin');
    fs.writeFileSync(bin, Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
    cp.configure({ maxFileBytes: 10 });
    const big = write('big.txt', 'x'.repeat(50));
    const t = await cp.beginTurn('binary');
    const e1 = await cp.capture(bin);
    const e2 = await cp.capture(big);
    expect(e1.skipped).toBe('binary');
    expect(e2.skipped).toBe('too-large');
    fs.writeFileSync(bin, 'changed');
    const r = await cp.rewind(t.id);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['binary', 'too-large']);
    expect(fs.readFileSync(bin, 'utf-8')).toBe('changed');
  });

  it('ignores paths inside .git', async () => {
    await cp.beginTurn('git');
    const p = write('.git/config', 'x');
    expect(await cp.capture(p)).toBeNull();
  });

  it('keeps only the last maxTurns turns and stores content-addressed blobs', async () => {
    cp.configure({ maxTurns: 3 });
    const a = write('a.txt', 'same');
    for (let i = 0; i < 5; i++) {
      await cp.beginTurn(`t${i}`);
      await cp.capture(a);
    }
    const turns = await cp.listTurns();
    expect(turns).toHaveLength(3);
    const blobs = fs.readdirSync(path.join(cp.getStoreDir(), 'blobs'));
    expect(blobs).toHaveLength(1); // identical content deduped
    expect(fs.existsSync(path.join(cp.getStoreDir(), 'manifest.json'))).toBe(true);
  });

  it('diffSummary reports line deltas against current content', async () => {
    const a = write('a.txt', 'l1\nl2\n');
    const t = await cp.beginTurn('t');
    await cp.capture(a);
    fs.writeFileSync(a, 'l1\nl2\nl3\nl4\n');
    const s = await cp.diffSummary(t.id);
    expect(s.success).toBe(true);
    expect(s.files[0]).toMatchObject({ status: 'modified', added: 2, removed: 0 });
  });

  it('restores directories and files removed by delete_file / moved by move_file', async () => {
    write('folder/x.txt', 'x');
    write('m.txt', 'move me');
    const tools = createFileTools({ baseDir: dir });
    const del = tools.find((t) => t.name === 'delete_file');
    const mv = tools.find((t) => t.name === 'move_file');
    const t = await cp.beginTurn('destructive');
    expect((await del.execute({ path: path.join(dir, 'folder'), confirm: true })).success).toBe(true);
    expect((await mv.execute({ source: path.join(dir, 'm.txt'), destination: path.join(dir, 'moved', 'm2.txt') })).success).toBe(true);
    expect(exists('folder/x.txt')).toBe(false);

    await cp.rewind(t.id);
    expect(read('folder/x.txt')).toBe('x');
    expect(read('m.txt')).toBe('move me');
    expect(exists('moved/m2.txt')).toBe(false);
  });

  it('is wired into write_file, edit_file and multi_edit', async () => {
    write('a.js', 'const a = 1;\n');
    write('b.js', 'const b = 1;\n');
    const fileTools = createFileTools({ baseDir: dir });
    const adv = createAdvancedEditTools({ baseDir: dir });
    const t = await cp.beginTurn('tools');
    await fileTools.find((x) => x.name === 'write_file').execute({ path: path.join(dir, 'new.js'), content: 'new' });
    await fileTools.find((x) => x.name === 'edit_file').execute({ path: path.join(dir, 'a.js'), find: 'const a = 1;', replace: 'const a = 2;' });
    const multi = adv.find((x) => x.name === 'multi_edit');
    const res = await multi.execute({ edits: [{ path: path.join(dir, 'b.js'), find: 'const b = 1;', replace: 'const b = 2;' }] });
    expect(res.success).toBe(true);
    expect(read('a.js')).toContain('2');
    expect(read('b.js')).toContain('2');

    const turns = await cp.listTurns();
    const names = turns[0].files.map((f) => path.basename(f.path)).sort();
    expect(names).toContain('a.js');
    expect(names).toContain('new.js');
    expect(names).toContain('b.js');

    await cp.rewind(t.id);
    expect(read('a.js')).toBe('const a = 1;\n');
    expect(read('b.js')).toBe('const b = 1;\n');
    expect(exists('new.js')).toBe(false);
  });
});
