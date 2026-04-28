# Phantom — Security model

## Trust boundaries

```
[ Browser (admin) ]
        │   HTTPS  +  phantom.sid cookie  ( SameSite, HttpOnly, Secure )
        ▼
[ Phantom API ]   ─── /runtime/* + Bearer node-token ───▶  [ Node agent ]
        │                                                      │
        ▼                                                      ▼
   Postgres                                            Docker / Minecraft
```

The control plane has **two distinct trust boundaries**:

- **Admin plane** — `/auth`, `/nodes`, `/workloads`, `/minecraft`, `/incidents`,
  `/notifications`, `/audit-logs`, plus the `/runtime/minecraft/.../console`
  WebSocket upgrade. Authenticates with a session cookie (Postgres-backed
  store).
- **Runtime plane** — `/runtime/*`. Authenticates per-request with a per-node
  bearer token issued at node creation (and rotatable).

## Defenses in place

### Network layer

- **`ADMIN_IP_ALLOWLIST`** — comma/space separated CIDRs and IPs (IPv4 +
  IPv6). When set, every request to the admin plane (HTTP and WebSocket
  upgrade) coming from outside the list is dropped with `403` and audited
  as `admin.ip_blocked`. Empty = allow all.
- **`RUNTIME_IP_ALLOWLIST`** — same, applied to `/runtime/*`. Combined with
  the per-node bearer token, this gives layered defense for the agent
  channel: an attacker would need both a stolen token *and* network access
  from a known node IP. Audited as `runtime.ip_blocked`.

### Authentication

- bcrypt password hashes (cost 12).
- **Per-account lockout** — 5 failed logins → 15-minute account lock
  (`admins.lockedUntil`).
- **Per-IP brute force lockout** — `LOGIN_IP_LOCKOUT_THRESHOLD` (default 10)
  failed attempts within `LOGIN_IP_FAILURE_WINDOW_MS` (default 15 min) lock
  the source IP for `LOGIN_IP_LOCKOUT_MS` (default 15 min). Audited as
  `admin.login_ip_locked`. Independent of the per-account lockout so an
  attacker rotating usernames is also stopped.
- **Global rate limit** — `express-rate-limit` 10 attempts per IP per
  10 minutes on `/auth/login`.
- **Per-admin IP allowlist** — `admins.ip_allowlist` is enforced both at
  login and on every authed request (so revoking an IP terminates active
  sessions on the next request). Self-managed via
  `PUT /auth/me/ip-allowlist` with a "would lock you out" guard.

### Session

- HttpOnly + Secure (in production) cookie, `SameSite` configurable
  (defaults to `none` in production, `lax` in dev), 8-hour max-age, rolling.
- Stored server-side in Postgres (`auth-session.store`), so logout
  invalidates immediately.
- **Session pinning** — at login the IP and User-Agent are persisted on the
  session. Every authed request compares the current IP/UA against the
  pinned values; mismatch destroys the session and emits
  `admin.session_revoked`. Toggle with `SESSION_PIN_IP` /
  `SESSION_PIN_USER_AGENT`.
- `session.regenerate` on login rotates the session ID, defeating session
  fixation.

### Transport / browser

- HSTS in production (`HSTS_MAX_AGE_SECONDS`, default 1 year, with
  `includeSubDomains; preload`).
- Conservative CSP in production (`default-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`).
- `Referrer-Policy: strict-origin-when-cross-origin`,
  `Cross-Origin-Opener-Policy: same-origin`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: deny`.
- `Server` / `X-Powered-By` headers stripped.

### File manager

- Sandboxed inside the Minecraft data volume — `realpath` checks every
  resolved path stays under the volume root.
- Symlinks rejected at every read/write/delete site.
- `FORBIDDEN_BASENAMES` + substring blocklist (`rcon`, `secret`, `token`,
  `password`) hides credentials from non-`infra_admin` users.
- `server.properties` writes are blocked for non-`infra_admin` users; reads
  are redacted (RCON password and management secret).
- Binary files refuse text overwrites: an extension blocklist
  (`.dat`, `.dat_old`, `.mca`, `.mcr`, `.mcc`, `.nbt`, `.jar`, `.zip`, …)
  *and* a NUL-byte sniff on existing files block the editor from
  corrupting world data.

### Runtime channel

- Node bearer token rotated via `POST /nodes/:id/rotate-token`.
- Heartbeat IP/UA recorded for forensics.
- `/runtime/*` now layered behind `RUNTIME_IP_ALLOWLIST` (see Network).

### Audit

Every security-relevant action writes to `audit_logs`:

- `admin.login`, `admin.login_failed`, `admin.login_ip_locked`,
  `admin.logout`, `admin.session_revoked`, `admin.ip_blocked`,
  `admin.ip_allowlist.update`, `runtime.ip_blocked` and all the existing
  `node.*`, `workload.*`, `minecraft.*` actions.

## Operator checklist

For a hardened production deployment, set at minimum:

```dotenv
NODE_ENV=production
SESSION_SECRET=<32+ bytes random>
COOKIE_SAMESITE=none

# Lock the admin UI to your office / VPN
ADMIN_IP_ALLOWLIST=203.0.113.0/24,2001:db8::/32

# Lock the runtime channel to known node IPs
RUNTIME_IP_ALLOWLIST=198.51.100.10,198.51.100.11

# Optional: tune brute force aggressiveness
LOGIN_IP_LOCKOUT_THRESHOLD=10
LOGIN_IP_LOCKOUT_MS=900000
LOGIN_IP_FAILURE_WINDOW_MS=900000

# Session pinning is on by default; only disable for known good reasons
SESSION_PIN_IP=true
SESSION_PIN_USER_AGENT=true
```

Then per-admin allowlists can be set via the API (or future UI):

```bash
curl -X PUT https://phantom.example.com/auth/me/ip-allowlist \
  -H "content-type: application/json" \
  -b phantom.sid=... \
  -d '{ "entries": ["203.0.113.5", "10.0.0.0/8"] }'
```

## Known residual risks

- The per-IP login lockout is **in-memory** (per API instance). Restarting
  the API resets the counters. The per-account lockout (Postgres-backed) is
  durable and still applies.
- WebSocket upgrade does not currently re-evaluate the per-admin IP
  allowlist after the initial accept — only the global `ADMIN_IP_ALLOWLIST`
  is enforced on the upgrade path. HTTP requests run the full per-admin
  check.
- HSTS cannot be unset without operator action once a browser has cached
  it; do not enable in production without TLS first.
- The bootstrap admin password defaults to a known dev value when
  `ADMIN_BOOTSTRAP_PASSWORD` is unset — production startup refuses to boot
  in that case (see `assertRuntimeConfig`).
