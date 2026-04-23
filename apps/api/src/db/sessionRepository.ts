import type { DbJsonInput } from "./types.js";
import { db } from "./client.js";

export function findAdminSessionRecord(id: string) {
  return db.adminSession.findUnique({ where: { id } });
}

export function upsertAdminSessionRecord(input: {
  id: string;
  adminId?: string;
  data: DbJsonInput;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}) {
  return db.adminSession.upsert({
    where: { id: input.id },
    create: input,
    update: {
      adminId: input.adminId,
      data: input.data,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    }
  });
}

export function deleteAdminSessionRecord(id: string) {
  return db.adminSession.deleteMany({ where: { id } });
}

export function touchAdminSessionRecord(id: string, data: DbJsonInput, expiresAt: Date) {
  return db.adminSession.updateMany({
    where: { id },
    data: { data, expiresAt }
  });
}
