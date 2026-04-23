CREATE TABLE "nodes" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "internal_host" TEXT NOT NULL,
  "public_host" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'offline',
  "health" TEXT NOT NULL DEFAULT 'unknown',
  "runtime_mode" TEXT NOT NULL DEFAULT 'remote',
  "total_ram_mb" INTEGER NOT NULL,
  "total_cpu" DOUBLE PRECISION NOT NULL,
  "port_range_start" INTEGER NOT NULL,
  "port_range_end" INTEGER NOT NULL,
  "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "node_tokens" (
  "id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "node_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "node_status_events" (
  "id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "previous_status" TEXT,
  "new_status" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nodes_status_idx" ON "nodes"("status");
CREATE INDEX "nodes_health_idx" ON "nodes"("health");
CREATE INDEX "nodes_region_idx" ON "nodes"("region");
CREATE INDEX "node_tokens_node_id_idx" ON "node_tokens"("node_id");
CREATE INDEX "node_tokens_revoked_at_idx" ON "node_tokens"("revoked_at");
CREATE INDEX "node_status_events_node_id_idx" ON "node_status_events"("node_id");
CREATE INDEX "node_status_events_created_at_idx" ON "node_status_events"("created_at");

ALTER TABLE "node_tokens" ADD CONSTRAINT "node_tokens_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "node_status_events" ADD CONSTRAINT "node_status_events_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
