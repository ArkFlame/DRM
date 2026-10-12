import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkBuiltByBit, createDrmService } from '../src/server/service.mjs';
import { clientIp, readJson } from '../src/server/http.mjs';

const create = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'arkflame-drm-v04-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = createDrmService({ dataFile: join(dir, 'inst.json'), graphFile: join(dir, 'graph.json'), hashKey: 'x'.repeat(64), retentionDays: 180 });
  await service.ready;
  return { dir, service };
};
const installation = () => ({ protocolVersion: 1, productId: 'fairplay', productVersion: '4.0', serverVersion: 'Paper', javaVersion: '8', installationId: randomUUID(), distributionNonce: '' });
const session = () => ({ protocolVersion: 2, event:'session_start', eventId:randomUUID(), sessionId:randomUUID(), nodeId:randomUUID(), productId:'fairplay',installationId:randomUUID(), sequence:1,productVersion:'4.0',serverVersion:'Paper',sentAt:new Date().toISOString(),server:{port:25565,maxPlayers:50},plugins:[],operators:[] });

test('v1 report persists without a separate backend or admin bearer token', async t => {
  const { dir, service } = await create(t);
  const item = installation();
  assert.equal((await service.reportV1(item, '127.0.0.1')).status, 202);
  const saved = JSON.parse(await readFile(join(dir,'inst.json'), 'utf8'));
  assert.equal(saved.installations[`${item.productId}:${item.installationId}`].productVersion, '4.0');
});
test('v2 session populates overview and survives restart', async t => {
  const { dir, service } = await create(t);
  const s = session();
  assert.equal((await service.reportV2(s, '127.0.0.1')).status, 202);
  const next = createDrmService({ dataFile:join(dir,'inst.json'), graphFile:join(dir,'graph.json'), hashKey:'x'.repeat(64) });
  await next.ready;
  assert.equal((await next.query('/api/admin/v2/overview')).stats.nodes, 1);
});
test('advisory network BLOCK overridden by node ALLOW', async t => {
  const { service } = await create(t);
  const s = session();
  await service.reportV2(s, '127.0.0.1');
  await service.query('/api/admin/v2/policy', {scope:'network',id:'127.0.0.1',status:'BLOCK',reason:'Review'});
  await service.query('/api/admin/v2/policy', {scope:'node',id:s.nodeId,status:'ALLOW',reason:'Reviewed'});
  assert.equal((await service.query(`/api/admin/v2/node?id=${s.nodeId}`)).policy.status,'ALLOW');
});
test('reject invalid v2 event without advancing graph state', async t => {
  const { service } = await create(t);
  assert.equal((await service.reportV2({bad:1},'127.0.0.1')).status, 400);
  assert.equal((await service.query('/api/admin/v2/overview')).stats.nodes, 0);
});
test('requires trustworthy proxy IP and blocks forged IP without opt-in', () => {
  const req = new Request('https://drm.arkflame.com', {headers:{'x-real-ip':'1.2.3.4'}});
  assert.equal(clientIp(req, false),'');
  assert.equal(clientIp(req, true),'1.2.3.4');
});
test('enforces bounded JSON, including chunked body', async () => {
  const req = new Request('https://drm.arkflame.com/api/v2/events', {method:'POST', headers:{'Content-Type':'application/json'},body:'{"message":"very long"}'});
  assert.equal((await readJson(req,8)).status,413);
});
test('rejects unexpected content-type before parsing', async () => {
  const req = new Request('https://drm.arkflame.com/api/v1/check', {method:'POST', headers:{'Content-Type':'text/plain'},body:'{}'});
  assert.equal((await readJson(req,100)).status,415);
});
test('review update persists with same product and installation keys', async t => {
  const { service } = await create(t);
  const item=installation();
  await service.reportV1(item,'127.0.0.1');
  await service.query('/api/admin/review',{productId:item.productId,installationId:item.installationId,status:'REVIEW',reason:'Manual audit'});
  assert.equal((await service.query('/api/admin/installations'))[0].manualStatus,'REVIEW');
});


test('BuiltByBit Retry-After uses its documented millisecond unit', async () => {
  const response = await checkBuiltByBit('a_nonce_1234', 'token', async () => ({
    ok: false, status: 429, headers: new Headers({ 'Retry-After': '120000' })
  }));
  assert.equal(response.retryAfterMs, 120000);
});


test('dashboard query waits for pending telemetry durability barrier', async t => {
  const { service } = await create(t);
  const packet = session();
  const persist = service.graph.persist.bind(service.graph);
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  service.graph.persist = async () => { await barrier; return persist(); };
  const ingestion = service.reportV2(packet, '127.0.0.1');
  await new Promise(resolve => setImmediate(resolve));
  let finished = false;
  const reading = service.query('/api/admin/v2/overview').then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  await ingestion;
  assert.equal((await reading).stats.nodes, 1);
});


test('dashboard query waits for persisted state to load after service construction', async t => {
  const { dir, service } = await create(t);
  await service.reportV2(session(), '127.0.0.1');
  const restored = createDrmService({ dataFile: join(dir, 'inst.json'), graphFile: join(dir, 'graph.json'), hashKey: 'x'.repeat(64) });
  assert.equal((await restored.query('/api/admin/v2/overview')).stats.nodes, 1);
});

test('failed v1 disk write cannot leak uncommitted installation or review state', async t => {
  const { service } = await create(t);
  const item = installation();
  await service.reportV1(item, '127.0.0.1');
  const original = service.store.persist;
  service.store.persist = async () => { throw Error('disk full'); };
  await assert.rejects(service.query('/api/admin/review', {
    productId: item.productId, installationId: item.installationId,
    status: 'BLOCK', reason: 'Investigation'
  }), /disk full/);
  assert.equal((await service.query('/api/admin/installations'))[0].manualStatus, 'NONE');
  service.store.persist = original;
  await service.query('/api/admin/review', {
    productId: item.productId, installationId: item.installationId,
    status: 'REVIEW', reason: 'Reviewed'
  });
  assert.equal((await service.query('/api/admin/audit')).length, 1);
});

test('failed v2 ingestion rolls back memory and accepts subsequent valid retry', async t => {
  const { service } = await create(t);
  const packet = session();
  const original = service.graph.persist;
  service.graph.persist = async () => { throw Error('disk full'); };
  await assert.rejects(service.reportV2(packet, '127.0.0.1'), /disk full/);
  assert.equal((await service.query('/api/admin/v2/overview')).stats.nodes, 0);
  service.graph.persist = original;
  assert.equal((await service.reportV2(packet, '127.0.0.1')).status, 202);
  assert.equal((await service.query('/api/admin/v2/overview')).stats.nodes, 1);
});

test('failed node policy save restores earlier committed policy and audit', async t => {
  const { service } = await create(t);
  const packet = session();
  await service.reportV2(packet, '127.0.0.1');
  await service.query('/api/admin/v2/policy', {
    scope: 'node', id: packet.nodeId, status: 'REVIEW', reason: 'Initial'
  });
  const original = service.graph.persist;
  service.graph.persist = async () => { throw Error('read only'); };
  await assert.rejects(service.query('/api/admin/v2/policy', {
    scope: 'node', id: packet.nodeId, status: 'BLOCK', reason: 'Later'
  }), /read only/);
  assert.equal((await service.query(`/api/admin/v2/node?id=${packet.nodeId}`)).policy.status, 'REVIEW');
  assert.equal((await service.query('/api/admin/v2/audit')).length, 1);
  service.graph.persist = original;
});

test('failed first v1 report does not create a phantom installation', async t => {
  const { service } = await create(t);
  const original = service.store.persist;
  service.store.persist = async () => { throw Error('write denied'); };
  await assert.rejects(service.reportV1(installation(), '127.0.0.1'), /write denied/);
  assert.equal((await service.query('/api/admin/installations')).length, 0);
  service.store.persist = original;
  assert.equal((await service.reportV1(installation(), '127.0.0.1')).status, 202);
});

test('recovery follows committed bytes if an error occurs after the rename', async t => {
  const { service } = await create(t);
  const original = service.graph.persist;
  service.graph.persist = async () => {
    await original();
    throw Error('post-write failure');
  };
  await assert.rejects(service.reportV2(session(), '127.0.0.1'), /post-write failure/);
  assert.equal((await service.query('/api/admin/v2/overview')).stats.nodes, 1);
});

test('expired full node inventory automatically prunes and accepts new installation without restart', async t => {
  const { dir, service } = await create(t);
  const initial = session();
  await service.reportV2(initial, '127.0.0.1');
  const template = service.graph.state.nodes[initial.nodeId];
  const old = new Date(Date.now() - 181 * 86400000).toISOString();
  // Fill the actual configured 10,000-node capacity; no test-only limit shortcuts.
  for (let i = 0; i < 9999; i++) {
    const id = randomUUID();
    service.graph.state.nodes[id] = { ...template, id, firstSeen: old, lastSeen: old, players: {} };
  }
  await service.graph.persist();
  const incoming = session();
  assert.equal((await service.reportV2(incoming, '127.0.0.1')).status, 202);
  const restored = createDrmService({ dataFile: join(dir, 'inst.json'), graphFile: join(dir, 'graph.json'), hashKey: 'x'.repeat(64) });
  await restored.ready;
  assert.equal((await restored.query('/api/admin/v2/overview')).stats.nodes, 2);
});

test('v2 graph honors configured retention window rather than hardcoded 180 days', async t => {
  const { dir } = await create(t);
  const service = createDrmService({ dataFile: join(dir, 'custom-inst.json'), graphFile: join(dir, 'custom-graph.json'), hashKey: 'x'.repeat(64), retentionDays: 1 });
  await service.ready;
  const packet = session();
  await service.reportV2(packet, '127.0.0.1');
  service.graph.now = () => Date.now() + 2 * 86400000;
  assert.equal(service.graph.prune(), true);
  assert.equal(service.graph.state.nodes[packet.nodeId], undefined);
});

test('overview query forwards flagged-only mode and searches reported JAR filenames', async t => {
  const { service } = await create(t);
  const good = session();
  const suspicious = { ...session(), plugins: [{ name: 'OrdinaryPlugin', version: '1.0', fileName: 'OrdinaryPlugin-LEAKED.jar' }] };
  assert.equal((await service.reportV2(good, '127.0.0.1')).status, 202);
  assert.equal((await service.reportV2(suspicious, '127.0.0.2')).status, 202);
  const filtered = await service.query('/api/admin/v2/overview?view=flagged');
  assert.deepEqual(filtered.nodes.map(n => n.id), [suspicious.nodeId]);
  assert.deepEqual(filtered.networks.map(n => n.id), ['127.0.0.2']);
  assert.equal(filtered.stats.nodes, 2);
  assert.equal(filtered.stats.flaggedNodes, 1);
  const searched = await service.query('/api/admin/v2/overview?q=LEAKED&view=flagged');
  assert.deepEqual(searched.nodes.map(n => n.id), [suspicious.nodeId]);
});

test('rejects identical v1 and v2 data paths before either schema can overwrite the other', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-file-collision-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'one.json');
  assert.throws(() => createDrmService({
    dataFile: file, graphFile: join(dir, 'nested', '..', 'one.json'), hashKey: 'x'.repeat(64)
  }), /must be different files/);
});

test('invalid direct source IP is a bad request, not a rate-limit response', async t => {
  const { service } = await create(t);
  for (const invalid of ['', 'forwarded-client-label', '999.0.0.1']) {
    assert.deepEqual(await service.reportV1(installation(), invalid),
      { status: 400, body: { error: 'invalid_transport_address' } });
    assert.deepEqual(await service.reportV2(session(), invalid),
      { status: 400, body: { error: 'invalid_transport_address' } });
  }
  assert.equal((await service.query('/api/admin/installations')).length, 0);
  assert.equal((await service.query('/api/admin/v2/overview')).stats.nodes, 0);
});

test('saving an identical v1 review is idempotent and does not write or duplicate audit', async t => {
  const { service } = await create(t);
  const item = installation();
  await service.reportV1(item, '127.0.0.1');
  const decision = { productId: item.productId, installationId: item.installationId,
    status: 'REVIEW', reason: 'Manual investigation' };
  assert.deepEqual(await service.query('/api/admin/review', decision), { ok: true });
  const original = service.store.persist;
  service.store.persist = async () => { throw Error('redundant write'); };
  try {
    assert.deepEqual(await service.query('/api/admin/review', decision), { ok: true });
    assert.equal((await service.query('/api/admin/audit')).length, 1);
    assert.equal((await service.query('/api/admin/installations'))[0].manualStatus, 'REVIEW');
  } finally { service.store.persist = original; }
  assert.deepEqual(await service.query('/api/admin/review', { ...decision, reason: 'New evidence' }), { ok: true });
  assert.equal((await service.query('/api/admin/audit')).length, 2);
});

test('no BuiltByBit token returns explicit unconfigured evidence without calling provider', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-no-bbb-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const service = createDrmService({ dataFile: join(dir, 'inst.json'), graphFile: join(dir, 'graph.json'), hashKey: 'x'.repeat(64),
    bbbToken: '', bbbFetcher: () => { calls++; throw Error('should not be called'); } });
  const item = { ...installation(), distributionNonce: 'TESTNONCE_abcdef012345' };
  assert.equal((await service.reportV1(item, '127.0.0.1')).status, 202);
  const [reported] = await service.query('/api/admin/installations');
  assert.equal(reported.entitlement, 'UNKNOWN');
  assert.equal(reported.licenseEvidence, 'BUILTBYBIT_NOT_CONFIGURED');
  assert.equal((await service.query('/api/admin/config')).builtByBit, 'NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('nonce rights observations never propagate across different claimed product records', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-bbb-product-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let providerCalls = 0;
  let releaseSecond;
  const second = new Promise(resolve => { releaseSecond = resolve; });
  const service = createDrmService({ dataFile: join(dir, 'inst.json'), graphFile: join(dir, 'graph.json'), hashKey: 'x'.repeat(64),
    bbbToken: 'test-token', bbbFetcher: async () => {
      providerCalls++;
      if (providerCalls === 2) await second;
      return { ok:true, json: async () => ({ result:'success', data:{ has_usage_rights: true } }) };
    } });
  const nonce = 'TESTNONCE_abcdef012345';
  const first = { ...installation(), productId:'FairPlay', distributionNonce: nonce };
  const other = { ...installation(), productId:'FlameOrders', distributionNonce: nonce };
  await service.reportV1(first, '127.0.0.1');
  for (let i=0; i<100 && service.store.state.installations[`FairPlay:${first.installationId}`].entitlement === 'UNKNOWN';i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(service.store.state.installations[`FairPlay:${first.installationId}`].entitlement, 'NONCE_RIGHTS_YES');
  await service.reportV1(other, '127.0.0.1');
  assert.equal(service.store.state.installations[`FlameOrders:${other.installationId}`].entitlement, 'UNKNOWN');
  const queried = await service.query('/api/admin/installations');
  assert.equal(queried.find(x=>x.productId==='FairPlay').licenseEvidence, 'NONCE_RIGHTS_ONLY_PRODUCT_UNVERIFIED');
  releaseSecond();
  for (let i=0; i<100 && service.store.state.installations[`FlameOrders:${other.installationId}`].entitlement === 'UNKNOWN';i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(providerCalls, 2);
});

test('private operational counters record ingestion and expose only safe provider configuration', async t => {
  const { service } = await create(t);
  await service.reportV1(installation(), '127.0.0.1');
  await service.reportV2(session(), '127.0.0.1');
  await service.reportV2({ invalid: true }, '127.0.0.1');
  const ops = await service.query('/api/admin/operations');
  assert.equal(ops.counters.v1Accepted, 1);
  assert.equal(ops.counters.v2Accepted, 1);
  assert.equal(ops.counters.rejected, 1);
  assert.equal(ops.builtByBitConfigured, false);
  assert.equal(ops.writeBarrierHealthy, true);
  assert.equal(JSON.stringify(ops).includes('x'.repeat(64)), false);
});
