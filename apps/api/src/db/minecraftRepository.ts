import { Prisma } from "@prisma/client";
import { db } from "./client.js";

export interface CreateMinecraftServerRecordInput {
  name: string;
  slug: string;
  workloadId: string;
  templateId: string;
  minecraftVersion: string;
  motd: string | null;
  difficulty: string;
  gameMode: string;
  maxPlayers: number;
  eula: boolean;
  planTier: string;
  serverProperties: Prisma.InputJsonValue;
  rconPassword: string;
  autoSleepEnabled?: boolean;
}

export interface MinecraftServerFilter {
  templateId?: string;
  includeDeleted?: boolean;
}

export function createMinecraftServerRecord(input: CreateMinecraftServerRecordInput) {
  return db.minecraftServer.create({
    data: {
      name: input.name,
      slug: input.slug,
      workloadId: input.workloadId,
      templateId: input.templateId,
      minecraftVersion: input.minecraftVersion,
      motd: input.motd,
      difficulty: input.difficulty,
      gameMode: input.gameMode,
      maxPlayers: input.maxPlayers,
      eula: input.eula,
      planTier: input.planTier,
      autoSleepEnabled: input.autoSleepEnabled ?? true,
      serverProperties: input.serverProperties,
      rconPassword: input.rconPassword
    }
  });
}

export function findMinecraftServerRecordById(id: string) {
  return db.minecraftServer.findUnique({ where: { id } });
}

export function findMinecraftServerRecordBySlug(slug: string) {
  return db.minecraftServer.findUnique({ where: { slug } });
}

export function findMinecraftServerRecordByWorkloadId(workloadId: string) {
  return db.minecraftServer.findUnique({ where: { workloadId } });
}

export function listMinecraftServerRecords(filter: MinecraftServerFilter = {}) {
  const where: Prisma.MinecraftServerWhereInput = {
    workload: {
      deletedAt: null
    }
  };
  if (filter.templateId !== undefined) where.templateId = filter.templateId;
  if (!filter.includeDeleted) where.deletedAt = null;

  return db.minecraftServer.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
}

export function listMinecraftServerRecordsForNode(nodeId: string) {
  return db.minecraftServer.findMany({
    where: {
      deletedAt: null,
      workload: { nodeId, deletedAt: null }
    },
    include: {
      workload: { include: { ports: true } }
    },
    orderBy: { createdAt: "asc" }
  });
}

export function countMinecraftServersByNode() {
  return db.minecraftServer.groupBy({
    by: ["workloadId"],
    where: {
      deletedAt: null,
      workload: { deletedAt: null, nodeId: { not: null } }
    }
  });
}

export function listMinecraftServerNodeAssignments() {
  return db.minecraftServer.findMany({
    where: { deletedAt: null, workload: { deletedAt: null, nodeId: { not: null } } },
    select: { workload: { select: { nodeId: true } } }
  });
}

export function updateMinecraftServerRecord(
  id: string,
  updates: {
    autoSleepEnabled?: boolean;
    currentPlayerCount?: number;
    lastPlayerSampleAt?: Date | null;
    lastPlayerSeenAt?: Date | null;
    lastConsoleCommandAt?: Date | null;
    lastActivityAt?: Date | null;
    idleSince?: Date | null;
    sleepingAt?: Date | null;
  }
) {
  return db.minecraftServer.update({
    where: { id },
    data: {
      ...(updates.autoSleepEnabled !== undefined
        ? { autoSleepEnabled: updates.autoSleepEnabled }
        : {}),
      ...(updates.currentPlayerCount !== undefined
        ? { currentPlayerCount: updates.currentPlayerCount }
        : {}),
      ...(updates.lastPlayerSampleAt !== undefined
        ? { lastPlayerSampleAt: updates.lastPlayerSampleAt }
        : {}),
      ...(updates.lastPlayerSeenAt !== undefined
        ? { lastPlayerSeenAt: updates.lastPlayerSeenAt }
        : {}),
      ...(updates.lastConsoleCommandAt !== undefined
        ? { lastConsoleCommandAt: updates.lastConsoleCommandAt }
        : {}),
      ...(updates.lastActivityAt !== undefined
        ? { lastActivityAt: updates.lastActivityAt }
        : {}),
      ...(updates.idleSince !== undefined ? { idleSince: updates.idleSince } : {}),
      ...(updates.sleepingAt !== undefined ? { sleepingAt: updates.sleepingAt } : {})
    }
  });
}

export function listAutoSleepCandidateServers() {
  return db.minecraftServer.findMany({
    where: {
      deletedAt: null,
      planTier: "free",
      autoSleepEnabled: true,
      workload: {
        deletedAt: null,
        status: "running",
        desiredStatus: "running",
        nodeId: { not: null },
        node: {
          pool: "free",
          maintenanceMode: false,
          status: "healthy"
        }
      }
    },
    include: {
      workload: true
    },
    orderBy: { createdAt: "asc" }
  });
}
