ALTER TABLE "minecraft_servers"
  ADD COLUMN "auto_sleep_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "current_player_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_player_sample_at" TIMESTAMPTZ,
  ADD COLUMN "last_player_seen_at" TIMESTAMPTZ,
  ADD COLUMN "last_console_command_at" TIMESTAMPTZ,
  ADD COLUMN "last_activity_at" TIMESTAMPTZ,
  ADD COLUMN "idle_since" TIMESTAMPTZ,
  ADD COLUMN "sleeping_at" TIMESTAMPTZ;
