import { createAuditLogRecord, listAuditLogRecords } from "../../db/auditRepository.js";
import type { DbJsonInput } from "../../db/types.js";
import type { AuditAction } from "./audit.types.js";

export function createAuditLog(input: {
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
  return createAuditLogRecord(input);
}

export function listAuditLogs(limit = 100) {
  return listAuditLogRecords(limit);
}
