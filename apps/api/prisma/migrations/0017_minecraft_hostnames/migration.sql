ALTER TABLE "minecraft_servers"
  ADD COLUMN "hostname" TEXT,
  ADD COLUMN "hostname_slug" TEXT,
  ADD COLUMN "hostname_updated_at" TIMESTAMPTZ,
  ADD COLUMN "dns_status" TEXT NOT NULL DEFAULT 'disabled',
  ADD COLUMN "dns_last_error" TEXT,
  ADD COLUMN "dns_synced_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "minecraft_servers_hostname_key" ON "minecraft_servers"("hostname");
CREATE UNIQUE INDEX "minecraft_servers_hostname_slug_key" ON "minecraft_servers"("hostname_slug");
CREATE INDEX "minecraft_servers_hostname_slug_idx" ON "minecraft_servers"("hostname_slug");
CREATE INDEX "minecraft_servers_dns_status_idx" ON "minecraft_servers"("dns_status");
