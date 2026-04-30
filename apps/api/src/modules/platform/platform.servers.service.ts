import { AppError } from "../../lib/appError.js";
import { findMinecraftServerRecordById } from "../../db/minecraftRepository.js";
import { findTenantRecordById, tenantUsageSummary } from "../../db/platformRepository.js";
import {
  createMinecraftServer,
  deleteMinecraftServer,
  getMinecraftServer,
  restartMinecraftServer,
  startMinecraftServer,
  stopMinecraftServer,
  updateMinecraftServerSettings
} from "../minecraft/minecraft.service.js";
import {
  findMinecraftTemplate,
  type MinecraftTemplate
} from "../minecraft/minecraft.templates.js";
import type { CreateMinecraftServerInput } from "../minecraft/minecraft.schema.js";
import type {
  MinecraftServer,
  MinecraftServerWithWorkload,
  PlanTier
} from "../minecraft/minecraft.types.js";

export interface PlatformQuotaError {
  field: "maxServers" | "maxRamMb" | "maxCpu" | "maxDiskGb";
  current: number;
  requested: number;
  limit: number;
}

/**
 * Validate that the requested resources fit inside the tenant quota
 * (counting current non-deleted workloads). Throws AppError(409,
 * QUOTA_EXCEEDED) on the first failed check.
 */
export async function assertTenantQuota(
  tenantId: string,
  requested: { ramMb: number; cpu: number; diskGb: number }
) {
  const tenant = await findTenantRecordById(tenantId);
  if (!tenant || tenant.deletedAt) {
    throw new AppError(404, "Tenant not found.", "TENANT_NOT_FOUND");
  }
  if (tenant.suspended) {
    throw new AppError(403, "Tenant is suspended.", "TENANT_SUSPENDED");
  }
  if (!tenant.quota) {
    throw new AppError(500, "Tenant quota missing.", "TENANT_QUOTA_MISSING");
  }

  const usage = await tenantUsageSummary(tenantId);
  const currentServers = usage._count?._all ?? 0;
  const currentRam = usage._sum?.requestedRamMb ?? 0;
  const currentCpu = usage._sum?.requestedCpu ?? 0;
  const currentDisk = usage._sum?.requestedDiskGb ?? 0;

  const checks: PlatformQuotaError[] = [
    {
      field: "maxServers",
      current: currentServers,
      requested: 1,
      limit: tenant.quota.maxServers
    },
    {
      field: "maxRamMb",
      current: currentRam,
      requested: requested.ramMb,
      limit: tenant.quota.maxRamMb
    },
    {
      field: "maxCpu",
      current: currentCpu,
      requested: requested.cpu,
      limit: tenant.quota.maxCpu
    },
    {
      field: "maxDiskGb",
      current: currentDisk,
      requested: requested.diskGb,
      limit: tenant.quota.maxDiskGb
    }
  ];

  for (const check of checks) {
    if (check.current + check.requested > check.limit) {
      throw new AppError(409, "Tenant quota exceeded.", "QUOTA_EXCEEDED", {
        ...check,
        wouldBe: check.current + check.requested
      });
    }
  }
}

export interface ProvisionTenantServerInput {
  name: string;
  templateId?: string;
  version?: string;
  motd?: string;
  difficulty?: CreateMinecraftServerInput["difficulty"];
  gameMode?: CreateMinecraftServerInput["gameMode"];
  maxPlayers?: number;
  hostnameSlug?: string;
  cpu?: number;
  ramMb?: number;
  diskGb?: number;
}

/**
 * Provision a Minecraft server for a tenant. Quota-checked, scoped via
 * tenantId, EULA implicitly accepted (the platform consumer is the
 * Hosting backend, which surfaces it to its end user).
 */
export async function provisionPlatformTenantServer(
  tenantId: string,
  input: ProvisionTenantServerInput
): Promise<MinecraftServerWithWorkload> {
  // Resolve the template now so we can pick the right defaults BEFORE
  // running the quota check (otherwise quota uses unknown values).
  const templateId = input.templateId ?? "vanilla-1.21";
  const template = await findMinecraftTemplate(templateId);
  if (!template) {
    throw new AppError(400, "Unknown Minecraft template.", "MINECRAFT_TEMPLATE_UNKNOWN");
  }
  const ramMb = input.ramMb ?? template.defaults.ramMb;
  const cpu = input.cpu ?? template.defaults.cpu;
  const diskGb = input.diskGb ?? template.defaults.diskGb;

  await assertTenantQuota(tenantId, { ramMb, cpu, diskGb });

  // Tenants are free-tier in v1 — premium routing comes later.
  const planTier: PlanTier = "free";

  const result = await createMinecraftServer(
    {
      name: input.name,
      templateId: template.id,
      version: input.version,
      motd: input.motd,
      difficulty: input.difficulty,
      gameMode: input.gameMode,
      maxPlayers: input.maxPlayers,
      hostnameSlug: input.hostnameSlug,
      cpu,
      ramMb,
      diskGb,
      eula: true,
      planTier
    },
    { email: `tenant:${tenantId}` },
    { tenantId }
  );

  // Reload to return the scoped detail shape (with runtime + node info).
  return getMinecraftServer(result.server.id);
}

/**
 * Cross-check that the server with this id actually belongs to the
 * tenant in the URL. Returns the server detail or throws 404.
 */
export async function getPlatformTenantServer(
  tenantId: string,
  serverId: string
): Promise<MinecraftServerWithWorkload> {
  const record = await findMinecraftServerRecordById(serverId);
  if (!record || record.deletedAt) {
    throw new AppError(404, "Server not found.", "SERVER_NOT_FOUND");
  }
  if (record.tenantId !== tenantId) {
    // Same status as "not found" so we don't leak the existence of
    // servers belonging to a different tenant.
    throw new AppError(404, "Server not found.", "SERVER_NOT_FOUND");
  }
  return getMinecraftServer(serverId);
}

export async function startPlatformTenantServer(tenantId: string, serverId: string) {
  await getPlatformTenantServer(tenantId, serverId);
  return startMinecraftServer(serverId);
}

export async function stopPlatformTenantServer(tenantId: string, serverId: string) {
  await getPlatformTenantServer(tenantId, serverId);
  return stopMinecraftServer(serverId);
}

export async function restartPlatformTenantServer(tenantId: string, serverId: string) {
  await getPlatformTenantServer(tenantId, serverId);
  return restartMinecraftServer(serverId);
}

export async function deletePlatformTenantServer(
  tenantId: string,
  serverId: string,
  options: { hardDeleteData?: boolean } = {}
) {
  await getPlatformTenantServer(tenantId, serverId);
  return deleteMinecraftServer(serverId, { hardDeleteData: options.hardDeleteData ?? false });
}

/**
 * Platform-facing settings update. Only exposes the customer-facing
 * subset: motd, difficulty, gameMode, maxPlayers, whitelistEnabled.
 * The other fields (autoSleep*, onlineMode) are merged from the
 * server's current state so the underlying admin schema is satisfied.
 */
export async function updatePlatformTenantServerSettings(
  tenantId: string,
  serverId: string,
  input: {
    motd?: string;
    difficulty?: "peaceful" | "easy" | "normal" | "hard";
    gameMode?: "survival" | "creative" | "adventure" | "spectator";
    maxPlayers?: number;
    whitelistEnabled?: boolean;
  }
) {
  const detail = await getPlatformTenantServer(tenantId, serverId);
  return updateMinecraftServerSettings(serverId, {
    autoSleepUseGlobalDefaults: detail.server.autoSleepUseGlobalDefaults,
    autoSleepEnabled: detail.server.autoSleepEnabled,
    autoSleepIdleMinutes: detail.server.autoSleepIdleMinutes,
    autoSleepAction: detail.server.autoSleepAction,
    onlineMode: detail.server.onlineMode,
    motd: input.motd ?? detail.server.motd ?? `${detail.server.name} — Phantom`,
    difficulty: input.difficulty ?? detail.server.difficulty,
    gameMode: input.gameMode ?? detail.server.gameMode,
    maxPlayers: input.maxPlayers ?? detail.server.maxPlayers,
    whitelistEnabled: input.whitelistEnabled ?? detail.server.whitelistEnabled
  });
}

// Re-export so the controller doesn't need to know about MinecraftTemplate.
export type { MinecraftServer, MinecraftTemplate };
