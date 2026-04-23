# Phantom Panel

Panel admin interne, separe du panel client et du produit public. La V1 est centree sur l'exploitation des nodes via une Phantom API dediee qui consomme la Hosting API.

## Architecture

- `apps/api`: API Express TypeScript, auth admin separee, Prisma/Aurora PostgreSQL dedie, sessions dediees, services Hosting API, nodes et audit.
- `apps/web`: panel Next.js TypeScript/Tailwind, routes admin protegees, UI sombre entreprise.

### API modules

- `src/modules/auth`: login, logout, session admin, lockout leger et schemas auth.
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

## Note Prisma

La V1 est volontairement verrouillee sur Prisma `6.17.1` pour accelerer la livraison Aurora PostgreSQL et eviter la complexite de configuration Prisma 7. L'upgrade vers Prisma 7 est preparee:

- Le schema reste isole dans `apps/api/prisma/schema.prisma`.
- La generation et les migrations passent par les scripts `db:*`.
- Le client Prisma est centralise dans `apps/api/src/db/client.ts`.
- Les modules applicatifs passent par des repositories `apps/api/src/db/*Repository.ts`.
- Les imports `@prisma/client` sont limites au dossier `src/db`.
