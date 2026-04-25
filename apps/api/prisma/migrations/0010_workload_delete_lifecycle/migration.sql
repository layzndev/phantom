ALTER TABLE "workloads"
  ADD COLUMN "delete_requested_at" TIMESTAMP(3),
  ADD COLUMN "delete_runtime_ack_at" TIMESTAMP(3),
  ADD COLUMN "delete_hard_data" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "workloads_delete_requested_at_idx" ON "workloads"("delete_requested_at");
