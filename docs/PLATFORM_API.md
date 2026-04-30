# Phantom — Platform API (`/platform/*`)

The platform API is the **machine-to-machine** surface Phantom exposes to the
Hosting product (codename **Nebula**). It is **not** a public customer API:
end users never authenticate against it directly. The Hosting backend holds
a single bearer token, manages its own customer accounts, and calls
`/platform/*` on their behalf.

```
Customer browser ──▶ Nebula (web + api) ──▶ Phantom /platform/*
                                            │
                                            ▼
                                          Postgres
                                          Nodes
```

## Authentication

Every request must include a bearer token issued in the Phantom admin panel
(see *Settings → Platform tokens*).

```
Authorization: Bearer phs_live_<32-byte-base64-secret>
```

- Tokens are stored as SHA-256 hashes in `platform_tokens.token_hash`.
- The plain-text token is shown **only once** at creation.
- Tokens can be revoked instantly from the admin panel.
- `last_used_at` is updated fire-and-forget on every authenticated request.
- Optional `expires_at` for time-bound tokens.
- Scope strings are persisted (`platform_tokens.scopes`); enforcement lands
  in v2. For now `["*"]` (full access) is granted.

Failure modes:

| Status | Code                       | Reason                                         |
| ------ | -------------------------- | ---------------------------------------------- |
| 401    | `PLATFORM_AUTH_REQUIRED`   | Missing/invalid header, unknown or revoked id  |

## Conventions

- All requests/responses are JSON. UTF-8.
- Timestamps are ISO-8601.
- Errors use the standard Phantom shape: `{ "error": string, "code"?: string, "details"?: any }`.
- The platform plane is **NOT** behind `ADMIN_IP_ALLOWLIST` (the Hosting
  backend usually runs on a different network). Combine with `RUNTIME_IP_ALLOWLIST`
  if you want to lock the source IP at the network layer.
- Audit log entries are written for every mutation (`platform.tenant.create`,
  `platform.tenant.update`, `platform.tenant.delete`, `platform.tenants.list`).
  The actor email is `platform-token:<token-name>`.

## Tenants

### `POST /platform/tenants`

Create a new tenant.

```http
POST /platform/tenants
Content-Type: application/json
Authorization: Bearer phs_live_…

{
  "name": "Anthony Bouchet",
  "slug": "anthony",
  "planTier": "free",
  "quota": {
    "maxServers": 1,
    "maxRamMb": 2048,
    "maxCpu": 1,
    "maxDiskGb": 5
  }
}
```

| Field      | Required | Notes                                                |
| ---------- | -------- | ---------------------------------------------------- |
| `name`     | yes      | 2-80 chars                                           |
| `slug`     | yes      | `[a-z0-9-]{1,32}`, no leading/trailing hyphen, unique |
| `planTier` | no       | `"free"` (default) or `"premium"`                    |
| `quota`    | no       | partial — defaults: 1 server / 2 GB RAM / 1 vCPU / 5 GB disk |

**Response 201**: `{ "tenant": Tenant }`.

### `GET /platform/tenants`

List all (non-deleted) tenants. Returns tenants with current usage
aggregated from `workloads` (cumulative RAM / CPU / disk).

```json
{
  "tenants": [
    {
      "id": "...", "name": "...", "slug": "...", "planTier": "free",
      "suspended": false,
      "quota": { "maxServers": 1, "maxRamMb": 2048, "maxCpu": 1, "maxDiskGb": 5 },
      "usage": { "workloadCount": 1, "ramMb": 2048, "cpu": 1, "diskGb": 5 },
      "createdAt": "…", "updatedAt": "…"
    }
  ]
}
```

### `GET /platform/tenants/:id`

Fetch a single tenant including current usage. `404 TENANT_NOT_FOUND` if
absent or soft-deleted.

### `PATCH /platform/tenants/:id`

Partial update. All fields optional.

```json
{
  "name": "Anthony — premium",
  "planTier": "premium",
  "suspended": false,
  "quota": { "maxRamMb": 4096 }
}
```

### `DELETE /platform/tenants/:id`

Soft-delete (`tenants.deleted_at` set, `suspended=true`). Workloads owned
by the tenant keep their `tenant_id` foreign key — they are NOT auto-stopped.
The Hosting backend is expected to terminate them through the standard
workload mutations before calling delete.

## Servers (scoped per tenant)

All server endpoints live under `/platform/tenants/:tenantId/servers/...`.
Phantom validates that `serverId` belongs to `tenantId` on every call —
mismatched ids return `404 SERVER_NOT_FOUND` (same shape as a missing
server, so we don't leak ownership across tenants).

### `GET /platform/tenants/:id/servers`

List Minecraft servers owned by the tenant.

```json
{
  "servers": [
    {
      "id": "...", "name": "...", "slug": "...",
      "hostname": "anthony.nptnz.co.uk",
      "planTier": "free",
      "runtimeState": "running",
      "currentPlayerCount": 0,
      "createdAt": "…"
    }
  ]
}
```

### `POST /platform/tenants/:id/servers`

Provision a Minecraft server. Defaults are inherited from the resolved
template (`vanilla-1.21` if `templateId` is omitted). Quota is enforced
**before** the workload is placed: any check that fails returns
`409 QUOTA_EXCEEDED` with the violating field.

```http
POST /platform/tenants/<tenant-uuid>/servers
Content-Type: application/json
Authorization: Bearer phs_live_…

{
  "name": "Anthony's main server",
  "templateId": "vanilla-1.21",
  "version": "1.21.4",
  "motd": "Welcome to Anthony's server",
  "difficulty": "normal",
  "gameMode": "survival",
  "maxPlayers": 20,
  "hostnameSlug": "anthony",
  "ramMb": 2048,
  "cpu": 1,
  "diskGb": 5
}
```

| Field          | Required | Notes                                             |
| -------------- | -------- | ------------------------------------------------- |
| `name`         | yes      | 2-60 chars                                        |
| `templateId`   | no       | defaults to `vanilla-1.21`                        |
| `version`      | no       | must be supported by the template                 |
| `motd`         | no       |                                                   |
| `difficulty`   | no       | `peaceful` / `easy` / `normal` (default) / `hard` |
| `gameMode`     | no       | `survival` (default) / `creative` / etc.          |
| `maxPlayers`   | no       | 1-500, default 20                                 |
| `hostnameSlug` | no       | Custom subdomain prefix; otherwise auto-generated |
| `cpu`          | no       | vCPUs; default = template default                 |
| `ramMb`        | no       | MB; default = template default                    |
| `diskGb`       | no       | GB; default = template default                    |

**Response 201**: full `MinecraftServerWithWorkload` shape (server +
workload + node + hostname).

**Quota error 409**:

```json
{
  "error": "Tenant quota exceeded.",
  "code": "QUOTA_EXCEEDED",
  "details": {
    "field": "maxRamMb",
    "current": 1024,
    "requested": 2048,
    "limit": 2048,
    "wouldBe": 3072
  }
}
```

### `GET /platform/tenants/:id/servers/:serverId`

Detail view, scoped to the tenant.

### `POST /platform/tenants/:id/servers/:serverId/start`
### `POST /platform/tenants/:id/servers/:serverId/stop`
### `POST /platform/tenants/:id/servers/:serverId/restart`

Lifecycle. Returns `{ server, workload }` reflecting the new desired
state. Note that runtime state catches up asynchronously — poll
`GET /tenants/:id/servers/:serverId` (or wait for a webhook in PR 3) to
see when the server is actually `running` (the API publishes
`readyAt` on the server detail when MC reports `Done (X)!`).

### `DELETE /platform/tenants/:id/servers/:serverId`

Soft-delete. Pass `?hardDeleteData=true` to wipe the workload data
volume too (irreversible).

Returns:

- `200 { finalized: true, ... }` if the workload was removed synchronously.
- `202 { finalized: false, ... }` if the deletion is in progress on the
  agent.

### `PATCH /platform/tenants/:id/servers/:serverId/settings`

Customer-facing settings update. Only exposes the safe subset — autosleep
and online-mode are infra concerns and are NOT writable from the platform
API. All fields optional; at least one must be provided.

```http
PATCH /platform/tenants/<tenant-uuid>/servers/<server-uuid>/settings
Content-Type: application/json
Authorization: Bearer phs_live_…

{
  "motd": "Updated welcome message",
  "difficulty": "hard",
  "gameMode": "creative",
  "maxPlayers": 50,
  "whitelistEnabled": true
}
```

Returns the full server detail. The other settings (autosleep, onlineMode)
are loaded from the server's current state and persisted unchanged.

### `POST /platform/tenants/:id/servers/:serverId/console-url`

Issues a single-use, short-lived ticket the Hosting frontend hands to the
customer's browser to open the Phantom console WebSocket directly,
without ever seeing the bearer token.

```http
POST /platform/tenants/<tenant-uuid>/servers/<server-uuid>/console-url
Authorization: Bearer phs_live_…
```

**Response 201**:

```json
{
  "ticket": "phct_…",
  "url": "ws://localhost:4200/runtime/minecraft/servers/<id>/console?ticket=phct_…",
  "expiresAt": "2026-04-30T12:34:56.789Z",
  "ttlSeconds": 60
}
```

The ticket is consumed on the first WebSocket upgrade attempt — a second
attempt with the same ticket fails with `401 Unauthorized`. Default TTL
is 60 s (max 5 min). The ticket is bound to `(serverId, tenantId)`: it
cannot be redeemed against a different server.

Set `PUBLIC_WS_BASE_URL` (eg. `wss://api.phantom.example.com`) in
production so the URL points to your TLS-terminating proxy.

## Roadmap

- Outbound webhooks (`server.ready`, `server.stopped`, `server.crashed`,
  `tenant.over_quota`) signed with HMAC.
- Scope enforcement (`tenants.read`, `tenants.write`, `servers.write`).
- Idempotency-Key support on POST routes.
- OpenAPI spec emitted from the zod schemas.

## Operator checklist

```dotenv
# Phantom side
RUNTIME_IP_ALLOWLIST=<nebula-backend-public-ip>   # optional, defense in depth

# Nebula side
PHANTOM_API_BASE_URL=https://api.phantom.local
PHANTOM_PLATFORM_TOKEN=phs_live_…
```

Mint the token in *Phantom → Settings → Platform tokens*. Store it in your
secret manager — Phantom only displays it once.
