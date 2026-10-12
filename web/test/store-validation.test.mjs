import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/installations.mjs';

test('v1 storage rejects audit history above its own persisted maximum', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-v1-audit-limit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'data.json');
  const audit = {
    at: '2026-10-11T00:00:00.000Z', productId: 'FairPlay',
    installationId: '123e4567-e89b-42d3-a456-426614174000',
    status: 'REVIEW', reason: 'Manual investigation'
  };
  await writeFile(file, JSON.stringify({ schema: 1, installations: {}, audit: Array(5001).fill(audit) }));
  await assert.rejects(new Store(file).load(), /Invalid schema/);
});

test('v1 storage remains compatible with historical transport address labels', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-v1-bad-ip-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'data.json');
  const uuid = '123e4567-e89b-42d3-a456-426614174000';
  const entry = {
    productId: 'FairPlay', installationId: uuid, productVersion: '4.0',
    serverVersion: 'Paper', javaVersion: '17', downloadDigest: '',
    observedIp: 'definitely-not-a-source-ip', firstSeen: '2026-10-11T00:00:00.000Z',
    lastSeen: '2026-10-11T00:00:00.000Z', reports: 1, manualStatus: 'NONE',
    manualReason: '', entitlement: 'UNKNOWN', entitlementCheckedAt: ''
  };
  await writeFile(file, JSON.stringify({ schema: 1, installations: { [`FairPlay:${uuid}`]: entry }, audit: [] }));
  const store = new Store(file);
  await store.load();
  assert.equal(store.state.installations[`FairPlay:${uuid}`].observedIp, 'definitely-not-a-source-ip');
});
