import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/appError.js";
import { authenticateRuntimeNode } from "../nodes/nodes.service.js";
import type {
  CompanyWorkload,
  CreateWorkloadResult,
  WorkloadDesiredStatus,
  WorkloadPort,
  WorkloadPortProtocol,
  WorkloadStatus,
  WorkloadStatusEvent,
  WorkloadType
} from "./workloads.types.js";
import {
  createWorkloadInRegistry,
  deleteWorkloadFromRegistry,
  emitWorkloadStatusEvent,
  findAssignedWorkloadFromRegistry,
  findWorkloadFromRegistry,
  listAssignedRuntimeWorkloadsFromRegistry,
  listWorkloadsFromRegistry,
  setWorkloadDesiredStatusInRegistry,
  updateWorkloadRuntimeInRegistry,
  updateWorkloadInRegistry
} from "./workloads.repository.js";
import type {
  CreateWorkloadInput,
  WorkloadRuntimeAckActionInput,
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
    ports,
    config: configJson
  });

  if (placement.placed) {
    const record = await findWorkloadFromRegistry(placement.workloadId);
    if (!record) {
      throw new AppError(500, "Workload disappeared after placement.", "WORKLOAD_MISSING");
    }
    return { workload: toCompanyWorkload(record), placed: true };
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

  return { workload: toCompanyWorkload(record), placed: false, reason: placement.reason };
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
  if (existing.deletedAt !== null) {
    throw new AppError(409, "Workload is being deleted.", "WORKLOAD_DELETING");
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
  if (existing.deletedAt !== null) {
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

export async function deleteWorkload(id: string) {
  const existing = await ensureWorkload(id);
  await deleteWorkloadFromRegistry(existing.id);
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
  const workload = await ensureAssignedRuntimeWorkload(workloadId, rawToken);

  const updated = await updateWorkloadRuntimeInRegistry(workload.id, {
    status: payload.status,
    containerId: payload.containerId,
    lastExitCode: payload.exitCode,
    restartCount: payload.restartCount
  });

  if (workload.status !== payload.status) {
    await emitWorkloadStatusEvent({
      workloadId: workload.id,
      previousStatus: workload.status,
      newStatus: payload.status,
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
  const workload = await ensureAssignedRuntimeWorkload(workloadId, rawToken);
  const nextStatus = payload.status ?? mapRuntimeEventTypeToStatus(payload.type);

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
  const workload = await ensureAssignedRuntimeWorkload(workloadId, rawToken);
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

async function transitionDesired(
  id: string,
  desired: WorkloadDesiredStatus,
  reason: string
): Promise<CompanyWorkload> {
  const existing = await ensureWorkload(id);
  if (existing.deletedAt !== null) {
    throw new AppError(409, "Workload is being deleted.", "WORKLOAD_DELETING");
  }
  if (existing.desiredStatus === desired) {
    return toCompanyWorkload(existing);
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

async function ensureAssignedRuntimeWorkload(workloadId: string, rawToken: string) {
  const node = await authenticateRuntimeNode(rawToken);
  const workload = await findAssignedWorkloadFromRegistry(node.id, workloadId);

  if (!workload || workload.status === "deleted" || workload.status === "deleting") {
    throw new AppError(404, "Workload not found.", "WORKLOAD_NOT_FOUND");
  }

  return workload;
}

function buildRuntimeReason(
  prefix: "heartbeat" | "event" | "ack",
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
    lastExitCode: record.lastExitCode,
    restartCount: record.restartCount,
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
