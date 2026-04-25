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
  | "minecraft.template.list"
  | "minecraft.server.list"
  | "minecraft.server.detail"
  | "minecraft.server.create"
  | "minecraft.server.start"
  | "minecraft.server.stop"
  | "minecraft.server.restart"
  | "minecraft.server.hostname"
  | "minecraft.server.dns_cleanup"
  | "minecraft.server.delete"
  | "minecraft.server.autosleep"
  | "minecraft.server.command"
  | "minecraft.server.save"
  | "minecraft.server.logs"
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
