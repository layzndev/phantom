import type { CompanyWorkload } from "../workloads/workloads.types.js";

export type MinecraftDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type MinecraftGameMode = "survival" | "creative" | "adventure" | "spectator";

export interface MinecraftServer {
  id: string;
  name: string;
  slug: string;
  workloadId: string;
  templateId: string;
  minecraftVersion: string;
  motd: string | null;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  maxPlayers: number;
  eula: boolean;
  serverProperties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MinecraftServerWithWorkload {
  server: MinecraftServer;
  workload: CompanyWorkload;
}

export interface CreateMinecraftServerResult {
  server: MinecraftServer;
  workload: CompanyWorkload;
  placed: boolean;
  reason?: string;
}

export type MinecraftOperationKind = "command" | "save" | "logs";
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
