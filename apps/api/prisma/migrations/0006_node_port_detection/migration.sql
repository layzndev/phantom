ALTER TABLE "nodes" ALTER COLUMN "port_range_start" DROP NOT NULL;
ALTER TABLE "nodes" ALTER COLUMN "port_range_end" DROP NOT NULL;
ALTER TABLE "nodes" ADD COLUMN "open_ports" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "nodes" ADD COLUMN "suggested_port_ranges" JSONB;
