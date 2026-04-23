ALTER TABLE "nodes"
ADD COLUMN "used_ram_mb" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "used_cpu" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "last_heartbeat_at" TIMESTAMP(3);

CREATE INDEX "nodes_last_heartbeat_at_idx" ON "nodes"("last_heartbeat_at");
