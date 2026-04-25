CREATE TABLE "minecraft_servers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "workload_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "minecraft_version" TEXT NOT NULL,
  "motd" TEXT,
  "difficulty" TEXT NOT NULL DEFAULT 'normal',
  "game_mode" TEXT NOT NULL DEFAULT 'survival',
  "max_players" INTEGER NOT NULL DEFAULT 20,
  "eula" BOOLEAN NOT NULL DEFAULT false,
  "server_properties" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "minecraft_servers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "minecraft_servers_slug_key" ON "minecraft_servers"("slug");
CREATE UNIQUE INDEX "minecraft_servers_workload_id_key" ON "minecraft_servers"("workload_id");
CREATE INDEX "minecraft_servers_template_id_idx" ON "minecraft_servers"("template_id");
CREATE INDEX "minecraft_servers_deleted_at_idx" ON "minecraft_servers"("deleted_at");

ALTER TABLE "minecraft_servers"
  ADD CONSTRAINT "minecraft_servers_workload_id_fkey"
  FOREIGN KEY ("workload_id") REFERENCES "workloads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
