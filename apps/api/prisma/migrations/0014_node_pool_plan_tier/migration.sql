ALTER TABLE "nodes"
  ADD COLUMN "pool" TEXT NOT NULL DEFAULT 'free';

CREATE INDEX "nodes_pool_idx" ON "nodes"("pool");

ALTER TABLE "minecraft_servers"
  ADD COLUMN "plan_tier" TEXT NOT NULL DEFAULT 'free';

CREATE INDEX "minecraft_servers_plan_tier_idx" ON "minecraft_servers"("plan_tier");
