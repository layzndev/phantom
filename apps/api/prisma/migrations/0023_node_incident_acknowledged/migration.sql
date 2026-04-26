ALTER TABLE "node_status_events"
ADD COLUMN "acknowledged_at" TIMESTAMP(3);

CREATE INDEX "node_status_events_acknowledged_at_idx"
ON "node_status_events"("acknowledged_at");
