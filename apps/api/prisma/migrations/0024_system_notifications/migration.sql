CREATE TABLE "system_notifications" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "node_id" TEXT,
  "metadata" JSONB,
  "read_at" TIMESTAMP(3),
  "read_by_admin_id" TEXT,
  "dismissed_at" TIMESTAMP(3),
  "dismissed_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_notifications_created_at_idx" ON "system_notifications"("created_at");
CREATE INDEX "system_notifications_severity_idx" ON "system_notifications"("severity");
CREATE INDEX "system_notifications_kind_idx" ON "system_notifications"("kind");
CREATE INDEX "system_notifications_read_at_idx" ON "system_notifications"("read_at");
CREATE INDEX "system_notifications_dismissed_at_idx" ON "system_notifications"("dismissed_at");
CREATE INDEX "system_notifications_node_id_idx" ON "system_notifications"("node_id");

ALTER TABLE "system_notifications"
ADD CONSTRAINT "system_notifications_node_id_fkey"
FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "system_notifications"
ADD CONSTRAINT "system_notifications_read_by_admin_id_fkey"
FOREIGN KEY ("read_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "system_notifications"
ADD CONSTRAINT "system_notifications_dismissed_by_admin_id_fkey"
FOREIGN KEY ("dismissed_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
