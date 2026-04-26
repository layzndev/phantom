ALTER TABLE "minecraft_servers"
ADD COLUMN "auto_sleep_idle_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "auto_sleep_action" TEXT NOT NULL DEFAULT 'sleep',
ADD COLUMN "online_mode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "whitelist_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "last_player_check_failed_at" TIMESTAMP(3),
ADD COLUMN "last_player_check_error" TEXT;
