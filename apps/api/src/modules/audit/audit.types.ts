export type AuditAction =
  | "admin.login"
  | "admin.login_failed"
  | "admin.logout"
  | "node.list"
  | "node.create"
  | "node.detail"
  | "node.sync"
  | "node.update"
  | "node.delete"
  | "node.maintenance"
  | "node.reconcile"
  | "node.refresh"
  | "node.rotate-token"
  | "workload.list"
  | "workload.create"
  | "workload.detail"
  | "workload.update"
  | "workload.delete"
  | "workload.start"
  | "workload.stop"
  | "workload.restart"
  | "workload.kill"
  | "workload.schedule_failed"
  | "system.critical_error";

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorId?: string;
  actorEmail: string;
  targetType?: "node" | "admin" | "system";
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}
