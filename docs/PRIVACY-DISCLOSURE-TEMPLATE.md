# Privacy disclosure template — review and publish before onboarding customers

**Draft only; NOT a public policy.** Replace the organization/contact, lawful basis, retention commitment, deployment configuration, hosting location, and actual consumer opt-in terms after a legal and operational review.

ArkFlame DRM is an advisory license/installation-observation service for Minecraft plugins. By default, the Java client may send the plugin name and version, a locally persisted installation UUID, the server software version, Java version and (when marketplace-injected) a BuiltByBit download nonce. The service observes the connecting server IP. **When the provider token is not configured, license rights remain unknown; the service continues accepting non-enforcing reports.**

Additional telemetry is **off by default** and requires the hosting server owner's explicit settings in `arkflame-drm/telemetry.properties`. Enabling network reporting may transmit node ID, session timestamps, server software/port/max-players and heartbeat. Individually opt-in fields may add player UUID and names/presence, operator statuses, installed plugin names/versions/JAR basenames, and machine OS/architecture/CPU count. File paths, installed JAR bytes, hashes, and Minecraft player IPs are not intentionally collected by this client.

Purpose: operation and support diagnostics, optional usage observations, correlation of apparent installations, and **manual** review of potential shared downloads or suspicious plugin filenames. Self-reported plugin and player information is not independent proof of ownership, piracy, or server reachability. No automatic plugin disablement or automatic blacklisting is performed.

Retention defaults to `DRM_RETENTION_DAYS=180` days for live stores, configurable on the backend; historical charts hold only a bounded 24h window. The service also requires explicit management of encrypted backup retention and erasure; current deletion is point-in-time and subsequent consented reports may recreate a profile. Admin access is password restricted and should be behind a private VPN/MFA gateway. Limit access to authorized personnel and provide a contact and rights-request procedure before launch.

**Publish after filling**: [Company/Controller], [Contact for access/deletion], [Hosting jurisdiction], [Retention policy including backups], [Lawful basis / contract and consent where required], [Data recipient/processor list], [How a Minecraft hosting administrator enables/disables enhanced telemetry], [Applicable resource license/dependencies-tab DRM disclosures].

BuiltByBit documentation: https://builtbybit.com/help/developers/v2-embed-api/license-checks-via-builtbybit/ (scope, usage rights and disclosure requirements).
