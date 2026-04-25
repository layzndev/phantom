ALTER TABLE "nodes"
  ADD COLUMN "agent_version" TEXT,
  ADD COLUMN "runtime_version" TEXT,
  ADD COLUMN "docker_version" TEXT,
  ADD COLUMN "os_platform" TEXT,
  ADD COLUMN "os_release" TEXT,
  ADD COLUMN "kernel_version" TEXT,
  ADD COLUMN "os_arch" TEXT,
  ADD COLUMN "hostname" TEXT,
  ADD COLUMN "uptime_sec" INTEGER,
  ADD COLUMN "cpu_model" TEXT,
  ADD COLUMN "cpu_cores" INTEGER,
  ADD COLUMN "total_disk_gb" INTEGER;
