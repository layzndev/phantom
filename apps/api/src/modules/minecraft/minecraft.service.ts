import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/appError.js";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { createAuditLog } from "../audit/audit.repository.js";
import {
  createMinecraftServerRecord,
  findMinecraftServerRecordById,
  findMinecraftServerRecordByHostnameSlug,
  findMinecraftServerRecordBySlug,
  findMinecraftServerRecordByWorkloadId,
  getMinecraftGlobalSettingsRecord,
  listAutoSleepCandidateServers,
  listMinecraftServerRecords,
  updateMinecraftGlobalSettingsRecord,
  updateMinecraftServerRecord
} from "../../db/minecraftRepository.js";
import {
  completeMinecraftOperation,
  createMinecraftOperation,
  findActiveMinecraftOperationByWorkloadAndKind,
  findMinecraftOperationById,
  listPendingMinecraftOperationsForNode,
  markMinecraftOperationInProgress,
  type MinecraftOperationKind as RepoOperationKind
} from "../../db/minecraftOperationsRepository.js";
import { authenticateRuntimeNode } from "../nodes/nodes.service.js";
import { findNodeFromRegistry } from "../nodes/nodes.repository.js";
import { findWorkloadFromRegistry } from "../workloads/workloads.repository.js";
import {
  createWorkload,
  getWorkload,
  requestWorkloadDeletion,
  restartWorkload,
  startWorkload,
  stopWorkload,
  updateWorkload
} from "../workloads/workloads.service.js";
import type { CompanyWorkload } from "../workloads/workloads.types.js";
import type {
  CreateMinecraftServerInput,
  DeleteMinecraftServerQuery,
  UpdateMinecraftServerSettingsInput
} from "./minecraft.schema.js";
import {
  findMinecraftTemplate,
  listMinecraftTemplates,
  resolveMinecraftImageForVersion,
  type MinecraftTemplate
} from "./minecraft.templates.js";
import { minecraftConsoleGateway } from "./minecraft.console.gateway.js";
import {
  allocateHostname,
  buildHostname,
  extractHostnameSlug,
  normalizeHostnameSlug
} from "./minecraft.hostname.js";
import type {
  CreateMinecraftServerResult,
  DeleteMinecraftServerResult,
  MinecraftGlobalSettings,
  MinecraftDifficulty,
  MinecraftFileAccessMode,
  MinecraftFileReadResult,
  MinecraftFilesListResult,
  MinecraftGameMode,
  MinecraftAutoSleepAction,
  MinecraftOperation,
  MinecraftOperationKind,
  MinecraftOperationResponse,
  MinecraftOperationStatus,
  MinecraftRuntimeState,
  MinecraftServer,
  MinecraftServerWithWorkload,
  PlanTier
} from "./minecraft.types.js";
import type { NodePool } from "../nodes/nodes.types.js";

type MinecraftServerRecord = NonNullable<
  Awaited<ReturnType<typeof findMinecraftServerRecordById>>
>;
type MinecraftOperationRecord = NonNullable<
  Awaited<ReturnType<typeof findMinecraftOperationById>>
>;

const MINECRAFT_INTERNAL_GAME_PORT = 25565;
const PHANTOM_PROXY_PUBLIC_PORT = 25565;
const MIN_MINECRAFT_DIRECT_PORT = 25566;
const DEFAULT_RCON_PORT = 25575;
const MIN_JVM_HEAP_MB = 1024;
const JVM_HEADROOM_MB = 512;
const MINECRAFT_STOP_TIMEOUT_SECONDS = 60;
const MINECRAFT_VOLUME_NAME = "minecraft-data";
const MINECRAFT_VOLUME_CONTAINER_PATH = "/data";
const OPERATION_WAIT_TIMEOUT_MS = 5_000;
const OPERATION_POLL_INTERVAL_MS = 250;

export async function getMinecraftTemplates() {
  return listMinecraftTemplates();
}

export async function listMinecraftServers(): Promise<MinecraftServerWithWorkload[]> {
  const records = await listMinecraftServerRecords();
  const servers = await Promise.all(
    records.map(async (record) => {
      const workload = await getWorkload(record.workloadId);
      return toMinecraftServerWithRuntime(record, workload);
    })
  );
  return servers;
}

export async function getMinecraftGlobalSettings(): Promise<MinecraftGlobalSettings> {
  const record = await getMinecraftGlobalSettingsRecord();
  return {
    freeAutoSleepEnabled: record.freeAutoSleepEnabled,
    freeAutoSleepIdleMinutes: record.freeAutoSleepIdleMinutes,
    freeAutoSleepAction: record.freeAutoSleepAction as MinecraftAutoSleepAction
  };
}

export async function getMinecraftServer(id: string): Promise<MinecraftServerWithWorkload> {
  const record = await findMinecraftServerRecordById(id);
  if (!record || record.deletedAt !== null) {
    throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
  }
  const workload = await getWorkload(record.workloadId);
  return toMinecraftServerWithRuntime(record, workload);
}

export async function reconcileReservedMinecraftProxyPorts() {
  const legacyPorts = await db.workloadPort.findMany({
    where: {
      externalPort: PHANTOM_PROXY_PUBLIC_PORT,
      protocol: "tcp",
      workload: {
        deletedAt: null,
        type: "minecraft",
        nodeId: { not: null }
      }
    },
    select: {
      id: true,
      workloadId: true,
      nodeId: true,
      workload: {
        select: {
          id: true,
          name: true,
          status: true
        }
      }
    }
  });

  for (const portRecord of legacyPorts) {
    if (!portRecord.nodeId) {
      continue;
    }

    try {
      const result = await db.$transaction(async (tx) => {
        const current = await tx.workloadPort.findUnique({
          where: { id: portRecord.id },
          select: {
            id: true,
            nodeId: true,
            externalPort: true,
            protocol: true,
            workloadId: true
          }
        });

        if (!current || !current.nodeId || current.externalPort !== PHANTOM_PROXY_PUBLIC_PORT) {
          return null;
        }

        const node = await tx.node.findUnique({
          where: { id: current.nodeId },
          select: { portRangeStart: true, portRangeEnd: true }
        });

        if (node?.portRangeEnd === null || node?.portRangeEnd === undefined) {
          return { skipped: "missing_port_range" } as const;
        }

        const rangeStart = Math.max(
          node.portRangeStart ?? MIN_MINECRAFT_DIRECT_PORT,
          MIN_MINECRAFT_DIRECT_PORT
        );
        if (node.portRangeEnd < rangeStart) {
          return { skipped: "invalid_port_range" } as const;
        }

        const usedPorts = await tx.workloadPort.findMany({
          where: {
            nodeId: current.nodeId,
            protocol: current.protocol,
            id: { not: current.id }
          },
          select: { externalPort: true }
        });

        const used = new Set(usedPorts.map((entry) => entry.externalPort));
        let nextPort: number | null = null;
        for (let port = rangeStart; port <= node.portRangeEnd; port += 1) {
          if (port === PHANTOM_PROXY_PUBLIC_PORT) continue;
          if (used.has(port)) continue;
          nextPort = port;
          break;
        }

        if (nextPort === null) {
          return { skipped: "no_free_port" } as const;
        }

        await tx.workloadPort.update({
          where: { id: current.id },
          data: { externalPort: nextPort }
        });

        await tx.workloadStatusEvent.create({
          data: {
            workloadId: current.workloadId,
            previousStatus: portRecord.workload.status,
            newStatus: portRecord.workload.status,
            reason: `[ports] migrated reserved proxy port 25565 -> ${nextPort}`
          }
        });

        return { nextPort } as const;
      });

      if (!result) {
        continue;
      }

      if ("skipped" in result) {
        console.warn("[minecraft] reserved proxy port migration skipped", {
          workloadId: portRecord.workloadId,
          serverName: portRecord.workload.name,
          reason: result.skipped
        });
        continue;
      }

      console.info("[minecraft] migrated reserved proxy port", {
        workloadId: portRecord.workloadId,
        serverName: portRecord.workload.name,
        previousPort: PHANTOM_PROXY_PUBLIC_PORT,
        nextPort: result.nextPort
      });
      await createAuditLog({
        action: "minecraft.server.port_migrated",
        actorEmail: "phantom@system",
        targetType: "system",
        targetId: portRecord.workloadId,
        metadata: {
          previousPort: PHANTOM_PROXY_PUBLIC_PORT,
          nextPort: result.nextPort,
          runtimeStatus: portRecord.workload.status,
          restartMayBeRequired: ["running", "creating"].includes(portRecord.workload.status)
        }
      });
    } catch (error) {
      console.error("[minecraft] failed to migrate reserved proxy port", {
        workloadId: portRecord.workloadId,
        serverName: portRecord.workload.name,
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}

export async function createMinecraftServer(
  input: CreateMinecraftServerInput,
  actor?: { email?: string | null }
): Promise<CreateMinecraftServerResult> {
  const template = await findMinecraftTemplate(input.templateId);
  if (!template) {
    throw new AppError(400, "Unknown Minecraft template.", "MINECRAFT_TEMPLATE_UNKNOWN");
  }

  const version = resolveVersion(template, input.version);
  const cpu = input.cpu ?? template.defaults.cpu;
  const ramMb = input.ramMb ?? template.defaults.ramMb;
  const diskGb = input.diskGb ?? template.defaults.diskGb;
  const difficulty: MinecraftDifficulty = input.difficulty ?? "normal";
  const gameMode: MinecraftGameMode = input.gameMode ?? "survival";
  const maxPlayers = input.maxPlayers ?? 20;
  const motd = input.motd ?? null;
  const planTier: PlanTier = input.planTier;
  const requiredPool: NodePool = planTier === "premium" ? "premium" : "free";

  const slug = await allocateUniqueSlug(input.name);
  const username = actor?.email ? actor.email.split("@")[0] : null;
  const allocatedHostname = await allocateHostname({
    requestedSlug: input.hostnameSlug,
    username,
    serverSlug: slug,
    serverName: input.name
  });
  const rconPassword = generateRconPassword();

  const minecraftEnv = buildMinecraftEnv({
    template,
    version,
    ramMb,
    motd: motd ?? `${input.name} — Phantom`,
    difficulty,
    gameMode,
    maxPlayers,
    onlineMode: true,
    whitelistEnabled: false,
    rconPassword
  });

  const config: Record<string, unknown> = {
    env: minecraftEnv,
    volumes: [
      {
        name: MINECRAFT_VOLUME_NAME,
        containerPath: MINECRAFT_VOLUME_CONTAINER_PATH
      }
    ],
    stopTimeoutSeconds: MINECRAFT_STOP_TIMEOUT_SECONDS,
    minecraft: {
      templateId: template.id,
      family: template.family,
      version,
      gamePort: MINECRAFT_INTERNAL_GAME_PORT,
      rconPort: DEFAULT_RCON_PORT,
      gracefulStopCommand: "stop"
    }
  };

  const placement = await createWorkload({
    name: input.name,
    type: "minecraft",
    image: resolveMinecraftImageForVersion(version),
    requestedCpu: cpu,
    requestedRamMb: ramMb,
    requestedDiskGb: diskGb,
    requiredPool,
    ports: [{ internalPort: MINECRAFT_INTERNAL_GAME_PORT, protocol: "tcp" }],
    config
  });

  try {
    const record = await createMinecraftServerRecord({
      name: input.name,
      slug,
      hostname: allocatedHostname.hostname,
      hostnameSlug: allocatedHostname.hostnameSlug,
      dnsStatus: "wildcard",
      workloadId: placement.workload.id,
      templateId: template.id,
      minecraftVersion: version,
      motd,
      difficulty,
      gameMode,
      maxPlayers,
      eula: true,
      planTier,
      autoSleepUseGlobalDefaults: planTier === "free",
      autoSleepEnabled: planTier === "free",
      autoSleepIdleMinutes: planTier === "free" ? env.autoSleepIdleMinutes : 10,
      autoSleepAction: "sleep",
      onlineMode: true,
      whitelistEnabled: false,
      serverProperties: buildMinecraftServerPropertiesSnapshot({
        motd: motd ?? `${input.name} — Phantom`,
        difficulty,
        gameMode,
        maxPlayers,
        onlineMode: true,
        whitelistEnabled: false
      }) as Prisma.InputJsonValue,
      rconPassword
    });

    return {
      server: toMinecraftServer(record),
      workload: placement.workload,
      placed: placement.placed,
      reason: placement.reason,
      diagnostics: placement.diagnostics
    };
  } catch (error) {
    await safeDeleteWorkload(placement.workload.id);
    throw error;
  }
}

export async function startMinecraftServer(id: string) {
  const record = await ensureMinecraftServerRecord(id);
  const updatedServer = await updateMinecraftServerRecord(record.id, {
    sleepingAt: null,
    sleepRequestedAt: null,
    wakeRequestedAt: new Date(),
    readyAt: null,
    idleSince: null,
    lastActivityAt: new Date()
  });
  const workload = await startWorkload(record.workloadId);
  publishPhantomConsoleLifecycle(record.id, "Waking server...");
  minecraftConsoleGateway.publishStatus(record.id, "waking");
  return { server: toMinecraftServer(updatedServer), workload };
}

export async function stopMinecraftServer(id: string) {
  const record = await ensureMinecraftServerRecord(id);
  const updatedServer = await updateMinecraftServerRecord(record.id, {
    sleepRequestedAt: null,
    sleepingAt: null,
    wakeRequestedAt: null,
    readyAt: null
  });
  const workload = await stopWorkload(record.workloadId);
  publishPhantomConsoleLifecycle(record.id, "Stopping server...");
  minecraftConsoleGateway.publishStatus(record.id, "stopping");
  return { server: toMinecraftServer(updatedServer), workload };
}

export async function restartMinecraftServer(id: string) {
  const record = await ensureMinecraftServerRecord(id);
  const updatedServer = await updateMinecraftServerRecord(record.id, {
    sleepingAt: null,
    sleepRequestedAt: null,
    wakeRequestedAt: new Date(),
    readyAt: null,
    idleSince: null,
    lastActivityAt: new Date()
  });
  const workload = await restartWorkload(record.workloadId);
  publishPhantomConsoleLifecycle(record.id, "Restarting server...");
  minecraftConsoleGateway.publishStatus(record.id, "starting");
  return { server: toMinecraftServer(updatedServer), workload };
}

export async function updateMinecraftServerHostname(id: string, hostnameSlug: string) {
  const record = await ensureMinecraftServerRecord(id);
  const normalized = normalizeHostnameSlug(hostnameSlug);
  const existing = await findMinecraftServerRecordByHostnameSlug(normalized);
  if (existing && existing.id !== record.id) {
    throw new AppError(409, "Hostname already in use.", "HOSTNAME_CONFLICT");
  }

  const nextHostname = buildHostname(normalized);
  const updated = await updateMinecraftServerRecord(record.id, {
    hostname: nextHostname,
    hostnameSlug: normalized,
    hostnameUpdatedAt: new Date(),
    dnsStatus: "wildcard",
    dnsLastError: null,
    dnsSyncedAt: null
  });

  const workload = await getWorkload(record.workloadId);
  return toMinecraftServerWithRuntime(updated, workload);
}

export async function updateMinecraftServerSettings(
  id: string,
  input: UpdateMinecraftServerSettingsInput
) {
  const record = await ensureMinecraftServerRecord(id);
  const workload = await getWorkload(record.workloadId);
  const nextMotd = input.motd.trim();
  const currentConfig = (workload.config as Record<string, unknown>) ?? {};
  const nextConfig = buildUpdatedMinecraftWorkloadConfig(currentConfig, {
    version: record.minecraftVersion,
    ramMb: workload.requestedRamMb,
    motd: nextMotd,
    difficulty: input.difficulty,
    gameMode: input.gameMode,
    maxPlayers: input.maxPlayers,
    onlineMode: input.onlineMode,
    whitelistEnabled: input.whitelistEnabled,
    rconPassword: record.rconPassword ?? generateRconPassword()
  });

  const updatedServer = await updateMinecraftServerRecord(record.id, {
    autoSleepUseGlobalDefaults: input.autoSleepUseGlobalDefaults,
    autoSleepEnabled: input.autoSleepEnabled,
    autoSleepIdleMinutes: input.autoSleepIdleMinutes,
    autoSleepAction: input.autoSleepAction,
    motd: nextMotd,
    difficulty: input.difficulty,
    gameMode: input.gameMode,
    maxPlayers: input.maxPlayers,
    onlineMode: input.onlineMode,
    whitelistEnabled: input.whitelistEnabled,
    serverProperties: buildMinecraftServerPropertiesSnapshot({
      motd: nextMotd,
      difficulty: input.difficulty,
      gameMode: input.gameMode,
      maxPlayers: input.maxPlayers,
      onlineMode: input.onlineMode,
      whitelistEnabled: input.whitelistEnabled
    }) as Prisma.InputJsonValue
  });

  const updatedWorkload = await updateWorkload(record.workloadId, {
    config: nextConfig
  });

  return toMinecraftServerWithRuntime(updatedServer, updatedWorkload);
}

export async function updateMinecraftGlobalSettings(input: {
  freeAutoSleepEnabled: boolean;
  freeAutoSleepIdleMinutes: number;
  freeAutoSleepAction: MinecraftAutoSleepAction;
}) {
  const record = await updateMinecraftGlobalSettingsRecord(input);
  return {
    freeAutoSleepEnabled: record.freeAutoSleepEnabled,
    freeAutoSleepIdleMinutes: record.freeAutoSleepIdleMinutes,
    freeAutoSleepAction: record.freeAutoSleepAction as MinecraftAutoSleepAction
  } satisfies MinecraftGlobalSettings;
}

export async function deleteMinecraftServer(
  id: string,
  options: DeleteMinecraftServerQuery
): Promise<DeleteMinecraftServerResult> {
  const record = await ensureMinecraftServerRecord(id);
  const preparedRecord = await prepareMinecraftServerForDelete(record);
  const result = await requestWorkloadDeletion(record.workloadId, options);
  minecraftConsoleGateway.publishStatus(record.id, result.workload?.status ?? "deleted");
  return {
    server: result.finalized ? null : toMinecraftServer(preparedRecord),
    workload: result.workload,
    finalized: result.finalized
  };
}

export async function enqueueMinecraftOperation(
  serverId: string,
  kind: MinecraftOperationKind,
  payload: Record<string, unknown>,
  actor: { id: string; email: string }
): Promise<MinecraftOperationResponse> {
  const record = await ensureMinecraftServerRecord(serverId);
  const workload = await getWorkload(record.workloadId);
  const runtimeState = deriveMinecraftRuntimeState(record, workload);
  const requiresReady = kind === "command" || kind === "save" || kind === "players";

  if (requiresReady && runtimeState !== "running") {
    throw new AppError(
      409,
      "Minecraft server is still starting. Wait until it is ready.",
      "MINECRAFT_SERVER_NOT_READY"
    );
  }

  if (kind === "stop" && !["running", "starting", "waking", "stopping"].includes(runtimeState)) {
    throw new AppError(
      409,
      "Minecraft server is not running.",
      "MINECRAFT_SERVER_NOT_RUNNING"
    );
  }

  const operation = await createMinecraftOperation({
    workloadId: record.workloadId,
    kind: kind as RepoOperationKind,
    payload: payload as Prisma.InputJsonValue,
    actorId: actor.id,
    actorEmail: actor.email
  });

  if (kind === "command") {
    await updateMinecraftServerRecord(record.id, {
      lastConsoleCommandAt: new Date(),
      lastActivityAt: new Date(),
      idleSince: null,
      sleepRequestedAt: null,
      sleepingAt: null
    });
  }

  const finalRecord = await waitForMinecraftOperation(operation.id);
  const isPending = isOperationPending(finalRecord);
  return {
    operation: toMinecraftOperation(finalRecord),
    pending: isPending
  };
}

export async function getMinecraftOperation(
  serverId: string,
  operationId: string
): Promise<MinecraftOperationResponse> {
  const record = await ensureMinecraftServerRecord(serverId);
  const op = await findMinecraftOperationById(operationId);
  if (!op || op.workloadId !== record.workloadId) {
    throw new AppError(
      404,
      "Operation not found.",
      "MINECRAFT_OPERATION_NOT_FOUND"
    );
  }
  return {
    operation: toMinecraftOperation(op),
    pending: isOperationPending(op)
  };
}

export async function listMinecraftFiles(
  serverId: string,
  path: string,
  actor: { id: string; email: string; role?: string }
): Promise<MinecraftFilesListResult> {
  const result = await enqueueMinecraftOperation(
    serverId,
    "files.list",
    { path, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
  return unwrapMinecraftFileOperation<MinecraftFilesListResult>(
    result,
    "MINECRAFT_FILES_LIST_FAILED",
    "Unable to list files."
  );
}

export async function readMinecraftFile(
  serverId: string,
  path: string,
  actor: { id: string; email: string; role?: string }
): Promise<MinecraftFileReadResult> {
  const result = await enqueueMinecraftOperation(
    serverId,
    "files.read",
    { path, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
  return unwrapMinecraftFileOperation<MinecraftFileReadResult>(
    result,
    "MINECRAFT_FILE_READ_FAILED",
    "Unable to read file."
  );
}

export async function writeMinecraftFile(
  serverId: string,
  path: string,
  content: string,
  actor: { id: string; email: string; role?: string }
) {
  return enqueueMinecraftOperation(
    serverId,
    "files.write",
    { path, content, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
}

export async function uploadMinecraftFile(
  serverId: string,
  path: string,
  contentBase64: string,
  actor: { id: string; email: string; role?: string }
) {
  return enqueueMinecraftOperation(
    serverId,
    "files.upload",
    { path, contentBase64, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
}

export async function mkdirMinecraftFilePath(
  serverId: string,
  path: string,
  actor: { id: string; email: string; role?: string }
) {
  return enqueueMinecraftOperation(
    serverId,
    "files.mkdir",
    { path, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
}

export async function renameMinecraftFilePath(
  serverId: string,
  from: string,
  to: string,
  actor: { id: string; email: string; role?: string }
) {
  return enqueueMinecraftOperation(
    serverId,
    "files.rename",
    { from, to, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
}

export async function deleteMinecraftFilePath(
  serverId: string,
  path: string,
  actor: { id: string; email: string; role?: string }
) {
  return enqueueMinecraftOperation(
    serverId,
    "files.delete",
    { path, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
}

export async function archiveMinecraftFilePath(
  serverId: string,
  path: string,
  actor: { id: string; email: string; role?: string }
) {
  return enqueueMinecraftOperation(
    serverId,
    "files.archive",
    { path, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
}

export async function extractMinecraftArchive(
  serverId: string,
  path: string,
  actor: { id: string; email: string; role?: string }
) {
  return enqueueMinecraftOperation(
    serverId,
    "files.extract",
    { path, accessMode: resolveMinecraftFileAccessMode(actor) },
    actor
  );
}

export interface RuntimeMinecraftOperation {
  id: string;
  workloadId: string;
  containerId: string | null;
  kind: MinecraftOperationKind;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: string;
}

export interface RuntimeMinecraftConsoleStream {
  serverId: string;
  workloadId: string;
  containerId: string | null;
  runtimeStartedAt: string | null;
}

export interface RuntimeMinecraftRoutingResult {
  serverId: string;
  status: string;
  nodeId: string | null;
  host: string | null;
  port: number | null;
  motd: string | null;
  version: string;
  planTier: PlanTier;
}

export async function listRuntimeMinecraftOperations(rawToken: string) {
  const node = await authenticateRuntimeNode(rawToken);
  const records = await listPendingMinecraftOperationsForNode(node.id);
  const operations: RuntimeMinecraftOperation[] = [];
  for (const record of records) {
    const workload = await findWorkloadFromRegistry(record.workloadId);
    if (!workload || workload.nodeId !== node.id) {
      continue;
    }
    operations.push({
      id: record.id,
      workloadId: record.workloadId,
      containerId: workload.containerId,
      kind: record.kind as MinecraftOperationKind,
      payload: (record.payload as Record<string, unknown>) ?? {},
      attempts: record.attempts,
      createdAt: record.createdAt.toISOString()
    });
  }
  return { nodeId: node.id, operations };
}

export async function listRuntimeMinecraftConsoleStreams(rawToken: string) {
  const node = await authenticateRuntimeNode(rawToken);
  const active = minecraftConsoleGateway.listActiveWorkloads();
  const streams: RuntimeMinecraftConsoleStream[] = [];

  for (const entry of active) {
    const workload = await findWorkloadFromRegistry(entry.workloadId);
    if (!workload || workload.nodeId !== node.id || workload.type !== "minecraft") {
      continue;
    }

    streams.push({
      serverId: entry.serverId,
      workloadId: workload.id,
      containerId: workload.containerId,
      runtimeStartedAt: workload.runtimeStartedAt?.toISOString() ?? null
    });
  }

  return { nodeId: node.id, streams };
}

export async function getRuntimeMinecraftRouting(rawToken: string, hostname: string) {
  await authenticateRuntimeNode(rawToken);

  const hostnameSlug = extractHostnameSlug(hostname);
  const record = await findMinecraftServerRecordByHostnameSlug(hostnameSlug);
  if (!record || record.deletedAt !== null) {
    throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
  }

  const workload = await getWorkload(record.workloadId);
  const node = workload.nodeId ? await findNodeFromRegistry(workload.nodeId) : null;
  const gamePort =
    workload.ports.find((port) => port.internalPort === MINECRAFT_INTERNAL_GAME_PORT)
      ?.externalPort ?? null;

  return {
    serverId: record.id,
    status: deriveMinecraftRuntimeState(record, workload),
    nodeId: workload.nodeId,
    host: node?.publicHost ?? null,
    port: gamePort,
    motd: record.motd,
    version: record.minecraftVersion,
    planTier: record.planTier as PlanTier
  } satisfies RuntimeMinecraftRoutingResult;
}

export interface RuntimeMinecraftWakeResult {
  ok: true;
  serverId: string;
  status: MinecraftRuntimeState;
  triggered: boolean;
}

export async function wakeRuntimeMinecraftServer(
  rawToken: string,
  serverId: string
): Promise<RuntimeMinecraftWakeResult> {
  await authenticateRuntimeNode(rawToken);

  const record = await findMinecraftServerRecordById(serverId);
  if (!record || record.deletedAt !== null) {
    throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
  }

  const workload = await getWorkload(record.workloadId);
  const status = deriveMinecraftRuntimeState(record, workload);

  if (status === "running" || status === "starting" || status === "waking") {
    return { ok: true, serverId: record.id, status, triggered: false };
  }

  const result = await startMinecraftServer(record.id);
  return {
    ok: true,
    serverId: record.id,
    status: result.server.runtimeState,
    triggered: true
  };
}

export async function claimRuntimeMinecraftOperation(rawToken: string, opId: string) {
  const node = await authenticateRuntimeNode(rawToken);
  const op = await findMinecraftOperationById(opId);
  if (!op) {
    throw new AppError(404, "Operation not found.", "MINECRAFT_OPERATION_NOT_FOUND");
  }
  const workload = await findWorkloadFromRegistry(op.workloadId);
  if (!workload || workload.nodeId !== node.id) {
    throw new AppError(404, "Operation not found.", "MINECRAFT_OPERATION_NOT_FOUND");
  }
  const result = await markMinecraftOperationInProgress(opId);
  if (result.count === 0) {
    throw new AppError(409, "Operation already claimed.", "MINECRAFT_OPERATION_CLAIMED");
  }
  return { ok: true };
}

export async function completeRuntimeMinecraftOperation(
  rawToken: string,
  opId: string,
  payload: { status: "succeeded" | "failed"; result?: Record<string, unknown> | null; error?: string | null }
) {
  const node = await authenticateRuntimeNode(rawToken);
  const op = await findMinecraftOperationById(opId);
  if (!op) {
    throw new AppError(404, "Operation not found.", "MINECRAFT_OPERATION_NOT_FOUND");
  }
  const workload = await findWorkloadFromRegistry(op.workloadId);
  if (!workload || workload.nodeId !== node.id) {
    throw new AppError(404, "Operation not found.", "MINECRAFT_OPERATION_NOT_FOUND");
  }
  const completed = await completeMinecraftOperation(opId, {
    status: payload.status,
    result: (payload.result ?? null) as Prisma.InputJsonValue | null,
    error: payload.error ?? null
  });

  if (payload.status === "failed") {
    await processMinecraftOperationFailure(op, payload.error ?? "operation failed");
    if (shouldSurfaceMinecraftOperationError(op, payload.error ?? "")) {
      minecraftConsoleGateway.publishError(op.workloadId, payload.error ?? "operation failed");
    }
  } else {
    await processMinecraftOperationSideEffects(op, completed);
    const output = formatMinecraftOperationOutput(
      (completed.result as Record<string, unknown> | null) ?? payload.result ?? null
    );
    if (shouldPublishMinecraftOperationResult(op, output)) {
      const payloadRecord = (op.payload as Record<string, unknown> | null) ?? null;
      const commandResultId =
        payloadRecord && typeof payloadRecord.clientRequestId === "string"
          ? payloadRecord.clientRequestId
          : op.id;
      minecraftConsoleGateway.publishCommandResult(op.workloadId, {
        id: commandResultId,
        output
      });
    }
  }
  return { ok: true };
}

export async function runMinecraftAutoSleepTick() {
  if (!env.autoSleepEnabled) {
    return 0;
  }

  const candidates = await listAutoSleepCandidateServers();
  const globalSettings = await getMinecraftGlobalSettingsRecord();
  let slept = 0;

  for (const record of candidates) {
    const activeProbe = await findActiveMinecraftOperationByWorkloadAndKind(
      record.workloadId,
      "players"
    );
    if (!activeProbe) {
      await createMinecraftOperation({
        workloadId: record.workloadId,
        kind: "players",
        payload: { source: "autosleep" } as Prisma.InputJsonValue,
        actorEmail: "system"
      });
    }

    const effectiveConfig = resolveEffectiveAutoSleepConfig(record, globalSettings);
    const playerCheckState = evaluateAutoSleepPlayerCheck(record);
    if (!playerCheckState.ok) {
      console.info("[autosleep] skipped", {
        serverId: record.id,
        planTier: record.planTier,
        source: effectiveConfig.source,
        enabled: effectiveConfig.enabled,
        idleMinutes: effectiveConfig.idleMinutes,
        action: effectiveConfig.action,
        workloadId: record.workloadId,
        playersOnline: record.currentPlayerCount,
        idleSince: record.idleSince?.toISOString() ?? null,
        reason: playerCheckState.reason
      });
      continue;
    }

    if (!effectiveConfig.enabled) {
      console.info("[autosleep] skipped", {
        serverId: record.id,
        planTier: record.planTier,
        source: effectiveConfig.source,
        enabled: effectiveConfig.enabled,
        idleMinutes: effectiveConfig.idleMinutes,
        action: effectiveConfig.action,
        workloadId: record.workloadId,
        playersOnline: record.currentPlayerCount,
        idleSince: record.idleSince?.toISOString() ?? null,
        reason: "autosleep_disabled"
      });
      continue;
    }

    if (record.currentPlayerCount > 0 || record.idleSince === null) {
      console.info("[autosleep] skipped", {
        serverId: record.id,
        planTier: record.planTier,
        source: effectiveConfig.source,
        enabled: effectiveConfig.enabled,
        idleMinutes: effectiveConfig.idleMinutes,
        action: effectiveConfig.action,
        workloadId: record.workloadId,
        playersOnline: record.currentPlayerCount,
        idleSince: record.idleSince?.toISOString() ?? null,
        reason: record.currentPlayerCount > 0 ? "players_online" : "idle_not_started"
      });
      continue;
    }

    if (record.sleepRequestedAt !== null || record.sleepingAt !== null) {
      continue;
    }

    const activeSave = await findActiveMinecraftOperationByWorkloadAndKind(record.workloadId, "save");
    const activeStop = await findActiveMinecraftOperationByWorkloadAndKind(record.workloadId, "stop");
    if (activeSave || activeStop) {
      console.info("[autosleep] skipped", {
        serverId: record.id,
        planTier: record.planTier,
        source: effectiveConfig.source,
        enabled: effectiveConfig.enabled,
        idleMinutes: effectiveConfig.idleMinutes,
        action: effectiveConfig.action,
        workloadId: record.workloadId,
        playersOnline: record.currentPlayerCount,
        idleSince: record.idleSince?.toISOString() ?? null,
        reason: "stop_or_save_in_progress"
      });
      continue;
    }

    const idleMs = Date.now() - record.idleSince.getTime();
    const idleThresholdMinutes = effectiveConfig.idleMinutes;
    if (idleMs < idleThresholdMinutes * 60_000) {
      console.info("[autosleep] skipped", {
        serverId: record.id,
        planTier: record.planTier,
        source: effectiveConfig.source,
        enabled: effectiveConfig.enabled,
        idleMinutes: effectiveConfig.idleMinutes,
        action: effectiveConfig.action,
        workloadId: record.workloadId,
        playersOnline: record.currentPlayerCount,
        idleSince: record.idleSince.toISOString(),
        reason: "below_idle_threshold",
        currentIdleMinutes: Math.floor(idleMs / 60_000),
        thresholdMinutes: idleThresholdMinutes
      });
      continue;
    }

    await createAuditLog({
      action: "minecraft.server.autosleep",
      actorEmail: "system",
      targetType: "system",
      targetId: record.id,
      metadata: {
        phase: "requested",
        workloadId: record.workloadId,
        idleSince: record.idleSince.toISOString(),
        idleMinutes: Math.floor(idleMs / 60_000),
        planTier: record.planTier,
        source: effectiveConfig.source,
        playersOnline: record.currentPlayerCount,
        autoSleepAction: effectiveConfig.action,
        thresholdMinutes: idleThresholdMinutes
      }
    });
    publishPhantomConsoleLifecycle(record.id, "AutoSleep triggered");

    if (!activeSave) {
      await createMinecraftOperation({
        workloadId: record.workloadId,
        kind: "save",
        payload: { source: "autosleep" } as Prisma.InputJsonValue,
        actorEmail: "system"
      });
    }

    await createMinecraftOperation({
      workloadId: record.workloadId,
      kind: "stop",
      payload: { source: "autosleep" } as Prisma.InputJsonValue,
      actorEmail: "system"
    });

    await updateMinecraftServerRecord(record.id, {
      sleepRequestedAt: new Date(),
      autoSleepAction: effectiveConfig.action
    });
    minecraftConsoleGateway.publishStatus(record.id, "stopping");
    await stopWorkload(record.workloadId);
    await createAuditLog({
      action: "minecraft.server.autosleep",
      actorEmail: "system",
      targetType: "system",
      targetId: record.id,
      metadata: {
        phase: "stop_requested",
        workloadId: record.workloadId,
        source: effectiveConfig.source,
        autoSleepAction: effectiveConfig.action
      }
    });
    slept += 1;
  }

  return slept;
}

export async function publishRuntimeMinecraftConsoleLogs(
  rawToken: string,
  serverId: string,
  payload: { lines: string[] }
) {
  const node = await authenticateRuntimeNode(rawToken);
  let record = await ensureMinecraftServerRecord(serverId);
  const workload = await findWorkloadFromRegistry(record.workloadId);
  if (!workload || workload.nodeId !== node.id || workload.type !== "minecraft") {
    throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
  }

  const lines = payload.lines
    .map((line) => sanitizeConsoleLogLine(line.trimEnd()))
    .filter((line) => line.length > 0)
    .slice(0, 200);

  const workloadRecord = await getWorkload(record.workloadId);
  let readyPromoted = false;
  for (const line of lines) {
    if (isMinecraftReadyLog(line)) {
      if (record.readyAt === null) {
        record = await updateMinecraftServerRecord(record.id, {
          readyAt: new Date(),
          wakeRequestedAt: null,
          sleepRequestedAt: null
        });
        publishPhantomConsoleLifecycle(record.id, "Server marked as running");
        minecraftConsoleGateway.publishStatus(record.id, "running");
        readyPromoted = true;
      }
      break;
    }
  }

  if (lines.length > 0) {
    minecraftConsoleGateway.publishLogs(serverId, lines);
  }

  if (!readyPromoted) {
    const runtimeState = deriveMinecraftRuntimeState(record, workloadRecord);
    if (runtimeState !== "running") {
      minecraftConsoleGateway.publishStatus(record.id, runtimeState);
    }
  }

  return { ok: true };
}

export async function getMinecraftConsoleSession(id: string) {
  const detail = await getMinecraftServer(id);
  if (detail.workload.type !== "minecraft") {
    throw new AppError(400, "Workload is not a Minecraft server.", "MINECRAFT_WORKLOAD_INVALID");
  }
  return detail;
}

async function waitForMinecraftOperation(operationId: string) {
  const deadline = Date.now() + OPERATION_WAIT_TIMEOUT_MS;
  let current = await findMinecraftOperationById(operationId);
  while (current && isOperationPending(current) && Date.now() < deadline) {
    await sleep(OPERATION_POLL_INTERVAL_MS);
    current = await findMinecraftOperationById(operationId);
  }
  if (!current) {
    throw new AppError(
      500,
      "Operation disappeared.",
      "MINECRAFT_OPERATION_GONE"
    );
  }
  return current;
}

function isOperationPending(record: MinecraftOperationRecord) {
  return record.status === "pending" || record.status === "in_progress";
}

function resolveMinecraftFileAccessMode(actor: { role?: string }): MinecraftFileAccessMode {
  return actor.role === "superadmin" || actor.role === "ops" ? "infra_admin" : "tenant_user";
}

function unwrapMinecraftFileOperation<T>(
  response: MinecraftOperationResponse,
  errorCode: string,
  fallbackMessage: string
) {
  if (response.pending) {
    throw new AppError(504, "Minecraft file operation timed out.", "MINECRAFT_FILES_TIMEOUT");
  }
  if (response.operation.status === "failed") {
    throw new AppError(
      400,
      response.operation.error ?? fallbackMessage,
      errorCode
    );
  }
  return (response.operation.result ?? {}) as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureMinecraftServerRecord(id: string) {
  const record = await findMinecraftServerRecordById(id);
  if (!record || record.deletedAt !== null) {
    throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
  }
  return record;
}

async function safeDeleteWorkload(workloadId: string) {
  try {
    await requestWorkloadDeletion(workloadId, { hardDeleteData: false });
  } catch {
    // Best-effort rollback; workload record will be cleaned up manually if this fails.
  }
}

async function allocateUniqueSlug(name: string) {
  const base = slugify(name);
  const existingBase = await findMinecraftServerRecordBySlug(base);
  if (!existingBase) {
    return base;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = randomBytes(3).toString("hex");
    const candidate = `${base}-${suffix}`.slice(0, 63);
    const existing = await findMinecraftServerRecordBySlug(candidate);
    if (!existing) {
      return candidate;
    }
  }

  throw new AppError(409, "Unable to allocate a unique server slug.", "MINECRAFT_SLUG_CONFLICT");
}

function slugify(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "server";
}

function resolveVersion(template: MinecraftTemplate, requested?: string) {
  if (!requested) {
    return template.defaultVersion;
  }
  if (!template.supportedVersions.includes(requested)) {
    throw new AppError(
      400,
      `Version ${requested} not supported for template ${template.id}.`,
      "MINECRAFT_VERSION_UNSUPPORTED"
    );
  }
  return requested;
}

function buildMinecraftEnv(input: {
  template: MinecraftTemplate;
  version: string;
  ramMb: number;
  motd: string;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  maxPlayers: number;
  onlineMode: boolean;
  whitelistEnabled: boolean;
  rconPassword: string;
}): Record<string, string> {
  const heapMb = computeHeapMb(input.ramMb);
  const jvmOptions = buildJvmOptionsForVersion(input.version);
  return {
    ...input.template.baseEnv,
    EULA: "true",
    VERSION: input.version,
    MEMORY: `${heapMb}M`,
    MOTD: input.motd,
    DIFFICULTY: input.difficulty,
    MODE: input.gameMode,
    MAX_PLAYERS: String(input.maxPlayers),
    ONLINE_MODE: input.onlineMode ? "true" : "false",
    ENABLE_WHITELIST: input.whitelistEnabled ? "true" : "false",
    ENABLE_RCON: "true",
    RCON_PORT: String(DEFAULT_RCON_PORT),
    RCON_PASSWORD: input.rconPassword,
    BROADCAST_RCON_TO_OPS: "false",
    ...(jvmOptions ? { JVM_OPTS: jvmOptions } : {})
  };
}

function buildMinecraftServerPropertiesSnapshot(input: {
  motd: string;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  maxPlayers: number;
  onlineMode: boolean;
  whitelistEnabled: boolean;
}) {
  return {
    motd: input.motd,
    "max-players": input.maxPlayers,
    "online-mode": input.onlineMode,
    difficulty: input.difficulty,
    gamemode: input.gameMode,
    "white-list": input.whitelistEnabled
  };
}

function buildUpdatedMinecraftWorkloadConfig(
  currentConfig: Record<string, unknown>,
  input: {
    version: string;
    ramMb: number;
    motd: string;
    difficulty: MinecraftDifficulty;
    gameMode: MinecraftGameMode;
    maxPlayers: number;
    onlineMode: boolean;
    whitelistEnabled: boolean;
    rconPassword: string;
  }
) {
  const envConfig = (currentConfig.env as Record<string, unknown> | undefined) ?? {};
  const nextEnv = {
    ...envConfig,
    VERSION: input.version,
    MEMORY: `${computeHeapMb(input.ramMb)}M`,
    MOTD: input.motd,
    DIFFICULTY: input.difficulty,
    MODE: input.gameMode,
    MAX_PLAYERS: String(input.maxPlayers),
    ONLINE_MODE: input.onlineMode ? "true" : "false",
    ENABLE_WHITELIST: input.whitelistEnabled ? "true" : "false",
    ENABLE_RCON: "true",
    RCON_PORT: String(DEFAULT_RCON_PORT),
    RCON_PASSWORD: input.rconPassword,
    BROADCAST_RCON_TO_OPS: "false",
    ...(() => {
      const jvmOptions = buildJvmOptionsForVersion(input.version);
      return jvmOptions ? { JVM_OPTS: jvmOptions } : {};
    })()
  };

  return {
    ...currentConfig,
    env: nextEnv
  };
}

function generateRconPassword() {
  return randomBytes(24).toString("base64url");
}

function computeHeapMb(ramMb: number) {
  const target = ramMb - JVM_HEADROOM_MB;
  return target < MIN_JVM_HEAP_MB ? MIN_JVM_HEAP_MB : target;
}

function buildJvmOptionsForVersion(version: string) {
  if (!isJava25Version(version)) {
    return "";
  }
  return "--enable-native-access=ALL-UNNAMED";
}

function isJava25Version(version: string) {
  if (/^\d{2,}\./.test(version)) {
    return true;
  }
  const match = version.match(/^1\.(\d+)\.(\d+)/);
  if (!match) {
    return false;
  }
  const minor = Number.parseInt(match[1] ?? "0", 10);
  const patch = Number.parseInt(match[2] ?? "0", 10);
  return minor > 21 || (minor === 21 && patch >= 6);
}

function toMinecraftOperation(record: MinecraftOperationRecord): MinecraftOperation {
  return {
    id: record.id,
    workloadId: record.workloadId,
    kind: record.kind as MinecraftOperationKind,
    status: record.status as MinecraftOperationStatus,
    payload: (record.payload as Record<string, unknown>) ?? {},
    result: (record.result as Record<string, unknown> | null) ?? null,
    error: record.error,
    attempts: record.attempts,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null
  };
}

function toMinecraftServer(record: MinecraftServerRecord): MinecraftServer {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    hostname: record.hostname ?? buildHostname(record.hostnameSlug ?? record.slug),
    hostnameSlug: record.hostnameSlug ?? record.slug,
    hostnameUpdatedAt: record.hostnameUpdatedAt?.toISOString() ?? null,
    dnsStatus: (record.dnsStatus as MinecraftServer["dnsStatus"]) ?? "wildcard",
    dnsLastError: record.dnsLastError ?? null,
    dnsSyncedAt: record.dnsSyncedAt?.toISOString() ?? null,
    workloadId: record.workloadId,
    templateId: record.templateId,
    minecraftVersion: record.minecraftVersion,
    motd: record.motd,
    difficulty: record.difficulty as MinecraftDifficulty,
    gameMode: record.gameMode as MinecraftGameMode,
    maxPlayers: record.maxPlayers,
    eula: record.eula,
    planTier: record.planTier as PlanTier,
    autoSleepUseGlobalDefaults: record.autoSleepUseGlobalDefaults,
    autoSleepEnabled: record.autoSleepEnabled,
    autoSleepIdleMinutes: record.autoSleepIdleMinutes,
    autoSleepAction: record.autoSleepAction as MinecraftAutoSleepAction,
    onlineMode: record.onlineMode,
    whitelistEnabled: record.whitelistEnabled,
    runtimeState: record.sleepingAt !== null ? "sleeping" : "stopped",
    sleeping: record.sleepingAt !== null,
    currentPlayerCount: record.currentPlayerCount,
    idleSince: record.idleSince?.toISOString() ?? null,
    lastPlayerSeenAt: record.lastPlayerSeenAt?.toISOString() ?? null,
    lastPlayerSampleAt: record.lastPlayerSampleAt?.toISOString() ?? null,
    lastPlayerCheckFailedAt: record.lastPlayerCheckFailedAt?.toISOString() ?? null,
    lastPlayerCheckError: record.lastPlayerCheckError ?? null,
    lastConsoleCommandAt: record.lastConsoleCommandAt?.toISOString() ?? null,
    sleepRequestedAt: record.sleepRequestedAt?.toISOString() ?? null,
    sleepingAt: record.sleepingAt?.toISOString() ?? null,
    wakeRequestedAt: record.wakeRequestedAt?.toISOString() ?? null,
    readyAt: record.readyAt?.toISOString() ?? null,
    serverProperties: (record.serverProperties as Record<string, unknown>) ?? {},
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null
  };
}

async function toMinecraftServerWithRuntime(
  record: MinecraftServerRecord,
  workload: CompanyWorkload
): Promise<MinecraftServerWithWorkload> {
  const node = workload.nodeId ? await findNodeFromRegistry(workload.nodeId) : null;
  const server = toMinecraftServer(record);
  server.runtimeState = deriveMinecraftRuntimeState(record, workload);
  return {
    server,
    workload,
    node: node
      ? {
          id: node.id,
          name: node.name,
          publicHost: node.publicHost,
          internalHost: node.internalHost
        }
      : null,
    hostname: record.hostname ?? null,
    connectAddress: record.hostname ?? null
  };
}

function formatMinecraftOperationOutput(result: Record<string, unknown> | null) {
  if (!result) {
    return "";
  }

  if (typeof result.output === "string" && result.output.trim().length > 0) {
    return result.output;
  }

  if (Array.isArray(result.lines)) {
    return result.lines.filter((line): line is string => typeof line === "string").join("\n");
  }

  if (typeof result.stderr === "string" && result.stderr.trim().length > 0) {
    return result.stderr;
  }

  return JSON.stringify(result);
}

function isMinecraftFileOperation(kind: MinecraftOperationRecord["kind"]) {
  return kind.startsWith("files.");
}

function shouldPublishMinecraftOperationResult(
  op: MinecraftOperationRecord,
  output: string
) {
  if (isMinecraftFileOperation(op.kind)) {
    return false;
  }
  const payload = (op.payload as Record<string, unknown> | null) ?? null;
  const source = typeof payload?.source === "string" ? payload.source : null;
  const normalized = sanitizeCommandResultOutput(output);

  if (op.kind === "players") {
    return false;
  }

  if (source === "autosleep" && (op.kind === "save" || op.kind === "stop")) {
    return false;
  }

  if (normalized.length === 0) {
    return false;
  }

  return true;
}

async function processMinecraftOperationSideEffects(
  op: MinecraftOperationRecord,
  completed: MinecraftOperationRecord
) {
  const server = await findMinecraftServerRecordByWorkloadId(op.workloadId);
  if (!server || server.deletedAt !== null) {
    return;
  }

  if (op.kind === "players") {
    const sample = parsePlayerSample(
      (completed.result as Record<string, unknown> | null) ?? null,
      server.maxPlayers
    );
    if (!sample.ok) {
      const now = new Date();
      await updateMinecraftServerRecord(server.id, {
        idleSince: null,
        sleepRequestedAt: null,
        lastPlayerCheckFailedAt: now,
        lastPlayerCheckError: sample.reason
      });
      console.info("[autosleep] player check failed", {
        serverId: server.id,
        workloadId: server.workloadId,
        reason: sample.reason
      });
      return;
    }
    const now = new Date();
    await updateMinecraftServerRecord(server.id, {
      currentPlayerCount: sample.currentPlayers,
      lastPlayerSampleAt: now,
      lastPlayerCheckFailedAt: null,
      lastPlayerCheckError: null,
      lastPlayerSeenAt: sample.currentPlayers > 0 ? now : undefined,
      lastActivityAt: sample.currentPlayers > 0 ? now : undefined,
      idleSince:
        sample.currentPlayers > 0
          ? null
          : server.idleSince ?? server.lastActivityAt ?? server.lastConsoleCommandAt ?? now,
      sleepRequestedAt: sample.currentPlayers > 0 ? null : undefined,
      sleepingAt: sample.currentPlayers > 0 ? null : undefined
    });
    return;
  }

  if (op.kind === "stop" && op.actorEmail === "system") {
    const payload = (op.payload as Record<string, unknown> | null) ?? null;
    if (payload?.source === "autosleep") {
      publishPhantomConsoleLifecycle(server.id, "AutoSleep stop sent");
      await createAuditLog({
        action: "minecraft.server.autosleep",
        actorEmail: "system",
        targetType: "system",
        targetId: server.id,
        metadata: {
          phase: "stop_sent",
          workloadId: server.workloadId
        }
      });
    }
  }
}

async function processMinecraftOperationFailure(op: MinecraftOperationRecord, error: string) {
  if (op.kind !== "players") {
    return;
  }
  const server = await findMinecraftServerRecordByWorkloadId(op.workloadId);
  if (!server || server.deletedAt !== null) {
    return;
  }
  const now = new Date();
  await updateMinecraftServerRecord(server.id, {
    idleSince: null,
    sleepRequestedAt: null,
    lastPlayerCheckFailedAt: now,
    lastPlayerCheckError: error
  });
  console.info("[autosleep] player check failed", {
    serverId: server.id,
    workloadId: server.workloadId,
    reason: error
  });
}

function sanitizeConsoleLogLine(line: string) {
  const sanitized = line.replace(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s+/,
    ""
  );
  if (isSuppressedJavaWarning(sanitized)) {
    return "";
  }
  if (
    /container .* is not running/i.test(sanitized) ||
    /rcon.*connection refused/i.test(sanitized)
  ) {
    return "";
  }
  return sanitized;
}

function isSuppressedJavaWarning(line: string) {
  return [
    "WARNING: A restricted method in java.lang.System has been called",
    "WARNING: java.lang.System::load has been called",
    "WARNING: Use --enable-native-access=ALL-UNNAMED",
    "WARNING: Restricted methods will be blocked in a future release",
    "WARNING: A terminally deprecated method in sun.misc.Unsafe has been called",
    "WARNING: sun.misc.Unsafe::objectFieldOffset",
    "WARNING: Please consider reporting this to the maintainers"
  ].some((snippet) => line.includes(snippet));
}

function isMinecraftReadyLog(line: string) {
  const sanitized = sanitizeConsoleLogLine(line);
  return /\bDone \([^)]+\)! For help, type "help"/.test(sanitized);
}

function sanitizeCommandResultOutput(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '{"output":"\\n","stderr":""}')
    .join("\n")
    .trim();
}

function publishPhantomConsoleLifecycle(serverId: string, message: string) {
  minecraftConsoleGateway.publishLogs(serverId, [`__PHANTOM__ ${message}`]);
}

function shouldSurfaceMinecraftOperationError(op: MinecraftOperationRecord, error: string) {
  if (isMinecraftFileOperation(op.kind)) {
    return false;
  }
  const normalized = error.trim().toLowerCase();
  const payload = (op.payload as Record<string, unknown> | null) ?? null;
  const source = typeof payload?.source === "string" ? payload.source : null;

  if (
    normalized.includes("container is not running") ||
    normalized.includes("connection refused")
  ) {
    if (op.kind === "players" || source === "autosleep") {
      return false;
    }
  }

  return normalized.length > 0;
}

function deriveMinecraftRuntimeState(
  record: MinecraftServerRecord,
  workload: CompanyWorkload
): MinecraftServer["runtimeState"] {
  if (record.sleepingAt !== null) {
    return "sleeping";
  }
  if (record.sleepRequestedAt !== null) {
    return "stopping";
  }
  if (workload.status === "crashed") {
    return "crashed";
  }
  if (workload.status === "stopped") {
    return "stopped";
  }
  if (workload.status === "queued_start" || workload.status === "pending") {
    return "waking";
  }
  if (workload.status === "creating") {
    return record.wakeRequestedAt !== null ? "waking" : "starting";
  }
  if (workload.status === "running") {
    if (record.readyAt !== null) {
      return "running";
    }
    return record.wakeRequestedAt !== null ? "waking" : "starting";
  }
  return "starting";
}

async function prepareMinecraftServerForDelete(record: MinecraftServerRecord) {
  await createAuditLog({
    action: "minecraft.server.dns_cleanup",
    actorEmail: "system",
    targetType: "system",
    targetId: record.id,
    metadata: {
      hostname: record.hostname,
      dnsProvider: "wildcard",
      status: "skipped"
    }
  });

  return updateMinecraftServerRecord(record.id, {
    dnsStatus: "disabled",
    dnsLastError: null,
    dnsSyncedAt: null
  });
}

function parsePlayerSample(result: Record<string, unknown> | null, maxPlayers: number) {
  const output = typeof result?.output === "string" ? result.output : "";
  const match = output.match(/There are\s+(\d+)\s+of a max(?:imum)?\s+(\d+)\s+players online/i);
  if (!match) {
    return { ok: false as const, currentPlayers: 0, maxPlayers, reason: "unparseable_player_count" };
  }
  return {
    ok: true as const,
    currentPlayers: Number.parseInt(match[1] ?? "0", 10) || 0,
    maxPlayers: Number.parseInt(match[2] ?? String(maxPlayers), 10) || maxPlayers
  };
}

function evaluateAutoSleepPlayerCheck(record: MinecraftServerRecord) {
  const freshnessWindowMs = Math.max(env.autoSleepMonitorTickMs * 3, 90_000);
  if (record.lastPlayerCheckFailedAt !== null) {
    if (
      record.lastPlayerSampleAt === null ||
      record.lastPlayerCheckFailedAt.getTime() >= record.lastPlayerSampleAt.getTime()
    ) {
      return { ok: false as const, reason: "player_check_failed" };
    }
  }

  if (record.lastPlayerSampleAt === null) {
    return { ok: false as const, reason: "missing_player_sample" };
  }

  const sampleAgeMs = Date.now() - record.lastPlayerSampleAt.getTime();
  if (sampleAgeMs > freshnessWindowMs) {
    return { ok: false as const, reason: "stale_player_sample" };
  }

  return { ok: true as const };
}

function resolveEffectiveAutoSleepConfig(
  record: MinecraftServerRecord,
  globalSettings: Awaited<ReturnType<typeof getMinecraftGlobalSettingsRecord>>
) {
  if (record.planTier !== "free") {
    return {
      source: "override" as const,
      enabled: record.autoSleepEnabled,
      idleMinutes: record.autoSleepIdleMinutes,
      action: record.autoSleepAction as MinecraftAutoSleepAction
    };
  }

  if (record.autoSleepUseGlobalDefaults) {
    return {
      source: "global" as const,
      enabled: globalSettings.freeAutoSleepEnabled,
      idleMinutes: globalSettings.freeAutoSleepIdleMinutes,
      action: globalSettings.freeAutoSleepAction as MinecraftAutoSleepAction
    };
  }

  return {
    source: "override" as const,
    enabled: record.autoSleepEnabled,
    idleMinutes: record.autoSleepIdleMinutes,
    action: record.autoSleepAction as MinecraftAutoSleepAction
  };
}
