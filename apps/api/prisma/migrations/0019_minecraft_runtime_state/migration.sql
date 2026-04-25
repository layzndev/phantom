ALTER TABLE "minecraft_servers"
  ADD COLUMN "wake_requested_at" TIMESTAMPTZ,
  ADD COLUMN "ready_at" TIMESTAMPTZ;
