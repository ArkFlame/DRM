import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NetworkGraph, validateEvent } from '../src/server/network.mjs';

const base = (event = 'session_start') => ({ protocolVersion: 2, event, eventId: randomUUID(), sessionId: randomUUID(), sequence: 1,
  nodeId: randomUUID(), productId: 'fairplay', productVersion: '4.0.3', installationId: randomUUID(), serverVersion: 'Paper 1.21.4', sentAt: new Date().toISOString(),
  server: { port: 25565, maxPlayers: 100 }, plugins: [{ name: 'FairPlay', version: '4.0.3' }], operators: [] });
const player = { uuid: randomUUID(), name: 'SomePlayer', op: false, online: true };

test('accepts expected v2 envelope but rejects invalid nested arrays', () => {
  assert.equal(validateEvent(base()), true);
  assert.equal(validateEvent({ ...base(), plugins: Array(161).fill({name:'p',version:'v'}) }), false);
});

test('stores node and network association for a session', () => {
  const g = new NetworkGraph('/unused');
  const start = base();
  assert.equal(g.observe(start, '127.0.0.1').code, 202);
  assert.equal(g.overview().stats.nodes, 1);
  assert.equal(g.overview().networks[0].observedIp, '127.0.0.1');
});

test('deduplicates or discards out of order session packets', () => {
  const g = new NetworkGraph('/unused');
  const start = base();
  g.observe(start, '127.0.0.1');
  assert.equal(g.observe({ ...start, event: 'session_stop', active: false }, '127.0.0.1').ignored, true);
  assert.equal(g.online(start.nodeId), true);
});

test('first player carries identity, subsequent presence preserves name and OP', () => {
  const g = new NetworkGraph('/unused');
  const s = base(); g.observe(s, '127.0.0.1');
  g.observe({ ...s, event:'player_seen', eventId:randomUUID(), sequence:2, player }, '127.0.0.1');
  g.observe({ ...s, event:'player_presence', eventId:randomUUID(), sequence:3, uuid:player.uuid, online:false }, '127.0.0.1');
  assert.equal(g.player(player.uuid).name, 'SomePlayer');
  assert.equal(g.player(player.uuid).online, false);
  assert.equal(g.node(s.nodeId).players[player.uuid].op, false);
});

test('missing player delta requires snapshot without advancing sequence', () => {
  const g=new NetworkGraph('/unused');const s=base();g.observe(s,'127.0.0.1');
  assert.equal(g.observe({ ...s, event:'player_presence', eventId:randomUUID(), sequence:2, uuid:player.uuid, online:true },'127.0.0.1').code,409);
  assert.equal(g.state.sessions[`${s.productId}:${s.installationId}:${s.sessionId}`].sequence,1);
});

test('new snapshot can establish session and reconcile player presence', () => {
  const g=new NetworkGraph('/unused');const s=base();
  assert.equal(g.observe({ ...s, event:'node_snapshot', onlinePlayers:[player] },'127.0.0.1').code,202);
  assert.equal(g.player(player.uuid).online,true);
  g.observe({ ...s, event:'session_stop', eventId:randomUUID(),sequence:2,active:false },'127.0.0.1');
  assert.equal(g.player(player.uuid).online,false);
});

test('two product sessions on one node keep node online when one stops', () => {
  const g=new NetworkGraph('/unused');const a=base(),b={...base(),nodeId:a.nodeId,productId:'exploitfixer'};
  g.observe(a,'127.0.0.1');g.observe(b,'127.0.0.1');
  g.observe({ ...a,event:'session_stop',eventId:randomUUID(),sequence:2,active:false },'127.0.0.1');
  assert.equal(g.node(a.nodeId).online,true);
});

test('node policy overrides network and clear restores network policy', async () => {
  const g=new NetworkGraph('/tmp/unwritten-graph-test.json');
  g.persist = async () => {};
  const a=base();g.observe(a,'127.0.0.1');
  await g.setPolicy({scope:'network',id:'127.0.0.1',status:'BLOCK',reason:'Investigate'});
  await g.setPolicy({scope:'node',id:a.nodeId,status:'ALLOW',reason:'Reviewed'});
  assert.equal(g.node(a.nodeId).policy.status,'ALLOW');
  await g.setPolicy({scope:'node',id:a.nodeId,status:'NONE',reason:''});
  assert.equal(g.node(a.nodeId).policy.status,'BLOCK');
});

test('node is offline when heartbeat exceeds sixty seconds', () => {
  let now=1700000000000;
  const g=new NetworkGraph('/unused',{now:()=>now});
  const a=base();g.observe(a,'127.0.0.1');
  now += 61000;
  assert.equal(g.node(a.nodeId).online,false);
});

test('operator roster maps to a player profile and erasure removes OP inventory', async () => {
  const g=new NetworkGraph('/unused'); g.persist=async()=>{};
  const s=base();s.operators=[{uuid:player.uuid,name:'SomePlayer',source:'bukkit-op'}];
  g.observe(s,'127.0.0.1');
  assert.equal(g.player(player.uuid).connections[0].op,true);
  await g.deletePlayer(player.uuid);
  assert.equal(g.node(s.nodeId).operators.length,0);
});

test('offline-mode version 3 Minecraft player UUID is accepted', () => {
  const v3={...player,uuid:'f23d276b-e5fa-3f8c-a1bd-b062bbb946f5'};
  const g=new NetworkGraph('/unused');const s=base();g.observe(s,'127.0.0.1');
  assert.equal(g.observe({...s,event:'player_seen',eventId:randomUUID(),sequence:2,player:v3},'127.0.0.1').code,202);
});

test('invalid nested graph on disk fails startup explicitly',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'drm-corrupt-v2-'));
  try{
    const file=join(dir,'graph.json');
    const s=base(), g=new NetworkGraph(file);
    g.observe(s,'127.0.0.1'); await g.persist();
    const {writeFile}=await import('node:fs/promises');
    const data=JSON.parse(await readFile(file,'utf8'));
    data.nodes[s.nodeId].operators={malformed:true};
    await writeFile(file,JSON.stringify(data));
    await assert.rejects(new NetworkGraph(file).load(),/Invalid graph file/);
  } finally{await rm(dir,{recursive:true,force:true});}
});


test('retention pruning removes player links to expired nodes and reports a durable change', () => {
  let now = Date.parse('2026-10-11T12:00:00Z');
  const g = new NetworkGraph('/unused', { now: () => now });
  const s = base();
  g.observe(s, '127.0.0.1');
  g.observe({ ...s, event: 'player_seen', eventId: randomUUID(), sequence: 2, player }, '127.0.0.1');
  now += 181 * 86400000;
  // Player reported elsewhere recently, but the original node expired.
  g.state.players[player.uuid].lastSeen = new Date(now).toISOString();
  assert.equal(g.prune(), true);
  assert.equal(g.node(s.nodeId), undefined);
  assert.deepEqual(g.player(player.uuid).connections, []);
  assert.equal(g.prune(), false);
});

test('a full node player inventory does not create orphan player profiles', () => {
  const g = new NetworkGraph('/unused');
  const s = base();
  g.observe(s, '127.0.0.1');
  const players = g.state.nodes[s.nodeId].players;
  for (let i = 0; i < 3000; i++) players[randomUUID()] = { firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), op: false };
  const incoming = { ...s, event: 'player_seen', eventId: randomUUID(), sequence: 2, player };
  assert.equal(g.observe(incoming, '127.0.0.1').code, 202);
  assert.equal(g.player(player.uuid), undefined);
});


test('retention removes expired players from node roster and active session presence', () => {
  let now = Date.parse('2026-10-11T12:00:00Z');
  const g = new NetworkGraph('/unused', { now: () => now });
  const s = base();
  s.operators = [{ uuid: player.uuid, name: player.name, source: 'bukkit-op' }];
  g.observe(s, '127.0.0.1');
  g.observe({ ...s, event: 'player_seen', eventId: randomUUID(), sequence: 2, player }, '127.0.0.1');
  assert.equal(g.node(s.nodeId).onlinePlayers, 1);
  now += 181 * 86400000;
  // Keep the node/session alive, but expire the player's independent retention window.
  g.state.nodes[s.nodeId].lastSeen = new Date(now).toISOString();
  g.state.sessions[`${s.productId}:${s.installationId}:${s.sessionId}`].lastSeen = new Date(now).toISOString();
  assert.equal(g.prune(), true);
  assert.equal(g.player(player.uuid), undefined);
  assert.equal(g.node(s.nodeId).onlinePlayers, 0);
  assert.equal(g.node(s.nodeId).operators.length, 0);
  assert.equal(g.node(s.nodeId).players[player.uuid], undefined);
});


test('player profile aggregates live presence across sessions with one bounded pass', () => {
  const g = new NetworkGraph('/unused');
  const a = base(), b = { ...base(), nodeId: randomUUID(), productId: 'other-plugin' };
  g.observe(a, '127.0.0.1'); g.observe(b, '127.0.0.2');
  g.observe({ ...a, event: 'player_seen', eventId: randomUUID(), sequence: 2, player }, '127.0.0.1');
  g.observe({ ...b, event: 'player_seen', eventId: randomUUID(), sequence: 2, player: { ...player, online: false } }, '127.0.0.2');
  // Node-wide activePlayers performs another full session scan; profile lookup must not use it.
  g.activePlayers = () => { throw Error('Redundant node-wide scan'); };
  const view = g.player(player.uuid);
  assert.deepEqual(view.connections.map(c => [c.nodeId, c.online]), [[a.nodeId, true], [b.nodeId, false]]);
});

test('player profile is offline when the only active session stops', () => {
  const g = new NetworkGraph('/unused');
  const s = base(); g.observe(s, '127.0.0.1');
  g.observe({ ...s, event: 'player_seen', eventId: randomUUID(), sequence: 2, player }, '127.0.0.1');
  g.observe({ ...s, event: 'session_stop', eventId: randomUUID(), sequence: 3, active: false }, '127.0.0.1');
  assert.equal(g.player(player.uuid).online, false);
});


test('partial telemetry does not erase inventory collected by another product on same node', () => {
  const g = new NetworkGraph('/unused');
  const primary = base();
  primary.collection = { plugins: true, operators: true, machine: true };
  primary.server.machine = { os: 'Linux', arch: 'amd64', processors: 8 };
  primary.operators = [{ uuid: player.uuid, name: player.name, source: 'bukkit-op' }];
  assert.equal(g.observe(primary, '127.0.0.1').code, 202);
  const secondary = { ...base(), nodeId: primary.nodeId, productId: 'OtherPlugin',
    collection: { plugins: false, operators: false, machine: false },
    plugins: [], operators: [] };
  assert.equal(g.observe(secondary, '127.0.0.1').code, 202);
  const node = g.node(primary.nodeId);
  assert.deepEqual({ plugins: node.plugins, operators: node.operators, machine: node.machine }, {
    plugins: [{ name: 'FairPlay', version: '4.0.3' }],
    operators: [{ uuid: player.uuid, name: player.name, source: 'bukkit-op' }],
    machine: { os: 'Linux', arch: 'amd64', processors: 8 }
  });
});

test('consented empty inventory clears previous collection, while older protocol events still work', () => {
  const g = new NetworkGraph('/unused');
  const original = base();
  assert.equal(g.observe(original, '127.0.0.1').code, 202);
  const current = { ...original, event: 'node_snapshot', sequence: 2, eventId: randomUUID(),
    onlinePlayers: [], plugins: [], operators: [], collection: { plugins: true, operators: true, machine: true } };
  assert.equal(g.observe(current, '127.0.0.1').code, 202);
  assert.deepEqual(g.node(original.nodeId).plugins, []);
});

test('invalid partial collection metadata is rejected', () => {
  const malformed = { ...base(), collection: { plugins: 'yes', operators: false, machine: false } };
  assert.equal(validateEvent(malformed), false);
});


test('stored graph rejects malformed nested presence, player edges and observed IP history', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-invalid-edges-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  const start = base();
  const graph = new NetworkGraph(file);
  graph.observe(start, '127.0.0.1');
  graph.observe({ ...start, event: 'player_seen', eventId: randomUUID(), sequence: 2, player }, '127.0.0.1');
  await graph.persist();
  const original = await readFile(file, 'utf8');
  const cases = [
    data => { data.sessions[`${start.productId}:${start.installationId}:${start.sessionId}`].onlinePlayers[player.uuid] = 'true'; },
    data => { data.players[player.uuid].nodes[start.nodeId].op = 'yes'; },
    data => { data.nodes[start.nodeId].ipHistory.push('not-an-ip'); },
    data => { data.nodes[start.nodeId].players[player.uuid].lastSeen = 'invalid-timestamp'; }
  ];
  for (const mutate of cases) {
    const corrupted = JSON.parse(original);
    mutate(corrupted);
    await writeFile(file, JSON.stringify(corrupted));
    await assert.rejects(new NetworkGraph(file).load(), /Invalid graph file/);
  }
  await writeFile(file, original);
  await new NetworkGraph(file).load();
});

test('long-lived session discards offline presence and survives a durable reload', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-session-turnover-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  const g = new NetworkGraph(file);
  const start = base();
  assert.equal(g.observe(start, '127.0.0.1').code, 202);
  for (let i = 0; i < 600; i++) {
    const id = randomUUID();
    const identity = { uuid: id, name: `Player${i}`, op: false, online: true };
    assert.equal(g.observe({ ...start, event: 'player_seen', eventId: randomUUID(), sequence: i * 2 + 2, player: identity }, '127.0.0.1').code, 202);
    assert.equal(g.observe({ ...start, event: 'player_presence', eventId: randomUUID(), sequence: i * 2 + 3, uuid: id, online: false }, '127.0.0.1').code, 202);
  }
  await g.persist();
  const restored = new NetworkGraph(file);
  await restored.load();
  assert.equal(Object.keys(restored.state.sessions[`${start.productId}:${start.installationId}:${start.sessionId}`].onlinePlayers).length, 0);
  assert.equal(Object.keys(restored.state.players).length, 600);
});

test('offline operators do not consume the bounded active-presence slots', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-operator-presence-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  const g = new NetworkGraph(file);
  const start = base();
  start.operators = Array.from({ length: 512 }, (_, i) => ({ uuid: randomUUID(), name: `Admin${i}`, source: 'bukkit-op' }));
  g.observe(start, '127.0.0.1');
  const active = { uuid: randomUUID(), name: 'LivePlayer', op: false, online: true };
  g.observe({ ...start, event: 'player_seen', eventId: randomUUID(), sequence: 2, player: active }, '127.0.0.1');
  await g.persist();
  const restored = new NetworkGraph(file);
  await restored.load();
  assert.equal(restored.node(start.nodeId).onlinePlayers, 1);
});

test('pruning migrates legacy stored false presence without removing player profiles', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-legacy-presence-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  const g = new NetworkGraph(file);
  const start = base();
  g.observe(start, '127.0.0.1');
  const row = g.state.sessions[`${start.productId}:${start.installationId}:${start.sessionId}`];
  row.onlinePlayers[player.uuid] = false;
  await g.persist();
  const restored = new NetworkGraph(file);
  await restored.load();
  assert.equal(restored.prune(), true);
  await restored.persist();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.sessions[row.key].onlinePlayers, {});
});

test('active presence stays within persisted session bounds under high concurrency', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-concurrent-presence-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  const graph = new NetworkGraph(file);
  const start = base();
  graph.observe(start, '127.0.0.1');
  for (let i = 0; i < 520; i++) {
    graph.observe({ ...start, event: 'player_seen', eventId: randomUUID(), sequence: i + 2,
      player: { uuid: randomUUID(), name: `Player${i}`, op: false, online: true } }, '127.0.0.1');
  }
  await graph.persist();
  const restored = new NetworkGraph(file);
  await restored.load();
  assert.equal(restored.node(start.nodeId).onlinePlayers, 512);
});


test('plugin signals mark reporting ArkFlame products green and tokenized cracked filenames red', () => {
  const g = new NetworkGraph('/unused');
  const start = { ...base(), productId: 'FairPlay', plugins: [
    { name: 'FairPlay', version: '4.0.9', fileName: 'FairPlay-4.0.9.jar' },
    { name: 'SomePlugin', version: '1.0', fileName: 'SomePlugin-NULLED.jar' },
    { name: 'CrackShot', version: '2.0', fileName: 'CrackShot.jar' }
  ] };
  assert.equal(g.observe(start, '127.0.0.1').code, 202);
  const node = g.node(start.nodeId);
  assert.deepEqual(node.pluginSignals.map(p => [p.name, p.drm, p.suspicious]), [
    ['FairPlay', true, false], ['SomePlugin', false, true], ['CrackShot', false, false]
  ]);
  assert.equal(g.network('127.0.0.1').network.suspiciousPlugins, 1);
});

test('plugin JAR filename persists across graph reload and old snapshots remain valid', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-file-inventory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json'), graph = new NetworkGraph(file);
  const start = base(); start.plugins[0].fileName = 'FairPlay-4.0.9-LEAKED.jar';
  graph.observe(start, '127.0.0.1');
  await graph.persist();
  const reread = new NetworkGraph(file); await reread.load();
  assert.equal(reread.node(start.nodeId).pluginSignals[0].fileName, 'FairPlay-4.0.9-LEAKED.jar');
  const legacy = JSON.parse(await readFile(file, 'utf8'));
  delete legacy.history;
  await writeFile(file, JSON.stringify(legacy));
  const old = new NetworkGraph(file); await old.load();
  assert.equal(old.state.history.length, 0);
});

test('online history deduplicates products on the same node and does not invent missing buckets', () => {
  let now = Date.parse('2026-10-11T12:00:00Z');
  const g = new NetworkGraph('/unused', { now: () => now });
  const a = base();
  g.observe(a, '127.0.0.1');
  const b = { ...base(), nodeId: a.nodeId, productId: 'AnotherProduct' };
  g.observe(b, '127.0.0.1');
  const latest = g.history24h().at(-1);
  assert.equal(latest.servers, 1);
  assert.equal(g.history24h()[0].players, null);
  now += 300000;
  g.observe({ ...a, event: 'product_heartbeat', eventId: randomUUID(), sequence: 2, active: true }, '127.0.0.1');
  assert.equal(g.history24h().at(-1).servers, 1);
});

test('history samples retain unique player count and survive persistence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = Date.parse('2026-10-11T12:00:00Z');
  const file = join(dir, 'graph.json'), graph = new NetworkGraph(file, { now: () => now });
  const start = base();
  graph.observe(start, '127.0.0.1');
  graph.observe({ ...start, event: 'player_seen', eventId: randomUUID(), sequence: 2, player }, '127.0.0.1');
  now += 300000;
  graph.observe({ ...start, event: 'product_heartbeat', eventId: randomUUID(), sequence: 3, active: true }, '127.0.0.1');
  await graph.persist();
  const reread = new NetworkGraph(file, { now: () => now }); await reread.load();
  assert.equal(reread.history24h().at(-1).players, 1);
});

test('malformed filename with paths is not accepted as a JAR basename', () => {
  const start = base(); start.plugins[0].fileName = '/srv/plugins/LEAK.jar';
  assert.equal(validateEvent(start), false);
});

test('history remains bounded to 288 samples after more than one day of valid heartbeats', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-history-bounds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = Date.parse('2026-10-11T12:00:00Z');
  const file = join(dir, 'graph.json'), graph = new NetworkGraph(file, { now: () => now });
  const start = base(); graph.observe(start, '127.0.0.1');
  for (let i = 2; i <= 293; i++) {
    now += 300000;
    assert.equal(graph.observe({ ...start, event: 'product_heartbeat', eventId: randomUUID(), sequence: i, active: true }, '127.0.0.1').code, 202);
  }
  await graph.persist();
  const restored = new NetworkGraph(file, { now: () => now }); await restored.load();
  assert.equal(restored.state.history.length, 288);
});

test('green DRM badge requires a currently reporting session, not only past use', () => {
  let now = Date.parse('2026-10-11T17:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => now });
  const start = base();
  assert.equal(graph.observe(start, '127.0.0.1').code, 202);
  assert.equal(graph.node(start.nodeId).pluginSignals[0].drm, true);
  const stopped = { ...start, event: 'session_stop', eventId: randomUUID(), sequence: 2, active: false };
  graph.observe(stopped, '127.0.0.1');
  assert.equal(graph.node(start.nodeId).pluginSignals[0].drm, false);
  // Active reporting is a freshness indicator; merely retaining a historical session is insufficient.
  const resumed = { ...base(), nodeId: start.nodeId };
  graph.observe(resumed, '127.0.0.1');
  assert.equal(graph.node(start.nodeId).pluginSignals[0].drm, true);
  now += 61000;
  assert.equal(graph.node(start.nodeId).pluginSignals[0].drm, false);
});

test('large snapshots count inventories at most once while preserving player capacity', () => {
  const g = new NetworkGraph('/unused');
  const start = base();
  assert.equal(g.observe(start, '127.0.0.1').code, 202);
  const n = g.state.nodes[start.nodeId];
  const key = `${start.productId}:${start.installationId}:${start.sessionId}`;
  const s = g.state.sessions[key];
  const scans = { node: 0, global: 0, online: 0 };
  const countProxy = (value, kind) => new Proxy(value, {
    ownKeys(target) { scans[kind]++; return Reflect.ownKeys(target); }
  });
  n.players = countProxy(n.players, 'node');
  g.state.players = countProxy(g.state.players, 'global');
  let presence = countProxy(s.onlinePlayers, 'online');
  Object.defineProperty(s, 'onlinePlayers', {
    configurable: true, enumerable: true,
    get() { return presence; },
    set(next) { presence = countProxy(next, 'online'); }
  });
  const onlinePlayers = Array.from({ length: 512 }, (_, i) => ({
    uuid: randomUUID(), name: `Player${i}`, op: i % 5 === 0, online: true
  }));
  const snapshot = { ...start, event: 'node_snapshot', eventId: randomUUID(), sequence: 2, onlinePlayers };
  assert.equal(g.observe(snapshot, '127.0.0.1').code, 202);
  assert.equal(g.node(start.nodeId).onlinePlayers, 512);
  assert.equal(Object.keys(g.state.players).length, 512);
  assert.ok(scans.node <= 2, `node map scanned ${scans.node} times`);
  assert.ok(scans.global <= 2, `global map scanned ${scans.global} times`);
  assert.ok(scans.online <= 2, `online map scanned ${scans.online} times`);
  // Reset and re-add existing IDs; repeated inventory must not exhaust the caps.
  const replay = { ...snapshot, eventId: randomUUID(), sequence: 3 };
  assert.equal(g.observe(replay, '127.0.0.1').code, 202);
  assert.equal(g.node(start.nodeId).onlinePlayers, 512);
  assert.equal(Object.keys(g.state.players).length, 512);
});

test('online presence deltas free slots and reject a 513th live player', () => {
  const g = new NetworkGraph('/unused');
  const start = base();
  const players = Array.from({ length: 512 }, (_, i) => ({
    uuid: randomUUID(), name: `Player${i}`, online: true, op: false
  }));
  assert.equal(g.observe({ ...start, event: 'node_snapshot', onlinePlayers: players }, '127.0.0.1').code, 202);
  const extra = { uuid: randomUUID(), name: 'ExtraPlayer', op: false, online: true };
  assert.equal(g.observe({ ...start, event: 'player_seen', eventId: randomUUID(), sequence: 2, player: extra }, '127.0.0.1').code, 202);
  assert.equal(g.node(start.nodeId).onlinePlayers, 512);
  assert.equal(g.player(extra.uuid).online, false);
  assert.equal(g.observe({ ...start, event: 'player_presence', eventId: randomUUID(), sequence: 3, uuid: players[0].uuid, online: false }, '127.0.0.1').code, 202);
  assert.equal(g.observe({ ...start, event: 'player_presence', eventId: randomUUID(), sequence: 4, uuid: extra.uuid, online: true }, '127.0.0.1').code, 202);
  assert.equal(g.node(start.nodeId).onlinePlayers, 512);
  assert.equal(g.player(extra.uuid).online, true);
});


test('network detail counts all nodes beyond its 2,000-row display limit', () => {
  let now = Date.parse('2026-10-11T20:00:00Z');
  const g = new NetworkGraph('/unused', { now: () => now });
  const a = base();
  a.plugins = [{ name: 'OtherPlugin', version: '1.0', fileName: 'OtherPlugin-NULLED.jar' }];
  assert.equal(g.observe(a, '127.0.0.1').code, 202);
  const template = g.state.nodes[a.nodeId];
  for (let i = 0; i < 2000; i++) {
    const id = randomUUID();
    g.state.nodes[id] = { ...template, id, players: {}, lastSeen: new Date(now - 30000).toISOString() };
  }
  const lastId = Object.keys(g.state.nodes).at(-1);
  const b = { ...base(), nodeId: lastId, productId: 'AnotherProduct', plugins: a.plugins };
  assert.equal(g.observe(b, '127.0.0.1').code, 202);
  const detail = g.network('127.0.0.1');
  const overview = g.overview().networks[0];
  assert.equal(detail.nodes.length, 2000, 'detail still caps the expensive node rows');
  assert.equal(detail.network.nodes, 2001);
  assert.equal(detail.network.online, 2, 'includes active nodes outside the displayed 2,000');
  assert.equal(detail.network.suspiciousPlugins, 2001);
  assert.equal(detail.network.lastSeen, new Date(now).toISOString());
  assert.equal(overview.nodes, detail.network.nodes);
  assert.equal(overview.online, detail.network.online);
  assert.equal(overview.suspiciousPlugins, detail.network.suspiciousPlugins);
});

test('fleet metrics and flagged node filter include suspicious nodes beyond the display cap', () => {
  let now = Date.parse('2026-10-11T18:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => now });
  const flagged = { ...base(), plugins: [{ name: 'OrdinaryPlugin', version: '1.0', fileName: 'OrdinaryPlugin-NULLED.jar' }],
    onlinePlayers: [{ uuid: randomUUID(), name: 'OnlineOne', op: false, online: true }], event: 'node_snapshot' };
  assert.equal(graph.observe(flagged, '127.0.0.1').code, 202);
  const template = graph.state.nodes[flagged.nodeId];
  now += 10000;
  for (let i = 0; i < 2000; i++) {
    const id = randomUUID();
    graph.state.nodes[id] = { ...template, id, lastSeen: new Date(now).toISOString(), plugins: [], players: {} };
  }
  const standard = graph.overview();
  assert.equal(standard.stats.nodes, 2001);
  assert.equal(standard.nodes.length, 2000);
  assert.ok(!standard.nodes.some(n => n.id === flagged.nodeId));
  assert.equal(standard.stats.suspiciousPlugins, 1, 'full graph, not the displayed subset');
  assert.equal(standard.stats.flaggedNodes, 1);
  assert.equal(standard.stats.onlinePlayers, 1, 'active player on an undisplayed node still counts');
  assert.equal(standard.stats.online, 1);
  const reviewed = graph.overview('', true);
  assert.deepEqual(reviewed.nodes.map(n => n.id), [flagged.nodeId]);
  assert.equal(reviewed.networks.length, 1);
  assert.equal(reviewed.stats.nodes, 2001, 'filter does not change fleet totals');
  assert.deepEqual(graph.overview('NULLED', true).nodes.map(n => n.id), [flagged.nodeId],
    'search includes plugin filenames, not just display names');
});

test('flagged network filter executes before the 2,000-network cap', () => {
  let now = Date.parse('2026-10-11T18:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => now });
  const flagged = { ...base(), plugins: [{ name: 'Plugin', version: '1', fileName: 'Plugin-LEAK.jar' }] };
  assert.equal(graph.observe(flagged, '127.0.0.1').code, 202);
  const template = graph.state.nodes[flagged.nodeId];
  now += 10000;
  for (let i = 0; i < 2000; i++) {
    const id = randomUUID();
    const ip = `198.${Math.floor(i / 256)}.${i % 256}.1`;
    graph.state.nodes[id] = { ...template, id, observedIp: ip, ipHistory: [ip],
      lastSeen: new Date(now).toISOString(), plugins: [], players: {} };
  }
  const unfiltered = graph.overview();
  assert.equal(unfiltered.stats.networks, 2001);
  assert.equal(unfiltered.networks.length, 2000);
  assert.ok(!unfiltered.networks.some(n => n.id === '127.0.0.1'));
  const reviewed = graph.overview('', true);
  assert.deepEqual(reviewed.networks.map(n => n.id), ['127.0.0.1']);
  assert.equal(reviewed.stats.flaggedNetworks, 1);
  assert.equal(reviewed.stats.suspiciousPlugins, 1);
});

test('network detail prioritizes suspicious and most recently observed nodes under its cap', () => {
  let now = Date.parse('2026-10-11T18:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => now });
  const flagged = { ...base(), plugins: [{ name: 'One', version: '1', fileName: 'One-CRACKED.jar' }] };
  graph.observe(flagged, '127.0.0.1');
  const template = graph.state.nodes[flagged.nodeId];
  now += 10000;
  let newest;
  for (let i = 0; i < 2000; i++) {
    const id = randomUUID();
    graph.state.nodes[id] = { ...template, id, lastSeen: new Date(now + i).toISOString(), plugins: [], players: {} };
    newest = id;
  }
  const view = graph.network('127.0.0.1');
  assert.equal(view.nodes.length, 2000);
  assert.equal(view.network.nodes, 2001);
  assert.equal(view.network.suspiciousPlugins, 1);
  assert.equal(view.nodes[0].id, flagged.nodeId, 'review candidates are not dropped by truncation');
  assert.equal(view.nodes[1].id, newest, 'non-flagged nodes are newest first');
});

test('fleet online-player KPI counts one connection per node across product sessions', () => {
  const graph = new NetworkGraph('/unused');
  const a = { ...base(), event: 'node_snapshot', onlinePlayers: [{ uuid: randomUUID(), name: 'SharedPlayer', op: false, online: true }] };
  const b = { ...base(), nodeId: a.nodeId, productId: 'OtherProduct',
    event: 'node_snapshot', onlinePlayers: a.onlinePlayers };
  assert.equal(graph.observe(a, '127.0.0.1').code, 202);
  assert.equal(graph.observe(b, '127.0.0.1').code, 202);
  assert.equal(graph.overview().stats.onlinePlayers, 1);
  assert.equal(graph.overview().stats.online, 1);
});

test('invalid node and player identifiers never access inherited object properties', async () => {
  const g = new NetworkGraph('/unused');
  for (const id of ['__proto__', 'constructor', 'toString', '', 'invalid-uuid']) {
    assert.equal(g.node(id), undefined);
    assert.equal(g.player(id), undefined);
    assert.deepEqual(g.network(id), { network: undefined, nodes: [] });
  }
  g.persist = async () => {};
  assert.equal(await g.setPolicy({ scope: 'node', id: '__proto__', status: 'BLOCK', reason: 'No such node' }), false);
  assert.equal(Object.keys(g.state.policies).length, 0);
});

test('clearing a node policy deletes the stored override and preserves the audit trail', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-policy-clear-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  const g = new NetworkGraph(file);
  const s = base();
  g.observe(s, '127.0.0.1');
  await g.setPolicy({ scope: 'network', id: '127.0.0.1', status: 'REVIEW', reason: 'Review' });
  await g.setPolicy({ scope: 'node', id: s.nodeId, status: 'BLOCK', reason: 'Manual block' });
  await g.setPolicy({ scope: 'node', id: s.nodeId, status: 'NONE', reason: '' });
  assert.equal(Object.hasOwn(g.state.policies, `node:${s.nodeId}`), false);
  assert.equal(g.node(s.nodeId).policy.status, 'REVIEW');
  const recovered = new NetworkGraph(file);
  await recovered.load();
  assert.equal(recovered.node(s.nodeId).policy.status, 'REVIEW');
  assert.equal(recovered.state.audit.length, 3);
});

test('graph startup rejects malformed persisted policy keys and audit references', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drm-policy-validation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'graph.json');
  const g = new NetworkGraph(file);
  const s = base();
  g.observe(s, '127.0.0.1');
  await g.persist();
  const valid = JSON.parse(await readFile(file, 'utf8'));
  for (const key of ['bogus:identity', 'node:__proto__', 'network:invalid-ip']) {
    const invalid = structuredClone(valid);
    invalid.policies[key] = { status: 'REVIEW', reason: 'Test', updatedAt: new Date().toISOString() };
    await writeFile(file, JSON.stringify(invalid));
    await assert.rejects(new NetworkGraph(file).load(), /Invalid graph file/, key);
  }
  const invalidAudit = structuredClone(valid);
  invalidAudit.audit.push({ at: new Date().toISOString(), scope: 'network', id: 'not-an-ip', status: 'BLOCK', reason: 'Test' });
  await writeFile(file, JSON.stringify(invalidAudit));
  await assert.rejects(new NetworkGraph(file).load(), /Invalid graph file/);
});

test('repeating a manual policy decision does not rewrite the graph or duplicate audit entries', async () => {
  const g = new NetworkGraph('/unused');
  const s = base();
  g.observe(s, '127.0.0.1');
  let writes = 0;
  g.persist = async () => { writes++; };
  const write = (status, reason) => g.setPolicy({ scope: 'node', id: s.nodeId, status, reason });
  assert.equal(await write('NONE', ''), true);
  assert.equal(writes, 0);
  assert.equal(await write('REVIEW', 'Investigate'), true);
  assert.equal(await write('REVIEW', 'Investigate'), true);
  assert.equal(writes, 1);
  assert.equal(g.state.audit.length, 1);
  assert.equal(await write('NONE', ''), true);
  assert.equal(await write('NONE', ''), true);
  assert.equal(writes, 2);
  assert.equal(g.state.audit.length, 2);
});

test('new sessions reclaim the oldest stopped session at capacity without deleting node history', () => {
  const g = new NetworkGraph('/unused');
  const old = base();
  assert.equal(g.observe(old, '127.0.0.1').code, 202);
  assert.equal(g.observe({ ...old, event: 'session_stop', eventId: randomUUID(), sequence: 2, active: false }, '127.0.0.1').code, 202);
  const oldKey = `${old.productId}:${old.installationId}:${old.sessionId}`;
  const newer = { ...base(), nodeId: old.nodeId, productId: 'OtherProduct' };
  assert.equal(g.observe(newer, '127.0.0.1').code, 202);
  assert.equal(g.observe({ ...newer, event: 'session_stop', eventId: randomUUID(), sequence: 2, active: false }, '127.0.0.1').code, 202);
  const newerKey = `${newer.productId}:${newer.installationId}:${newer.sessionId}`;
  // Previous records may have different supported timestamp representations.
  g.state.sessions[oldKey].lastSeen = '2024-01-01T00:00:00.000Z';
  g.state.sessions[newerKey].lastSeen = '2025-01-01T00:00:00.000Z';
  // Fill the remaining capacity with active sessions. Keep unique, valid composite keys.
  for (let i = 0; i < 49998; i++) {
    const id = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    const key = `Other:${id}:${id}`;
    g.state.sessions[key] = { key, sessionId: id, nodeId: old.nodeId, installationId: id,
      productId: 'Other', productVersion: '1', sequence: 1, startedAt: old.sentAt,
      lastSeen: old.sentAt, stoppedAt: '', onlinePlayers: {} };
  }
  const next = { ...base(), nodeId: old.nodeId };
  assert.equal(g.observe(next, '127.0.0.1').code, 202);
  assert.equal(Object.keys(g.state.sessions).length, 50000);
  assert.equal(g.state.sessions[oldKey], undefined);
  assert.ok(g.state.sessions[newerKey], 'the more recently stopped session is retained');
  assert.equal(g.state.nodes[old.nodeId].id, old.nodeId);
  assert.ok(g.state.sessions[`${next.productId}:${next.installationId}:${next.sessionId}`]);
});

test('full active session capacity rejects an extra session without evicting live data', () => {
  const g = new NetworkGraph('/unused');
  const original = base();
  assert.equal(g.observe(original, '127.0.0.1').code, 202);
  const firstKey = `${original.productId}:${original.installationId}:${original.sessionId}`;
  for (let i = 0; i < 49999; i++) {
    const id = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    const key = `Other:${id}:${id}`;
    g.state.sessions[key] = { key, sessionId: id, nodeId: original.nodeId, installationId: id,
      productId: 'Other', productVersion: '1', sequence: 1, startedAt: original.sentAt,
      lastSeen: original.sentAt, stoppedAt: '', onlinePlayers: {} };
  }
  const next = { ...base(), nodeId: original.nodeId };
  assert.deepEqual(g.observe(next, '127.0.0.1'), { code: 429, error: 'session_capacity' });
  assert.equal(g.state.sessions[firstKey].stoppedAt, '');
  assert.equal(Object.keys(g.state.sessions).length, 50000);
});
