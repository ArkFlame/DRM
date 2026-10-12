# ArkFlame DRM v0.6.4 — production verification and release gates

**Source:** v0.6.2 production-readiness audit (43 items) plus v0.6.3 source changes and locally executed tests. This release contains **implemented hardening**, not a completed public production deployment. The items below preserve all audit work and mark unverified host/customer/provider gates explicitly. Runtime evidence always outranks this checklist.

## Scope and trust contract

- Client remains Java 8 compatible, advisory-only, Bukkit name auto-detected (`ArkFlameDrm.start(this)`). Consuming plugins may still require modern Minecraft APIs; their runtime compatibility cannot be inferred from this client.
- `BBB_EMBED_TOKEN` is **optional**. When blank, v1 reports and opt-in v2 telemetry operate normally and the review console says **BuiltByBit not configured**. Licensing observations remain UNKNOWN; no lookup request is made and there is no shutdown or ban.
- When token is present, the latest embed API may answer whether a **nonce** has usage rights. That is **not** proof that an untrusted `productId` matches the resource which issued it. Cross-product digest result fanout is removed in v0.6.3, but no authoritative resource-ID binding is implemented. Evidence is explicitly labeled `NONCE_RIGHTS_ONLY_PRODUCT_UNVERIFIED` and never auto-enforced. A copied nonce or fabricated v1/v2 identity must not be treated as verified ownership.
- Server/player/plugin/operator facts are self-reported. Suspicious filename markers and green active DRM indicators are advisory observations only.

## Critical public-launch gates (P0)

| Audit ID | v0.6.4 state | Exact remaining proof |
|---|---|---|
| P0-01 Native build | BLOCKED: Maven CLI absent; Next.js deps unavailable here | Native `./scripts/build.sh` exit 0 and deployed standalone smoke test |
| P0-02 Lockfile | PARTIAL: missing lockfile now triggers automatic generator + strict `npm ci`; the archive still lacks a real lockfile because registry access timed out here | On a networked build host, run build to generate, review/commit lockfile, verify `npm ci` and audit dependencies/licenses |
| P0-03 Canonical Maven version | BLOCKED: offline Java 8 JAR only; no immutable 0.6.4 publication | Maven package + external Gradle/Maven resolution of exact checksums |
| P0-04 Real consumer plugin | UNVERIFIED: no actual ArkFlame consumer sources or runtime here | Shade/relocate complete JAR into built plugin; test `onEnable` and HTTP |
| P0-05 Spigot/Paper 1.8–1.21 | PARTIAL: fake old/modern host shape tests and Java 8 build | Real server-version matrix, restart, player lifecycle and performance |
| P0-06 Folia | PARTIAL: scheduler reflection in existing client | Live Folia tests of full consuming plugin; only then mark `folia-supported: true` |
| P0-07 BuiltByBit rights | PARTIAL: no-token state/test; no real token | Scoped `resources.embed.latest` token, positive/negative/expired/429 integration |
| P0-08 Product-resource entitlement binding | **OPEN SECURITY LIMITATION**: isolated per claimed product but API resource identity unverified | Determine official response resource identity; bind against server-owned product registry and reject mismatch |
| P0-09 Marketplace placeholder | UNVERIFIED: literal watermark preserved | Authorized customer-downloaded final JAR with actual injected nonce |
| P0-10 Reporting authenticity | OPEN by design: public self-reports spoofable; UI labels preserve trust levels | Abuse/replay test, non-automatic decisions; assess receipt/authentication scheme without claiming downloadable shared secret proves host identity |
| P0-11 Ingress | PARTIAL: documented proxy timeouts/limits and header overwrites | Live DNS, TLS, firewall, proxy spoof and abuse tests |
| P0-12 Administrator protection | PARTIAL: password/cookie baseline; VPN/MFA recommended | Deploy and verify access gateway, cookie/logout/origin/CSRF/brute-force flows |
| P0-13 Privacy/marketplace | PARTIAL: template included; NOT published or legally reviewed | Publish specific data policy and required BuiltByBit DRM dependency disclosure |
| P0-14 Disaster recovery | PARTIAL: file+directory fsync, guarded offline archive/restore with checksum, schema validation tested locally | Host-specific stopped-writer backup, encryption, restore drill, disk-full and hardware-failure tests |
| P0-15 Browser acceptance | UNVERIFIED: TS syntax and static previews only | Actual Next.js login/navigation/review/delete/chart/mobile browser test |
| P0-16 Operations | PARTIAL: systemd example, runtime counters and documented health check | Supervised single-process deployment, alerts, 24h trial, rollback and service maintenance |

## Recommended sustained-launch work (P1)

| Audit IDs | State |
|---|---|
| P1-01 | IMPLEMENTED bounded async Java v1 retry (I/O/429/5xx; four total attempts, max 1+2+4 sec between retries). Java regression covers recovery and non-retryable 400. No persistent offline queue after process shutdown. |
| P1-02 | PARTIAL: v2 continues existing bounded queue/snapshot behavior; full fault-injection matrix still required. |
| P1-03 | PARTIAL: console explains token state and opt-in docs remain; explicit fleet-wide per-installation v2-disabled diagnostic not yet implemented. |
| P1-04 | OPEN: each acknowledged v2 update still rewrites the JSON graph. Profile production-scale workload before adopting transactional storage with an explicit migration/rollback plan. |
| P1-05 | PARTIAL: private process-local accepted/rejected/error/provider-queue counters and strengthened `/api/health` barrier. Durable external monitoring/alerting still required. |
| P1-06 | PARTIAL: recommended Nginx rate/concurrency limits, untested on host. |
| P1-07 | OPEN: copied installation or node identities can remain ambiguous. |
| P1-08 | OPEN: nonce lookup queue is in-memory; cannot replay a failed lookup after restart without a fresh original nonce report. |
| P1-09 | OPEN: player deletion is point-in-time, future opt-in observations can recreate data. Requires a scoped durable suppression design and backup expiration policy. |
| P1-10 | PARTIAL: 0600 snapshots and backup defaults, operation docs. Encrypted off-host backups and permission audit are host tasks. |
| P1-11 | OPEN: one shared password/cookie, no named users or revocable stolen cookie; restrict console behind VPN/MFA. |
| P1-12 | PARTIAL: existing backward-compatible JSON tests, but no real upgrade/rollback matrix. |
| P1-13 | OPEN: hashes for Maven artifacts, but no signed provenance/CI dependency audit. |
| P1-14 | PARTIAL: one-process deployment sample, no validated distributed writer lock; do not run multiple processes. |
| P1-15 | PARTIAL: chart labels/holes already truthful; no independent node reachability checks. |
| P1-16 | PARTIAL: malicious filename tests from earlier iterations, not a penetration test. |
| P1-17 | UNVERIFIED: no runtime CPU/tick/thread measurements from real Minecraft servers. |

## Optional future work (P2)

P2-01 notifications; P2-02 evidence timelines; P2-03 product/resource registry (mandatory for **product-specific verified entitlement**, not nonce-only observation); P2-04 export; P2-05 bulk review; P2-06 client diagnostic UI; P2-07 staging/prod environments; P2-08 durable monitoring dashboard; P2-09 node collision reconciliation; P2-10 external-route security assessment. These are not represented as implemented.

## Ready-to-execute release checklist

1. On a connected build host with Maven and npm, run `./scripts/build.sh` directly or `./scripts/start.sh` for automatic first-run build. The missing `web/package-lock.json` is generated automatically. Inspect and commit it after generation, then run dependency vulnerability/license review. This archive does not include an invented lockfile.
2. Verify `./scripts/build.sh` exits 0 and startup uses only the completed current-release marker; check Maven JAR bytecode, all Java/Node tests, `npm ci`, TS typecheck, Next.js `next build`, and public Maven repository publication only after success.
3. Start a disposable instance using `./scripts/start.sh`, verify login, session logout, proxy IP, 24h charts, node filters and manual actions in Chromium mobile/desktop (using test data).
4. Test Java 8/modern API consumers against real Bukkit 1.8.8, Spigot 1.13.x, Paper 1.16.x/1.20.x/1.21.x and current Folia releases. No universal Folia main thread assumptions.
5. Test BuiltByBit with a creator token of minimum scope and a watermark-injected purchaser download; before claiming **product license verification**, implement authoritative product-resource binding.
6. Deploy behind a private admin access gateway + HTTPS/loopback reverse proxy and set up single-writer supervision. Run real resource/load/abuse/failure tests.
7. Publish a privacy notice appropriate to the actual collection configuration and marketplace dependency disclosure, then run a real encrypted backup/restore drill.
8. Canary on controlled servers for at least a complete 24h telemetry window before extending to customers. Never auto-ban based on markers, self-reports or nonce-only evidence.
