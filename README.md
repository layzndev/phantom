# Phantom Panel

## Architecture

- `apps/api`: API Express TypeScript, auth admin, Prisma/Aurora PostgreSQL, sessions, nodes et audit.
- `apps/web`: panel Next.js TypeScript/Tailwind, routes admin, UI sombre.

### API modules

- `src/modules/auth`: login, logout, session admin, lockout et schemas auth.
- `src/modules/admins`: comptes internes, roles `superadmin` et `ops`, bootstrap admin.
- `src/modules/nodes`: endpoints nodes, schemas, service et repository d'acces Hosting API.
- `src/modules/audit`: journal d'audit admin stocke dans la base Phantom.
- `src/modules/integrations/hosting-api`: unique couche de communication avec la Hosting API.
- `src/middleware`: securite, protection admin, request ids et erreurs centralisees.
- `src/lib`: erreurs applicatives, validation et wrappers async.
- Convention module: `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.schema.ts`, `*.types.ts`.
- `prisma/schema.prisma`: schema Aurora PostgreSQL dedie au Phantom.

### Base Aurora PostgreSQL dediee

La base Phantom est strictement separee de la base du hosting public. Tables V1:

- `admins`: comptes internes, hash de mot de passe, statut, 2FA-ready, IP allowlist-ready.
- `admin_roles`: roles `superadmin` et `ops`.
- `admin_sessions`: sessions admin persistantes separees du produit public.
- `audit_logs`: audit trail complet des actions admin.

## Securite V1

- Cookie admin dedie `phantom.sid`, `HttpOnly`, `SameSite=strict`, `Secure` en production.
- Sessions persistantes dans `admin_sessions`, separees du hosting public.
- Password hashing via bcrypt avec cost 12.
- Rate limit sur `/auth/login`.
- Lockout leger: 5 echecs verrouillent temporairement le compte pendant 15 minutes.
- Request id sur chaque requete et reponse erreur.
- Audit DB pour login, login fail, logout, detail node, sync, maintenance, refresh, reconcile, rotate token et erreurs critiques.
- CORS strict via `WEB_ORIGIN`.

### Web design system

- `AppShell`, `AdminSidebar`, `AdminTopbar`
- `SectionHeader`, `StatCard`, `StatusBadge`, `DataTable`
- `EmptyState`, `ActionBar`, `DetailCard`, `SkeletonBlock`
- composants nodes: `NodeCapacityCard`, `NodePortsCard`, `NodeServersTable`, `NodeActions`

## Lancement local

```bash
cd phantom
npm install
npm run db:generate --workspace @phantom/api
npm run db:migrate:deploy --workspace @phantom/api
npm run dev
```

Par defaut en developpement:

- API: `http://localhost:4200`
- Web: `http://localhost:3000`

En production, definis obligatoirement `DATABASE_URL`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` et `SESSION_SECRET`.

Pour Aurora PostgreSQL, `DATABASE_URL` doit cibler la base Phantom dediee, par exemple:

```bash
DATABASE_URL=postgresql://phantom:<password>@<aurora-endpoint>:5432/phantom?schema=public&sslmode=require
```

## Brancher la Hosting API

Copie `apps/api/.env.example` vers `apps/api/.env`, puis configure:

```bash
HOSTING_API_BASE_URL=https://hosting-api.example.com
HOSTING_API_TOKEN=...
HOSTING_API_NODES_PATH=/admin/nodes
HOSTING_API_TIMEOUT_MS=7000
HOSTING_API_RETRY_ATTEMPTS=1
```

La Phantom API ne parle jamais directement au runtime node ou a Docker. Elle appelle uniquement la Hosting API via `src/modules/integrations/hostingApiClient.ts`.

## Verification

```bash
npm run typecheck
npm run build
```

Les migrations Prisma sont dans `apps/api/prisma/migrations`.

## Creer le premier superadmin

Aucune route publique d'inscription n'existe pour le Phantom. Le premier compte se cree via un script CLI interne:

```bash
npm run admin:bootstrap --workspace @phantom/api
```

Le script demande l'email et le mot de passe, ou accepte:

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@company.local ADMIN_BOOTSTRAP_PASSWORD='ChangeMe-Admin-2026!' npm run admin:bootstrap --workspace @phantom/api
```

Il refuse de creer un admin si l'email existe deja.

## Node Registry Interne

Phantom est maintenant la source de verite des nodes. La Hosting API/runtime sera branchee plus tard.

Tables Aurora:

- `nodes`
- `node_tokens`
- `node_status_events`

Appliquer la migration:

```bash
npm run db:migrate:deploy --workspace @phantom/api
```

Creer un node par CLI interne:

```bash
npm run node:register --workspace @phantom/api
```

Ou avec variables d'environnement:

```bash
NODE_ID=node-par-01 \
NODE_NAME="Paris Edge 01" \
NODE_PROVIDER=OVHcloud \
NODE_REGION=eu-west-par \
NODE_INTERNAL_HOST=10.40.0.11 \
NODE_PUBLIC_HOST=par-01.nodes.nptnz.com \
NODE_RUNTIME_MODE=remote \
NODE_TOTAL_RAM_MB=65536 \
NODE_TOTAL_CPU=32 \
NODE_PORT_RANGE_START=25000 \
NODE_PORT_RANGE_END=26000 \
npm run node:register --workspace @phantom/api
```

Le token node est affiche une seule fois et stocke uniquement sous forme hashee.
