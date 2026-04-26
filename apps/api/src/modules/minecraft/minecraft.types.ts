import type { CompanyWorkload } from "../workloads/workloads.types.js";

export type MinecraftDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type MinecraftGameMode = "survival" | "creative" | "adventure" | "spectator";
export type PlanTier = "free" | "premium";
export type MinecraftDnsStatus = "wildcard" | "disabled" | "pending" | "active" | "failed";
export type MinecraftFileAccessMode = "infra_admin" | "tenant_user";
export type MinecraftAutoSleepAction = "sleep" | "stop";
export type MinecraftRuntimeState =
  | "sleeping"
  | "waking"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed";

export const PLAN_TIERS: readonly PlanTier[] = ["free", "premium"] as const;

export interface MinecraftServer {
  id: string;
  name: string;
  slug: string;
  hostname: string;
  hostnameSlug: string;
  hostnameUpdatedAt: string | null;
  dnsStatus: MinecraftDnsStatus;
  dnsLastError: string | null;
  dnsSyncedAt: string | null;
  workloadId: string;
  templateId: string;
  minecraftVersion: string;
  motd: string | null;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  maxPlayers: number;
  eula: boolean;
  planTier: PlanTier;
  autoSleepUseGlobalDefaults: boolean;
  autoSleepEnabled: boolean;
  autoSleepIdleMinutes: number;
  autoSleepAction: MinecraftAutoSleepAction;
  onlineMode: boolean;
  whitelistEnabled: boolean;
  runtimeState: MinecraftRuntimeState;
  sleeping: boolean;
  currentPlayerCount: number;
  idleSince: string | null;
  lastPlayerSeenAt: string | null;
  lastPlayerSampleAt: string | null;
  lastPlayerCheckFailedAt: string | null;
  lastPlayerCheckError: string | null;
  lastConsoleCommandAt: string | null;
  sleepRequestedAt: string | null;
  sleepingAt: string | null;
  wakeRequestedAt: string | null;
  readyAt: string | null;
  serverProperties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MinecraftGlobalSettings {
  freeAutoSleepEnabled: boolean;
  freeAutoSleepIdleMinutes: number;
  freeAutoSleepAction: MinecraftAutoSleepAction;
}

export interface MinecraftServerWithWorkload {
  server: MinecraftServer;
  workload: CompanyWorkload;
  node?: {
    id: string;
    name: string;
    publicHost: string;
    internalHost: string;
  } | null;
  hostname?: string | null;
  connectAddress: string | null;
}

export interface CreateMinecraftServerResult {
  server: MinecraftServer;
  workload: CompanyWorkload;
  placed: boolean;
  reason?: string;
  diagnostics?: import("../workloads/workloads.scheduler.js").SchedulerDiagnostics;
}

export interface DeleteMinecraftServerResult {
  server: MinecraftServer | null;
  workload: CompanyWorkload | null;
  finalized: boolean;
}

export type MinecraftOperationKind =
  | "command"
  | "save"
  | "logs"
  | "stop"
  | "players"
  | "files.list"
  | "files.read"
  | "files.write"
  | "files.upload"
  | "files.mkdir"
  | "files.rename"
  | "files.delete"
  | "files.archive"
  | "files.extract";
export type MinecraftOperationStatus =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed";

export interface MinecraftOperation {
  id: string;
  workloadId: string;
  kind: MinecraftOperationKind;
  status: MinecraftOperationStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MinecraftOperationResponse {
  operation: MinecraftOperation;
  pending: boolean;
}

export interface MinecraftLogsResult {
  lines: string[];
}

export interface MinecraftFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  sizeBytes: number;
  modifiedAt: string;
}

export interface MinecraftFilesListResult {
  path: string;
  parentPath: string | null;
  entries: MinecraftFileEntry[];
}

export interface MinecraftFileReadResult {
  path: string;
  content: string;
  modifiedAt: string;
  sizeBytes: number;
  encoding: "utf-8";
  readOnly?: boolean;
  redacted?: boolean;
}

export interface UpdateMinecraftServerSettingsInput {
  autoSleepUseGlobalDefaults: boolean;
  autoSleepEnabled: boolean;
  autoSleepIdleMinutes: number;
  autoSleepAction: MinecraftAutoSleepAction;
  maxPlayers: number;
  onlineMode: boolean;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  motd: string;
  whitelistEnabled: boolean;
}
