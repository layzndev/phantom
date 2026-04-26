CREATE TABLE "incidents" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "scope" TEXT NOT NULL,
  "source_type" TEXT,
  "source_id" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by_id" TEXT,
  "assigned_to_id" TEXT,
  "resolution_type" TEXT,
  "root_cause" TEXT,
  "internal_notes" TEXT,
  "metadata" JSONB,
  "node_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "incident_events" (
  "id" TEXT NOT NULL,
  "incident_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "incidents_dedupe_key_idx" ON "incidents"("dedupe_key");
CREATE INDEX "incidents_status_idx" ON "incidents"("status");
CREATE INDEX "incidents_severity_idx" ON "incidents"("severity");
CREATE INDEX "incidents_scope_idx" ON "incidents"("scope");
CREATE INDEX "incidents_source_type_source_id_idx" ON "incidents"("source_type", "source_id");
CREATE INDEX "incidents_node_id_idx" ON "incidents"("node_id");
CREATE INDEX "incidents_created_at_idx" ON "incidents"("created_at");
CREATE INDEX "incident_events_incident_id_idx" ON "incident_events"("incident_id");
CREATE INDEX "incident_events_created_at_idx" ON "incident_events"("created_at");

ALTER TABLE "incidents"
ADD CONSTRAINT "incidents_acknowledged_by_id_fkey"
FOREIGN KEY ("acknowledged_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incidents"
ADD CONSTRAINT "incidents_assigned_to_id_fkey"
FOREIGN KEY ("assigned_to_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incidents"
ADD CONSTRAINT "incidents_node_id_fkey"
FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incident_events"
ADD CONSTRAINT "incident_events_incident_id_fkey"
FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incident_events"
ADD CONSTRAINT "incident_events_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
