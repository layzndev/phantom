import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/appError.js";
import { env } from "../../config/env.js";
import { createAuditLog } from "../audit/audit.repository.js";
import {
  createMinecraftServerRecord,
  findMinecraftServerRecordById,
  findMinecraftServerRecordByHostnameSlug,
  findMinecraftServerRecordBySlug,
  findMinecraftServerRecordByWorkloadId,
  listAutoSleepCandidateServers,
  listMinecraftServerRecords,
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
  stopWorkload
} from "../workloads/workloads.service.js";
import type { CompanyWorkload } from "../workloads/workloads.types.js";
import type {
  CreateMinecraftServerInput,
  DeleteMinecraftServerQuery
} from "./minecraft.schema.js";
import {
  findMinecraftTemplate,
  listMinecraftTemplates,
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
  MinecraftDifficulty,
  MinecraftGameMode,
  MinecraftOperation,
  MinecraftOperationKind,
  MinecraftOperationResponse,
  MinecraftOperationStatus,
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

const DEFAULT_GAME_PORT = 25565;
const DEFAULT_RCON_PORT = 25575;
const MIN_JVM_HEAP_MB = 1024;
const JVM_HEADROOM_MB = 512;
const MINECRAFT_STOP_TIMEOUT_SECONDS = 60;
const MINECRAFT_VOLUME_NAME = "minecraft-data";
const MINECRAFT_VOLUME_CONTAINER_PATH = "/data";
const OPERATION_WAIT_TIMEOUT_MS = 5_000;
const OPERATION_POLL_INTERVAL_MS = 250;

export function getMinecraftTemplates() {
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

export async function getMinecraftServer(id: string): Promise<MinecraftServerWithWorkload> {
  const record = await findMinecraftServerRecordById(id);
  if (!record || record.deletedAt !== null) {
    throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
  }
  const workload = await getWorkload(record.workloadId);
  return toMinecraftServerWithRuntime(record, workload);
}

export async function createMinecraftServer(
  input: CreateMinecraftServerInput,
  actor?: { email?: string | null }
): Promise<CreateMinecraftServerResult> {
  const template = findMinecraftTemplate(input.templateId);
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

  const env = buildMinecraftEnv({
    template,
    version,
    ramMb,
    motd: motd ?? `${input.name} — Phantom`,
    difficulty,
    gameMode,
    maxPlayers,
    rconPassword
  });

  const config: Record<string, unknown> = {
    env,
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
      gamePort: DEFAULT_GAME_PORT,
      rconPort: DEFAULT_RCON_PORT,
      gracefulStopCommand: "stop"
    }
  };

  const placement = await createWorkload({
    name: input.name,
    type: "minecraft",
    image: template.image,
    requestedCpu: cpu,
    requestedRamMb: ramMb,
    requestedDiskGb: diskGb,
    requiredPool,
    ports: [{ internalPort: DEFAULT_GAME_PORT, protocol: "tcp" }],
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
      autoSleepEnabled: planTier === "free",
      serverProperties: {} as Prisma.InputJsonValue,
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
  const gamePort = workload.ports.find((port) => port.internalPort === DEFAULT_GAME_PORT)?.externalPort ?? null;

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

    if (record.currentPlayerCount > 0 || record.idleSince === null) {
      continue;
    }

    if (record.sleepRequestedAt !== null || record.sleepingAt !== null) {
      continue;
    }

    const activeSave = await findActiveMinecraftOperationByWorkloadAndKind(record.workloadId, "save");
    const activeStop = await findActiveMinecraftOperationByWorkloadAndKind(record.workloadId, "stop");
    if (activeSave || activeStop) {
      continue;
    }

    const idleMs = Date.now() - record.idleSince.getTime();
    if (idleMs < env.autoSleepIdleMinutes * 60_000) {
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
        planTier: record.planTier
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
      sleepRequestedAt: new Date()
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
        source: "autosleep"
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
  rconPassword: string;
}): Record<string, string> {
  const heapMb = computeHeapMb(input.ramMb);
  return {
    ...input.template.baseEnv,
    EULA: "true",
    VERSION: input.version,
    MEMORY: `${heapMb}M`,
    MOTD: input.motd,
    DIFFICULTY: input.difficulty,
    MODE: input.gameMode,
    MAX_PLAYERS: String(input.maxPlayers),
    ENABLE_RCON: "true",
    RCON_PORT: String(DEFAULT_RCON_PORT),
    RCON_PASSWORD: input.rconPassword,
    BROADCAST_RCON_TO_OPS: "false"
  };
}

function generateRconPassword() {
  return randomBytes(24).toString("base64url");
}

function computeHeapMb(ramMb: number) {
  const target = ramMb - JVM_HEADROOM_MB;
  return target < MIN_JVM_HEAP_MB ? MIN_JVM_HEAP_MB : target;
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
    autoSleepEnabled: record.autoSleepEnabled,
    runtimeState: record.sleepingAt !== null ? "sleeping" : "stopped",
    sleeping: record.sleepingAt !== null,
    currentPlayerCount: record.currentPlayerCount,
    idleSince: record.idleSince?.toISOString() ?? null,
    lastPlayerSeenAt: record.lastPlayerSeenAt?.toISOString() ?? null,
    lastPlayerSampleAt: record.lastPlayerSampleAt?.toISOString() ?? null,
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

function shouldPublishMinecraftOperationResult(
  op: MinecraftOperationRecord,
  output: string
) {
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
    const now = new Date();
    await updateMinecraftServerRecord(server.id, {
      currentPlayerCount: sample.currentPlayers,
      lastPlayerSampleAt: now,
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

function sanitizeConsoleLogLine(line: string) {
  const sanitized = line.replace(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s+/,
    ""
  );
  if (
    /container .* is not running/i.test(sanitized) ||
    /rcon.*connection refused/i.test(sanitized)
  ) {
    return "";
  }
  return sanitized;
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
    return { currentPlayers: 0, maxPlayers };
  }
  return {
    currentPlayers: Number.parseInt(match[1] ?? "0", 10) || 0,
    maxPlayers: Number.parseInt(match[2] ?? String(maxPlayers), 10) || maxPlayers
  };
}
