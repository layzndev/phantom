ALTER TABLE "minecraft_servers"
ADD COLUMN "auto_sleep_use_global_defaults" BOOLEAN NOT NULL DEFAULT true;

UPDATE "minecraft_servers"
SET "auto_sleep_use_global_defaults" = CASE
  WHEN "plan_tier" = 'free' THEN true
  ELSE false
END;

CREATE TABLE "minecraft_global_settings" (
  "id" TEXT NOT NULL,
  "free_auto_sleep_enabled" BOOLEAN NOT NULL DEFAULT true,
  "free_auto_sleep_idle_minutes" INTEGER NOT NULL DEFAULT 10,
  "free_auto_sleep_action" TEXT NOT NULL DEFAULT 'sleep',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "minecraft_global_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "minecraft_global_settings" (
  "id",
  "free_auto_sleep_enabled",
  "free_auto_sleep_idle_minutes",
  "free_auto_sleep_action",
  "updated_at"
) VALUES (
  'default',
  true,
  10,
  'sleep',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
