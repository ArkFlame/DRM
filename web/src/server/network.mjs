import { readFile } from 'node:fs/promises';
import { snapshotWriter } from './persistence.mjs';
import { isIP } from 'node:net';
import { PRODUCT_ID, UUID_ID } from './installations.mjs';
import { summarizePlugins, suspiciousCount } from './plugin-signals.mjs';

const EVENTS = new Set(['session_start', 'session_stop', 'product_heartbeat', 'node_snapshot', 'player_seen', 'player_update', 'player_presence']);
const POLICY = new Set(['NONE', 'ALLOW', 'BLOCK', 'REVIEW']);
const string = (v, size) => typeof v === 'string' && v.length <= size;
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const uuid4 = v => typeof v === 'string' && UUID_ID.test(v);
const playerName = v => string(v, 32) && /^[a-zA-Z0-9_]{1,32}$/.test(v);
const iso = ms => new Date(ms).toISOString();
const timestamp = v => string(v, 40) && Number.isFinite(Date.parse(v));
const optionalTimestamp = v => v === '' || timestamp(v);
const entries = (v, max, check) => record(v) && Object.keys(v).length <= max && Object.entries(v).every(([key, value]) => check(key, value));
const bounded = (v, max) => Array.isArray(v) && v.length <= max;
const validPlayer = p => record(p) && uuid(p.uuid) && playerName(p.name) && typeof p.op === 'boolean' && typeof p.online === 'boolean';
const validServer = s => record(s) && Number.isInteger(s.port) && s.port >= 0 && s.port <= 65535 && Number.isInteger(s.maxPlayers) && s.maxPlayers >= 0 && s.maxPlayers <= 1000000 &&
  (s.machine === undefined || (record(s.machine) && string(s.machine.os, 48) && string(s.machine.arch, 32) && Number.isInteger(s.machine.processors) && s.machine.processors > 0 && s.machine.processors <= 4096));
const validPlugins = v => bounded(v, 160) && v.every(p => record(p) && string(p.name, 80) && string(p.version, 80) && (p.fileName === undefined || (string(p.fileName, 160) && !/[\\/\x00-\x1f]/.test(p.fileName))));
const validOperators = v => bounded(v, 512) && v.every(p => record(p) && uuid(p.uuid) && playerName(p.name) && p.source === 'bukkit-op');
const validInventory = d => validServer(d.server) && (d.collection === undefined ||
  (record(d.collection) && ['plugins', 'operators', 'machine'].every(key => typeof d.collection[key] === 'boolean'))) &&
  validPlugins(d.plugins) && validOperators(d.operators);
const validStoredNode = (id, n) => uuid4(id) && record(n) && n.id === id && timestamp(n.firstSeen) && timestamp(n.lastSeen) &&
  isIP(n.observedIp) && bounded(n.ipHistory, 10) && n.ipHistory.every(ip => isIP(ip)) && string(n.serverVersion, 160) &&
  validServer({ port: n.port, maxPlayers: n.maxPlayers, ...(n.machine === null ? {} : { machine: n.machine }) }) &&
  validPlugins(n.plugins) && validOperators(n.operators) &&
  entries(n.players, 3000, (key, edge) => uuid(key) && record(edge) && timestamp(edge.firstSeen) && timestamp(edge.lastSeen) && typeof edge.op === 'boolean');
const MAX_ONLINE_PLAYERS = 512;
const HISTORY_STEP_MS = 300000; // Five-minute samples, at most 288 per rolling day.
const MAX_HISTORY = 288;
const validSample = s => record(s) && Number.isSafeInteger(s.time) && s.time >= 0 && s.time % HISTORY_STEP_MS === 0 &&
  Number.isInteger(s.servers) && s.servers >= 0 && s.servers <= 10000 &&
  Number.isInteger(s.players) && s.players >= 0 && s.players <= 100000;
const validStoredSession = (key, s) => record(s) && s.key === key && uuid4(s.sessionId) && uuid4(s.nodeId) &&
  uuid4(s.installationId) && PRODUCT_ID.test(s.productId) && key === `${s.productId}:${s.installationId}:${s.sessionId}` &&
  string(s.productVersion, 160) && Number.isSafeInteger(s.sequence) && s.sequence > 0 &&
  timestamp(s.startedAt) && timestamp(s.lastSeen) && optionalTimestamp(s.stoppedAt) &&
  entries(s.onlinePlayers, MAX_ONLINE_PLAYERS, (id, online) => uuid(id) && typeof online === 'boolean');
const validStoredPlayer = (id, p) => uuid(id) && record(p) && p.uuid === id && playerName(p.name) &&
  timestamp(p.firstSeen) && timestamp(p.lastSeen) && entries(p.nodes, 10000, (nodeId, edge) =>
    uuid4(nodeId) && record(edge) && timestamp(edge.lastSeen) && typeof edge.op === 'boolean');
const validStoredPolicy = p => record(p) && POLICY.has(p.status) && string(p.reason, 500) && timestamp(p.updatedAt);
const validStoredAudit = row => record(row) && timestamp(row.at) && ['node','network'].includes(row.scope) &&
  validPolicyKey(`${row.scope}:${row.id}`) && POLICY.has(row.status) && string(row.reason, 500);

export function validateEvent(d) {
  if (!record(d) || d.protocolVersion !== 2 || !EVENTS.has(d.event) || !uuid4(d.eventId) || !uuid4(d.sessionId) || !uuid4(d.nodeId) ||
    !uuid4(d.installationId) || !PRODUCT_ID.test(d.productId || '') || !Number.isSafeInteger(d.sequence) || d.sequence < 1 || d.sequence > Number.MAX_SAFE_INTEGER - 1 ||
    !string(d.productVersion, 160) || !string(d.serverVersion, 160) || !string(d.sentAt, 64)) return false;
  switch (d.event) {
    case 'session_start': return validInventory(d);
    case 'node_snapshot': return validInventory(d) && bounded(d.onlinePlayers, 512) && d.onlinePlayers.every(validPlayer);
    case 'player_seen': case 'player_update': return validPlayer(d.player);
    case 'player_presence': return uuid(d.uuid) && typeof d.online === 'boolean';
    case 'session_stop': return d.active === false;
    case 'product_heartbeat': return d.active === true;
    default: return false;
  }
}

const statusAt = (session, now) => {
  const elapsed = now - Date.parse(session.lastSeen);
  // An old snapshot must not appear live when the wall clock moves backwards.
  return !session.stoppedAt && elapsed >= 0 && elapsed <= 60000;
};
const policyKey = (scope, id) => `${scope}:${id}`;
const own = (object, key) => Object.hasOwn(object, key);
const validPolicyKey = key => key.startsWith('node:') ? uuid4(key.slice(5)) :
  key.startsWith('network:') && !!isIP(key.slice(8));

export class NetworkGraph {
  constructor(file, { now = () => Date.now(), retentionDays = 180 } = {}) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw Error('Invalid graph retention');
    this.retentionDays = retentionDays;
    this.file = file;
    this.now = now;
    this.state = { schema: 2, nodes: {}, sessions: {}, players: {}, policies: {}, audit: [], history: [] };
    this.persist = snapshotWriter(file, () => this.state);
    this.receipts = 0;
    this.historyComputedAt = Number.NEGATIVE_INFINITY;
  }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!record(data) || data.schema !== 2 || !record(data.nodes) || !record(data.sessions) || !record(data.players) || !record(data.policies) || !Array.isArray(data.audit) ||
          Object.keys(data.nodes).length > 10000 || Object.keys(data.sessions).length > 50000 || Object.keys(data.players).length > 100000 || data.audit.length > 5000 ||
          !Object.entries(data.nodes).every(([id, n]) => validStoredNode(id, n)) ||
          !Object.entries(data.sessions).every(([id, s]) => validStoredSession(id, s)) ||
          !Object.entries(data.players).every(([id, p]) => validStoredPlayer(id, p)) ||
          !Object.entries(data.policies).every(([key, policy]) => validPolicyKey(key) && validStoredPolicy(policy)) || !data.audit.every(validStoredAudit) ||
          (data.history !== undefined && (!bounded(data.history, MAX_HISTORY) || !data.history.every(validSample) ||
            data.history.some((sample, i) => i && sample.time <= data.history[i - 1].time))))
        throw Error('Invalid graph file');
      this.state = { ...data, history: data.history || [] };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  prune() {
    const older = this.now() - this.retentionDays * 86400000;
    let changed = false;
    for (const [key, session] of Object.entries(this.state.sessions)) {
      if (Date.parse(session.lastSeen) < older) { delete this.state.sessions[key]; changed = true; continue; }
      // v0.4.6 kept offline flags forever. Drop them without changing presence semantics.
      for (const [id, online] of Object.entries(session.onlinePlayers)) {
        if (!online) { delete session.onlinePlayers[id]; changed = true; }
      }
    }
    for (const [id, node] of Object.entries(this.state.nodes)) {
      if (Date.parse(node.lastSeen) < older) { delete this.state.nodes[id]; changed = true; }
    }
    // Player-to-node edges must not outlive their node after retention pruning.
    const expiredPlayers = new Set();
    for (const [id, player] of Object.entries(this.state.players)) {
      if (Date.parse(player.lastSeen) < older) {
        expiredPlayers.add(id);
        delete this.state.players[id];
        changed = true;
        continue;
      }
      for (const nodeId of Object.keys(player.nodes)) {
        if (!this.state.nodes[nodeId]) { delete player.nodes[nodeId]; changed = true; }
      }
    }
    if (expiredPlayers.size) {
      // Keep expired identities out of node inventories and online-session counts.
      for (const node of Object.values(this.state.nodes)) {
        for (const id of Object.keys(node.players)) if (expiredPlayers.has(id)) { delete node.players[id]; changed = true; }
        const remaining = node.operators.filter(op => !expiredPlayers.has(op.uuid));
        if (remaining.length !== node.operators.length) { node.operators = remaining; changed = true; }
      }
      for (const session of Object.values(this.state.sessions)) {
        for (const id of Object.keys(session.onlinePlayers)) if (expiredPlayers.has(id)) { delete session.onlinePlayers[id]; changed = true; }
      }
    }
    const history = this.state.history.filter(sample => sample.time >= Math.floor((this.now() - 86400000) / HISTORY_STEP_MS) * HISTORY_STEP_MS).slice(-MAX_HISTORY);
    if (history.length !== this.state.history.length) changed = true;
    this.state.history = history;
    const audit = this.state.audit.filter(row => Date.parse(row.at) >= older).slice(-5000);
    if (audit.length !== this.state.audit.length) changed = true;
    this.state.audit = audit;
    return changed;
  }
  observe(d, ip) {
    if (!validateEvent(d) || !isIP(ip)) return { code: 400, error: 'invalid_event' };
    const now = this.now();
    const at = iso(now);
    const key = `${d.productId}:${d.installationId}:${d.sessionId}`;
    let s = this.state.sessions[key];
    if (!s && d.event !== 'session_start' && d.event !== 'node_snapshot') return { code: 409, error: 'session_required' };
    if (s && (s.nodeId !== d.nodeId || s.productId !== d.productId || s.installationId !== d.installationId)) return { code: 409, error: 'identity_mismatch' };
    if (s && d.sequence <= s.sequence) return { code: 202, ignored: true };
    if (s?.stoppedAt) return { code: 202, ignored: true };
    if (d.event === 'player_presence' && (!this.state.nodes[d.nodeId]?.players?.[d.uuid.toLowerCase()] || !this.state.players[d.uuid.toLowerCase()]))
      return { code: 409, error: 'player_snapshot_required' };
    let n = this.state.nodes[d.nodeId];
    if (!n && Object.keys(this.state.nodes).length >= 10000) return { code: 429, error: 'node_capacity' };
    if (!s && Object.keys(this.state.sessions).length >= 50000) {
      // Stopped sessions are historical observations, not active capacity. Retain
      // their node/player history while making room for a newly reporting plugin.
      let oldestKey;
      let oldestSeen;
      for (const [candidateKey, candidate] of Object.entries(this.state.sessions)) {
        if (candidate.stoppedAt && (oldestSeen === undefined || Date.parse(candidate.lastSeen) < oldestSeen)) {
          oldestSeen = Date.parse(candidate.lastSeen);
          oldestKey = candidateKey;
        }
      }
      if (!oldestKey) return { code: 429, error: 'session_capacity' };
      delete this.state.sessions[oldestKey];
    }
    if (!n) n = this.state.nodes[d.nodeId] = { id: d.nodeId, firstSeen: at, lastSeen: at, observedIp: ip, ipHistory: [ip], serverVersion: d.serverVersion, port: 0, maxPlayers: 0, machine: null, plugins: [], operators: [], players: {} };
    if (!s) s = this.state.sessions[key] = { key, sessionId: d.sessionId, nodeId: d.nodeId, productId: d.productId, installationId: d.installationId, productVersion: d.productVersion, sequence: 0, startedAt: at, lastSeen: at, stoppedAt: '', onlinePlayers: {} };
    n.lastSeen = at;
    n.observedIp = ip;
    if (!n.ipHistory.includes(ip)) n.ipHistory = [...n.ipHistory.slice(-9), ip];
    n.serverVersion = d.serverVersion;
    s.sequence = d.sequence;
    s.lastSeen = at;
    s.productVersion = d.productVersion;
    if (d.event === 'session_start' || d.event === 'node_snapshot') {
      n.port = d.server.port;
      n.maxPlayers = d.server.maxPlayers;
      if (d.collection?.machine ?? true) n.machine = d.server.machine || null;
      if (d.collection?.plugins ?? true) n.plugins = d.plugins.map(p => ({ name: p.name, version: p.version, ...(p.fileName ? { fileName: p.fileName } : {}) }));
      if (d.collection?.operators ?? true) n.operators = d.operators.map(p => ({ uuid: p.uuid.toLowerCase(), name: p.name, source: p.source }));
    }
    // Snapshot inventories can contain hundreds of players. Count each map once per
    // event instead of enumerating an ever-growing map for every player added.
    let nodePlayerCount;
    let globalPlayerCount;
    let onlinePlayerCount;
    const setOnline = (id, online) => {
      if (!online) {
        if (s.onlinePlayers[id]) {
          delete s.onlinePlayers[id];
          if (onlinePlayerCount !== undefined) onlinePlayerCount--;
        }
      } else if (!s.onlinePlayers[id]) {
        if (onlinePlayerCount === undefined) onlinePlayerCount = Object.keys(s.onlinePlayers).length;
        if (onlinePlayerCount < MAX_ONLINE_PLAYERS) {
          s.onlinePlayers[id] = true;
          onlinePlayerCount++;
        }
      }
    };
    const touch = p => {
      const id = p.uuid.toLowerCase();
      const isNewNodePlayer = !n.players[id];
      if (isNewNodePlayer) {
        if (nodePlayerCount === undefined) nodePlayerCount = Object.keys(n.players).length;
        if (nodePlayerCount >= 3000) return;
      }
      let pl = this.state.players[id];
      if (!pl) {
        if (globalPlayerCount === undefined) globalPlayerCount = Object.keys(this.state.players).length;
        if (globalPlayerCount >= 100000) return;
        pl = this.state.players[id] = { uuid: id, name: p.name, firstSeen: at, lastSeen: at, nodes: {} };
        globalPlayerCount++;
      }
      pl.name = p.name;
      pl.lastSeen = at;
      const edge = n.players[id] || { firstSeen: at };
      n.players[id] = { ...edge, lastSeen: at, op: p.op };
      if (isNewNodePlayer) nodePlayerCount++;
      pl.nodes[d.nodeId] = { lastSeen: at, op: p.op };
      setOnline(id, p.online);
    };
    if ((d.event === 'session_start' || d.event === 'node_snapshot') && (d.collection?.operators ?? true))
      for (const op of n.operators) touch({ uuid: op.uuid, name: op.name, op: true, online: false });
    if (d.event === 'player_seen' || d.event === 'player_update') touch(d.player);
    if (d.event === 'player_presence') {
      const id = d.uuid.toLowerCase();
      if (n.players[id] && this.state.players[id]) {
        setOnline(id, d.online);
        n.players[id].lastSeen = at;
        this.state.players[id].lastSeen = at;
      }
    }
    if (d.event === 'node_snapshot') {
      s.onlinePlayers = {};
      onlinePlayerCount = 0;
      for (const p of d.onlinePlayers) touch(p);
    }
    if (d.event === 'session_stop') { s.stoppedAt = at; s.onlinePlayers = {}; }
    if (!this.state.history.length || now - this.historyComputedAt >= 30000) { this.recordHistory(now); this.historyComputedAt = now; }
    if (++this.receipts % 1000 === 0) this.prune();
    return { code: 202, ok: true };
  }
  // Recalculate once per five-minute bucket; duplicate product sessions count as one node.
  recordHistory(now = this.now()) {
    const bucket = Math.floor(now / HISTORY_STEP_MS) * HISTORY_STEP_MS;
    const series = this.state.history;
    const recent = series[series.length - 1];
    if (recent && recent.time > bucket) return;
    const nodes = new Set(), players = new Set();
    for (const session of Object.values(this.state.sessions)) if (statusAt(session, now)) {
      nodes.add(session.nodeId);
      for (const [id, active] of Object.entries(session.onlinePlayers)) if (active) players.add(id);
    }
    const sample = { time: bucket, servers: nodes.size, players: players.size };
    if (recent && recent.time === bucket) series[series.length - 1] = sample;
    else series.push(sample);
    while (series.length > MAX_HISTORY || (series.length && series[0].time < bucket - 86400000 + HISTORY_STEP_MS)) series.shift();
  }
  history24h(now = this.now()) {
    const end = Math.floor(now / HISTORY_STEP_MS) * HISTORY_STEP_MS;
    const known = new Map(this.state.history.map(s => [s.time, s]));
    // Missing historical observations stay null, never fabricated as zero.
    return Array.from({ length: MAX_HISTORY }, (_, i) => {
      const time = end - (MAX_HISTORY - 1 - i) * HISTORY_STEP_MS;
      const sample = known.get(time);
      return { time, servers: sample?.servers ?? null, players: sample?.players ?? null };
    });
  }
  policy(scope, id) {
    const key = policyKey(scope, id);
    return own(this.state.policies, key) ? this.state.policies[key] : { status: 'NONE', reason: '' };
  }
  effective(node) {
    const own = this.policy('node', node.id);
    return own.status !== 'NONE' ? { ...own, scope: 'node' } : { ...this.policy('network', node.observedIp), scope: 'network' };
  }
  online(nodeId, now = this.now()) {
    return Object.values(this.state.sessions).some(s => s.nodeId === nodeId && statusAt(s, now));
  }
  activePlayers(nodeId, sessions = Object.values(this.state.sessions).filter(s => s.nodeId === nodeId), now = this.now()) {
    const ids = new Set();
    for (const s of sessions) if (statusAt(s, now))
      for (const [id, v] of Object.entries(s.onlinePlayers)) if (v) ids.add(id);
    return ids;
  }
  nodeView(n, sessions = Object.values(this.state.sessions).filter(s => s.nodeId === n.id), now = this.now()) {
    const current = sessions.filter(s => statusAt(s, now));
    return { ...n, pluginSignals: summarizePlugins(n.plugins, current.map(s => s.productId)), suspiciousPlugins: suspiciousCount(n.plugins), online: current.length > 0, onlinePlayers: this.activePlayers(n.id, current, now).size,
      products: [...new Set(sessions.map(s => s.productId))], activeProducts: [...new Set(current.map(s => s.productId))],
      sessions: [...sessions].sort((a,b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, 100), policy: this.effective(n),
      uptime: this.uptime(n.id, sessions, now) };
  }
  nodeSummary(n, sessions = Object.values(this.state.sessions).filter(s => s.nodeId === n.id), now = this.now(), cachedOnlinePlayers, cachedSuspiciousPlugins) {
    const active = sessions.filter(s => statusAt(s, now));
    return { id:n.id, observedIp:n.observedIp, port:n.port, lastSeen:n.lastSeen, firstSeen:n.firstSeen,
      online:active.length>0, onlinePlayers:cachedOnlinePlayers ?? this.activePlayers(n.id,active,now).size,
      playerCount:Object.keys(n.players).length, suspiciousPlugins:cachedSuspiciousPlugins ?? suspiciousCount(n.plugins), products:[...new Set(sessions.map(s=>s.productId))],
      activeProducts:[...new Set(active.map(s=>s.productId))], uptime:this.uptime(n.id,sessions,now), policy:this.effective(n) };
  }
  uptime(nodeId, sessions = Object.values(this.state.sessions).filter(s => s.nodeId === nodeId), now = this.now()) {
    const intervals = sessions.map(s => [Date.parse(s.startedAt), Math.min(now, s.stoppedAt ? Date.parse(s.stoppedAt) : Date.parse(s.lastSeen) + 60000)]).filter(([a,b]) => b > a).sort((a,b) => a[0]-b[0]);
    let ms = 0, from = -1, to = -1;
    for (const [a,b] of intervals) { if (a > to) { if (to > from) ms += to-from; from = a; to = b; } else to = Math.max(to,b); }
    if (to > from) ms += to - from;
    const first = Date.parse(this.state.nodes[nodeId]?.firstSeen || iso(now));
    const denominator = Math.max(1, now - first);
    return Math.round(Math.min(1000, ms * 1000 / denominator)) / 10;
  }
  overview(query = '', flaggedOnly = false) {
    // Derive fleet totals before applying the 2,000-row UI response cap.
    // Review filters must also precede truncation so old flagged nodes remain discoverable.
    const now = this.now();
    const q = query.toLowerCase();
    const nodes = Object.values(this.state.nodes).filter(n => !q ||
      [n.id, n.observedIp, n.serverVersion, ...n.plugins.flatMap(p => [p.name, p.fileName || ''])]
        .some(value => value.toLowerCase().includes(q)))
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const groups = new Map();
    for (const s of Object.values(this.state.sessions)) {
      if (!groups.has(s.nodeId)) groups.set(s.nodeId, []);
      groups.get(s.nodeId).push(s);
    }
    const networks = new Map();
    const flaggedByNode = new Map();
    const onlinePlayersByNode = new Map();
    let flaggedNodes = 0;
    let suspiciousPlugins = 0;
    let onlinePlayers = 0;
    for (const n of nodes) {
      const sessions = groups.get(n.id) || [];
      const active = sessions.filter(s => statusAt(s, now));
      const flagged = suspiciousCount(n.plugins);
      flaggedByNode.set(n.id, flagged);
      suspiciousPlugins += flagged;
      if (flagged) flaggedNodes++;
      const nodeOnlinePlayers = this.activePlayers(n.id, active, now).size;
      onlinePlayersByNode.set(n.id, nodeOnlinePlayers);
      onlinePlayers += nodeOnlinePlayers;
      const ip = n.observedIp;
      if (!networks.has(ip)) networks.set(ip, {
        id: ip, observedIp: ip, nodes: 0, online: 0, suspiciousPlugins: 0,
        lastSeen: n.lastSeen, policy: this.policy('network', ip)
      });
      const row = networks.get(ip);
      row.nodes++;
      row.suspiciousPlugins += flagged;
      if (active.length) row.online++;
      if (n.lastSeen > row.lastSeen) row.lastSeen = n.lastSeen;
    }
    // Search results use matching-node totals. An unfiltered fleet overview retains
    // the full historical player/installation totals, including inactive profiles.
    let matchedPlayers;
    let matchedInstallations;
    if (q) {
      matchedPlayers = new Set();
      matchedInstallations = new Set();
      for (const n of nodes) {
        for (const id of Object.keys(n.players)) matchedPlayers.add(id);
        for (const s of groups.get(n.id) || []) matchedInstallations.add(`${s.productId}:${s.installationId}`);
      }
    }
    const networkRows = [...networks.values()];
    const flaggedNetworks = networkRows.filter(n => n.suspiciousPlugins > 0).length;
    return {
      networks: (flaggedOnly ? networkRows.filter(n => n.suspiciousPlugins > 0) : networkRows).slice(0, 2000),
      nodes: (flaggedOnly ? nodes.filter(n => flaggedByNode.get(n.id) > 0) : nodes)
        .slice(0, 2000).map(n => this.nodeSummary(n, groups.get(n.id) || [], now, onlinePlayersByNode.get(n.id), flaggedByNode.get(n.id))),
      history: this.history24h(now),
      stats: {
        networks: networks.size, nodes: nodes.length,
        online: networkRows.reduce((sum, n) => sum + n.online, 0),
        onlinePlayers, suspiciousPlugins, flaggedNodes, flaggedNetworks,
        players: q ? matchedPlayers.size : Object.keys(this.state.players).length,
        installations: q ? matchedInstallations.size : new Set(Object.values(this.state.sessions).map(s => `${s.productId}:${s.installationId}`)).size
      }
    };
  }
  node(id) {
    return uuid4(id) && own(this.state.nodes, id) ? this.nodeView(this.state.nodes[id]) : undefined;
  }
  network(ip) {
    if (!isIP(ip)) return { network: undefined, nodes: [] };
    const now = this.now();
    // The detail list is bounded for the UI, but the network summary must cover
    // every matching node. Otherwise the overview and detail page disagree.
    const matches = Object.values(this.state.nodes).filter(n => n.observedIp === ip);
    // Investigators must not lose older flagged nodes behind a 2,000-row cap.
    // Within the same review priority, show the latest report first.
    const reviewCounts = new Map(matches.map(n => [n.id, suspiciousCount(n.plugins)]));
    matches.sort((a, b) => reviewCounts.get(b.id) - reviewCounts.get(a.id) ||
      b.lastSeen.localeCompare(a.lastSeen) || a.id.localeCompare(b.id));
    const displayed = matches.slice(0, 2000);
    const allIds = new Set(matches.map(n => n.id));
    const displayedIds = new Set(displayed.map(n => n.id));
    const buckets = new Map();
    const activeIds = new Set();
    for (const s of Object.values(this.state.sessions)) if (allIds.has(s.nodeId)) {
      if (statusAt(s, now)) activeIds.add(s.nodeId);
      if (displayedIds.has(s.nodeId)) {
        if (!buckets.has(s.nodeId)) buckets.set(s.nodeId, []);
        buckets.get(s.nodeId).push(s);
      }
    }
    const nodes = displayed.map(n => this.nodeSummary(n, buckets.get(n.id) || [], now, undefined, reviewCounts.get(n.id)));
    return {
      network: matches.length ? {
        id: ip, observedIp: ip, nodes: matches.length, online: activeIds.size,
        suspiciousPlugins: matches.reduce((total, n) => total + reviewCounts.get(n.id), 0),
        lastSeen: matches.reduce((latest, n) => n.lastSeen > latest ? n.lastSeen : latest, ''),
        policy: this.policy('network', ip)
      } : undefined,
      nodes
    };
  }
  players(query = '') {
    const now = this.now();
    const q = query.toLowerCase();
    const active=new Set();
    for(const s of Object.values(this.state.sessions)) if(statusAt(s,now))
      for(const [id, online] of Object.entries(s.onlinePlayers)) if(online) active.add(id);
    return Object.values(this.state.players).filter(p => !q || p.name.toLowerCase().includes(q) || p.uuid.includes(q)).sort((a,b)=>b.lastSeen.localeCompare(a.lastSeen)).slice(0,1000)
      .map(p => ({ ...p, online: active.has(p.uuid) }));
  }
  player(id) {
    if (!uuid(id)) return undefined;
    const normalized = id.toLowerCase();
    const p = own(this.state.players, normalized) ? this.state.players[normalized] : undefined;
    if (!p) return undefined;
    // Only this player's presence matters; scan sessions once, not once per node edge.
    const activeNodes = new Set();
    const now = this.now();
    for (const session of Object.values(this.state.sessions)) {
      if (p.nodes[session.nodeId] && statusAt(session, now) && session.onlinePlayers[p.uuid])
        activeNodes.add(session.nodeId);
    }
    return { ...p, online: activeNodes.size > 0,
      connections: Object.entries(p.nodes).map(([nodeId, edge]) => ({ nodeId, ...edge,
        nodeIp: this.state.nodes[nodeId]?.observedIp || '', online: activeNodes.has(nodeId) })) };
  }
  async setPolicy({ scope, id, status, reason }) {
    if (!['node', 'network'].includes(scope) || !string(id, 128) || !id ||
        (scope === 'node' && !own(this.state.nodes, id)) || (scope === 'network' && !isIP(id)) ||
        !POLICY.has(status) || !string(reason, 500) || (status !== 'NONE' && !reason.trim())) return false;
    const key = policyKey(scope, id);
    const previous = own(this.state.policies, key) ? this.state.policies[key] : undefined;
    const trimmed = reason.trim();
    // Repeated saves must not rewrite the full graph or create duplicate audit decisions.
    if ((status === 'NONE' && !previous) ||
        (status !== 'NONE' && previous?.status === status && previous.reason === trimmed)) return true;
    if (status === 'NONE') delete this.state.policies[key];
    else this.state.policies[key] = { status, reason: trimmed, updatedAt: iso(this.now()) };
    const at = iso(this.now());
    this.state.audit.push({ at, scope, id, status, reason: trimmed });
    this.state.audit = this.state.audit.slice(-5000);
    await this.persist();
    return true;
  }
  async deletePlayer(uuidValue) {
    const id = uuidValue.toLowerCase();
    if (!uuid(id) || !this.state.players[id]) return false;
    delete this.state.players[id];
    for (const n of Object.values(this.state.nodes)) {
      delete n.players[id];
      n.operators = n.operators.filter(p => p.uuid !== id);
    }
    for (const s of Object.values(this.state.sessions)) delete s.onlinePlayers[id];
    await this.persist();
    return true;
  }
}
