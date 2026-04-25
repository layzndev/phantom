import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/appError.js";
import {
  createMinecraftServerRecord,
  findMinecraftServerRecordById,
  findMinecraftServerRecordBySlug,
  listMinecraftServerRecords
} from "../../db/minecraftRepository.js";
import {
  completeMinecraftOperation,
  createMinecraftOperation,
  findMinecraftOperationById,
  listPendingMinecraftOperationsForNode,
  markMinecraftOperationInProgress,
  type MinecraftOperationKind as RepoOperationKind
} from "../../db/minecraftOperationsRepository.js";
import { authenticateRuntimeNode } from "../nodes/nodes.service.js";
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
  MinecraftServerWithWorkload
} from "./minecraft.types.js";

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
      return { server: toMinecraftServer(record), workload };
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
  return { server: toMinecraftServer(record), workload };
}

export async function createMinecraftServer(
  input: CreateMinecraftServerInput
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

  const slug = await allocateUniqueSlug(input.name);
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
    ports: [{ internalPort: DEFAULT_GAME_PORT, protocol: "tcp" }],
    config
  });

  try {
    const record = await createMinecraftServerRecord({
      name: input.name,
      slug,
      workloadId: placement.workload.id,
      templateId: template.id,
      minecraftVersion: version,
      motd,
      difficulty,
      gameMode,
      maxPlayers,
      eula: true,
      serverProperties: {} as Prisma.InputJsonValue,
      rconPassword
    });

    return {
      server: toMinecraftServer(record),
      workload: placement.workload,
      placed: placement.placed,
      reason: placement.reason
    };
  } catch (error) {
    await safeDeleteWorkload(placement.workload.id);
    throw error;
  }
}

export async function startMinecraftServer(id: string) {
  const record = await ensureMinecraftServerRecord(id);
  const workload = await startWorkload(record.workloadId);
  return { server: toMinecraftServer(record), workload };
}

export async function stopMinecraftServer(id: string) {
  const record = await ensureMinecraftServerRecord(id);
  const workload = await stopWorkload(record.workloadId);
  return { server: toMinecraftServer(record), workload };
}

export async function restartMinecraftServer(id: string) {
  const record = await ensureMinecraftServerRecord(id);
  const workload = await restartWorkload(record.workloadId);
  return { server: toMinecraftServer(record), workload };
}

export async function deleteMinecraftServer(
  id: string,
  options: DeleteMinecraftServerQuery
): Promise<DeleteMinecraftServerResult> {
  const record = await ensureMinecraftServerRecord(id);
  const result = await requestWorkloadDeletion(record.workloadId, options);
  return {
    server: result.finalized ? null : toMinecraftServer(record),
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
  if (workload.status !== "running") {
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
  await completeMinecraftOperation(opId, {
    status: payload.status,
    result: (payload.result ?? null) as Prisma.InputJsonValue | null,
    error: payload.error ?? null
  });
  return { ok: true };
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
    workloadId: record.workloadId,
    templateId: record.templateId,
    minecraftVersion: record.minecraftVersion,
    motd: record.motd,
    difficulty: record.difficulty as MinecraftDifficulty,
    gameMode: record.gameMode as MinecraftGameMode,
    maxPlayers: record.maxPlayers,
    eula: record.eula,
    serverProperties: (record.serverProperties as Record<string, unknown>) ?? {},
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null
  };
}
