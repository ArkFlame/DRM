import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { digest, validate, ENTITLEMENT_TTL_MS, PRODUCT_ID, UUID_ID, Store } from './installations.mjs';
import { NetworkGraph } from './network.mjs';

export async function checkBuiltByBit(nonce, token, fetcher = fetch) {
  if (!token || !token.trim()) return { status: 'UNKNOWN', retryAfterMs: ENTITLEMENT_TTL_MS, rateLimited: false, unconfigured: true };
  const response = await fetcher(`https://api.builtbybit.com/v2/resources/embed/latest?nonce=${encodeURIComponent(nonce)}`, {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(1800)
  });
  if (!response.ok) {
    // BuiltByBit V2 documents Retry-After in milliseconds, unlike RFC 9110 seconds.
    const retry = response.status === 429 ? Number(response.headers.get('retry-after')) : 0;
    return { status: 'UNKNOWN', retryAfterMs: Number.isFinite(retry) && retry > 0 ? Math.min(Math.max(retry, 1000), 3600000) : 60000, rateLimited: response.status === 429 };
  }
  const json = await response.json();
  if (json.result !== 'success' || typeof json.data?.has_usage_rights !== 'boolean')
    return { status: 'UNKNOWN', retryAfterMs: 60000, rateLimited: false };
  return { status: json.data.has_usage_rights ? 'NONCE_RIGHTS_YES' : 'NONCE_RIGHTS_NO', retryAfterMs: ENTITLEMENT_TTL_MS, rateLimited: false };
}

// Exactly one writable persistence authority in the Next.js Node process.
const GLOBAL_SERVICE_KEY = Symbol.for('com.arkflame.drm.web.service.v0.4');
export function createDrmService(config) {
  if (!config?.dataFile || !config?.graphFile || !config?.hashKey || config.hashKey.length < 32)
    throw Error('DRM_DATA_FILE, DRM_GRAPH_FILE and DRM_HASH_KEY (32+ chars) required');
  const dataFile = resolve(config.dataFile);
  const graphFile = resolve(config.graphFile);
  // Both databases use independent atomic writers and incompatible schemas.
  if (dataFile === graphFile) throw Error('DRM_DATA_FILE and DRM_GRAPH_FILE must be different files');
  const store = new Store(dataFile);
  const graph = new NetworkGraph(graphFile, { retentionDays: Number(config.retentionDays ?? 180) });
  const bbbConfigured = Boolean(typeof config.bbbToken === 'string' && config.bbbToken.trim());
  const lookups = new Map();
  const queue = [];
  const cache = new Map();
  const rates = new Map();
  const counters = { v1Accepted: 0, v2Accepted: 0, rejected: 0, persistenceErrors: 0 };
  const startedAt = new Date().toISOString();
  let active = 0;
  let backoffUntil = 0;
  let backoffTimer;
  let work = Promise.resolve();
  let storageFailure;
  const retentionDays = Number(config.retentionDays ?? 180);
  const maxInstallations = Number(config.maxInstallations ?? 10000);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650 ||
      !Number.isInteger(maxInstallations) || maxInstallations < 100 || maxInstallations > 100000)
    throw Error('Invalid retention configuration');
  const ready = (async () => {
    await Promise.all([store.load(), graph.load()]);
    if (store.prune(Date.now(), retentionDays, maxInstallations)) await store.persist();
    if (graph.prune()) await graph.persist();
    for (const row of Object.values(store.state.installations)) {
      const checked = Date.parse(row.entitlementCheckedAt);
      if (row.downloadDigest && ['NONCE_RIGHTS_YES', 'NONCE_RIGHTS_NO'].includes(row.entitlement) && checked + ENTITLEMENT_TTL_MS > Date.now()) {
        const key = `${row.productId}:${row.downloadDigest}`;
        const prev = cache.get(key);
        if (!prev || prev.checked < checked) cache.set(key, { status: row.entitlement, until: checked + ENTITLEMENT_TTL_MS, checked });
      }
    }
  })();
  // Failed writes may already have mutated memory. Reconcile from disk before another operation.
  async function restoreCommittedState() {
    const savedStore = new Store(store.file);
    const savedGraph = new NetworkGraph(graph.file);
    await Promise.all([savedStore.load(), savedGraph.load()]);
    store.state = savedStore.state;
    graph.state = savedGraph.state;
    graph.historyComputedAt = Number.NEGATIVE_INFINITY;
  }
  function mutate(fn) {
    const result = work.then(async () => {
      await ready;
      if (storageFailure) throw storageFailure;
      try { return await fn(); }
      catch (error) {
        try { await restoreCommittedState(); }
        catch (recoveryError) {
          storageFailure = new Error('Cannot restore committed DRM state', { cause: recoveryError });
        }
        throw error;
      }
    });
    work = result.catch(() => {});
    return result;
  }
  function throttle(kind, ip, limit) {
    if (!isIP(ip)) return false;
    const now = Date.now();
    const key = `${kind}:${ip}`;
    const previous = rates.get(key);
    const current = !previous || now - previous.start >= 60000 ? { start: now, count: 0 } : previous;
    rates.set(key, current);
    if (rates.size > 10000) {
      for (const [k, v] of rates) if (now - v.start >= 60000) rates.delete(k);
      if (rates.size > 10000) rates.delete(rates.keys().next().value);
    }
    return ++current.count <= limit;
  }
  function drain() {
    const delay = backoffUntil - Date.now();
    if (delay > 0) {
      if (queue.length && !backoffTimer) {
        backoffTimer = setTimeout(() => { backoffTimer = undefined; drain(); }, delay);
        backoffTimer.unref?.();
      }
      return;
    }
    while (active < 4 && queue.length) {
      const [key, productId, hash, nonce] = queue.shift();
      active++;
      checkBuiltByBit(nonce, config.bbbToken, config.bbbFetcher || fetch).then(async found => {
        const checked = Date.now();
        if (cache.size >= 5000 && !cache.has(key)) cache.delete(cache.keys().next().value);
        cache.set(key, { status: found.status, until: checked + found.retryAfterMs, checked });
        if (found.rateLimited) backoffUntil = Math.max(backoffUntil, checked + found.retryAfterMs);
        await mutate(async () => {
          if (store.applyEntitlement(productId, hash, found.status, new Date(checked).toISOString())) await store.persist();
        });
      }).catch(err => console.error('BuiltByBit lookup failed:', err?.name || 'unknown'))
        .finally(() => { active--; lookups.delete(key); drain(); });
    }
  }
  async function reportV1Inner(payload, ip) {
    if (!validate(payload)) return { status: 400, body: { error: 'invalid_installation' } };
    if (!isIP(ip)) return { status: 400, body: { error: 'invalid_transport_address' } };
    if (!throttle('v1', ip, 60)) return { status: 429, body: { error: 'rate_limited' } };
    const hash = digest(payload.distributionNonce, config.hashKey);
    const key = `${payload.productId}:${hash}`;
    await mutate(async () => {
      const now = Date.now();
      const cached = cache.get(key);
      store.record(payload, ip, hash);
      if (cached && cached.until > now) store.applyEntitlement(payload.productId, hash, cached.status, new Date(cached.checked).toISOString());
      store.prune(now, retentionDays, maxInstallations);
      await store.persist();
    });
    const cached = cache.get(key);
    if (bbbConfigured && payload.distributionNonce && !(cached && cached.until > Date.now()) &&
        !lookups.has(key) && queue.length < 64) {
      lookups.set(key, true); queue.push([key, payload.productId, hash, payload.distributionNonce]); drain();
    }
    return { status: 202, body: { ok: true, mode: 'advisory' } };
  }
  async function reportV2Inner(payload, ip) {
    if (!isIP(ip)) return { status: 400, body: { error: 'invalid_transport_address' } };
    if (!throttle('v2', ip, 2400)) return { status: 429, body: { error: 'rate_limited' } };
    return mutate(async () => {
      let result = graph.observe(payload, ip);
      let pruned = false;
      // An expired full graph must recover without a process restart or a successful report.
      if (result.code === 429 && (result.error === 'node_capacity' || result.error === 'session_capacity')) {
        pruned = graph.prune();
        if (pruned) result = graph.observe(payload, ip);
      }
      if (pruned || (result.code === 202 && !result.ignored)) await graph.persist();
      return { status: result.code, body: result.code === 202 && !result.ignored ? { ok: true, mode: 'advisory', verified: false } : result };
    });
  }
  async function observed(kind, operation) {
    try {
      const response = await operation();
      if (response.status === 202) counters[kind === 'v1' ? 'v1Accepted' : 'v2Accepted']++;
      else counters.rejected++;
      return response;
    } catch (error) {
      counters.persistenceErrors++;
      throw error;
    }
  }
  const reportV1 = (payload, ip) => observed('v1', () => reportV1Inner(payload, ip));
  const reportV2 = (payload, ip) => observed('v2', () => reportV2Inner(payload, ip));
  async function query(path, input) {
    await ready;
    // Dashboard reads must not expose a mutation before its persistence barrier settles.
    await work;
    if (storageFailure) throw storageFailure;
    const url = new URL(path, 'http://internal');
    const p = url.searchParams;
    switch (url.pathname) {
      case '/api/admin/v2/overview': return graph.overview((p.get('q') || '').slice(0, 100), p.get('view') === 'flagged');
      case '/api/admin/v2/node': return graph.node(p.get('id') || '');
      case '/api/admin/v2/network': return graph.network(p.get('id') || '');
      case '/api/admin/v2/players': return graph.players((p.get('q') || '').slice(0, 100));
      case '/api/admin/v2/player': return graph.player(p.get('id') || '');
      case '/api/admin/v2/audit': return graph.state.audit.slice(-500).reverse();
      case '/api/admin/installations': return store.list({ bbbConfigured }).slice(0, 5000);
      case '/api/admin/operations': return { startedAt, counters: { ...counters }, builtByBitConfigured: bbbConfigured, providerQueueDepth: queue.length, providerInFlight: active, writeBarrierHealthy: !storageFailure };
      case '/api/admin/config': return { builtByBit: bbbConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED', enforcement: 'ADVISORY', telemetry: 'OPT_IN' };
      case '/api/admin/audit': return store.state.audit.slice(-500).reverse();
      case '/api/admin/v2/policy': {
        if (!input) throw Error('Missing policy');
        const ok = await mutate(() => graph.setPolicy(input));
        if (!ok) throw Error('Invalid policy');
        return { ok: true };
      }
      case '/api/admin/v2/delete-player': {
        if (typeof input?.uuid !== 'string') throw Error('Invalid UUID');
        const ok = await mutate(() => graph.deletePlayer(input.uuid));
        if (!ok) throw Error('Unknown player');
        return { ok: true };
      }
      case '/api/admin/review': {
        if (!input || typeof input !== 'object' || typeof input.productId !== 'string' || !PRODUCT_ID.test(input.productId) ||
            typeof input.installationId !== 'string' || !UUID_ID.test(input.installationId) ||
            !['NONE','ALLOW','REVIEW','BLOCK'].includes(input.status) || typeof input.reason !== 'string' ||
            !input.reason.trim() || input.reason.length > 500) throw Error('Invalid review');
        const ok = await mutate(async () => {
          const changed = store.setStatus(input.productId, input.installationId, input.status, input.reason.trim());
          if (!changed) return false;
          if (changed !== 'unchanged') await store.persist();
          return true;
        });
        if (!ok) throw Error('Unknown installation');
        return { ok: true };
      }
      default: throw Error('Unknown internal service operation');
    }
  }
  return { ready, reportV1, reportV2, query, store, graph };
}
export function drmService() {
  // Server routes may be compiled into different Next.js chunks; one process-global authority.
  if (!globalThis[GLOBAL_SERVICE_KEY]) globalThis[GLOBAL_SERVICE_KEY] = createDrmService({
    dataFile: process.env.DRM_DATA_FILE || './data/drm.json',
    graphFile: process.env.DRM_GRAPH_FILE || './data/graph.json',
    hashKey: process.env.DRM_HASH_KEY,
    bbbToken: process.env.BBB_EMBED_TOKEN || '',
    retentionDays: Number(process.env.DRM_RETENTION_DAYS || 180),
    maxInstallations: Number(process.env.DRM_MAX_INSTALLATIONS || 10000)
  });
  return globalThis[GLOBAL_SERVICE_KEY];
}
