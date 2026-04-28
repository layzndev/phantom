import { Prisma } from "@prisma/client";
import { db } from "./client.js";

// ---------- Tenants ----------

export interface CreateTenantRecordInput {
  name: string;
  slug: string;
  planTier?: string;
  quota?: {
    maxServers?: number;
    maxRamMb?: number;
    maxCpu?: number;
    maxDiskGb?: number;
  };
}

export function createTenantRecord(input: CreateTenantRecordInput) {
  return db.tenant.create({
    data: {
      name: input.name,
      slug: input.slug,
      planTier: input.planTier ?? "free",
      quota: input.quota
        ? {
            create: {
              maxServers: input.quota.maxServers ?? 1,
              maxRamMb: input.quota.maxRamMb ?? 2048,
              maxCpu: input.quota.maxCpu ?? 1,
              maxDiskGb: input.quota.maxDiskGb ?? 5
            }
          }
        : { create: {} }
    },
    include: { quota: true }
  });
}

export function findTenantRecordById(id: string) {
  return db.tenant.findUnique({
    where: { id },
    include: { quota: true }
  });
}

export function findTenantRecordBySlug(slug: string) {
  return db.tenant.findUnique({
    where: { slug },
    include: { quota: true }
  });
}

export function listTenantRecords(options: { includeDeleted?: boolean } = {}) {
  return db.tenant.findMany({
    where: options.includeDeleted ? undefined : { deletedAt: null },
    include: { quota: true },
    orderBy: { createdAt: "desc" }
  });
}

export function updateTenantRecord(
  id: string,
  updates: {
    name?: string;
    planTier?: string;
    suspended?: boolean;
    quota?: {
      maxServers?: number;
      maxRamMb?: number;
      maxCpu?: number;
      maxDiskGb?: number;
    };
  }
) {
  return db.tenant.update({
    where: { id },
    data: {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.planTier !== undefined ? { planTier: updates.planTier } : {}),
      ...(updates.suspended !== undefined ? { suspended: updates.suspended } : {}),
      ...(updates.quota
        ? {
            quota: {
              upsert: {
                create: {
                  maxServers: updates.quota.maxServers ?? 1,
                  maxRamMb: updates.quota.maxRamMb ?? 2048,
                  maxCpu: updates.quota.maxCpu ?? 1,
                  maxDiskGb: updates.quota.maxDiskGb ?? 5
                },
                update: {
                  ...(updates.quota.maxServers !== undefined
                    ? { maxServers: updates.quota.maxServers }
                    : {}),
                  ...(updates.quota.maxRamMb !== undefined
                    ? { maxRamMb: updates.quota.maxRamMb }
                    : {}),
                  ...(updates.quota.maxCpu !== undefined ? { maxCpu: updates.quota.maxCpu } : {}),
                  ...(updates.quota.maxDiskGb !== undefined
                    ? { maxDiskGb: updates.quota.maxDiskGb }
                    : {})
                }
              }
            }
          }
        : {})
    },
    include: { quota: true }
  });
}

export function softDeleteTenantRecord(id: string) {
  return db.tenant.update({
    where: { id },
    data: { deletedAt: new Date(), suspended: true },
    include: { quota: true }
  });
}

export function listTenantMinecraftServers(tenantId: string) {
  return db.minecraftServer.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" }
  });
}

export function tenantUsageSummary(tenantId: string) {
  return db.workload.aggregate({
    where: { tenantId, deletedAt: null },
    _count: { _all: true },
    _sum: { requestedRamMb: true, requestedDiskGb: true, requestedCpu: true }
  });
}

// ---------- Platform tokens ----------

export interface CreatePlatformTokenRecordInput {
  name: string;
  prefix: string;
  last4: string;
  tokenHash: string;
  scopes: string[];
  createdById?: string | null;
  expiresAt?: Date | null;
}

export function createPlatformTokenRecord(input: CreatePlatformTokenRecordInput) {
  return db.platformToken.create({
    data: {
      name: input.name,
      prefix: input.prefix,
      last4: input.last4,
      tokenHash: input.tokenHash,
      scopes: input.scopes as Prisma.InputJsonValue,
      createdById: input.createdById ?? null,
      expiresAt: input.expiresAt ?? null
    }
  });
}

export function findPlatformTokenByHash(tokenHash: string) {
  return db.platformToken.findUnique({ where: { tokenHash } });
}

export function listPlatformTokenRecords() {
  return db.platformToken.findMany({ orderBy: { createdAt: "desc" } });
}

export function markPlatformTokenUsed(id: string) {
  return db.platformToken.update({
    where: { id },
    data: { lastUsedAt: new Date() }
  });
}

export function revokePlatformTokenRecord(id: string) {
  return db.platformToken.update({
    where: { id },
    data: { revokedAt: new Date() }
  });
}
