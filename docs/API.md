# ArkFlame DRM v0.4.0 — HTTP and domain API

**One Next.js App Router application** owns all public endpoint handlers, admin session handling, domain services and JSON data stores. The older `backend/` Node HTTP server, bearer token and HTTP proxy between UI and backend have been removed.

- `GET /api/health`: `200 {"ok":true,"mode":"advisory","protocol":[1,2]}` when JSON stores initialize; `503` otherwise.
- `POST /api/v1/check`: original v1 JSON shape (see existing client); max 4 KiB; returns advisory HTTP 202 after durable write. BuiltByBit nonce checks are asynchronous and separately cached. No license enforcement.
- `POST /api/v2/events`: existing protocol-v2 envelope; max 128 KiB; 202 accepted/ignored, 400 invalid, 409 session recovery, 429 rate-limited. See `PROTOCOL-v2.md`.
- `/login` and `/api/auth/login` use `DRM_WEB_PASSWORD`; session cookie signed with `DRM_WEB_SESSION_SECRET`. All management UI and `/api/console/*` mutations require signed cookie and CSRF origin validation. There are no public `/api/admin/*` routes.
- `/maven/` serves static Maven metadata, versioned POM, JAR and checksums created by `scripts/publish-maven.py`; site deployment required before remote resolution.

**Storage:** `DRM_DATA_FILE` (v1 schema) and `DRM_GRAPH_FILE` (v2 schema) in `web/data` by default. Single writable Next Node process only; no serverless/multi-replica support.

**IP ingress:** `DRM_TRUST_PROXY=true` requires a trusted edge that overwrites `X-Real-IP`. Never trust user-provided headers or use IP to prove a purchase.

**Advisory state:** manual `ALLOW/BLOCK/REVIEW/NONE` stays dashboard metadata. v1/v2 client never interprets a remote BLOCK as authority to disable plugin functionality.
