# Security and privacy — v0.6.3

- One Next.js Node server contains API and dashboard. Sensitive dashboard and management routes use signed HttpOnly SameSite=Strict sessions, password comparison by constant-time SHA-256 digest, per-process rate limits and same-origin checks on mutations (configured origin or actual host through trusted ingress).
- Generated `web/.env` stores `DRM_WEB_PASSWORD`, `DRM_WEB_SESSION_SECRET`, and `DRM_HASH_KEY`. File permissions 0600, Git-ignored. Password recoverable locally by owner; no universal password. Password alone is weaker than MFA: restrict the administrator console using VPN / identity-aware reverse proxy for public deployment.
- The ingestion endpoints have no cryptographic client authenticity. Event payloads and claimed player/operator/plugin/machine data are **unverified** observations, not legal or enforcement proof. Do not make blacklist decisions automatically.
- Real IP is accepted only from a trusted TLS terminator that replaces `X-Real-IP`; never expose the Node process publicly. Hostname grouping can include NAT, reverse proxies, hosting clusters and VPNs.
- Enhanced node/player/OP/plugin/machine collection is disabled without explicit server-owner opt-in. Publish a privacy notice with retention, access, correction and deletion instructions. Do not silently enable these flags during plugin upgrades.
- Bounded request payloads, rate limits, bounded persistence collections, staged file writes. Single process writes JSON; multiple processes or serverless functions risk corruption. For scaling, migrate to a transactional DB first.
- `web/data` must not be under `web/public`. Never reveal raw nonce values; only keyed digests persist. Preserve `DRM_HASH_KEY` across migration.
- Maven artifacts under `/maven/` are public and immutable; do not store credentials or source server telemetry in the JAR. Compiled JAR retains a BuiltByBit placeholder intentionally; download-specific watermarking occurs downstream in the final product jar.
- JDK 8 client stays advisory-only and never stops plugins. Network timeout bounded, no Bukkit mutable world changes from network threads. Folia live runtime remains a required deployer verification.


### v0.5.0 telemetry / reputation safeguards

Plugin filename collection remains subject to `network.enabled=true` and `plugins.enabled=true` in the installation's explicit opt-in configuration. Only the basename of `.jar` code sources is recorded; no paths, JAR contents, file hashes, player IPs or external disk inventories are collected. A missing basename is not an error. The `pluginSignals` fields are **unverified client-reported indicators**. A token such as `LEAKED`, `CRACKED`, or `NULLED` may indicate a modified JAR but does **not** prove infringement. Do not automatically blacklist users or servers from these observations. Admin ALLOW/BLOCK entries remain advisory labels. The 24-hour metric history is bounded and may have gaps; it is not an independently measured public server uptime monitor.

### v0.5.1 accuracy and staging

A green DRM indicator means a matching product has an active, recently reporting v2 session, not that its distribution license is proven valid. Old sessions and expired heartbeats do not produce green badges. Snapshot staging uses randomly named exclusive 0600 files adjacent to the target JSON data file and removes unfinished staging data on write failure. In v0.6.3 the staged file and containing directory are synchronized on supported Linux filesystems before acknowledgement. There is still no multi-process ACID guarantee or validated hardware-level crash recovery.

### v0.6.3 license evidence and opt-in

Without `BBB_EMBED_TOKEN`, rights lookups are **not configured**; v1/v2 telemetry continues fail-open, with no automatic ban or remote disablement. With a token, a nonce usage-rights result is **not product-specific verification** because the claimed Bukkit product identifier is not yet authoritatively bound to the provider resource. The service no longer propagates a nonce-rights result across different claimed product names, but copied/fabricated nonce and telemetry remain spoofable. The dashboard labels those uncertainty tiers. Provider requests are never issued without a configured token.

The password verifier accepts a nonempty operator-configured password exactly as written, without a hidden minimum-length rejection. Generate a strong random password and protect the `.env` file. In production, use HTTPS and an additional VPN or identity-aware proxy. Startup loads `.env` using `node --env-file=.env`, not shell expansion. Only trust forwarded scheme from a proxy that overwrites inbound headers; protect the loopback-only Node port.
