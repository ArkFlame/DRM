# Changelog

## 0.6.5 — Administrator login and environment loading
- Existing administrator passwords are matched exactly, including values shorter than 20 characters and values with punctuation/whitespace. Empty/unset passwords remain invalid.
- Login origin validation accepts the configured origin or the actual incoming host when its scheme is established by a trusted proxy; cross-site origins remain rejected.
- `start.sh` uses the Node.js env-file loader instead of shell evaluation, preserving literal password characters and avoiding shell command execution from `.env` contents.
- The login page distinguishes invalid credentials from origin and rate-limit failures; authentication/origin regressions and startup safety tests added.

## 0.6.4 — Automatic build and first-start bootstrap
- A missing `web/package-lock.json` now triggers `scripts/generate-lockfile.sh` automatically during `scripts/build.sh`; dependencies still install reproducibly through `npm ci`. Registry connectivity is required to generate a real lockfile.
- `scripts/start.sh` builds before launching if no complete current-version standalone application exists. Build failures stop startup; an existing successful build starts directly.
- Introduced a versioned completion marker written only after all build/test/publication/copy steps have succeeded. Stale and incomplete outputs are rebuilt rather than served.
- Added eight end-to-end shell fixture regressions for missing/present lockfiles, failed dependency resolution, first start, stale output, and fail-closed startup.
- No Bukkit, telemetry, storage schema, privacy, or license enforcement changes.


## 0.6.3 — Operational hardening and optional BuiltByBit support
- Missing `BBB_EMBED_TOKEN` is explicitly reported as **not configured**; no provider API calls occur. Startup and opt-in telemetry remain active.
- Nonce-only rights results are scoped to each claimed product and never represented as cryptographically verified product ownership; no automatic enforcement.
- Bounded async Java startup-report retries on 429, 5xx and transport failures; v2 startup no longer waits for v1 network completion.
- Linux snapshot staging syncs file bytes and containing directory before acknowledging persistence.
- Private in-process telemetry health counters, immutable deployment guidance, guarded offline backup and restore with SHA-256/schema validation.
- Locked-production-build gate requires generated `web/package-lock.json`; registry connectivity and live build verification remain external blockers.

## 0.6.2 — Saturated session recovery and idempotent manual reviews
- Reclaim the oldest stopped v2 session when the 50,000-session limit would otherwise block a new report. Never evict active sessions. Keep node and player profiles. Historical session-only detail and uptime calculations can become less complete after eviction.
- Repeated identical v1 manual-review decisions no longer create duplicate audit entries or unnecessary JSON rewrites.
- Added full-capacity regressions for stopped-session recovery and all-active rejection, plus review idempotence. Java client and wire schemas unchanged.

## 0.6.1 — Durable policy hygiene and service input hardening
- Reject identical resolved v1/v2 database file paths before startup to prevent schema overwrites.
- Distinguish invalid transport addresses (400) from actual IP rate limiting (429) in both direct service APIs. Existing public routes already reject invalid sources.
- Reject malformed persisted policy keys and policy audit targets on load; preserve compatible historical valid records.
- Require actual owned UUID keys when reading node/player details or assigning node policies to avoid inherited JavaScript object properties. Reject malformed network detail identifiers without scanning the graph.
- Remove policy override entries when cleared, leaving inherited network policy visible; preserve the audit trail.
- Skip redundant full-graph saves and duplicate audit entries for repeated unchanged manual decisions.
- Add six focused regression tests; keep the Java 8 client, API, v1/v2 protocol, persisted schema, and dark glass UI unchanged.

## 0.6.0 — Scoped discovery metrics and fleet query efficiency
- Search-filtered overview player identities and product installations now count only matching nodes; the unfiltered fleet overview retains historical fleet-wide identity totals.
- Online status rejects heartbeat timestamps that lie in the future after server-clock rollback, rather than treating them as fresh indefinitely.
- Reuse per-node online-player totals and suspicious-plugin counts already calculated for fleet aggregation when constructing bounded overview rows. Avoid redundant player-map iteration and filename classification.
- Distinguish the historical chart’s globally unique player UUIDs from the overview KPI’s summed node player connections. No history data rewrite or telemetry schema change.
- Add regression coverage for filtered totals, rollback at online boundaries, and one-pass active-player aggregation.
- Preserve Java 8 Bukkit API, advisory-only policy, v1/v2 protocol, persisted schemas, and dark-glass presentation.

## 0.5.9 — Accurate fleet totals and complete manual-review discovery
- Fleet overview KPIs now aggregate all matching nodes instead of using the first 2,000 displayed node rows; online player connections remain deduplicated across product sessions within each node.
- `?view=flagged` is evaluated in the graph before the 2,000-row response cap for nodes and observed network IPs; filtered pages show untruncated matching totals.
- Search includes the opt-in plugin JAR basename, allowing specific suspicious-file markers to be found from the node/server explorers.
- Network detail prioritizes suspicious node inventories, then sorts remaining nodes by latest report, while retaining complete network totals and a 2,000-row detail limit.
- Add capacity-boundary tests for nodes, networks, and query wiring. No auto-blacklisting or new collection.

## 0.5.8 — Accurate large-network summaries
- Calculate network detail summary statistics over all nodes sharing the IP, not only the first 2,000 displayed rows.
- Keep the detail node list bounded to 2,000 for UI and response-size safety.
- Reuse one observation timestamp and one grouped session traversal for full-network active status.
- Add a 2,001-node regression proving online, total-node, suspicious-plugin, and last-seen values agree with the fleet overview.
- Preserve advisory-only review, Java 8 Bukkit integration, and protocol/storage compatibility.

## 0.5.7 — Accurate uptime and consistent fleet queries
- Fix estimated node uptime mistakenly capped at 10%; restore complete 0–100% scale, with 90% observed-interval regression.
- Capture one observation time for the duration of each overview, node, network, and player-list query. Prevent inconsistent online counts near the 60-second freshness boundary and reduce redundant clock reads.
- Reuse filtered active sessions for online-player aggregation; remove obsolete unused helper.
- Add tests proving one-clock query snapshots and consistent node/network/player presence.
- Keep wire v1/v2, persistence format, Bukkit Java client integration, and advisory-only policies unchanged.

## 0.5.6 — Bounded snapshot ingest and shared presence logic
- Avoid repeated `Object.keys()` scans while processing large v2 node snapshots. Cache node/global/player-presence counts locally to each event and update them as new entries are accepted.
- Consolidate online presence insertion/removal for full snapshots, player updates, and presence deltas; keep the 512 online-player limit, 3,000 player edges per node, and 100,000 stored player profiles.
- Add regressions that assert constant per-event inventory enumeration for 512-player snapshots, snapshot replay, and slot reuse after disconnect.
- Preserve v1/v2 protocols, existing graph schema, admin policies, opt-in collection, and the Java one-call API.


## 0.5.5 — Backend input, persisted-state and snapshot-writer hardening
- Reject malformed UTF-8 request bodies rather than silently decoding replacement characters.
- Validate v1 disk state against persisted record/audit limits without changing legacy stored IP-field compatibility.
- Avoid redundant chmod following an exclusive 0600 atomic staging-file rename.
- Parse installation retention and entitlement timestamps once in their existing loops.
- New regressions cover malformed UTF-8, oversized audit history and legacy source-address compatibility. No protocol or Java API changes.

## 0.5.4 — Flat header controls and surface hierarchy

- The automatic refresh indicator is unboxed status text, not a status card.
- Refresh is one keyboard-accessible, borderless icon button rather than combined DaisyUI and custom button chrome.
- The top-right A indicator is a functional settings link with one flat circular background, not a glass box nested in the topbar.
- Header menu toggle and overview navigation action share the lightweight control hierarchy.
- The advisory Clear action, empty-state icon, and login lock icon no longer add redundant nested visual shells.
- Preview fixtures and responsive screenshots refreshed and covered by contract tests. Backend, telemetry and Bukkit client behavior unchanged.

## 0.5.3 — Glass-surface economy and mobile explorer clarity
- Remove bordered mini-cards nested inside glass section panels in node, network, and overview mobile explorer lists. Replace with directly separated rows; retain advisory marker counts and state visibility.
- Flatten chart legend values and fleet-health statistics to use one glass surface per section; remove the sidebar's redundant nested data-policy card.
- Preserve existing manual review controls, opt-in telemetry, source-derived graph behavior, and Bukkit Java API. No backend or wire-format changes.
- Revise source-matched illustrative preview fixtures and add a layout structure regression check; production-browser rendering remains unverified.

## 0.5.2 — Evidence-first dashboard and mobile investigation UX

- Reworked overview KPI hierarchy: four primary metrics and a compact secondary fleet summary. "Player connections" explicitly means summed node connections, not necessarily globally distinct people.
- Reworked 24-hour SVG chart with **independently labeled player/server Y-axes** so smaller server values are not flattened by large player counts. Preserved gaps for unknown observations and existing single-point rendering. Arrow-key navigation now moves between observed samples; the default focus selects the last known observation.
- Made the chart horizontally scrollable on narrow screens, with compact player/server readouts and improved contrast.
- Added manual `flagged only` filters to the node and observed-IP explorers, preserving the filter when searching. Mobile explorers and overview lists now use compact cards that surface review counts without forcing horizontal table scrolling.
- Put suspicious inventory entries first in node details while keeping DRM-positive items visible. Labels remain advisory, with no automatic blacklist.
- Included illustrative desktop/mobile HTML preview fixtures and rendered PNGs, with sample data only. **Not** a live Next.js screenshot, real telemetry capture, or substitute for browser/runtime acceptance testing.
- Preserved Java 8 one-call API, opt-in v2 telemetry, v1/v2 wire protocols, stored schemas, auth, advisory-only review labels, and immutable Maven release process.


## 0.5.1 — Live product evidence, safe snapshots and chart visibility

- Green plugin indicators now require a **currently active** DRM product session on the node, instead of treating historical/stopped sessions as ongoing evidence. A live report is still unverified client-reported evidence, not proof of legal ownership.
- Fix sparse 24-hour activity graphs: a single valid five-minute sample renders as a point even if surrounding samples are missing.
- Stage JSON snapshots into unique private (0600) exclusive temporary files, preserve a preexisting legacy `.tmp` file, and remove failed stages without deleting the last committed data.
- Add regressions for stopped/stale versus active DRM sessions, private snapshots, failed write cleanup and recovery. Preserve v1/v2 schemas, Java one-call API, and advisory-only manual policies.


## 0.5.0 — Plugin inventory signals, activity history and glass console

- Enhanced opt-in startup plugin inventory with optional `fileName` JAR basename (never the absolute location). The Java client remains Bukkit-independent and Java 8-compatible.
- Node detail distinguishes self-reported DRM products (green) from name/filename suspicious markers (red). Tokenized detection covers LEAK, LEAKED, CRACK, CRACKED, NULLED, PIRATE/PIRATED, UNLICENSED; substring-only legitimate names such as CrackShot are not classified. Human review required; no automatic blacklist or disabling.
- Node and public-IP network lists show counts of plugins with suspicious markers. Counts describe **observations**, not proven unauthorized installations.
- Online players and active nodes tracked in a bounded rolling 24-hour five-minute series, with gaps where samples are unavailable; deduplicates products on shared nodes. Historical player counts start at deployment, not backfilled from current users.
- Redesigned dark translucent console (including login) with native system font, consistent tokens, reduced-motion support and responsive tables. Existing sessions, policies, authentication and v1 protocol unchanged.
- Graph schema version stays 2; `history` is optional when reading older files. Previous Maven version directories stay immutable.

## 0.4.9 — Capacity recovery and retention parity
- Retry previously rejected new node/session registration once after pruning expired records at storage capacity. Persist any cleanup even if the incoming event remains rejected. Avoid additional full-graph scans in normal heartbeat traffic.
- Apply `DRM_RETENTION_DAYS` to the v2 network graph as well as v1 installation records; preserve 180-day default.
- Add regressions using actual 10,000-node capacity, on-disk reload, and configurable network-retention cleanup.
- Preserve existing Java public API, protocol v1/v2 events, schemas, signed admin session, and advisory-only behavior.


## 0.4.8 — Recover persisted state after failed writes
- Fix a consistency defect where a failed disk write returned an error but left the installation, review, policy, node or player mutation visible in server memory.
- Serialize failure recovery with normal mutations: reload both JSON stores from their last readable disk state before another request executes; keep the existing single-process storage contract.
- If recovery cannot read a valid committed snapshot, mark the service unhealthy instead of exposing ambiguous in-memory data.
- Preserve atomic snapshot writing, opt-in telemetry, v1/v2 wire protocols, stored schemas, and the advisory-only Java public API.
- Add regression tests for failed first installation reports, review/policy writes, v2 ingestion, successful retry, and post-rename errors.


## 0.4.7 — Session-presence retention and shared disk writer
- Stop recording offline players in per-session presence maps. Keep player history in the existing player/node graph. Bound live per-session presence to 512 records, matching the existing snapshot protocol and stored-session schema.
- During startup retention reconciliation, remove legacy `onlinePlayers: false` entries so long-lived v0.4.6 sessions do not accumulate stale flags or exhaust the presence cap.
- Extract one shared coalescing JSON snapshot writer for installation and graph stores. Preserve atomic temp-file rename, 0600 file permissions, and completion only after successful persistence.
- Add regressions for 600 distinct historical joins/quits, 512 offline operators plus one active player, legacy presence cleanup, high-concurrency presence bounds, and batched snapshot durability.
- Keep Java public API, Java 8 target, protocol v1/v2 payloads, persisted schema versions, authentication, and advisory-only semantics unchanged.


## 0.4.6 — Consistent dashboard reads and durable graph validation
- Dashboard queries wait for initial storage load and pending telemetry/admin mutation persistence before reading state.
- Validate loaded network graph nested player/session edges, presence booleans, IP history, machine inventories, timestamps, policies, and audit records. Reject corrupt files without silently replacing saved data.
- Replace version-specific Maven build regression fixtures with current POM-derived artifact coordinates.
- Preserve v1/v2 wire formats, storage schemas, Java API, opt-in telemetry, offline startup and advisory-only policy.
- Add tests for pending-write read barriers, immediate post-construction queries, and invalid persisted nested records.


## 0.4.5 — Consent-aware node inventory and idle listener cleanup
- Add optional `collection: { plugins, operators, machine }` flags to v2 session_start/node_snapshot reports; preserve previous payload fields and old-client compatibility.
- A product without consent for inventory cannot erase another product's previously reported plugin list, OP roster, or machine data on the same logical node.
- Explicitly consented empty inventory still clears earlier values. Operator associations are updated only when that session is authorized to report an operator roster.
- Register Bukkit listeners after opt-in configuration and legal scheduler context are established. Opted-out products register no listeners; network-only telemetry registers just the disable event. Failed scheduler dispatch closes the worker and releases the session registry entry.
- Ensure partially failed event registration unregisters its listener. Keep legacy v1 reporting, Java 8 bytecode, Bukkit 1.8/modern reflection and advisory-only enforcement unchanged.
- Add Node and Java regressions covering partial/empty inventory, malformed metadata, opt-out listener lifecycle and live single-call JSON output.


## 0.4.4 — Consistent identity ownership and lightweight profile queries
- V1 and v2 share one file-locked installation UUID store; concurrent startup cannot replace one another's IDs.
- Player detail queries aggregate presence with one session scan instead of rescanning every session per node.
- Reuse one JSON escape implementation across startup and telemetry; preserve JSON semantics.
- Build script derives artifact filename from Maven coordinates and publishes only after Java/web validation succeeds.
- Add concurrent identity and multi-node presence regressions; keep protocol versions, privacy defaults and Java 8 compatibility.

## 0.4.3 — Auto-detect Bukkit plugin identity and retain legacy runtimes
- New `ArkFlameDrm.start(this)` uses `PluginDescriptionFile#getName()`; exact plugin.yml name and case are preserved in v1 and v2 reports.
- Accept valid Bukkit names in server-side v1/v2 validation; old lowercase custom product IDs remain accepted.
- Retain explicit-ID overloads, Java 8 target, Bukkit-reflection adapter, Spigot 1.21 dependency for consuming plugins, and `api-version: 1.13`.
- Add old/modern scheduler compatibility and identity regressions.


## 0.4.2 — Consistency, smaller transport and immutable publishing

- Expired player retention now clears node inventories, operator lists, and active-session presence links, preventing stale online counts and orphan references.
- Maven publisher refuses to overwrite an existing version with different JAR or POM bytes; identical rebuild is idempotent.
- Deduplicated v2 HTTP transport by reusing the v1 bounded Java 8 HTTP client. No wire protocol change.
- Updated client User-Agent, Maven/Gradle version, release scripts and documentation to 0.4.2.
- Added regressions for retention cleanup, immutable publication, and BuiltByBit-specific millisecond Retry-After handling. Same advisory-only policy.


## 0.4.1 — Maven publishing and telemetry lifecycle hardening

- Retain historical Maven versions when publishing; generate `maven-metadata.xml` from all complete releases and refresh SHA-1/SHA-256 metadata checksums.
- Add isolated Maven publisher regression tests for old/new JAR resolution, metadata versions and checksum correctness.
- Repair graph retention: expired nodes no longer remain as dangling associations on otherwise retained player profiles; pruning now reports state changes for persistence.
- Prevent ghost player-profile creation when a node already holds the maximum number of player associations.
- Shutdown idle v2 client executor when optional `network.enabled` telemetry is disabled or its configuration cannot initialize.
- Add opt-out executor test and backend regression tests. Run publication regression tests in the release build script.
- Publish Java client and Maven coordinates as `0.4.1`. No v1/v2 JSON protocol, storage schema, authentication or enforcement change.

## 0.2.0 (client-side telemetry preparation)

- Preserve v0.1.4 v1 wire protocol, backend data and single-call Java API.
- Add optional Java 8 telemetry adapter; backend integration remains future protocol v2.
- Add persistent shared node UUID and per-product startup-session UUID/ordered event identifiers.
- Add opt-in server profile, bounded plugin inventory and operator snapshot, opt-in player session events.
- Send player UUID/name/OP state on initial observation, status-only on subsequent joins/quits, complete update on name/OP change.
- Add 30-second heartbeat and asynchronous best-effort disable event; bound queue and recover via snapshot after loss.
- Isolate Minecraft API reads to owned Bukkit/Folia execution contexts and network to separate worker.
- Document planned network/node/player dashboard, IP grouping limitations, ping/SSRF rules and signed enforcement architecture.
- No backend v2 endpoint or remote enforcement in this release. Real Minecraft/Folia runtime compatibility unverified.

## 0.1.4 (previous release)

- Bounded concurrent BuiltByBit verification queue, storage capacity enforcement, retention persistence and nested-record validation.

## 0.3.0 — Website + protocol-v2 collector
- Next.js/Tailwind/daisyUI private website: overview, server/network, node, player, review, activity and settings.
- Token-isolated backend integration and authenticated HMAC-cookie session login.
- Server receives opt-in v2 session/player/heartbeat/snapshot events; dedupes and persists to separate bounded graph JSON.
- Advisory node/network policy overrides with audit; player profile erasure.
- Existing v1 startup/entitlement API, Java 8 client source, plugin integration and packaged JAR preserved.
- New backend graph/session tests and web session-crypto tests.
- No remote enforcement or Minecraft public server pinging.

## 0.4.0 — Unified application and published client dependency

- Replaced split backend/frontend services with single Next.js App Router app and server-side services; kept protocol-v1 and protocol-v2 request envelopes and persisted schemas.
- Removed DRM_ADMIN_TOKEN and DRM_API_URL; management actions use Next.js signed-cookie sessions.
- Split Java 8 client into identity, JSON, bounded HTTP and telemetry helper classes without changing `ArkFlameDrm.start(this, id)`.
- Added Maven `pom.xml`, optional Gradle build, standard `/maven/` artifact layout with JAR/POM/checksums/metadata and copyable dependency coordinates.
- Added `scripts/build.sh`, `scripts/start.sh`, `scripts/init-env.sh`; generated per-installation password/secret, not a universal default.
- Kept opt-in telemetry, advisory decisions, offline startup, and single-process JSON persistence.
