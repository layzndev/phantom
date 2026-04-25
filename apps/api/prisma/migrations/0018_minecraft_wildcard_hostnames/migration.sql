ALTER TABLE "minecraft_servers"
  ALTER COLUMN "dns_status" SET DEFAULT 'wildcard';

UPDATE "minecraft_servers"
SET
  "hostname_slug" = COALESCE(
    NULLIF("hostname_slug", ''),
    NULLIF(split_part(COALESCE("hostname", ''), '.', 1), ''),
    NULLIF("slug", '')
  );

UPDATE "minecraft_servers"
SET
  "hostname" = lower("hostname_slug") || '.nptnz.co.uk',
  "hostname_updated_at" = COALESCE("hostname_updated_at", NOW()),
  "dns_status" = 'wildcard',
  "dns_last_error" = NULL,
  "dns_synced_at" = NULL
WHERE "hostname_slug" IS NOT NULL;
