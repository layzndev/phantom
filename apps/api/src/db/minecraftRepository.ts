import { Prisma } from "@prisma/client";
import { db } from "./client.js";

export interface CreateMinecraftServerRecordInput {
  name: string;
  slug: string;
  workloadId: string;
  templateId: string;
  minecraftVersion: string;
  motd: string | null;
  difficulty: string;
  gameMode: string;
  maxPlayers: number;
  eula: boolean;
  serverProperties: Prisma.InputJsonValue;
  rconPassword: string;
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
      workloadId: input.workloadId,
      templateId: input.templateId,
      minecraftVersion: input.minecraftVersion,
      motd: input.motd,
      difficulty: input.difficulty,
      gameMode: input.gameMode,
      maxPlayers: input.maxPlayers,
      eula: input.eula,
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

export function findMinecraftServerRecordByWorkloadId(workloadId: string) {
  return db.minecraftServer.findUnique({ where: { workloadId } });
}

export function listMinecraftServerRecords(filter: MinecraftServerFilter = {}) {
  const where: Prisma.MinecraftServerWhereInput = {};
  if (filter.templateId !== undefined) where.templateId = filter.templateId;
  if (!filter.includeDeleted) where.deletedAt = null;

  return db.minecraftServer.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
}
