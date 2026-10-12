# Production operations (v0.6.4)

**Deploy status:** These are reference procedures, NOT evidence of a completed deployment or restore drill. Adjust service user, paths, Node binary, certificate manager and network policy on the actual host. Never expose the Next process directly to the internet.

## Service, access and ingress

1. Provision a dedicated unprivileged `arkflame` service account; install source and Next build at `/opt/arkflame-drm`. Ensure only this account can read `web/.env` and write `web/data`. Protect backups from other users.
2. Install `deploy/arkflame-drm.service.example` as a systemd service after reviewing absolute paths. **Only one writable process** may own the JSON files. Stop service before a backup or restore. `systemctl status arkflame-drm` is necessary but not sufficient to prove no extra worker is running.
3. Use TLS termination, reverse-proxy `127.0.0.1:3000`, overwrite `X-Real-IP`, and firewall port 3000. Place console behind a VPN or access gateway with MFA. Do not rely on the built-in shared password as the only control on an internet-exposed administrator panel.
4. At the Nginx `http {}` scope, configure request limits before applying them to `/api/v1/` and `/api/v2/`, and tune for NAT/shared IP addresses. Suggested initial ingress controls: `limit_req_zone $binary_remote_addr zone=drm_ingest:10m rate=15r/s;` and `limit_conn_zone $binary_remote_addr zone=drm_conn:10m;`. Within the corresponding `server/location`: `limit_req zone=drm_ingest burst=30 nodelay; limit_conn drm_conn 20; proxy_connect_timeout 3s; proxy_read_timeout 10s;`. Run `nginx -t` and load/failure tests before reload. Reverse-proxy and application limits are independent.
5. Verify `/api/health` gives HTTP 200 only when internal service load and write barrier are healthy. For ongoing monitoring, access authenticated Settings → Runtime health (counts are **in-memory since last process start**, not a durable time series). Alert externally on repeated 5xx, login failures, disk usage, backup failure and server downtime.

## Stop-the-world backup and restore

- Stop the Next.js service and confirm no extra process is running. Set `DRM_SERVICE_STOPPED=YES` as an explicit operator acknowledgment, not as a substitute for checking processes.
- Run `DRM_SERVICE_STOPPED=YES ./scripts/backup.sh /secure/path/drm-YYYYMMDD.tar.gz`. Store the tarball and `.sha256` sidecar together. **Backup includes administrator credentials, session secret, and nonce digest HMAC key.** Restrict permissions and encrypt before copying off-host.
- Restore is destructive unless the destination is empty. Preserve the existing `.env` and JSON datasets in a **separate protected rescue directory**, then run `DRM_SERVICE_STOPPED=YES DRM_CONFIRM_RESTORE=YES ./scripts/restore.sh /secure/path/drm-YYYYMMDD.tar.gz`. The script verifies SHA-256, member allowlist, JSON schemas, then refuses to overwrite data. Never move original data out before verifying the archive.
- Start the service and verify login, v1 check, v2 data load, old nonce correlations, node graph and manual review labels. Do not reopen public ingestion until healthy. If a test fails, stop the service and reinstate the rescue files.
- Existing stores use two independent JSON files. A backup while writes are ongoing is not a consistent transaction. Back up only when the writer is stopped. Snapshot writes sync staged data and containing directory on supported Linux filesystems, but filesystem/hardware crash durability remains an operational property requiring a host test.
- Periodically restore to a **separate disposable staging environment** to prove the recovery objective. A script existing is not proof of successful disaster recovery.

## Release gates

- Use `./scripts/build.sh` on a provisioned host with native Maven, npm and network connectivity. A missing `web/package-lock.json` is generated automatically by the script; inspect and commit it for repeatable builds. `./scripts/start.sh` also builds automatically when the standalone output is absent/incomplete/stale, but for supervised production services prefer a prebuilt release to avoid compiling at boot. Do not publish offline JARs into immutable Maven coordinates.
- Test against real Spigot 1.8, modern Paper and Folia server distributions using a real shaded consumer plugin. A Java-8 compile is not runtime proof.
- Test an actual BuiltByBit purchase/download and rights lookup using a least-scope token. With no token, the dashboard shows **Provider not configured**; telemetry continues, rights remain unknown, and no plugin is disabled.
- Keep privacy and BuiltByBit dependency disclosures accurate and published before processing customer observations. Follow `docs/PRODUCTION-GATES.md`.
