# ArkFlame DRM architecture v0.6.4

## Components and authority

```text
Minecraft plugin (one ArkFlameDrm.start() call)
  ├─ ArkFlameDrm (public facade, async v1 startup observation)
  ├─ ClientIdentity / ClientJson / ClientHttp (shared locked identity, JSON, transport; Java 8)
  ├─ ArkFlameDrmTelemetry (optional v2 facade/lifecycle registry)
  ├─ TelemetrySession (per-installation event queue/sequence/scheduler boundary)
  ├─ TelemetrySupport (reflection, node ID, encoding)
  └─ TelemetryTransport (bounded HTTPS posting)
           ↓ POST (untrusted telemetry)
drm.arkflame.com / Next.js App Router (one Node process)
  ├─ /api/v1/check, /api/v2/events (public ingestion routes)
  ├─ server/http.mjs (strict JSON limits / trusted ingress IP)
  ├─ server/service.mjs (single process-global mutation queue; BuiltByBit lookup scheduling)
  ├─ server/installations.mjs (v1 persistence, nonce digest, review)
  ├─ server/network.mjs (v2 node, session, player graph, advisory policy)
  ├─ server/persistence.mjs (shared coalesced and atomic JSON disk writer)
  ├─ /login + auth/session cookie (admin access)
  ├─ (console)/* (server-side dashboard reads)
  ├─ /api/console/* (cookie+origin-protected administrative writes)
  └─ /maven/... (immutable built client POM/JAR/metadata/checksums)
```

## Contracts

- One Java 8 embeddable Maven artifact, no Bukkit runtime dependency. Relocate into each plugin JAR with its existing shade step. Stable public entry point `ArkFlameDrm.start(this)`.
- v2 node snapshots use event-local inventory/presence counters to enforce the existing 3,000 per-node player, 100,000 global player, and 512 live-player-per-session ceilings without repeated full-map enumeration. No additional persistent count index is introduced.
- v1 unchanged; v2 adds optional opt-in `collection` flags to inventory events without changing protocolVersion or required fields. Old clients remain supported; the new backend preserves node inventories against opt-out producers. V1 and v2 remain advisory-only.
- Opted-out v2 client sessions do not install Bukkit listeners and release their registry entry. Opted-in sessions register after config and on their scheduler-owned initialization path; network-only sessions omit player listeners, and failed scheduler dispatch closes the worker and releases the registry entry. Client network worker handles HTTPS; Bukkit/Folia reads collected only on supported owner schedulers. 500 ms connect and read timeouts, bounded player-event queue, delta updates and recovery snapshots. No gameplay mutation on network threads.
- Node server owns all persistent state; no separate backend HTTP service, bearer admin token, internal HTTP proxy or duplicate web authentication.
- Server-only dashboard reads share data authority; writes are serialized. Server global symbol prevents duplicated in-process service instances when App Router chunks load separately. Every acknowledged v1/v2 write has completed an atomic JSON-file replacement in the current process; v0.6.3 also flushes staging-file bytes and its containing directory on supported Linux filesystems; verified hardware crash durability and multi-process ACID are still not claimed.
- Manager auth = one unique administrator password in `web/.env`, signed HttpOnly session cookie, password login rate limits, exact origin check on state-changing endpoints. Admin data never sent without authentication. No hardcoded reusable default secret.
- Public event endpoints are untrusted data. A stable node ID is a correlation hint, IP can be shared, OP status does not prove ownership, plugin inventory does not prove piracy. Manual BLOCK is non-enforcing.

## Data persistence and deployment limits

- `web/data/drm.json` v1 schema 1 and `web/data/graph.json` v2 schema 2. Existing files can be copied from previous release offline; no destructive migration. Never run old backend simultaneously with new service over same files.
- Explicitly **single-process** JSON storage. Next's single Node instance on 127.0.0.1 behind reverse proxy. Do not use multiple Next workers, separate containers, Lambda/serverless functions or load-balanced replicas against this storage. For HA/multi-instance, migrate to an atomic DB first.
- Ingress proxy strips and sets `X-Real-IP`, uses HTTPS, and only forwards public routes to the Next process. No per-product server IP authorization based on this unverified address.
- BuiltByBit API token remains server-side and optional. Remote entitlement hint is independently cached/retried, never treated as proof of a particular plugin's rights without appropriate binding.

## Artifact supply chain

- Maven project: `client/pom.xml`; optional native Gradle project: `client/build.gradle` (no wrappers).
- `scripts/build.sh`: generates a missing npm lockfile through the existing generator (needs registry connectivity); uses locked `npm ci`; native Maven package, Java behavior tests + Java-to-Node JSON exchange, Node tests, TypeScript check, Next production build; **only then** immutable Maven publication, standalone static copy, and Maven target cleanup. A failed test/build must never expose a half-verified release.
- `scripts/publish-maven.py`: `dist/maven/com/arkflame/arkflame-drm-client/0.4.0/*.jar|pom|sha1|sha256`; mirrored to `web/public/maven` for `https://drm.arkflame.com/maven/`.
- Version coordinates must be immutable once published. Preserve old version directories for existing customer builds. Do not publish Java tests or raw administrative secrets inside JARs.

## Remaining pre-deployment gates

- `scripts/start.sh` checks `server.js` and a versioned completion marker; if either is absent or stale, it invokes the full build and fails closed when the build cannot complete. Existing credentials and user data remain untouched.
- Install external native Maven and npm dependencies; run `./scripts/build.sh` on internet-connected build host. Validate `npm run typecheck`, `next build` and generated `package-lock.json`.
- Launch one Next process behind trusted HTTPS; test login, operations, public ingests, Java client restart/quit, published Maven/Gradle dependency resolution and real Bukkit/Paper/Folia runtimes.
- Create external durable DB before multi-process production. Replace single password with MFA/identity proxy if administrator access is public and not VPN-restricted.


## v0.4.8 consistency gates

- `drmService().query(...)` awaits initial storage hydration and the previously queued mutation/persistence barrier before returning dashboard state. One Node process remains mandatory for JSON storage correctness.
- `NetworkGraph.load()` rejects invalid nested node/player/session/policy/audit records instead of interpreting malformed data as valid presence or operator metadata. On invalid persistent data, startup fails explicitly; the file is not overwritten with an empty graph.
- Client protocol v1/v2, Bukkit scheduler integration and advisory-only behavior remain unchanged.

## v0.4.8 session bounds and persistence owner

- A session stores UUIDs for **online** players only. Offline player history remains in `state.players` and `state.nodes[id].players`; a quit removes that session's presence key. A session holds at most 512 concurrent presence keys, consistent with protocol-v2 snapshot limits. Larger simultaneous populations need a separately designed protocol/storage-cap upgrade, not silent schema expansion.
- Existing v0.4.6 graph files with `onlinePlayers[uuid] = false` remain readable. `NetworkGraph.prune()` removes these flags on service startup and persists the cleanup.
- `server/persistence.mjs` is the sole atomic JSON file writer used by the v1 installation store and v2 graph store. Each store still owns its schema and mutation logic; no new database or process is introduced.

## v0.4.8 failed-commit recovery

The single Next.js Node process serializes all v1/v2 and administrator mutations. Persistence errors previously left mutated memory visible even though the API returned an error. Now each failed serialized mutation restores `Store.state` and `NetworkGraph.state` from their committed JSON files before the mutation queue continues. Missing files restore empty stores; a disk error after an atomic rename restores the committed new state, not an imagined old state. If reload fails because on-disk data is corrupt or inaccessible, reads and mutations fail closed at the **dashboard/storage boundary** until process restart/recovery. This is not Minecraft license enforcement; the client remains fail-open.

This guarantees in-process post-error consistency with readable disk snapshots, not filesystem power-loss durability or cross-process concurrency. One writer process remains mandatory.

## v0.4.9 bounded graph recovery

New node/session ingestion that reaches the existing graph limit triggers exactly one expiry prune and retry. Successful cleanup is persisted even if registration still cannot proceed. Ordinary session events avoid this extra scan. The existing `DRM_RETENTION_DAYS` setting governs both v1 installation and v2 node/session/player/audit expiry, default 180 days. This preserves the single-writer, advisory-only model and wire/schema compatibility.


## v0.5.0 inventory and graph authority

`TelemetrySession.initialize` remains the single Bukkit/Folia-owned plugin inventory reader; only an optional source JAR basename was added. The I/O executor never walks Bukkit plugin objects. `web/src/server/network.mjs` continues to own node/session persistence and graph computations; `web/src/server/plugin-signals.mjs` is a pure, side-effect-free advisory classifier, reused by node/network responses. Each successful v2 event still requires durable persistence before HTTP 202. Graph history is a bounded optional field inside schema-2 state, sampled no more than every 30s and grouped into 5-minute UTC buckets. The UI never treats risk markers or self-reported DRM identity as cryptographic evidence.

## v0.5.1 active-report labels and snapshot staging

Node inventory UI evaluates DRM status only against live, non-stopped product sessions with a heartbeat within 60 seconds. Historical product associations are still listed separately. Labels remain self-reported. Persisted graph and installation data continue to use the same schema and single-process serialized authority; unique `0600` exclusive sibling temporary files are renamed onto committed JSON files. Failed staging attempts clean up their own temporary files, keeping the prior persisted state intact. The chart draws an isolated point for each non-null sample; missing buckets remain gaps.

## v0.5.7 query time and uptime

Fleet views use one server-side observation timestamp per query. For online status, session receipts are current for at most 60 seconds. Estimated uptime is the union of observed product-session intervals divided by elapsed time since the node first appeared, expressed on the complete 0–100% scale. No browser-derived time, external ping verification, or protocol/schema change.

## v0.5.8 network aggregation and bounded detail

The network detail endpoint may display at most 2,000 node summaries, but its aggregate totals must cover all nodes sharing the observed IP. One query timestamp and one traversal of sessions determine active node IDs for the full group; detailed session buckets are allocated only for visible nodes. Overview network counts and detail totals must agree, including suspicious filename indicators and the latest report time. The telemetry wire protocol and persisted JSON structures do not change.

## v0.5.9 bounded dashboard queries and review visibility

`NetworkGraph.overview(q, flaggedOnly)` performs query matching (including the optional reported plugin JAR basename), session grouping and complete fleet aggregation before the 2,000-row response limit. `stats.onlinePlayers` counts unique player UUIDs per matching active node, deduplicating sessions reporting the same player on one node; `stats.suspiciousPlugins` sums advisory markers across all matching nodes, never only visible rows. `stats.flaggedNodes` and `stats.flaggedNetworks` count complete matching review populations. The `view=flagged` query parameter restricts returned row collections **before** capping them, not the aggregate population. Network detail similarly prioritizes suspicious and then newest nodes for its capped display list without changing whole-network totals. Observed identity and filename markers remain unverified, non-enforcing review signals. The v2 wire protocol, storage schema and Java API are unchanged.

## v0.6.0 query consistency and bounded aggregation

The overview counts historical player profiles and product installations fleet-wide in unfiltered mode. When a search is active, both totals use only matching node memberships, matching displayed node/network and online connection counts. Flagged-only is a result-view filter, not a scope change to top-level fleet totals. Freshness requires `0 <= now - lastSeen <= 60000` so negative clock deltas never count as live. Per-node online player counts and suspicious classifications are reused when constructing the bounded node summaries, rather than recomputed for each displayed row. The history chart still records unique UUIDs across active nodes (distinct from per-node player connections).

## v0.6.1 policy hygiene and persistence configuration

- Reject configurations mapping `DRM_DATA_FILE` and `DRM_GRAPH_FILE` to the same resolved path. v1 and v2 JSON files have incompatible schemas and independent atomic writers.
- Reject malformed direct client IPs as bad requests in both service ingestion methods (Next.js routes already enforce this).
- Guard node/player/admin policy lookups against inherited prototype properties; validate policy and audit key structure when reading persisted graphs.
- Clearing policy status `NONE` removes the redundant persisted override. Repeated identical admin decisions are no-ops and do not append duplicate audits or trigger full graph writes. All actual policy changes retain audit records.
- Existing legitimate stored policy entries, legacy `NONE` overrides, wire protocols, graph schema 2, and one-call Java 8 integration remain supported.

## v0.6.2 session-capacity recovery

The v2 graph accepts at most 50,000 session records. When that capacity is reached and an otherwise valid new session arrives, the oldest stopped session is removed before recording the newcomer; active sessions are not evicted. Historical node/player profiles remain, but session-level timeline, product associations, and uptime estimates can lose older stopped-session evidence if capacity is exhausted. If no stopped session exists, the report remains rejected (429). The normal hot path does not scan sessions for eviction. The v1 manual-review storage owner detects unchanged status/reason and skips persistence and audit duplication.

## v0.6.3 write barrier and operational process

Client startup reports have a bounded async retry budget (4 attempts total for transport failures, 429 and 5xx; 1s, 2s and 4s between retries) and preserve the same installation UUID. Opt-in v2 initialization proceeds independently of v1 network completion. In-process operational counters are available via authenticated Settings and private service query, not through a new unauthenticated metrics API. `BBB_EMBED_TOKEN` is optional; no-token installations remain UNKNOWN for entitlement and continue reporting. Release builds require a pinned npm lockfile and `npm ci` before immutable Maven publication. The backend remains a single writer with full graph snapshots per durable heartbeat. At scale, measure write amplification and migrate transactionally before horizontal scaling; do not run two Next writers against the same files.
