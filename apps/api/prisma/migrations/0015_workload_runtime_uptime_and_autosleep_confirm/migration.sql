ALTER TABLE "workloads"
  ADD COLUMN "runtime_started_at" TIMESTAMPTZ,
  ADD COLUMN "runtime_finished_at" TIMESTAMPTZ;

ALTER TABLE "minecraft_servers"
  ADD COLUMN "sleep_requested_at" TIMESTAMPTZ;
