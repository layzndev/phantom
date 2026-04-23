# Phantom Node Registry

Phantom owns the node registry in Aurora PostgreSQL. Runtime sync, heartbeat and metrics are intentionally not connected yet.

## Tables

- `nodes`: canonical admin inventory.
- `node_tokens`: hashed runtime tokens. Plain tokens are shown once only.
- `node_status_events`: simple status timeline for admin changes.

## API

```text
GET  /nodes
GET  /nodes/:id
POST /nodes
POST /nodes/:id/maintenance
POST /nodes/:id/rotate-token
```

No Hosting API calls are made in this phase.

## Migration

```bash
cd /opt/phantom
npm run db:generate --workspace @phantom/api
npm run db:migrate:deploy --workspace @phantom/api
sudo systemctl restart phantom-api
```

## Register Node CLI

Interactive:

```bash
npm run node:register --workspace @phantom/api
```

Environment-driven:

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

Store the token immediately. It cannot be recovered from the database.
