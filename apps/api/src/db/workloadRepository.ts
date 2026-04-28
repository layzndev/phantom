import { Prisma } from "@prisma/client";
import { db } from "./client.js";

export interface WorkloadPortAllocation {
  internalPort: number;
  externalPort: number;
  protocol: "tcp" | "udp";
}

export interface CreateWorkloadRecordInput {
  name: string;
  type: string;
  image: string;
  nodeId: string | null;
  status: string;
  requestedCpu: number;
  requestedRamMb: number;
  requestedDiskGb: number;
  config: Prisma.InputJsonValue;
  ports: WorkloadPortAllocation[];
  tenantId?: string | null;
}

export interface WorkloadFilter {
  nodeId?: string;
  status?: string;
  type?: string;
  includeDeleted?: boolean;
}

const workloadInclude = {
  ports: { orderBy: { externalPort: "asc" as const } },
  statusEvents: { orderBy: { createdAt: "desc" as const }, take: 50 }
};

export function listWorkloadRecords(filter: WorkloadFilter = {}) {
  const where: Prisma.WorkloadWhereInput = {};
  if (filter.nodeId !== undefined) where.nodeId = filter.nodeId;
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.type !== undefined) where.type = filter.type;
  if (!filter.includeDeleted) where.deletedAt = null;

  return db.workload.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: workloadInclude
  });
}

export function findWorkloadRecordById(id: string) {
  return db.workload.findUnique({
    where: { id },
    include: workloadInclude
  });
}

export function createWorkloadRecord(input: CreateWorkloadRecordInput) {
  return db.workload.create({
    data: {
      name: input.name,
      type: input.type,
      image: input.image,
      nodeId: input.nodeId,
      tenantId: input.tenantId ?? null,
      status: input.status,
      requestedCpu: input.requestedCpu,
      requestedRamMb: input.requestedRamMb,
      requestedDiskGb: input.requestedDiskGb,
      config: input.config,
      ports:
        input.nodeId && input.ports.length > 0
          ? {
              createMany: {
                data: input.ports.map((port) => ({
                  nodeId: input.nodeId as string,
                  internalPort: port.internalPort,
                  externalPort: port.externalPort,
                  protocol: port.protocol
                }))
              }
            }
          : undefined,
      statusEvents: {
        create: {
          previousStatus: null,
          newStatus: input.status,
          reason: input.nodeId ? "workload placed" : "awaiting placement"
        }
      }
    },
    include: workloadInclude
  });
}

export interface UpdateWorkloadRecordInput {
  name?: string;
  config?: Prisma.InputJsonValue;
}

export function updateWorkloadRecord(id: string, updates: UpdateWorkloadRecordInput) {
  return db.workload.update({
    where: { id },
    data: {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.config !== undefined ? { config: updates.config } : {})
    },
    include: workloadInclude
  });
}

export function setWorkloadDesiredStatusRecord(
  id: string,
  desiredStatus: string,
  reason: string
) {
  return db.$transaction(async (tx) => {
    const workload = await tx.workload.findUniqueOrThrow({ where: { id } });
    const updated = await tx.workload.update({
      where: { id },
      data: {
        desiredStatus,
        statusEvents: {
          create: {
            previousStatus: workload.status,
            newStatus: workload.status,
            reason: `desired=${desiredStatus}: ${reason}`
          }
        }
      },
      include: workloadInclude
    });
    return updated;
  });
}

export function createWorkloadStatusEventRecord(input: {
  workloadId: string;
  previousStatus?: string | null;
  newStatus: string;
  reason?: string;
}) {
  return db.workloadStatusEvent.create({
    data: {
      workloadId: input.workloadId,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus,
      reason: input.reason
    }
  });
}

export function listWorkloadStatusEvents(workloadId: string, options: { limit?: number } = {}) {
  return db.workloadStatusEvent.findMany({
    where: { workloadId },
    orderBy: { createdAt: "asc" },
    take: options.limit
  });
}

export function deleteWorkloadRecord(id: string) {
  return db.workload.delete({ where: { id } });
}

export function markWorkloadDeletingRecord(
  id: string,
  options: { hardDeleteData: boolean; reason: string }
) {
  return db.$transaction(async (tx) => {
    const now = new Date();
    const workload = await tx.workload.findUniqueOrThrow({ where: { id } });
    return tx.workload.update({
      where: { id },
      data: {
        status: "deleting",
        desiredStatus: "stopped",
        deleteRequestedAt: now,
        deleteRuntimeAckAt: null,
        deleteHardData: options.hardDeleteData,
        statusEvents: {
          create: {
            previousStatus: workload.status,
            newStatus: "deleting",
            reason: options.reason
          }
        }
      },
      include: workloadInclude
    });
  });
}

export function finalizeWorkloadDeletionRecord(
  id: string,
  options: { mode: "hard" | "soft"; reason: string }
) {
  return db.$transaction(async (tx) => {
    const workload = await tx.workload.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true }
    });
    const now = new Date();

    await tx.workloadStatusEvent.create({
      data: {
        workloadId: id,
        previousStatus: workload.status,
        newStatus: "deleted",
        reason: options.reason
      }
    });

    if (options.mode === "hard") {
      await tx.workload.delete({ where: { id } });
      return null;
    }

    await tx.minecraftServer.updateMany({
      where: { workloadId: id, deletedAt: null },
      data: { deletedAt: now }
    });

    await tx.workloadPort.deleteMany({
      where: { workloadId: id }
    });

    return tx.workload.update({
      where: { id },
      data: {
        status: "deleted",
        desiredStatus: "stopped",
        containerId: null,
        lastExitCode: null,
        restartCount: 0,
        deleteRuntimeAckAt: now,
        deletedAt: now
      },
      include: workloadInclude
    });
  });
}

export function listWorkloadsByNodeIds(nodeIds: string[]) {
  return db.workload.findMany({
    where: { nodeId: { in: nodeIds }, deletedAt: null },
    select: {
      id: true,
      nodeId: true,
      requestedCpu: true,
      requestedRamMb: true,
      requestedDiskGb: true
    }
  });
}

export function listRuntimeAssignedWorkloadRecords(nodeId: string) {
  return db.workload.findMany({
    where: {
      nodeId,
      deletedAt: null,
      status: {
        notIn: ["deleted"]
      }
    },
    orderBy: { createdAt: "asc" },
    include: workloadInclude
  });
}

export function findAssignedWorkloadRecordById(nodeId: string, workloadId: string) {
  return db.workload.findFirst({
    where: {
      id: workloadId,
      nodeId,
      deletedAt: null
    },
    include: workloadInclude
  });
}

export interface UpdateWorkloadRuntimeRecordInput {
  status?: string;
  desiredStatus?: string;
  containerId?: string | null;
  runtimeStartedAt?: Date | null;
  runtimeFinishedAt?: Date | null;
  runtimeCpuPercent?: number | null;
  runtimeMemoryMb?: number | null;
  runtimeDiskGb?: number | null;
  lastExitCode?: number | null;
  restartCount?: number;
  deleteRuntimeAckAt?: Date | null;
}

export function updateWorkloadRuntimeRecord(
  workloadId: string,
  updates: UpdateWorkloadRuntimeRecordInput
) {
  return db.workload.update({
    where: { id: workloadId },
    data: {
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.desiredStatus !== undefined ? { desiredStatus: updates.desiredStatus } : {}),
      ...(updates.containerId !== undefined ? { containerId: updates.containerId } : {}),
      ...(updates.runtimeStartedAt !== undefined ? { runtimeStartedAt: updates.runtimeStartedAt } : {}),
      ...(updates.runtimeFinishedAt !== undefined ? { runtimeFinishedAt: updates.runtimeFinishedAt } : {}),
      ...(updates.runtimeCpuPercent !== undefined ? { runtimeCpuPercent: updates.runtimeCpuPercent } : {}),
      ...(updates.runtimeMemoryMb !== undefined ? { runtimeMemoryMb: updates.runtimeMemoryMb } : {}),
      ...(updates.runtimeDiskGb !== undefined ? { runtimeDiskGb: updates.runtimeDiskGb } : {}),
      ...(updates.lastExitCode !== undefined ? { lastExitCode: updates.lastExitCode } : {}),
      ...(updates.restartCount !== undefined ? { restartCount: updates.restartCount } : {}),
      ...(updates.deleteRuntimeAckAt !== undefined
        ? { deleteRuntimeAckAt: updates.deleteRuntimeAckAt }
        : {}),
      lastHeartbeatAt: new Date(),
      updatedAt: new Date()
    },
    include: workloadInclude
  });
}
