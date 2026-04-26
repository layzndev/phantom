import { DockerRuntime } from "./docker.js";
import { Logger } from "./logger.js";
import { PhantomApiClient } from "./phantom-api.js";
import type {
  AgentConfig,
  AssignedWorkload,
  DockerContainerSummary,
  WorkloadEventType,
  WorkloadHeartbeatPayload,
  WorkloadRuntimeStatus
} from "./types.js";

export class WorkloadReconciler {
  private readonly logger: Logger;
  private readonly lastHeartbeatAt = new Map<string, number>();
  private readonly lastCrashFingerprint = new Map<string, string>();

  constructor(
    private readonly config: AgentConfig,
    private readonly api: PhantomApiClient,
    private readonly docker: DockerRuntime,
    logger: Logger
  ) {
    this.logger = logger.child("reconciler");
  }

  async reconcileOnce() {
    const assigned = await this.api.getAssignedWorkloads();
    if (assigned.nodeId !== this.config.nodeId) {
      throw new Error(
        `Assigned workloads returned nodeId=${assigned.nodeId}, expected ${this.config.nodeId}`
      );
    }

    const managedContainers = await this.docker.listManagedContainers(this.config.nodeId);
    const containerByWorkloadId = groupByWorkloadId(managedContainers);
    const seenWorkloadIds = new Set<string>();

    for (const workload of assigned.workloads) {
      seenWorkloadIds.add(workload.id);
      const containers = containerByWorkloadId.get(workload.id) ?? [];

      if (containers.length > 1) {
        this.logger.warn("multiple managed containers detected for workload", {
          workloadId: workload.id,
          containerIds: containers.map((container) => container.id)
        });
      }

      await this.reconcileWorkload(workload, containers);
    }

    for (const workloadId of this.lastHeartbeatAt.keys()) {
      if (!seenWorkloadIds.has(workloadId)) {
        this.lastHeartbeatAt.delete(workloadId);
        this.lastCrashFingerprint.delete(workloadId);
      }
    }
  }

  private async reconcileWorkload(
    workload: AssignedWorkload,
    containers: DockerContainerSummary[]
  ) {
    const container = containers[0] ?? null;

    if (container && !this.docker.isManagedContainer(container, this.config.nodeId, workload.id)) {
      this.logger.warn("refusing to act on unmanaged container", {
        workloadId: workload.id,
        containerId: container.id
      });
      return;
    }

    if (workload.status === "deleting") {
      await this.ensureDeleted(workload, containers);
      return;
    }

    if (workload.status === "queued_start") {
      await this.ensureStopped(workload, container);
      return;
    }

    if (workload.desiredStatus === "running") {
      await this.ensureRunning(workload, container);
      return;
    }

    await this.ensureStopped(workload, container);
  }

  private async ensureDeleted(
    workload: AssignedWorkload,
    containers: DockerContainerSummary[]
  ) {
    this.logger.info("[delete] requested", {
      workloadId: workload.id,
      hardDeleteData: readHardDeleteData(workload),
      containerCount: containers.length
    });

    const timeoutSeconds = this.docker.getStopTimeoutSeconds(workload.config);
    const gracefulCommand = readGracefulStopCommand(workload);

    if (containers.length === 0) {
      this.logger.info("[delete] runtime removed", {
        workloadId: workload.id,
        containerId: null,
        reason: "no managed container present"
      });
    }

    for (const container of containers) {
      if (container.running && gracefulCommand) {
        try {
          await this.docker.execInContainer(container.id, ["rcon-cli", gracefulCommand]);
        } catch (error) {
          this.logger.warn("graceful stop command failed during delete", {
            workloadId: workload.id,
            containerId: container.id,
            error: error instanceof Error ? error.message : "unknown"
          });
        }
      }

      await this.docker.stopAndRemoveContainer(container.id, { timeoutSeconds });
      this.logger.info("[delete] runtime removed", {
        workloadId: workload.id,
        containerId: container.id
      });
    }

    let removedData = false;
    if (readHardDeleteData(workload)) {
      removedData = await this.docker.removeWorkloadData(workload.id);
      this.logger.info("[delete] data removed", {
        workloadId: workload.id,
        removedData
      });
    }

    await this.api.ackDelete(workload.id, {
      removedRuntime: true,
      removedData,
      containerId: null,
      reason: readHardDeleteData(workload)
        ? "[delete] completed after runtime and data cleanup"
        : "[delete] completed after runtime cleanup"
    });

    this.lastHeartbeatAt.delete(workload.id);
    this.lastCrashFingerprint.delete(workload.id);
    this.logger.info("[delete] completed", {
      workloadId: workload.id,
      removedData
    });
  }

  private async ensureRunning(
    workload: AssignedWorkload,
    container: DockerContainerSummary | null
  ) {
    if (!container) {
      await this.api.sendHeartbeat(workload.id, {
        status: "creating",
        reason: "pulling image before container creation"
      });
      await this.api.sendEvent(workload.id, {
        type: "pulled",
        status: "creating",
        reason: `pulling ${workload.image}`
      });
      await this.docker.pullImage(workload.image);

      const staleIds = await this.docker.listManagedContainerIdsByWorkload(
        workload.id,
        this.config.nodeId
      );
      for (const staleId of staleIds) {
        try {
          const ok = await this.docker.stopAndRemoveContainer(staleId);
          if (ok) {
            this.logger.info("removed stale container before create", {
              workloadId: workload.id,
              containerId: staleId
            });
          }
        } catch (error) {
          this.logger.warn("failed to remove stale container before create", {
            workloadId: workload.id,
            containerId: staleId,
            error: error instanceof Error ? error.message : "unknown"
          });
        }
      }

      const containerId = await this.docker.createContainer(workload, this.config.nodeId);
      await this.api.sendEvent(workload.id, {
        type: "created",
        status: "creating",
        reason: `container created ${containerId.slice(0, 12)}`
      });

      await this.docker.startContainer(containerId);
      await this.api.sendEvent(workload.id, {
        type: "started",
        status: "running",
        reason: "container started"
      });

      const inspected = await this.docker.inspectContainer(containerId);
      await this.sendHeartbeat(workload, inspected, "container created and started", true);
      return;
    }

    if (container.running) {
      await this.sendHeartbeat(workload, container, "container running");
      return;
    }

    if (!this.docker.workloadConfigMatches(container, workload)) {
      this.logger.info("recreating stopped container because runtime config changed", {
        workloadId: workload.id,
        containerId: container.id
      });
      await this.docker.stopAndRemoveContainer(container.id);
      await this.api.sendEvent(workload.id, {
        type: "stopped",
        status: "stopped",
        reason: "container removed to apply updated runtime config"
      });
      await this.ensureRunning(workload, null);
      return;
    }

    if ((container.exitCode ?? 0) !== 0) {
      const crashFingerprint = `${container.id}:${container.finishedAt ?? "none"}:${container.exitCode}`;
      if (this.lastCrashFingerprint.get(workload.id) !== crashFingerprint) {
        this.lastCrashFingerprint.set(workload.id, crashFingerprint);
        await this.api.sendEvent(workload.id, {
          type: "crashed",
          status: "crashed",
          reason: `exit code ${container.exitCode}`
        });
        await this.sendHeartbeat(workload, container, `container crashed with exit code ${container.exitCode}`, true, "crashed");
      }
    }

    await this.docker.materializeMinecraftServerProperties(workload);
    await this.docker.startContainer(container.id);
    await this.api.sendEvent(workload.id, {
      type: "started",
      status: "running",
      reason: "container restarted from existing runtime"
    });

    const inspected = await this.docker.inspectContainer(container.id);
    await this.sendHeartbeat(workload, inspected, "container started", true);
  }

  private async ensureStopped(
    workload: AssignedWorkload,
    container: DockerContainerSummary | null
  ) {
    if (!container) {
      await this.sendHeartbeat(workload, null, "no managed container present", false, "stopped");
      return;
    }

    if (container.running) {
      const timeoutSeconds = this.docker.getStopTimeoutSeconds(workload.config);
      const gracefulCommand = readGracefulStopCommand(workload);
      if (gracefulCommand) {
        try {
          await this.docker.execInContainer(container.id, ["rcon-cli", gracefulCommand]);
          this.logger.debug("graceful stop command issued", {
            workloadId: workload.id,
            command: gracefulCommand
          });
        } catch (error) {
          this.logger.warn("graceful stop command failed", {
            workloadId: workload.id,
            error: error instanceof Error ? error.message : "unknown"
          });
        }
      }
      await this.docker.stopContainer(container.id, { timeoutSeconds });
      await this.api.sendEvent(workload.id, {
        type: "stopped",
        status: "stopped",
        reason: `container stopped gracefully (timeout=${timeoutSeconds}s)`
      });
      const inspected = await this.docker.inspectContainer(container.id);
      await this.sendHeartbeat(workload, inspected, "container stopped", true, "stopped");
      return;
    }

    await this.sendHeartbeat(workload, container, "container already stopped", false, "stopped");
  }

  private async sendHeartbeat(
    workload: AssignedWorkload,
    container: DockerContainerSummary | null,
    reason: string,
    force = false,
    overrideStatus?: WorkloadRuntimeStatus
  ) {
    const now = Date.now();
    const lastSent = this.lastHeartbeatAt.get(workload.id) ?? 0;
    if (!force && now - lastSent < this.config.heartbeatIntervalMs) {
      return;
    }

    const stats =
      container && container.running
        ? {
            ...(await this.docker.getContainerStats(container.id)),
            diskGb: await this.docker.getWorkloadDiskUsageGb(workload.id)
          }
        : {};

    const payload = buildHeartbeatPayload(container, reason, stats, overrideStatus);
    await this.api.sendHeartbeat(workload.id, payload);
    this.lastHeartbeatAt.set(workload.id, now);
  }
}

function buildHeartbeatPayload(
  container: DockerContainerSummary | null,
  reason: string,
  stats: { cpuPercent?: number; memoryMb?: number; diskGb?: number },
  overrideStatus?: WorkloadRuntimeStatus
): WorkloadHeartbeatPayload {
  if (!container) {
    return {
      status: overrideStatus ?? "stopped",
      reason
    };
  }

  return {
    status: overrideStatus ?? mapContainerToRuntimeStatus(container),
    containerId: container.id,
    exitCode: container.exitCode,
    restartCount: container.restartCount,
    cpuPercent: stats.cpuPercent,
    memoryMb: stats.memoryMb,
    diskGb: stats.diskGb,
    startedAt: container.startedAt ?? undefined,
    finishedAt: container.finishedAt,
    reason
  };
}

function mapContainerToRuntimeStatus(
  container: DockerContainerSummary
): WorkloadRuntimeStatus {
  if (container.running) {
    return "running";
  }

  if (container.stateStatus === "created" || container.stateStatus === "restarting") {
    return "creating";
  }

  if ((container.exitCode ?? 0) !== 0) {
    return "crashed";
  }

  return "stopped";
}

function readGracefulStopCommand(workload: AssignedWorkload): string | null {
  const minecraft = workload.config?.minecraft;
  if (!minecraft || typeof minecraft !== "object") {
    return null;
  }
  const value = (minecraft as Record<string, unknown>).gracefulStopCommand;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readHardDeleteData(workload: AssignedWorkload) {
  return workload.deleteHardData === true;
}

function groupByWorkloadId(containers: DockerContainerSummary[]) {
  const grouped = new Map<string, DockerContainerSummary[]>();

  for (const container of containers) {
    const workloadId = container.labels["phantom.workload.id"];
    if (!workloadId) {
      continue;
    }

    const list = grouped.get(workloadId) ?? [];
    list.push(container);
    grouped.set(workloadId, list);
  }

  return grouped;
}
