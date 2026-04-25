import { DockerRuntime } from "./docker.js";
import { Logger } from "./logger.js";
import { PhantomApiClient } from "./phantom-api.js";
import type { AgentConfig, DockerContainerSummary } from "./types.js";

const PHANTOM_CONTAINER_NAME_PATTERN = /^phantom-[a-z0-9-]+-[0-9a-f]{12}$/;

export class RuntimeCleanupService {
  private readonly logger: Logger;

  constructor(
    private readonly config: AgentConfig,
    private readonly api: PhantomApiClient,
    private readonly docker: DockerRuntime,
    logger: Logger
  ) {
    this.logger = logger.child("cleanup");
  }

  async purgeOrphanedManaged() {
    const [assigned, managed] = await Promise.all([
      this.api.getAssignedWorkloads(),
      this.docker.listManagedContainers(this.config.nodeId)
    ]);

    if (assigned.nodeId !== this.config.nodeId) {
      this.logger.warn("skipping orphan purge: assigned node mismatch", {
        expected: this.config.nodeId,
        received: assigned.nodeId
      });
      return;
    }

    const assignedIds = new Set(assigned.workloads.map((workload) => workload.id));
    let removed = 0;

    for (const container of managed) {
      const workloadId = container.labels["phantom.workload.id"];
      const isOrphan = !workloadId || !assignedIds.has(workloadId);
      if (!isOrphan) continue;

      const ok = await this.removeContainer(
        container,
        workloadId
          ? `workload ${workloadId} no longer assigned to this node`
          : "managed container missing workload label"
      );
      if (ok) removed += 1;
    }

    if (removed > 0) {
      this.logger.info("orphan cleanup completed", {
        removed,
        scanned: managed.length
      });
    }
  }

  async runFullGarbageCollection() {
    const [assigned, named] = await Promise.all([
      this.api.getAssignedWorkloads(),
      this.docker.listPhantomNamedContainers()
    ]);

    if (assigned.nodeId !== this.config.nodeId) {
      this.logger.warn("skipping full gc: assigned node mismatch", {
        expected: this.config.nodeId,
        received: assigned.nodeId
      });
      return;
    }

    const assignedIds = new Set(assigned.workloads.map((workload) => workload.id));
    let removed = 0;

    for (const container of named) {
      const labels = container.labels;
      const managed = labels["phantom.managed"] === "true";
      const containerNodeId = labels["phantom.node.id"];
      const workloadId = labels["phantom.workload.id"];

      if (managed && containerNodeId && containerNodeId !== this.config.nodeId) {
        continue;
      }

      const matchesNamePattern = PHANTOM_CONTAINER_NAME_PATTERN.test(container.name);
      if (!managed && !matchesNamePattern) {
        this.logger.debug("skipping foreign phantom-prefixed container", {
          containerId: container.id,
          name: container.name
        });
        continue;
      }

      if (workloadId && assignedIds.has(workloadId)) {
        continue;
      }

      const reason = !managed
        ? "phantom-named container missing managed label"
        : workloadId
          ? `workload ${workloadId} not present in DB`
          : "managed container without workload label";

      const ok = await this.removeContainer(container, reason);
      if (ok) removed += 1;
    }

    this.logger.info("full garbage collection completed", {
      removed,
      scanned: named.length
    });
  }

  async removeStaleContainersForWorkload(workloadId: string) {
    const ids = await this.docker.listManagedContainerIdsByWorkload(
      workloadId,
      this.config.nodeId
    );
    if (ids.length === 0) return 0;

    let removed = 0;
    for (const containerId of ids) {
      try {
        const ok = await this.docker.stopAndRemoveContainer(containerId);
        if (ok) {
          removed += 1;
          this.logger.info("removed stale container before recreate", {
            containerId,
            workloadId
          });
        }
      } catch (error) {
        this.logger.warn("failed to remove stale container before recreate", {
          containerId,
          workloadId,
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }
    return removed;
  }

  private async removeContainer(container: DockerContainerSummary, reason: string) {
    try {
      const ok = await this.docker.stopAndRemoveContainer(container.id);
      if (ok) {
        this.logger.info("cleanup removed container", {
          containerId: container.id,
          name: container.name,
          workloadId: container.labels["phantom.workload.id"] ?? null,
          running: container.running,
          reason
        });
      }
      return ok;
    } catch (error) {
      this.logger.error("cleanup failed to remove container", {
        containerId: container.id,
        name: container.name,
        reason,
        error: error instanceof Error ? error.message : "unknown"
      });
      return false;
    }
  }
}
