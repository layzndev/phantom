-- Tenants
CREATE TABLE "tenants" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "slug"       TEXT NOT NULL,
  "plan_tier"  TEXT NOT NULL DEFAULT 'free',
  "suspended"  BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key"  ON "tenants"("slug");
CREATE INDEX        "tenants_deleted_at_idx" ON "tenants"("deleted_at");
CREATE INDEX        "tenants_plan_tier_idx"  ON "tenants"("plan_tier");

-- Per-tenant quota
CREATE TABLE "tenant_quotas" (
  "tenant_id"   TEXT NOT NULL,
  "max_servers" INTEGER NOT NULL DEFAULT 1,
  "max_ram_mb"  INTEGER NOT NULL DEFAULT 2048,
  "max_cpu"     DOUBLE PRECISION NOT NULL DEFAULT 1,
  "max_disk_gb" INTEGER NOT NULL DEFAULT 5,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_quotas_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "tenant_quotas_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Machine-to-machine token used by the Hosting backend (Nebula) to call /platform/*
CREATE TABLE "platform_tokens" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "prefix"        TEXT NOT NULL,
  "last4"         TEXT NOT NULL,
  "token_hash"    TEXT NOT NULL,
  "scopes"        JSONB NOT NULL DEFAULT '[]',
  "created_by_id" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at"  TIMESTAMP(3),
  "expires_at"    TIMESTAMP(3),
  "revoked_at"    TIMESTAMP(3),
  CONSTRAINT "platform_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_tokens_token_hash_key" ON "platform_tokens"("token_hash");
CREATE INDEX        "platform_tokens_revoked_at_idx" ON "platform_tokens"("revoked_at");

-- Workloads + minecraft_servers gain an optional tenant_id (null = infra-owned)
ALTER TABLE "workloads"          ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "minecraft_servers"  ADD COLUMN "tenant_id" TEXT;

CREATE INDEX "workloads_tenant_id_idx"          ON "workloads"("tenant_id");
CREATE INDEX "minecraft_servers_tenant_id_idx"  ON "minecraft_servers"("tenant_id");

ALTER TABLE "workloads"
  ADD CONSTRAINT "workloads_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "minecraft_servers"
  ADD CONSTRAINT "minecraft_servers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
