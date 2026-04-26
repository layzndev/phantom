import { Prisma } from "@prisma/client";
import { db } from "./client.js";

export interface CreateMinecraftServerRecordInput {
  name: string;
  slug: string;
  hostname: string;
  hostnameSlug: string;
  hostnameUpdatedAt?: Date | null;
  dnsStatus?: string;
  dnsLastError?: string | null;
  dnsSyncedAt?: Date | null;
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
  autoSleepUseGlobalDefaults?: boolean;
  autoSleepEnabled?: boolean;
  autoSleepIdleMinutes?: number;
  autoSleepAction?: string;
  onlineMode?: boolean;
  whitelistEnabled?: boolean;
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
      hostname: input.hostname,
      hostnameSlug: input.hostnameSlug,
      hostnameUpdatedAt: input.hostnameUpdatedAt ?? new Date(),
      dnsStatus: input.dnsStatus ?? "disabled",
      dnsLastError: input.dnsLastError ?? null,
      dnsSyncedAt: input.dnsSyncedAt ?? null,
      workloadId: input.workloadId,
      templateId: input.templateId,
      minecraftVersion: input.minecraftVersion,
      motd: input.motd,
      difficulty: input.difficulty,
      gameMode: input.gameMode,
      maxPlayers: input.maxPlayers,
      eula: input.eula,
      planTier: input.planTier,
      autoSleepUseGlobalDefaults: input.autoSleepUseGlobalDefaults ?? true,
      autoSleepEnabled: input.autoSleepEnabled ?? true,
      autoSleepIdleMinutes: input.autoSleepIdleMinutes ?? 10,
      autoSleepAction: input.autoSleepAction ?? "sleep",
      onlineMode: input.onlineMode ?? true,
      whitelistEnabled: input.whitelistEnabled ?? false,
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

export function findMinecraftServerRecordByHostnameSlug(hostnameSlug: string) {
  return db.minecraftServer.findUnique({ where: { hostnameSlug } });
}

export function findMinecraftServerRecordByHostname(hostname: string) {
  return db.minecraftServer.findUnique({ where: { hostname } });
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
    motd?: string | null;
    difficulty?: string;
    gameMode?: string;
    maxPlayers?: number;
    serverProperties?: Prisma.InputJsonValue;
    autoSleepUseGlobalDefaults?: boolean;
    autoSleepEnabled?: boolean;
    autoSleepIdleMinutes?: number;
    autoSleepAction?: string;
    onlineMode?: boolean;
    whitelistEnabled?: boolean;
    currentPlayerCount?: number;
    lastPlayerSampleAt?: Date | null;
    lastPlayerCheckFailedAt?: Date | null;
    lastPlayerCheckError?: string | null;
    lastPlayerSeenAt?: Date | null;
    lastConsoleCommandAt?: Date | null;
    lastActivityAt?: Date | null;
    idleSince?: Date | null;
    sleepRequestedAt?: Date | null;
    sleepingAt?: Date | null;
    wakeRequestedAt?: Date | null;
    readyAt?: Date | null;
    hostname?: string;
    hostnameSlug?: string;
    hostnameUpdatedAt?: Date | null;
    dnsStatus?: string;
    dnsLastError?: string | null;
    dnsSyncedAt?: Date | null;
  }
) {
  return db.minecraftServer.update({
    where: { id },
    data: {
      ...(updates.motd !== undefined ? { motd: updates.motd } : {}),
      ...(updates.difficulty !== undefined ? { difficulty: updates.difficulty } : {}),
      ...(updates.gameMode !== undefined ? { gameMode: updates.gameMode } : {}),
      ...(updates.maxPlayers !== undefined ? { maxPlayers: updates.maxPlayers } : {}),
      ...(updates.serverProperties !== undefined ? { serverProperties: updates.serverProperties } : {}),
      ...(updates.autoSleepUseGlobalDefaults !== undefined
        ? { autoSleepUseGlobalDefaults: updates.autoSleepUseGlobalDefaults }
        : {}),
      ...(updates.autoSleepEnabled !== undefined
        ? { autoSleepEnabled: updates.autoSleepEnabled }
        : {}),
      ...(updates.autoSleepIdleMinutes !== undefined
        ? { autoSleepIdleMinutes: updates.autoSleepIdleMinutes }
        : {}),
      ...(updates.autoSleepAction !== undefined
        ? { autoSleepAction: updates.autoSleepAction }
        : {}),
      ...(updates.onlineMode !== undefined ? { onlineMode: updates.onlineMode } : {}),
      ...(updates.whitelistEnabled !== undefined
        ? { whitelistEnabled: updates.whitelistEnabled }
        : {}),
      ...(updates.currentPlayerCount !== undefined
        ? { currentPlayerCount: updates.currentPlayerCount }
        : {}),
      ...(updates.lastPlayerSampleAt !== undefined
        ? { lastPlayerSampleAt: updates.lastPlayerSampleAt }
        : {}),
      ...(updates.lastPlayerCheckFailedAt !== undefined
        ? { lastPlayerCheckFailedAt: updates.lastPlayerCheckFailedAt }
        : {}),
      ...(updates.lastPlayerCheckError !== undefined
        ? { lastPlayerCheckError: updates.lastPlayerCheckError }
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
      ...(updates.sleepRequestedAt !== undefined
        ? { sleepRequestedAt: updates.sleepRequestedAt }
        : {}),
      ...(updates.sleepingAt !== undefined ? { sleepingAt: updates.sleepingAt } : {}),
      ...(updates.wakeRequestedAt !== undefined
        ? { wakeRequestedAt: updates.wakeRequestedAt }
        : {}),
      ...(updates.readyAt !== undefined ? { readyAt: updates.readyAt } : {}),
      ...(updates.hostname !== undefined ? { hostname: updates.hostname } : {}),
      ...(updates.hostnameSlug !== undefined ? { hostnameSlug: updates.hostnameSlug } : {}),
      ...(updates.hostnameUpdatedAt !== undefined
        ? { hostnameUpdatedAt: updates.hostnameUpdatedAt }
        : {}),
      ...(updates.dnsStatus !== undefined ? { dnsStatus: updates.dnsStatus } : {}),
      ...(updates.dnsLastError !== undefined ? { dnsLastError: updates.dnsLastError } : {}),
      ...(updates.dnsSyncedAt !== undefined ? { dnsSyncedAt: updates.dnsSyncedAt } : {})
    }
  });
}

export function listAutoSleepCandidateServers() {
  return db.minecraftServer.findMany({
    where: {
      deletedAt: null,
      planTier: "free",
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

export function getMinecraftGlobalSettingsRecord() {
  return db.minecraftGlobalSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default"
    },
    update: {}
  });
}

export function updateMinecraftGlobalSettingsRecord(updates: {
  freeAutoSleepEnabled?: boolean;
  freeAutoSleepIdleMinutes?: number;
  freeAutoSleepAction?: string;
}) {
  return db.minecraftGlobalSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      freeAutoSleepEnabled: updates.freeAutoSleepEnabled ?? true,
      freeAutoSleepIdleMinutes: updates.freeAutoSleepIdleMinutes ?? 10,
      freeAutoSleepAction: updates.freeAutoSleepAction ?? "sleep"
    },
    update: {
      ...(updates.freeAutoSleepEnabled !== undefined
        ? { freeAutoSleepEnabled: updates.freeAutoSleepEnabled }
        : {}),
      ...(updates.freeAutoSleepIdleMinutes !== undefined
        ? { freeAutoSleepIdleMinutes: updates.freeAutoSleepIdleMinutes }
        : {}),
      ...(updates.freeAutoSleepAction !== undefined
        ? { freeAutoSleepAction: updates.freeAutoSleepAction }
        : {})
    }
  });
}
