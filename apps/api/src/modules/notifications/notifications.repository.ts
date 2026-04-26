import { db } from "../../db/client.js";
import type { DbJsonInput } from "../../db/types.js";

export function listSystemNotificationRecords(options?: {
  includeDismissed?: boolean;
  limit?: number;
}) {
  return db.systemNotification.findMany({
    where: options?.includeDismissed ? undefined : { dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 100
  });
}

export function createSystemNotificationRecord(input: {
  kind: string;
  severity: string;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  nodeId?: string;
  metadata?: DbJsonInput;
}) {
  return db.systemNotification.create({
    data: {
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      body: input.body,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      nodeId: input.nodeId,
      metadata: input.metadata
    }
  });
}

export function markSystemNotificationReadRecord(id: string, adminId: string) {
  return db.systemNotification.update({
    where: { id },
    data: {
      readAt: new Date(),
      readByAdminId: adminId
    }
  });
}

export function markAllSystemNotificationsReadRecord(adminId: string) {
  return db.systemNotification.updateMany({
    where: {
      readAt: null,
      dismissedAt: null
    },
    data: {
      readAt: new Date(),
      readByAdminId: adminId
    }
  });
}

export function dismissSystemNotificationRecord(id: string, adminId: string) {
  return db.systemNotification.update({
    where: { id },
    data: {
      dismissedAt: new Date(),
      dismissedByAdminId: adminId
    }
  });
}
