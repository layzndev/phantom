import { AppError } from "../../lib/appError.js";
import {
  createTenantRecord,
  findTenantRecordById,
  findTenantRecordBySlug,
  listTenantMinecraftServers,
  listTenantRecords,
  softDeleteTenantRecord,
  tenantUsageSummary,
  updateTenantRecord
} from "../../db/platformRepository.js";
import type {
  PlatformTenant,
  PlatformTenantQuota,
  PlatformTenantUsage
} from "./platform.types.js";

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export interface CreateTenantInput {
  name: string;
  slug: string;
  planTier?: string;
  quota?: Partial<PlatformTenantQuota>;
}

export async function createPlatformTenant(input: CreateTenantInput): Promise<PlatformTenant> {
  validateSlug(input.slug);
  if (!input.name || input.name.trim().length === 0) {
    throw new AppError(400, "Tenant name is required.", "VALIDATION_ERROR");
  }
  const existing = await findTenantRecordBySlug(input.slug);
  if (existing) {
    throw new AppError(409, "Slug already in use.", "TENANT_SLUG_CONFLICT");
  }

  const record = await createTenantRecord({
    name: input.name.trim(),
    slug: input.slug,
    planTier: input.planTier,
    quota: input.quota
  });
  return toTenant(record, null);
}

export async function getPlatformTenant(id: string): Promise<PlatformTenant> {
  const record = await findTenantRecordById(id);
  if (!record || record.deletedAt) {
    throw new AppError(404, "Tenant not found.", "TENANT_NOT_FOUND");
  }
  const usage = await summarizeUsage(record.id);
  return toTenant(record, usage);
}

export async function listPlatformTenants(): Promise<PlatformTenant[]> {
  const records = await listTenantRecords();
  return Promise.all(
    records.map(async (record) => toTenant(record, await summarizeUsage(record.id)))
  );
}

export interface UpdateTenantInput {
  name?: string;
  planTier?: string;
  suspended?: boolean;
  quota?: Partial<PlatformTenantQuota>;
}

export async function updatePlatformTenant(
  id: string,
  input: UpdateTenantInput
): Promise<PlatformTenant> {
  const record = await findTenantRecordById(id);
  if (!record || record.deletedAt) {
    throw new AppError(404, "Tenant not found.", "TENANT_NOT_FOUND");
  }
  const updated = await updateTenantRecord(id, input);
  const usage = await summarizeUsage(updated.id);
  return toTenant(updated, usage);
}

export async function deletePlatformTenant(id: string): Promise<PlatformTenant> {
  const record = await findTenantRecordById(id);
  if (!record || record.deletedAt) {
    throw new AppError(404, "Tenant not found.", "TENANT_NOT_FOUND");
  }
  const deleted = await softDeleteTenantRecord(id);
  return toTenant(deleted, null);
}

export interface PlatformTenantServerSummary {
  id: string;
  name: string;
  slug: string;
  hostname: string | null;
  planTier: string;
  runtimeState: string;
  currentPlayerCount: number;
  createdAt: string;
}

export async function listPlatformTenantServers(
  tenantId: string
): Promise<PlatformTenantServerSummary[]> {
  const tenant = await findTenantRecordById(tenantId);
  if (!tenant || tenant.deletedAt) {
    throw new AppError(404, "Tenant not found.", "TENANT_NOT_FOUND");
  }
  const servers = await listTenantMinecraftServers(tenantId);
  return servers.map((server) => ({
    id: server.id,
    name: server.name,
    slug: server.slug,
    hostname: server.hostname ?? null,
    planTier: server.planTier,
    // Provisioning lands in PR 2 — for now expose the persisted state only.
    runtimeState: server.sleepingAt
      ? "sleeping"
      : server.sleepRequestedAt
      ? "stopping"
      : server.readyAt
      ? "running"
      : "unknown",
    currentPlayerCount: server.currentPlayerCount,
    createdAt: server.createdAt.toISOString()
  }));
}

function validateSlug(slug: string) {
  if (!slug || !SLUG_REGEX.test(slug)) {
    throw new AppError(
      400,
      "Slug must be lowercase letters, digits or hyphens (1-32 chars, no leading/trailing hyphen).",
      "VALIDATION_ERROR"
    );
  }
}

async function summarizeUsage(tenantId: string): Promise<PlatformTenantUsage> {
  const summary = await tenantUsageSummary(tenantId);
  return {
    workloadCount: summary._count?._all ?? 0,
    ramMb: summary._sum?.requestedRamMb ?? 0,
    cpu: summary._sum?.requestedCpu ?? 0,
    diskGb: summary._sum?.requestedDiskGb ?? 0
  };
}

function toTenant(
  record: Awaited<ReturnType<typeof findTenantRecordById>>,
  usage: PlatformTenantUsage | null
): PlatformTenant {
  if (!record) {
    throw new AppError(500, "Tenant record missing.", "INTERNAL");
  }
  const quota: PlatformTenantQuota = record.quota
    ? {
        maxServers: record.quota.maxServers,
        maxRamMb: record.quota.maxRamMb,
        maxCpu: record.quota.maxCpu,
        maxDiskGb: record.quota.maxDiskGb
      }
    : { maxServers: 1, maxRamMb: 2048, maxCpu: 1, maxDiskGb: 5 };
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    planTier: record.planTier,
    suspended: record.suspended,
    quota,
    usage: usage ?? undefined,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
