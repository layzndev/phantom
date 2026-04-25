ALTER TABLE "minecraft_servers"
  ADD COLUMN "rcon_password" TEXT;

CREATE TABLE "minecraft_operations" (
  "id" TEXT NOT NULL,
  "workload_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "result" JSONB,
  "error" TEXT,
  "actor_id" TEXT,
  "actor_email" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "minecraft_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "minecraft_operations_workload_id_idx" ON "minecraft_operations"("workload_id");
CREATE INDEX "minecraft_operations_status_idx" ON "minecraft_operations"("status");
CREATE INDEX "minecraft_operations_created_at_idx" ON "minecraft_operations"("created_at");

ALTER TABLE "minecraft_operations"
  ADD CONSTRAINT "minecraft_operations_workload_id_fkey"
  FOREIGN KEY ("workload_id") REFERENCES "workloads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
