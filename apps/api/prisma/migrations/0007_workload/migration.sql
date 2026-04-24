CREATE TABLE "workloads" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "image" TEXT NOT NULL,
  "node_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "desired_status" TEXT NOT NULL DEFAULT 'running',
  "requested_cpu" DOUBLE PRECISION NOT NULL,
  "requested_ram_mb" INTEGER NOT NULL,
  "requested_disk_gb" INTEGER NOT NULL,
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "container_id" TEXT,
  "last_heartbeat_at" TIMESTAMP(3),
  "last_exit_code" INTEGER,
  "restart_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "workloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workload_ports" (
  "id" TEXT NOT NULL,
  "workload_id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "internal_port" INTEGER NOT NULL,
  "external_port" INTEGER NOT NULL,
  "protocol" TEXT NOT NULL DEFAULT 'tcp',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workload_ports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workload_status_events" (
  "id" TEXT NOT NULL,
  "workload_id" TEXT NOT NULL,
  "previous_status" TEXT,
  "new_status" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workload_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workloads_node_id_idx" ON "workloads"("node_id");
CREATE INDEX "workloads_status_idx" ON "workloads"("status");
CREATE INDEX "workloads_type_idx" ON "workloads"("type");
CREATE INDEX "workloads_deleted_at_idx" ON "workloads"("deleted_at");

CREATE UNIQUE INDEX "workload_ports_node_id_external_port_protocol_key"
  ON "workload_ports"("node_id", "external_port", "protocol");
CREATE INDEX "workload_ports_workload_id_idx" ON "workload_ports"("workload_id");

CREATE INDEX "workload_status_events_workload_id_idx" ON "workload_status_events"("workload_id");
CREATE INDEX "workload_status_events_created_at_idx" ON "workload_status_events"("created_at");

ALTER TABLE "workloads"
  ADD CONSTRAINT "workloads_node_id_fkey"
  FOREIGN KEY ("node_id") REFERENCES "nodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workload_ports"
  ADD CONSTRAINT "workload_ports_workload_id_fkey"
  FOREIGN KEY ("workload_id") REFERENCES "workloads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workload_status_events"
  ADD CONSTRAINT "workload_status_events_workload_id_fkey"
  FOREIGN KEY ("workload_id") REFERENCES "workloads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
