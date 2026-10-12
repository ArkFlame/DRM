# ArkFlame DRM — website delivery status and future enforcement roadmap

**Historical design from v0.2.0, updated after v0.3.0.** Website, protocol-v2 event ingestion, basic identity graph and provisional uptime are now implemented locally. `drm.arkflame.com` remains the undeployed target hostname. Safe Minecraft ping probing, trusted identity attestation, and actual signed startup enforcement remain future work. See the implementation-status section below.

## Data model and indexing

- `network`: `networkId`, canonical observed egress IP, firstSeen/lastSeen, privacy flags. An IP may host multiple nodes; IPv4/IPv6 and reverse proxies need explicit normalization. IP may change for one node. Never equate IP with legitimate owner or a unique physical machine.
- `node`: `nodeId`, observedIpHistory, advertised endpoints (only verified), productSessions, consent categories, lastSeen, online status, last known server version, plugin snapshot, OP snapshot, online-player snapshot, incident history, manual override.
- `productInstallation`: `productId`, `installationId`, `nodeId`, per-download BuiltByBit HMAC marker reference (from v1), version, lastSeen, entitlement status, policy state.
- `session`: `(productId, installationId, sessionId)` unique, last sequence, last heartbeat receivedAt, last successful snapshot, state `ONLINE|OFFLINE|STALE`, server startup/shutdown observations. Idempotency by eventId and sequence.
- `player`: UUID primary key, last observed username, optional historic name changes, server-node presence edges, OP indicators, firstSeen/lastSeen, source/consent. Do not conflate username with immutable UUID or OP with proof of ownership.
- `node_player_edge`: nodeId + UUID, firstSeen, lastSeen, lastPresenceOnline, lastChangeAt, OP/source. Record only consent-eligible data, avoid unbounded lifelong tracking.
- `policy`: scoped `network|node|installation`, `NONE|ALLOW|BLOCK|REVIEW`, reason, createdBy, timestamp, policy revision, expiry, evidence/source and signed decision metadata.
- `ping_result`: node/verified public endpoint, pingAt, protocol reachability, last successful sanitized MOTD and server favicon; protect probe workers against SSRF and internal address probing.
- `audit`: every administrator change, entitlement fetch, visibility change, appeal, deletion, IP association, policy action and signed startup decision.

Indexes: unique `(productId,installationId,sessionId,eventId)` or `eventId` per session, `(sessionId,sequence)`, `nodeId+receivedAt`, `observedIp+lastSeen`, `playerUuid+lastSeen`, `nodeId+playerUuid`, `downloadDigest+productId`, policy scope+identifier. TTL collections for raw events, audit and IP-history retention managed independently; aggregated uptime can be retained at lower precision.

## Dashboard routes

- `/overview`: network/IP groups; node counts; active vs stale; uptime (selected window), plugin distribution, latest notes; filter/search by IP, product, version, OP indicator, entitlement, review status. No automatic piracy claims.
- `/server/{server_id}`: server is a **verified advertised service endpoint** or administratively curated network group, *not equal to arbitrary egress IP*. Show nodes at its endpoint/IP, active sessions, known players and OP indicators (where opted in), uptime, last successful MOTD/icon, risk evidence, manual override controls and audit log. If no verified endpoint, show network view without claiming public reachability.
- `/node/{node_id}`: last known network address(es), port, version, product/plugin inventory, session timeline, uptime, online/seen players, OP roster, last successful ping result, allow/block/review and notes. Node identity is self-reported until authenticated; show confidence.
- `/player/{uuid}`: UUID, last username, per-node presence history, OP-derived administrative relationships (not verified ownership), sources and access/deletion controls. Avoid exposing player graph publicly; administrator-only access and retention.
- `/review`: BuiltByBit entitlement evidence, shared nonces, appeals/verified accounts, conflicting policy states and evidence. Require manual evidence before sanction.
- `/settings`: retention, privacy disclosures, per-product BuiltByBit resource mapping/EULA rules, signing-key rotation, admin RBAC/MFA, ping allowlist and DNS rebinding protection.

## Presence and uptime

`session_start` marks product session present. `product_heartbeat` at ~30 seconds refreshes `receivedAt`. After **60 seconds** without a successful receipt, report OFF (with a separate `STALE/UNCONFIRMED` explanation for network ambiguity). Explicit `session_stop` marks only its own product session OFF; a different active product must keep node ON. Compute uptime percentage from server-observed active intervals divided by observation window after firstSeen, and display data-quality/confidence gaps. Duplicate product sessions must not inflate node uptime.

`player_seen`: upsert UUID, username, OP indicator and online presence. `player_presence`: update only `(sessionId, UUID, online)`. Duplicate eventId/sequence ignored. On disconnect or expiry of the product session, stale online-player presence is cleared. On `node_snapshot`, replace the session's active roster atomically; preserve anonymized/history data only per retention policy. Same UUID on several nodes is a graph edge, not proof they share ownership.

## Administrative policy UI

Each `/server` and `/node` detail has three mutually exclusive actions: `WHITELIST` (green), `BLACKLIST` (red), `CLEAR`. At a **single scope**, the most recent explicit action replaces the prior action atomically; never store simultaneously active ALLOW and BLOCK. Display the effective rule and which scope decided it. Precedence: **node override if explicit**, else **network/server override if explicit**, else per-product installation policy, else NONE. Every change requires authenticated admin action, confirmation for BLOCK, a reason, audit trail and optional expiry. Review signals alone cannot auto-block a purchased resource.

Configured default display reason: `BLACKLISTED from using this plugin`. Future signed startup denial message may include:

```text
The plugin will not start: <reason>
Contact the developer to ask to be whitelisted.
Discord: https://discord.com/invite/gF36AT3
BuiltByBit: https://builtbybit.com/members/linsaftw.152552/
```

This is **not** emitted or enforced by v0.2.0. It must be shown by the host plugin's existing message/logger bridge only after an authorized, authenticated startup decision. A bare JSON `BLOCK`, error code or network connection failure is never sufficient. BuiltByBit licensing rights and resource-specific EULA termination terms constrain actual denial. Multiple download installations, shared IP, plugin names, admin roles and machine descriptions are investigative signals, not infringement proof.

## Future implementation waves

1. **v2 ingestion + schema**: authenticated telemetry endpoint; idempotency, sequencing, session expiry, input validation and rate limits. Source of truth for all subsequent screens.
2. **Network/node/product model**: privacy controls, history, dedupe, product correlations; no bare-IP owner inference. Retention/deletion mechanisms before cross-node player graph rollout.
3. **Admin dashboard**: overview, `/server`, `/node`, `/player`, review, search and auditable overrides. Verify permissions, no public access to identifiable player data.
4. **Reachability worker**: verify Minecraft endpoints, sanitize MOTD/favicon, cap network/socket/dns, reject loopback/private/link-local targets, recheck DNS after resolution to prevent SSRF/rebinding, retain last successful ping with timestamp.
5. **BuiltByBit + policy**: authoritative entitlement-to-product mapping, review workflow, license/EULA criteria, short-lived signed decisions, versioned key rotation, appeals, rollback/audit. Never expose BBB server tokens in client.
6. **Opt-in gated enforcement adapter per product**: each plugin must make actual feature initialization conditional on a validated decision *before* registering gameplay handlers. Async startup inherently cannot abort already-returned `onEnable()`; if existing plugin lifecycle cannot gate without blocking threads, keep it advisory. Fail-open on outage; never perform mid-session kill switch. Security and legal review before shipping.
7. **Runtime matrix**: 1.8/1.12/1.16/1.20/Paper/Folia actual integration tests; real BuildByBit-injected download; proxy/shared-host network test; consent/erasure test, heartbeat loss, reboot, duplicated event and signed response tests.

## Privacy/security requirements

The platform can reconstruct associations between individuals, admins and Minecraft networks. Treat player UUID/name/OP and node IP/history as personally identifying in context. Use conspicuous server-owner opt-in, a clear notice to players where required, constrained access and retention, right-to-delete/rectification workflow, encryption of storage/backups, audited exports, and data-protection/legal review for relevant jurisdictions. Do not quietly add telemetry in a plugin update without customer disclosure. Restrict any risk engine to investigation and human review, never automatic deprivation from incidental correlations.

## 2026-10-11 implementation status — v0.4.0

**IMPLEMENTED:** basic private authenticated website with `/`, `/servers`, `/server/{IP}`, `/nodes`, `/node/{nodeId}`, `/players`, `/player/{uuid}`, `/reviews`, `/activity`, `/settings`; protocol-v2 ingestion, nested record tracking, node/session freshness, provisional uptime, advisory network/node overrides and audit, per-player erase. See `README.md`, `docs/API.md` and `docs/DEPLOYMENT.md` for actual guarantees and limitations. Existing sections above were originally design targets, not a record of deployed features.

**STILL PLANNED:** verifiable installation identities, per-product entitlement mapping, trusted BuiltByBit OAuth, appeal verification, safe public Minecraft endpoint registration/ping/MOTD/favicon, signed startup decisions and license/EULA-gated enforcement, indexed multi-process datastore, RBAC/MFA, high-volume alerting and uptime history aggregations, full privacy erasure/suppression across backups, actual browser/Minecraft production integration tests.

## v0.4.0 architecture decision

No separate backend process: the Next.js Node runtime handles both ingestion and administrator UI, using direct server-side services. `/api/v1/check`, `/api/v2/events` and session-protected console mutations live in App Router Route Handlers. Published Maven repository path `/maven/` hosts versioned immutable client dependencies. Authentication uses one generated administrator password and signed cookie, not a backend bearer token. Site must be one process until persistence is migrated from JSON.


### v0.5.0 implemented (dashboard phase)

- Opt-in plugin JAR basename and advisory flags; green DRM-reporting plugin name matches and red suspicious filename/name token matches.
- Suspicious plugin counts on network (public IP) and node summaries and details.
- Rolling 24-hour online player and node counts, sampled every five minutes (no historic backfill), visualized on Overview in iOS-inspired dark glass design.
- **Still pending:** verified JAR attestation, server MOTD/favicons, independent reachability checks, signed license revocation, customer appeals; do not label these as implemented.
