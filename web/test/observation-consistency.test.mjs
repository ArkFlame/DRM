import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NetworkGraph } from '../src/server/network.mjs';

function start(nodeId = randomUUID()) {
  return {
    protocolVersion: 2, event: 'session_start', eventId: randomUUID(), sessionId: randomUUID(),
    installationId: randomUUID(), nodeId, productId: 'FairPlay', productVersion: '4.0',
    serverVersion: 'Paper 1.21', sequence: 1, sentAt: '2026-10-11T00:00:00Z',
    server: { port: 25565, maxPlayers: 300 }, plugins: [], operators: []
  };
}

test('estimated uptime reports full percentage range, not a ten-percent ceiling', () => {
  const started = Date.parse('2026-10-11T00:00:00Z');
  let clock = started;
  const graph = new NetworkGraph('/unused', { now: () => clock });
  const event = start();
  assert.equal(graph.observe(event, '127.0.0.1').code, 202);
  clock += 9 * 60000;
  assert.equal(graph.observe({ ...event, event: 'session_stop', eventId: randomUUID(),
    sequence: 2, active: false }, '127.0.0.1').code, 202);
  clock += 60000;
  assert.equal(graph.node(event.nodeId).uptime, 90);
  assert.equal(graph.overview().nodes[0].uptime, 90);
});

test('continuously observed uptime reaches exactly 100 percent', () => {
  const started = Date.parse('2026-10-11T00:00:00Z');
  let clock = started;
  const graph = new NetworkGraph('/unused', { now: () => clock });
  const event = start();
  assert.equal(graph.observe(event, '127.0.0.1').code, 202);
  clock += 10 * 60000;
  assert.equal(graph.observe({ ...event, event: 'product_heartbeat', eventId: randomUUID(),
    sequence: 2, active: true }, '127.0.0.1').code, 202);
  assert.equal(graph.node(event.nodeId).uptime, 100);
});

test('overview uses one observation clock for network count, nodes and 24h history', () => {
  const started = Date.parse('2026-10-11T00:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => started });
  const event = start();
  assert.equal(graph.observe(event, '127.0.0.1').code, 202);
  let clockReads = 0;
  graph.now = () => started + (++clockReads === 1 ? 59000 : 61000);
  const view = graph.overview();
  assert.equal(clockReads, 1);
  assert.equal(view.stats.online, 1);
  assert.equal(view.networks[0].online, 1);
  assert.equal(view.nodes[0].online, true);
  assert.deepEqual(view.nodes[0].activeProducts, ['FairPlay']);
  assert.equal(view.history.length, 288);
});

test('node, network and player lists use one clock per query at freshness boundary', () => {
  const started = Date.parse('2026-10-11T00:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => started });
  const event = start();
  assert.equal(graph.observe(event, '127.0.0.1').code, 202);
  const uuid = randomUUID();
  const seen = { ...event, event: 'player_seen', eventId: randomUUID(), sequence: 2,
    player: { uuid, name: 'ExamplePlayer', op: false, online: true } };
  assert.equal(graph.observe(seen, '127.0.0.1').code, 202);
  for (const [label, query, expected] of [
    ['node', () => graph.node(event.nodeId), view => view.online && view.onlinePlayers === 1],
    ['network', () => graph.network('127.0.0.1'), view => view.nodes[0].online && view.nodes[0].onlinePlayers === 1],
    ['players', () => graph.players(), view => view.length === 1 && view[0].online]
  ]) {
    let calls = 0;
    graph.now = () => started + (++calls === 1 ? 59000 : 61000);
    const view = query();
    assert.equal(calls, 1, `${label}: must sample clock once`);
    assert.ok(expected(view), `${label}: must use the sampled clock`);
  }
});


test('future-dated stored heartbeat is not online after server clock rollback', () => {
  const started = Date.parse('2026-10-11T12:00:00Z');
  let clock = started;
  const graph = new NetworkGraph('/unused', { now: () => clock });
  const event = start();
  graph.observe(event, '127.0.0.1');
  clock -= 120000;
  const view = graph.overview();
  assert.equal(view.stats.online, 0);
  assert.equal(view.nodes[0].online, false);
  assert.equal(graph.node(event.nodeId).online, false);
  assert.equal(graph.network('127.0.0.1').network.online, 0);
});

test('searched overview counts only matching node players and installations', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => now });
  const a = start(), b = start();
  assert.equal(graph.observe(a, '127.0.0.1').code, 202);
  assert.equal(graph.observe(b, '192.0.2.5').code, 202);
  const firstPlayer = randomUUID(), secondPlayer = randomUUID();
  for (const [s, ip, uuid, name] of [[a, '127.0.0.1', firstPlayer, 'Alpha'], [b, '192.0.2.5', secondPlayer, 'Beta']]) {
    assert.equal(graph.observe({ ...s, event: 'player_seen', eventId: randomUUID(), sequence: 2,
      player: { uuid, name, op: false, online: true } }, ip).code, 202);
  }
  assert.equal(graph.overview().stats.installations, 2);
  assert.equal(graph.overview().stats.players, 2);
  const filtered = graph.overview('127.0.0.1');
  assert.equal(filtered.stats.nodes, 1);
  assert.equal(filtered.stats.players, 1);
  assert.equal(filtered.stats.installations, 1);
  const missing = graph.overview('not-a-match');
  assert.equal(missing.stats.nodes, 0);
  assert.equal(missing.stats.players, 0);
  assert.equal(missing.stats.installations, 0);
});


test('overview reuses active-player aggregation for bounded node summaries', () => {
  const clock = Date.parse('2026-10-11T12:00:00Z');
  const graph = new NetworkGraph('/unused', { now: () => clock });
  const event = start();
  graph.observe(event, '127.0.0.1');
  graph.observe({ ...event, event: 'player_seen', sequence: 2, eventId: randomUUID(),
    player: { uuid: randomUUID(), name: 'PlayerOne', op: false, online: true } }, '127.0.0.1');
  const baseActivePlayers = graph.activePlayers.bind(graph);
  let calls = 0;
  graph.activePlayers = (...args) => { calls++; return baseActivePlayers(...args); };
  const view = graph.overview();
  assert.equal(view.stats.onlinePlayers, 1);
  assert.equal(view.nodes[0].onlinePlayers, 1);
  assert.equal(calls, 1, 'each node inventory should be aggregated once for the overview');
});
