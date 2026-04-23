import type { Request } from "express";
import type { DbJsonInput } from "../../db/types.js";
import { createAuditLog, listAuditLogs as listAuditLogRecords } from "./audit.repository.js";
import type { AuditLogEntry } from "./audit.types.js";

export async function writeAuditLog(req: Request, entry: Omit<AuditLogEntry, "id" | "ip" | "userAgent" | "createdAt">) {
  await createAuditLog({
    action: entry.action,
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata as DbJsonInput | undefined,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    sessionId: req.sessionID
  });
}

export async function listAuditLogs() {
  const logs = await listAuditLogRecords(100);

  return logs.map((log) => ({
    id: log.id,
    action: log.action as AuditLogEntry["action"],
    actorId: log.actorId ?? "",
    actorEmail: log.actorEmail,
    targetType: log.targetType as AuditLogEntry["targetType"],
    targetId: log.targetId ?? undefined,
    metadata: log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata) ? (log.metadata as Record<string, unknown>) : undefined,
    ip: log.ipAddress ?? undefined,
    userAgent: log.userAgent ?? undefined,
    createdAt: log.createdAt.toISOString()
  }));
}

export async function writeCriticalErrorAuditLog(req: Request, error: unknown) {
  await createAuditLog({
    action: "system.critical_error",
    actorId: req.session?.admin?.id,
    actorEmail: req.session?.admin?.email ?? "system",
    targetType: "system",
    targetId: req.requestId,
    metadata: {
      requestId: req.requestId,
      path: req.originalUrl,
      method: req.method,
      message: error instanceof Error ? error.message : "Unknown error"
    },
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    sessionId: req.sessionID
  }).catch((auditError) => {
    console.error("critical audit write failed", auditError);
  });
}
