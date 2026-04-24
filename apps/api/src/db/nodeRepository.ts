import { Prisma } from "@prisma/client";
import { db } from "./client.js";

export type PortRange = { start: number; end: number };

export interface CreateNodeRecordInput {
  id: string;
  name: string;
  provider: string;
  region: string;
  internalHost: string;
  publicHost: string;
  runtimeMode: string;
  totalRamMb?: number;
  totalCpu?: number;
  portRangeStart?: number;
  portRangeEnd?: number;
}

export function listNodeRecords() {
  return db.node.findMany({
    orderBy: { createdAt: "desc" },
    include: { statusEvents: { orderBy: { createdAt: "desc" }, take: 20 } }
  });
}

export function findNodeRecordById(id: string) {
  return db.node.findUnique({
    where: { id },
    include: { statusEvents: { orderBy: { createdAt: "desc" }, take: 50 } }
  });
}

export function createNodeRecord(input: CreateNodeRecordInput) {
  return db.node.create({
    data: {
      ...input,
      status: "offline",
      health: "unknown",
      maintenanceMode: false,
      usedRamMb: 0,
      usedCpu: 0,
      lastHeartbeatAt: null,
      statusEvents: {
        create: {
          previousStatus: null,
          newStatus: "offline",
          reason: "node registered"
        }
      }
    },
    include: { statusEvents: { orderBy: { createdAt: "desc" }, take: 20 } }
  });
}

export function setNodeMaintenanceRecord(id: string, maintenanceMode: boolean, reason: string) {
  return db.$transaction(async (tx) => {
    const node = await tx.node.findUniqueOrThrow({ where: { id } });
    const nextStatus = maintenanceMode ? "maintenance" : "offline";
    const nextHealth = maintenanceMode ? "unknown" : node.health;

    const updated = await tx.node.update({
      where: { id },
      data: {
        maintenanceMode,
        status: nextStatus,
        health: nextHealth,
        statusEvents: {
          create: {
            previousStatus: node.status,
            newStatus: nextStatus,
            reason
          }
        }
      },
      include: { statusEvents: { orderBy: { createdAt: "desc" }, take: 50 } }
    });

    return updated;
  });
}

export function revokeActiveNodeTokens(nodeId: string) {
  return db.nodeToken.updateMany({
    where: { nodeId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export function createNodeTokenRecord(nodeId: string, tokenHash: string) {
  return db.nodeToken.create({
    data: { nodeId, tokenHash }
  });
}

export function findActiveNodeTokenRecord(nodeId: string, tokenHash: string) {
  return db.nodeToken.findFirst({
    where: {
      nodeId,
      tokenHash,
      revokedAt: null
    }
  });
}

export interface UpdateNodeHeartbeatRecordInput {
  status: string;
  health: string;
  usedRamMb: number;
  usedCpu: number;
  totalRamMb?: number;
  totalCpu?: number;
  openPorts?: number[];
  suggestedPortRanges?: PortRange[];
}

export function updateNodeHeartbeatRecord(
  nodeId: string,
  updates: UpdateNodeHeartbeatRecordInput
) {
  return db.node.update({
    where: { id: nodeId },
    data: {
      status: updates.status,
      health: updates.health,
      usedRamMb: updates.usedRamMb,
      usedCpu: updates.usedCpu,
      ...(updates.totalRamMb !== undefined ? { totalRamMb: updates.totalRamMb } : {}),
      ...(updates.totalCpu !== undefined ? { totalCpu: updates.totalCpu } : {}),
      ...(updates.openPorts !== undefined ? { openPorts: { set: updates.openPorts } } : {}),
      ...(updates.suggestedPortRanges !== undefined
        ? { suggestedPortRanges: updates.suggestedPortRanges as unknown as Prisma.InputJsonValue }
        : {}),
      lastHeartbeatAt: new Date(),
      updatedAt: new Date()
    },
    include: {
      statusEvents: { orderBy: { createdAt: "desc" }, take: 50 }
    }
  });
}

export interface UpdateNodeRecordInput {
  name?: string;
  provider?: string;
  region?: string;
  internalHost?: string;
  publicHost?: string;
  runtimeMode?: string;
  totalRamMb?: number;
  totalCpu?: number;
  portRangeStart?: number;
  portRangeEnd?: number;
}

export function updateNodeRecord(nodeId: string, updates: UpdateNodeRecordInput) {
  return db.node.update({
    where: { id: nodeId },
    data: {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.provider !== undefined ? { provider: updates.provider } : {}),
      ...(updates.region !== undefined ? { region: updates.region } : {}),
      ...(updates.internalHost !== undefined ? { internalHost: updates.internalHost } : {}),
      ...(updates.publicHost !== undefined ? { publicHost: updates.publicHost } : {}),
      ...(updates.runtimeMode !== undefined ? { runtimeMode: updates.runtimeMode } : {}),
      ...(updates.totalRamMb !== undefined ? { totalRamMb: updates.totalRamMb } : {}),
      ...(updates.totalCpu !== undefined ? { totalCpu: updates.totalCpu } : {}),
      ...(updates.portRangeStart !== undefined ? { portRangeStart: updates.portRangeStart } : {}),
      ...(updates.portRangeEnd !== undefined ? { portRangeEnd: updates.portRangeEnd } : {})
    },
    include: {
      statusEvents: { orderBy: { createdAt: "desc" }, take: 50 }
    }
  });
}

export function createNodeStatusEventRecord(input: {
  nodeId: string;
  previousStatus?: string | null;
  newStatus: string;
  reason?: string;
}) {
  return db.nodeStatusEvent.create({
    data: {
      nodeId: input.nodeId,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus,
      reason: input.reason
    }
  });
}

