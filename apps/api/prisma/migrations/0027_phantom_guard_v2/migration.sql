CREATE TABLE "connection_events" (
  "id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "server_id" TEXT,
  "node_id" TEXT,
  "hostname" TEXT,
  "source_ip" TEXT,
  "source_ip_hash" TEXT NOT NULL,
  "country_code" TEXT,
  "region" TEXT,
  "city" TEXT,
  "asn" TEXT,
  "isp" TEXT,
  "username_attempted" TEXT,
  "normalized_username" TEXT,
  "online_mode" BOOLEAN,
  "protocol_version" INTEGER,
  "client_brand" TEXT,
  "action" TEXT NOT NULL,
  "disconnect_reason" TEXT,
  "latency_ms" INTEGER,
  "session_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "connection_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_profiles" (
  "normalized_username" TEXT NOT NULL,
  "display_username" TEXT,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total_connections" INTEGER NOT NULL DEFAULT 0,
  "total_servers_visited" INTEGER NOT NULL DEFAULT 0,
  "total_play_sessions" INTEGER NOT NULL DEFAULT 0,
  "risk_score" INTEGER NOT NULL DEFAULT 0,
  "trusted" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("normalized_username")
);

CREATE TABLE "player_server_relations" (
  "id" TEXT NOT NULL,
  "normalized_username" TEXT NOT NULL,
  "server_id" TEXT NOT NULL,
  "joins" INTEGER NOT NULL DEFAULT 0,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total_play_minutes" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "player_server_relations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guard_ip_profiles" (
  "source_ip_hash" TEXT NOT NULL,
  "source_ip" TEXT,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total_connections" INTEGER NOT NULL DEFAULT 0,
  "total_servers_targeted" INTEGER NOT NULL DEFAULT 0,
  "total_usernames" INTEGER NOT NULL DEFAULT 0,
  "risk_score" INTEGER NOT NULL DEFAULT 0,
  "trusted" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  CONSTRAINT "guard_ip_profiles_pkey" PRIMARY KEY ("source_ip_hash")
);

CREATE TABLE "guard_rules" (
  "id" TEXT NOT NULL,
  "target_scope" TEXT NOT NULL,
  "target_value" TEXT,
  "target_hash" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "note" TEXT,
  "rate_limit_per_minute" INTEGER,
  "delay_ms" INTEGER,
  "expires_at" TIMESTAMP(3),
  "created_by_admin_id" TEXT,
  "created_by_email" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guard_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guard_settings" (
  "id" TEXT NOT NULL,
  "raw_ip_retention_days" INTEGER NOT NULL DEFAULT 30,
  "aggregate_retention_days" INTEGER NOT NULL DEFAULT 365,
  "hash_ips_after_retention" BOOLEAN NOT NULL DEFAULT true,
  "privacy_mode" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guard_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "guard_settings" (
  "id",
  "raw_ip_retention_days",
  "aggregate_retention_days",
  "hash_ips_after_retention",
  "privacy_mode",
  "created_at",
  "updated_at"
) VALUES (
  'default',
  30,
  365,
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

CREATE INDEX "connection_events_created_at_idx" ON "connection_events"("created_at");
CREATE INDEX "connection_events_server_id_created_at_idx" ON "connection_events"("server_id", "created_at");
CREATE INDEX "connection_events_node_id_created_at_idx" ON "connection_events"("node_id", "created_at");
CREATE INDEX "connection_events_source_ip_hash_created_at_idx" ON "connection_events"("source_ip_hash", "created_at");
CREATE INDEX "connection_events_country_code_created_at_idx" ON "connection_events"("country_code", "created_at");
CREATE INDEX "connection_events_normalized_username_created_at_idx" ON "connection_events"("normalized_username", "created_at");
CREATE INDEX "connection_events_action_created_at_idx" ON "connection_events"("action", "created_at");
CREATE INDEX "connection_events_session_id_idx" ON "connection_events"("session_id");
CREATE INDEX "player_profiles_last_seen_at_idx" ON "player_profiles"("last_seen_at");
CREATE INDEX "player_profiles_risk_score_idx" ON "player_profiles"("risk_score");
CREATE UNIQUE INDEX "player_server_relations_normalized_username_server_id_key" ON "player_server_relations"("normalized_username", "server_id");
CREATE INDEX "player_server_relations_server_id_idx" ON "player_server_relations"("server_id");
CREATE INDEX "player_server_relations_last_seen_at_idx" ON "player_server_relations"("last_seen_at");
CREATE INDEX "guard_ip_profiles_last_seen_at_idx" ON "guard_ip_profiles"("last_seen_at");
CREATE INDEX "guard_ip_profiles_risk_score_idx" ON "guard_ip_profiles"("risk_score");
CREATE INDEX "guard_rules_target_scope_target_value_idx" ON "guard_rules"("target_scope", "target_value");
CREATE INDEX "guard_rules_target_scope_target_hash_idx" ON "guard_rules"("target_scope", "target_hash");
CREATE INDEX "guard_rules_action_idx" ON "guard_rules"("action");
CREATE INDEX "guard_rules_expires_at_idx" ON "guard_rules"("expires_at");

ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "minecraft_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "player_server_relations" ADD CONSTRAINT "player_server_relations_normalized_username_fkey" FOREIGN KEY ("normalized_username") REFERENCES "player_profiles"("normalized_username") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_server_relations" ADD CONSTRAINT "player_server_relations_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "minecraft_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
