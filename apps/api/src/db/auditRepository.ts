import type { AuditAction } from "../modules/audit/audit.types.js";
import type { DbJsonInput } from "./types.js";
import { db } from "./client.js";

export function createAuditLogRecord(input: {
  action: AuditAction;
  actorId?: string;
  actorEmail: string;
  targetType?: "node" | "admin" | "system";
  targetId?: string;
  metadata?: DbJsonInput;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}) {
  return db.auditLog.create({
    data: input
  });
}

export function listAuditLogRecords(limit = 100) {
  return db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit
  });
}
