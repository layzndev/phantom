ALTER TABLE "workloads"
  ADD COLUMN "runtime_cpu_percent" DOUBLE PRECISION,
  ADD COLUMN "runtime_memory_mb" INTEGER,
  ADD COLUMN "runtime_disk_gb" DOUBLE PRECISION;
