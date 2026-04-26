import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/appError.js";
import { env } from "../../config/env.js";
import { createAuditLog } from "../audit/audit.repository.js";
import {
  findMinecraftServerRecordByWorkloadId,
  updateMinecraftServerRecord
} from "../../db/minecraftRepository.js";
import { minecraftConsoleGateway } from "../minecraft/minecraft.console.gateway.js";
import { findNodeFromRegistry } from "../nodes/nodes.repository.js";
import { authenticateRuntimeNode } from "../nodes/nodes.service.js";
import type {
  CompanyWorkload,
  CreateWorkloadResult,
  DeleteWorkloadResult,
  WorkloadDesiredStatus,
  WorkloadPort,
  WorkloadPortProtocol,
  WorkloadStatus,
  WorkloadStatusEvent,
  WorkloadType
} from "./workloads.types.js";
import {
  createWorkloadInRegistry,
  emitWorkloadStatusEvent,
  finalizeWorkloadDeletionInRegistry,
  findAssignedWorkloadFromRegistry,
  findWorkloadFromRegistry,
  listAssignedRuntimeWorkloadsFromRegistry,
  listWorkloadsFromRegistry,
  markWorkloadDeletingInRegistry,
  setWorkloadDesiredStatusInRegistry,
  updateWorkloadRuntimeInRegistry,
  updateWorkloadInRegistry
} from "./workloads.repository.js";
import type {
  CreateWorkloadInput,
  WorkloadDeleteQuery,
  WorkloadRuntimeAckActionInput,
  WorkloadRuntimeAckDeleteInput,
  WorkloadRuntimeEventInput,
  WorkloadRuntimeHeartbeatInput,
  UpdateWorkloadInput,
  WorkloadListQuery
} from "./workloads.schema.js";
import { placeWorkload } from "./workloads.scheduler.js";

type WorkloadRecord = NonNullable<Awaited<ReturnType<typeof findWorkloadFromRegistry>>>;

export async function listWorkloads(query: WorkloadListQuery) {
  const records = await listWorkloadsFromRegistry({
    nodeId: query.nodeId,
    status: query.status,
    type: query.type
  });
  return records.map(toCompanyWorkload);
}

export async function getWorkload(id: string) {
  const record = await findWorkloadFromRegistry(id);
  if (!record) {
    throw new AppError(404, "Workload not found.", "WORKLOAD_NOT_FOUND");
  }
  return toCompanyWorkload(record);
}

export async function createWorkload(input: CreateWorkloadInput): Promise<CreateWorkloadResult> {
  const configJson = (input.config ?? {}) as Prisma.InputJsonValue;
  const ports = input.ports ?? [];

  const placement = await placeWorkload({
    name: input.name,
    type: input.type,
    image: input.image,
    requestedCpu: input.requestedCpu,
    requestedRamMb: input.requestedRamMb,
    requestedDiskGb: input.requestedDiskGb,
    requiredPool: input.requiredPool,
    ports,
    config: configJson
  });

  if (placement.placed) {
    const record = await findWorkloadFromRegistry(placement.workloadId);
    if (!record) {
      throw new AppError(500, "Workload disappeared after placement.", "WORKLOAD_MISSING");
    }
    return {
      workload: toCompanyWorkload(record),
      placed: true,
      diagnostics: placement.diagnostics
    };
  }

  const record = await createWorkloadInRegistry({
    name: input.name,
    type: input.type,
    image: input.image,
    nodeId: null,
    status: "pending",
    requestedCpu: input.requestedCpu,
    requestedRamMb: input.requestedRamMb,
    requestedDiskGb: input.requestedDiskGb,
    config: configJson,
    ports: []
  });

  return {
    workload: toCompanyWorkload(record),
    placed: false,
    reason: placement.reason,
    diagnostics: placement.diagnostics
  };
}

export async function updateWorkload(id: string, input: UpdateWorkloadInput) {
  const existing = await findWorkloadFromRegistry(id);
  if (!existing) {
    throw new AppError(404, "Workload not found.", "WORKLOAD_NOT_FOUND");
  }

  const updated = await updateWorkloadInRegistry(id, {
    name: input.name,
    config:
      input.config !== undefined ? ((input.config ?? {}) as Prisma.InputJsonValue) : undefined
  });

  return toCompanyWorkload(updated);
}

export async function startWorkload(id: string) {
  return transitionDesired(id, "running", "start requested");
}

export async function stopWorkload(id: string) {
  return transitionDesired(id, "stopped", "stop requested");
}

export async function restartWorkload(id: string) {
  const existing = await ensureWorkload(id);
  if (existing.deletedAt !== null || existing.status === "deleting") {
    throw new AppError(409, "Workload is being deleted.", "WORKLOAD_DELETING");
  }
  const queueDecision = await shouldQueueFreeWorkloadStart(existing);
  if (queueDecision.shouldQueue) {
    const updated = await updateWorkloadRuntimeInRegistry(id, {
      status: "queued_start",
      desiredStatus: "running"
    });
    await emitWorkloadStatusEvent({
      workloadId: id,
      previousStatus: existing.status,
      newStatus: "queued_start",
      reason: `[restart] ${queueDecision.reason}`
    });
    return toCompanyWorkload(updated);
  }
  await emitWorkloadStatusEvent({
    workloadId: id,
    previousStatus: existing.status,
    newStatus: existing.status,
    reason: "restart requested"
  });
  const updated = await setWorkloadDesiredStatusInRegistry(id, "running", "restart requested");
  return toCompanyWorkload(updated);
}

export async function killWorkload(id: string) {
  const existing = await ensureWorkload(id);
  if (existing.deletedAt !== null || existing.status === "deleting") {
    throw new AppError(409, "Workload is being deleted.", "WORKLOAD_DELETING");
  }
  await emitWorkloadStatusEvent({
    workloadId: id,
    previousStatus: existing.status,
    newStatus: existing.status,
    reason: "kill requested (forced)"
  });
  const updated = await setWorkloadDesiredStatusInRegistry(id, "stopped", "kill requested");
  return toCompanyWorkload(updated);
}

export async function requestWorkloadDeletion(
  id: string,
  options: WorkloadDeleteQuery
): Promise<DeleteWorkloadResult> {
  const existing = await ensureWorkload(id);
  if (existing.deletedAt !== null || existing.status === "deleted") {
    throw new AppError(404, "Workload not found.", "WORKLOAD_NOT_FOUND");
  }

  if (existing.status === "deleting") {
    return {
      workload: toCompanyWorkload(existing),
      finalized: false
    };
  }

  if (existing.nodeId === null) {
    await finalizeWorkloadDeletionInRegistry(existing.id, {
      mode: "hard",
      reason: "[delete] completed immediately for unassigned workload"
    });
    return {
      workload: null,
      finalized: true
    };
  }

  const deleting = await markWorkloadDeletingInRegistry(existing.id, {
    hardDeleteData: options.hardDeleteData,
    reason: options.hardDeleteData
      ? "[delete] requested (hardDeleteData=true)"
      : "[delete] requested"
  });

  return {
    workload: toCompanyWorkload(deleting),
    finalized: false
  };
}

export async function listAssignedRuntimeWorkloads(rawToken: string) {
  const node = await authenticateRuntimeNode(rawToken);
  const records = await listAssignedRuntimeWorkloadsFromRegistry(node.id);

  return {
    nodeId: node.id,
    workloads: records.map((record) => ({
      id: record.id,
      name: record.name,
      type: record.type as WorkloadType,
      image: record.image,
      nodeId: record.nodeId,
      status: record.status as WorkloadStatus,
      desiredStatus: record.desiredStatus as WorkloadDesiredStatus,
      requestedCpu: record.requestedCpu,
      requestedRamMb: record.requestedRamMb,
      requestedDiskGb: record.requestedDiskGb,
      config: (record.config as Record<string, unknown>) ?? {},
      containerId: record.containerId,
      lastHeartbeatAt: record.lastHeartbeatAt?.toISOString() ?? null,
      lastExitCode: record.lastExitCode,
      restartCount: record.restartCount,
      deleteHardData: record.deleteHardData,
      ports: record.ports.map((port) => ({
        internalPort: port.internalPort,
        externalPort: port.externalPort,
        protocol: (port.protocol === "udp" ? "udp" : "tcp") as WorkloadPortProtocol
      }))
    }))
  };
}

export async function acceptWorkloadHeartbeat(
  workloadId: string,
  rawToken: string,
  payload: WorkloadRuntimeHeartbeatInput
) {
  const workload = await ensureAssignedRuntimeWorkload(workloadId, rawToken, {
    allowDeleting: true
  });
  const previousStatus = workload.status as WorkloadStatus;
  const nextRuntimeStatus: WorkloadStatus =
    workload.status === "deleting" ? "deleting" : payload.status;

  const updated = await updateWorkloadRuntimeInRegistry(workload.id, {
    status: nextRuntimeStatus,
    containerId: payload.containerId,
    runtimeStartedAt: payload.startedAt ? new Date(payload.startedAt) : undefined,
    runtimeFinishedAt: payload.finishedAt === undefined
      ? undefined
      : payload.finishedAt === null
        ? null
        : new Date(payload.finishedAt),
    runtimeCpuPercent: payload.cpuPercent ?? undefined,
    runtimeMemoryMb: payload.memoryMb === undefined ? undefined : Math.round(payload.memoryMb),
    runtimeDiskGb: payload.diskGb ?? undefined,
    lastExitCode: payload.exitCode,
    restartCount: payload.restartCount
  });

  await syncMinecraftSleepStateFromRuntimeHeartbeat(workload.id, previousStatus, nextRuntimeStatus);

  if (previousStatus !== nextRuntimeStatus) {
    await emitWorkloadStatusEvent({
      workloadId: workload.id,
      previousStatus,
      newStatus: nextRuntimeStatus,
      reason: buildRuntimeReason("heartbeat", payload.reason, {
        exitCode: payload.exitCode,
        restartCount: payload.restartCount,
        cpuPercent: payload.cpuPercent,
        memoryMb: payload.memoryMb,
        startedAt: payload.startedAt,
        finishedAt: payload.finishedAt
      })
    });
  }

  return {
    ok: true,
    nodeId: workload.nodeId,
    workloadId: updated.id,
    status: updated.status,
    receivedAt: new Date().toISOString()
  };
}

export async function appendRuntimeWorkloadEvent(
  workloadId: string,
  rawToken: string,
  payload: WorkloadRuntimeEventInput
) {
  const workload = await ensureAssignedRuntimeWorkload(workloadId, rawToken, {
    allowDeleting: true
  });
  const nextStatus =
    workload.status === "deleting"
      ? "deleting"
      : (payload.status ?? mapRuntimeEventTypeToStatus(payload.type));

  await emitWorkloadStatusEvent({
    workloadId: workload.id,
    previousStatus: workload.status,
    newStatus: nextStatus,
    reason: buildRuntimeReason("event", payload.reason ?? payload.type, {
      type: payload.type
    })
  });

  return {
    ok: true,
    nodeId: workload.nodeId,
    workloadId: workload.id,
    receivedAt: new Date().toISOString()
  };
}

export async function ackRuntimeWorkloadAction(
  workloadId: string,
  rawToken: string,
  payload: WorkloadRuntimeAckActionInput
) {
  const workload = await ensureAssignedRuntimeWorkload(workloadId, rawToken, {
    allowDeleting: true
  });
  const normalizedDesiredStatus =
    payload.handledDesiredStatus === "restart" ? "running" : "stopped";

  const updated = await updateWorkloadRuntimeInRegistry(workload.id, {
    desiredStatus: normalizedDesiredStatus,
    status: payload.status,
    containerId: payload.containerId
  });

  const nextStatus = payload.status ?? workload.status;
  await emitWorkloadStatusEvent({
    workloadId: workload.id,
    previousStatus: workload.status,
    newStatus: nextStatus,
    reason: buildRuntimeReason(
      "ack",
      payload.reason ?? `${payload.handledDesiredStatus} acknowledged`,
      { desiredStatus: normalizedDesiredStatus }
    )
  });

  return {
    ok: true,
    nodeId: workload.nodeId,
    workloadId: updated.id,
    desiredStatus: updated.desiredStatus,
    status: updated.status,
    receivedAt: new Date().toISOString()
  };
}

export async function ackRuntimeWorkloadDelete(
  workloadId: string,
  rawToken: string,
  payload: WorkloadRuntimeAckDeleteInput
) {
  const workload = await ensureAssignedRuntimeWorkload(workloadId, rawToken, {
    allowDeleting: true
  });

  if (workload.status !== "deleting") {
    throw new AppError(409, "Workload is not deleting.", "WORKLOAD_NOT_DELETING");
  }

  await updateWorkloadRuntimeInRegistry(workload.id, {
    status: "deleting",
    desiredStatus: "stopped",
    containerId: payload.containerId ?? null,
    deleteRuntimeAckAt: new Date()
  });

  await finalizeWorkloadDeletionInRegistry(workload.id, {
    mode: "hard",
    reason: buildRuntimeReason("ack-delete", payload.reason ?? "[delete] completed", {
      removedRuntime: payload.removedRuntime,
      removedData: payload.removedData
    })
  });

  return {
    ok: true,
    nodeId: workload.nodeId,
    workloadId,
    deleted: true,
    receivedAt: new Date().toISOString()
  };
}

async function transitionDesired(
  id: string,
  desired: WorkloadDesiredStatus,
  reason: string
): Promise<CompanyWorkload> {
  const existing = await ensureWorkload(id);
  if (existing.deletedAt !== null || existing.status === "deleting") {
    throw new AppError(409, "Workload is being deleted.", "WORKLOAD_DELETING");
  }
  if (existing.desiredStatus === desired) {
    return toCompanyWorkload(existing);
  }

  if (desired === "running") {
    const queueDecision = await shouldQueueFreeWorkloadStart(existing);
    if (queueDecision.shouldQueue) {
      const updated = await updateWorkloadRuntimeInRegistry(id, {
        status: "queued_start",
        desiredStatus: "running"
      });
      await emitWorkloadStatusEvent({
        workloadId: id,
        previousStatus: existing.status,
        newStatus: "queued_start",
        reason: queueDecision.reason
      });
      return toCompanyWorkload(updated);
    }
  }

  const updated = await setWorkloadDesiredStatusInRegistry(id, desired, reason);
  return toCompanyWorkload(updated);
}

async function ensureWorkload(id: string) {
  const record = await findWorkloadFromRegistry(id);
  if (!record) {
    throw new AppError(404, "Workload not found.", "WORKLOAD_NOT_FOUND");
  }
  return record;
}

async function ensureAssignedRuntimeWorkload(
  workloadId: string,
  rawToken: string,
  options: { allowDeleting?: boolean } = {}
) {
  const node = await authenticateRuntimeNode(rawToken);
  const workload = await findAssignedWorkloadFromRegistry(node.id, workloadId);

  if (
    !workload ||
    workload.status === "deleted" ||
    (!options.allowDeleting && workload.status === "deleting")
  ) {
    throw new AppError(404, "Workload not found.", "WORKLOAD_NOT_FOUND");
  }

  return workload;
}

function buildRuntimeReason(
  prefix: "heartbeat" | "event" | "ack" | "ack-delete",
  reason?: string,
  details: Record<string, unknown> = {}
) {
  const detailParts = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value === null ? "null" : String(value)}`);

  const parts = [prefix, reason, detailParts.length > 0 ? detailParts.join(" ") : undefined].filter(
    (value): value is string => Boolean(value)
  );

  return parts.join(": ").slice(0, 500);
}

function mapRuntimeEventTypeToStatus(type: WorkloadRuntimeEventInput["type"]): WorkloadStatus {
  switch (type) {
    case "pulled":
    case "created":
      return "creating";
    case "started":
      return "running";
    case "stopped":
    case "killed":
      return "stopped";
    case "crashed":
      return "crashed";
  }
}

function toCompanyWorkload(record: WorkloadRecord): CompanyWorkload {
  return {
    id: record.id,
    name: record.name,
    type: record.type as WorkloadType,
    image: record.image,
    nodeId: record.nodeId,
    status: record.status as WorkloadStatus,
    desiredStatus: record.desiredStatus as WorkloadDesiredStatus,
    requestedCpu: record.requestedCpu,
    requestedRamMb: record.requestedRamMb,
    requestedDiskGb: record.requestedDiskGb,
    config: (record.config as Record<string, unknown>) ?? {},
    containerId: record.containerId,
    lastHeartbeatAt: record.lastHeartbeatAt?.toISOString() ?? null,
    runtimeStartedAt: record.runtimeStartedAt?.toISOString() ?? null,
    runtimeFinishedAt: record.runtimeFinishedAt?.toISOString() ?? null,
    runtimeCpuPercent: record.runtimeCpuPercent ?? null,
    runtimeMemoryMb: record.runtimeMemoryMb ?? null,
    runtimeDiskGb: record.runtimeDiskGb ?? null,
    lastExitCode: record.lastExitCode,
    restartCount: record.restartCount,
    deleteRequestedAt: record.deleteRequestedAt?.toISOString() ?? null,
    deleteRuntimeAckAt: record.deleteRuntimeAckAt?.toISOString() ?? null,
    deleteHardData: record.deleteHardData,
    ports: record.ports.map<WorkloadPort>((port) => ({
      id: port.id,
      internalPort: port.internalPort,
      externalPort: port.externalPort,
      protocol: (port.protocol === "udp" ? "udp" : "tcp") as WorkloadPortProtocol
    })),
    statusEvents: record.statusEvents.map<WorkloadStatusEvent>((event) => ({
      id: event.id,
      workloadId: event.workloadId,
      previousStatus: event.previousStatus as WorkloadStatus | null,
      newStatus: event.newStatus as WorkloadStatus,
      reason: event.reason,
      createdAt: event.createdAt.toISOString()
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null
  };
}

async function syncMinecraftSleepStateFromRuntimeHeartbeat(
  workloadId: string,
  previousStatus: WorkloadStatus,
  nextStatus: WorkloadStatus
) {
  const server = await findMinecraftServerRecordByWorkloadId(workloadId);
  if (!server || server.deletedAt !== null) {
    return;
  }

  if (nextStatus === "running") {
    if (server.sleepingAt !== null) {
      await updateMinecraftServerRecord(server.id, {
        sleepingAt: null
      });
    }
    return;
  }

  if (nextStatus === "stopped" && server.sleepRequestedAt !== null) {
    const confirmedAt = new Date();
    await updateMinecraftServerRecord(server.id, {
      sleepRequestedAt: null,
      sleepingAt: null,
      wakeRequestedAt: null,
      readyAt: null,
      currentPlayerCount: 0
    });
    if (previousStatus !== "stopped") {
      minecraftConsoleGateway.publishLogs(server.id, ["__PHANTOM__ Server marked as stopped"]);
      minecraftConsoleGateway.publishStatus(server.id, "stopped");
    }
    await createAuditLog({
      action: "minecraft.server.autosleep",
      actorEmail: "system",
      targetType: "system",
      targetId: server.id,
      metadata: {
        phase: "stopped_confirmed",
        workloadId,
        confirmedAt: confirmedAt.toISOString(),
        autoSleepAction: server.autoSleepAction
      }
    });
    return;
  }

  if (nextStatus === "crashed" && server.sleepRequestedAt !== null) {
    await updateMinecraftServerRecord(server.id, {
      sleepRequestedAt: null,
      readyAt: null,
      wakeRequestedAt: null
    });
    return;
  }

  if (nextStatus === "stopped") {
    await updateMinecraftServerRecord(server.id, {
      readyAt: null,
      wakeRequestedAt: null
    });
    minecraftConsoleGateway.publishStatus(server.id, "stopped");
    return;
  }

  if (nextStatus === "crashed") {
    await updateMinecraftServerRecord(server.id, {
      readyAt: null,
      wakeRequestedAt: null
    });
    minecraftConsoleGateway.publishStatus(server.id, "crashed");
    return;
  }

  if (nextStatus === "creating") {
    minecraftConsoleGateway.publishStatus(server.id, "starting");
  }
}

async function shouldQueueFreeWorkloadStart(workload: WorkloadRecord) {
  if (!workload.nodeId) {
    return { shouldQueue: false as const };
  }

  const node = await findNodeFromRegistry(workload.nodeId);
  if (!node || node.pool !== "free") {
    return { shouldQueue: false as const };
  }

  const cpuPercent =
    node.totalCpu && node.totalCpu > 0 ? ((node.usedCpu ?? 0) / node.totalCpu) * 100 : 100;
  const ramPercent =
    node.totalRamMb && node.totalRamMb > 0
      ? ((node.usedRamMb ?? 0) / node.totalRamMb) * 100
      : 100;

  if (cpuPercent < env.freeTierMaxCpuPercent && ramPercent < env.freeTierMaxRamPercent) {
    return { shouldQueue: false as const };
  }

  return {
    shouldQueue: true as const,
    reason: `[queued-start] live usage too high on node ${node.id} (cpu=${cpuPercent.toFixed(
      1
    )}% ram=${ramPercent.toFixed(1)}% thresholds cpu<${env.freeTierMaxCpuPercent}% ram<${env.freeTierMaxRamPercent}%)`
  };
}
