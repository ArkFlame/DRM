import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotWriter } from '../src/server/persistence.mjs';

test('shared snapshot writer coalesces same-turn saves and writes later versions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-durable-writer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  const state = { count: 1 };
  let snapshots = 0;
  const persist = snapshotWriter(file, () => { snapshots++; return state; });
  const a = persist(), b = persist();
  assert.equal(a, b);
  await Promise.all([a, b]);
  state.count = 2;
  await persist();
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { count: 2 });
  assert.equal(snapshots, 2);
});

test('snapshot staging never reuses a stale .tmp and writes private output', async t => {
  const { writeFile, stat } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'drm-private-writer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  await writeFile(`${file}.tmp`, 'preexisting temporary file');
  await snapshotWriter(file, () => ({ secret: 'private' }))();
  assert.equal(await readFile(`${file}.tmp`, 'utf8'), 'preexisting temporary file');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { secret: 'private' });
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('failed atomic snapshot write removes its own temporary file and can retry', async t => {
  const { mkdir, readdir, rmdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'drm-failed-writer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  await mkdir(file); // rename cannot replace a nonempty filesystem directory with a file
  const save = snapshotWriter(file, () => ({ count: 1 }));
  await assert.rejects(save());
  assert.deepEqual(await readdir(dir), ['state.json']);
  await rmdir(file);
  await save();
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { count: 1 });
});
