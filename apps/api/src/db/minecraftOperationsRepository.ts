import { Prisma } from "@prisma/client";
import { db } from "./client.js";

export type MinecraftOperationKind = "command" | "save" | "logs" | "stop" | "players";
export type MinecraftOperationStatus =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed";

export interface CreateMinecraftOperationInput {
  workloadId: string;
  kind: MinecraftOperationKind;
  payload: Prisma.InputJsonValue;
  actorId?: string | null;
  actorEmail?: string | null;
}

export interface CompleteMinecraftOperationInput {
  status: "succeeded" | "failed";
  result?: Prisma.InputJsonValue | null;
  error?: string | null;
}

export function createMinecraftOperation(input: CreateMinecraftOperationInput) {
  return db.minecraftOperation.create({
    data: {
      workloadId: input.workloadId,
      kind: input.kind,
      payload: input.payload,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null
    }
  });
}

export function findMinecraftOperationById(id: string) {
  return db.minecraftOperation.findUnique({ where: { id } });
}

export async function listPendingMinecraftOperationsForNode(nodeId: string, limit = 5) {
  return db.minecraftOperation.findMany({
    where: {
      status: "pending",
      workload: { nodeId }
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });
}

export function markMinecraftOperationInProgress(id: string) {
  return db.minecraftOperation.updateMany({
    where: { id, status: "pending" },
    data: {
      status: "in_progress",
      startedAt: new Date(),
      attempts: { increment: 1 }
    }
  });
}

export function completeMinecraftOperation(id: string, input: CompleteMinecraftOperationInput) {
  return db.minecraftOperation.update({
    where: { id },
    data: {
      status: input.status,
      result: input.result ?? Prisma.JsonNull,
      error: input.error ?? null,
      completedAt: new Date()
    }
  });
}

export function findActiveMinecraftOperationByWorkloadAndKind(
  workloadId: string,
  kind: MinecraftOperationKind
) {
  return db.minecraftOperation.findFirst({
    where: {
      workloadId,
      kind,
      status: { in: ["pending", "in_progress"] }
    },
    orderBy: { createdAt: "desc" }
  });
}
