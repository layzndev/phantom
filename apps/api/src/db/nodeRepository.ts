import { db } from "./client.js";

export interface CreateNodeRecordInput {
  id: string;
  name: string;
  provider: string;
  region: string;
  internalHost: string;
  publicHost: string;
  runtimeMode: string;
  totalRamMb: number;
  totalCpu: number;
  portRangeStart: number;
  portRangeEnd: number;
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
