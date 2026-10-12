# ArkFlame DRM telemetry protocol v2 — implemented backend contract

**Client shipped in v0.2.0; backend endpoint implemented in v0.3.0.** All events `POST https://drm.arkflame.com/api/v2/events`; JSON UTF-8, `Content-Type: application/json`. No v2 batch transport in this version. Recommended future server request limit: 128 KiB; independently bound nested collections and strings.

## Common envelope

```json
{
  "protocolVersion": 2,
  "event": "player_seen",
  "eventId": "d8cfd60e-cd2d-4134-9eca-100a17fd6263",
  "sessionId": "c7994cd8-4200-4427-b6f3-33f39b62a7a7",
  "sequence": 3,
  "nodeId": "98b06330-bd45-4e17-ae69-37dcd8d49da4",
  "productId": "fairplay",
  "productVersion": "4.0.3",
  "installationId": "f39cf736-014e-4a4f-978a-8ea5224b86a8",
  "serverVersion": "Paper 1.21.x",
  "sentAt": "2026-10-11T14:00:00Z",
  "player": {
    "uuid": "a0ecef0b-11d8-4df8-a0a0-e1696fbdacaa",
    "name": "ExamplePlayer",
    "op": true,
    "online": true
  }
}
```

`eventId` = transport dedupe key. `sessionId` = new UUID for each product enable. `sequence` = increasing per session (not per node). `nodeId` = stable per Bukkit plugins directory. `installationId` = stable per product installation. `productId` is server-reported and requires backend entitlement correlation before being trusted. `sentAt` is client clock data; server timestamps receipt independently. Never use client clock alone for uptime or blacklist decisions.

## Event-specific fields

### session_start

```json
{
  "event": "session_start",
  "server": { "port": 25565, "maxPlayers": 200, "machine": { "os": "Linux", "arch": "amd64", "processors": 8 } },
  "plugins": [{ "name": "FairPlay", "version": "4.0.3" }],
  "operators": [{ "uuid": "a0ecef0b-11d8-4df8-a0a0-e1696fbdacaa", "name": "ExamplePlayer", "source": "bukkit-op" }]
}
```

Shown fields are merged with the common envelope. Starting v0.4.5, `session_start` and `node_snapshot` additionally carry an optional `collection` object:

```json
"collection": { "plugins": true, "operators": false, "machine": true }
```

Each boolean means *this producer collected the corresponding inventory*. `false` with an empty array **does not mean the server has no installed plugins or operators**. On a shared node, the backend keeps the most recently collected value until a consenting report updates it. An explicitly collected empty list clears previous values. Older v2 clients without `collection` retain historic full-replacement semantics; new and old clients remain wire-compatible. Collection consent is declarative and does not authenticate ownership.

`machine` appears only if its separate opt-in is enabled; `plugins` and `operators` are otherwise empty arrays. `server.port` is the configured local port, **not** proof an Internet-facing endpoint exists. Network IP is added server-side from trusted ingress; never accept an arbitrary client-asserted network identity as authoritative.

### player_seen

`player: {uuid,name,op,online}`. Full player properties emitted once on initial discovery in this process session; subsequent changes use events below. If the client evicts an older offline entry to preserve its 512-account bound, a later appearance may generate another `player_seen`.

### player_presence

`uuid`, `online`. `name`/`op` intentionally absent. Emitted only on a state transition. If a join occurs without a cached previous entry, send `player_seen` instead.

### player_update

`player: {uuid,name,op,online}`; used when username or OP flag has changed during a new observation. Permissions/group memberships are NOT collected in v0.2.0.

### product_heartbeat

`active: true`. Sent every 30 seconds from each opted-in plugin session. No player roster retransmitted. A future backend marks a product session `OFF` when server receipt age exceeds 60 seconds; this may misclassify lagged/unreachable sessions, so show last-seen and reporting health as well. A node is active when at least one of its live product sessions is active.

### session_stop

`active: false`. Best effort, async on Bukkit disable. Do not rely on it: abrupt process termination has no stop packet. Close stale sessions by TTL.

### node_snapshot

`server`, `plugins`, `operators`, `onlinePlayers: [{uuid,name,op,online}]`. Sent after queue overflow or communication failure. Backend atomically replaces the session's online-player set with this snapshot, keeping historical player records. Snapshots are **exceptions**, not periodic full transfers; any emitted `player_presence` following the snapshot applies in sequence order.

## Backend reconciliation requirements

1. Group by `observedEgressIp` to present one **network view**, not one real-world owner; group by `nodeId` + verified/account context for logical Minecraft server instances. Do not merge two node IDs solely because their egress IP matches.
2. Persist `(productId, installationId, sessionId)` as session key. Deduplicate `(sessionId,eventId)`; reject older or duplicate sequences, require start/snapshot for a new session, never let an old delayed `session_stop` mark a newer session OFF.
3. Do not treat an unauthenticated POST as proof of hosting, ownership, player presence or product entitlement. Authenticate licensed installation sessions before trusting/acting on state. Validate uuid/version/schema/array limits, rate-limit abuse and audit ingress.
4. Receive timestamps server-side; derive online flag and uptime intervals from **successful server receipts**, not client-provided `sentAt`.
5. Limit heartbeat fan-out from many ArkFlame products on one node; aggregate session pulses by node. Future backend can return a negotiated interval in a verified response.
6. Store signed revocation decisions in a separate authentication/policy contract; telemetry HTTP status (including 403) is never a safe shutdown instruction. Check BuiltByBit entitlement and EULA scope independently.
7. Preserve explicit consent categories and data retention/deletion rules. Operators are permissions indicators, not verified ownership. Players using Minecraft do not thereby consent to a third-party behavioral graph; the deploying administrator must have a suitable privacy basis and clear notice.

## Compatibility / endpoint negotiation

- v1: `POST /api/v1/check`, request `protocolVersion:1` and v1 response unchanged. **Still implemented and backwards compatible in backend v0.3.0.**
- v2: `POST /api/v2/events`, request `protocolVersion:2`. **Implemented in backend v0.3.0.** Client disables v2 for this process when receiving `404`, `405` or `410`; restart after web deployment. Offline/error: skip future attempts for at least 30 seconds, restore via snapshot. No automatic retry storm.
- BuiltByBit `%%__NONCE__%%` remains in v1 request; the v2 server can resolve it from productId+installationId with cryptographically verified context. Never treat `nodeId` or `installationId` as a security credential.

## V0.3.0 backend data model

`POST /api/v2/events` responds `202 {"ok":true,"mode":"advisory","verified":false}`. Invalid event returns 400; events before session_start (except node_snapshot) return 409; duplicates/out-of-order return 202 ignored. Backend captures transport IP, stores separate protocol-v2 graph at DRM_GRAPH_FILE, and exposes authenticated admin queries detailed in WEBSITE-v0.3.0.md. Client identity is still **unverified**; no signed session authentication or enforcement exists.


## v0.5.0 backward-compatible plugin inventory extension

`session_start` and `node_snapshot` continue to accept `plugins: [{"name":"FairPlay","version":"4.0.9"}]`.
Clients may add the **optional** `fileName` basename, for example:

```json
{"name":"FairPlay","version":"4.0.9","fileName":"FairPlay-4.0.9.jar"}
```

The Java client obtains the name from the Bukkit plugin main class protection-domain code source during the opt-in startup snapshot. Only JAR basenames are reported; no machine paths. Missing/unavailable origin yields an absent field. The backend rejects filenames containing separators/control characters. No change to the v2 event envelope or sequence contract.

`GET /api/admin/v2/node` adds `pluginSignals: [{name,version,fileName?,drm,suspicious}]` and `suspiciousPlugins` while retaining original `plugins`. Classification is advisory: `drm` means that a product with a matching Bukkit descriptor name has reported a DRM session, **not** signature verification; `suspicious` means a token in a self-reported name, version or filename, **not** a piracy finding. The network/node summaries add `suspiciousPlugins` counts. No automatic policy update follows classification.

`GET /api/admin/v2/overview` adds `history: [{time,servers,players}]`, one five-minute UTC bucket per point across 24 hours. The server deduplicates multiple product sessions by node ID and player UUID. Missing samples have JSON `null` values, never fabricated zeros. The graph file stores at most 288 five-minute buckets; older schema-2 snapshots without `history` load normally.
