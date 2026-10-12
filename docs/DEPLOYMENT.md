# Single-process Next.js deployment

1. Install Node.js 22 LTS or newer compatible runtime, npm, JDK 17+ capable of compiling with `--release 8`, and Maven 3.9+ (system CLI, **no wrappers**).
2. Set DNS for `drm.arkflame.com` and TLS. Review `deploy/nginx.conf.example`.
3. `./scripts/init-env.sh` creates credentials once. Back up `web/.env` securely and keep it outside version control.
4. `./scripts/build.sh` (or launch `./scripts/start.sh` directly and allow first-run build). If `web/package-lock.json` is missing, it is generated automatically using npm registry metadata, then `npm ci` installs locked dependencies. This installs npm dependencies, compiles/test-packages client, publishes `/maven/`, tests the web services, runs TypeScript and Next production build, and cleans Maven `target` after successful completion.
5. `./scripts/start.sh` starts the standalone Next server. If the web build is missing, incomplete, or from an earlier release, it first runs the entire build; any build error stops startup. Run under process supervisor (systemd) for restart on crash. Only Nginx accepts public traffic.
6. `curl -f https://drm.arkflame.com/api/health` and `curl -f https://drm.arkflame.com/maven/com/arkflame/arkflame-drm-client/0.6.4/arkflame-drm-client-0.6.4.pom`.
7. Verify Maven and Gradle consumption from another machine and sign in to the dashboard using generated password.

**Proxy invariant:** the edge proxy must replace, not forward client-supplied `X-Real-IP`; this application requires `DRM_TRUST_PROXY=true` to correlate observed IPs. When served without a trusted proxy, telemetry requests are rejected instead of trusting spoofable headers. Do not expose the Node port publicly.

**Storage:** `web/data/` is JSON for single-process deployments only. Back up files as a consistent pair while app stopped or via filesystem-level snapshots. Keep `DRM_HASH_KEY` unchanged during migration. For multi-process hosting, use a transactional database and atomic lock/queue authority before scaling.

**No automatic enforcement:** Dashboard labels are advisory; no DRM response can disable a paying customer's plugin. Manage usage rights based on marketplace rules and supported evidence.

## Production gates and operations (v0.6.4)

Use `docs/PRODUCTION-GATES.md` as the authoritative unresolved gate list and `deploy/OPERATIONS.md` for supervised deployment, ingress and recovery. `scripts/build.sh` now generates a missing real `web/package-lock.json` automatically with `scripts/generate-lockfile.sh`. It then uses `npm ci`, never an unlocked install of runtime dependencies. First-run generation needs npm registry connectivity; inspect and commit the resulting lockfile for repeatability. `start.sh` builds when the completed release is missing or stale. Maven and Next.js production builds have NOT been run in this evaluation environment.

`BBB_EMBED_TOKEN` may be empty. When empty, licensing evidence is explicitly NOT CONFIGURED and server-side automatic provider lookups are disabled; advisory telemetry and manual reviews still work. The install status is not proof of license validity. Backups contain sensitive secrets: stop the single writer, `DRM_SERVICE_STOPPED=YES ./scripts/backup.sh /secure/backup.tgz`, encrypt before off-host storage and perform a disposable restore drill. Systemd and Nginx instructions in `deploy/OPERATIONS.md` are examples that require host-specific testing.
