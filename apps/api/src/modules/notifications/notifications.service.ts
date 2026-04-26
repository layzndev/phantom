import { AppError } from "../../lib/appError.js";
import {
  createSystemNotificationRecord,
  dismissSystemNotificationRecord,
  listSystemNotificationRecords,
  markAllSystemNotificationsReadRecord,
  markSystemNotificationReadRecord
} from "./notifications.repository.js";
import type {
  NotificationKind,
  NotificationSeverity,
  SystemNotification
} from "./notifications.types.js";

export async function listSystemNotifications(options?: {
  includeDismissed?: boolean;
  limit?: number;
}) {
  const records = await listSystemNotificationRecords(options);
  return records.map(toSystemNotification);
}

export async function createNodeStatusNotification(input: {
  nodeId: string;
  nodeName: string;
  nodePublicHost: string;
  previousStatus: string | null;
  newStatus: string;
  reason?: string | null;
}) {
  const payload = buildNodeStatusNotificationPayload(input);
  if (!payload) {
    return null;
  }

  const record = await createSystemNotificationRecord({
    ...payload,
    nodeId: input.nodeId,
    resourceType: "node",
    resourceId: input.nodeId,
    metadata: {
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      reason: input.reason ?? null,
      nodeName: input.nodeName,
      nodePublicHost: input.nodePublicHost
    }
  });

  return toSystemNotification(record);
}

export async function markSystemNotificationRead(id: string, adminId: string) {
  try {
    const record = await markSystemNotificationReadRecord(id, adminId);
    return toSystemNotification(record);
  } catch {
    throw new AppError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
  }
}

export async function markAllSystemNotificationsRead(adminId: string) {
  const result = await markAllSystemNotificationsReadRecord(adminId);
  return {
    updatedCount: result.count,
    updatedAt: new Date().toISOString()
  };
}

export async function dismissSystemNotification(id: string, adminId: string) {
  try {
    const record = await dismissSystemNotificationRecord(id, adminId);
    return toSystemNotification(record);
  } catch {
    throw new AppError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
  }
}

function buildNodeStatusNotificationPayload(input: {
  nodeName: string;
  nodePublicHost: string;
  previousStatus: string | null;
  newStatus: string;
  reason?: string | null;
}): {
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
} | null {
  const hostSuffix = input.nodePublicHost ? ` (${input.nodePublicHost})` : "";
  const reasonSuffix = input.reason ? ` ${input.reason}` : "";

  if (input.reason === "node registered") {
    return null;
  }

  if (input.newStatus === "offline") {
    if (input.reason?.includes("maintenance disabled")) {
      return null;
    }
    return {
      kind: "node_offline",
      severity: "critical",
      title: "Node offline",
      body: `${input.nodeName}${hostSuffix} is offline.${reasonSuffix}`.trim()
    };
  }

  if (input.newStatus === "degraded") {
    return {
      kind: "node_degraded",
      severity: "warning",
      title: "Node degraded",
      body: `${input.nodeName}${hostSuffix} is degraded.${reasonSuffix}`.trim()
    };
  }

  if (input.newStatus === "maintenance") {
    return {
      kind: "node_maintenance",
      severity: "info",
      title: "Node in maintenance",
      body: `${input.nodeName}${hostSuffix} entered maintenance mode.${reasonSuffix}`.trim()
    };
  }

  if (
    input.newStatus === "healthy" &&
    (input.previousStatus === "offline" || input.previousStatus === "degraded")
  ) {
    return {
      kind: "node_recovered",
      severity: "success",
      title: "Node recovered",
      body: `${input.nodeName}${hostSuffix} is healthy again.`.trim()
    };
  }

  return null;
}

function toSystemNotification(record: Awaited<ReturnType<typeof listSystemNotificationRecords>>[number]) {
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : null;
  return {
    id: record.id,
    kind: record.kind as NotificationKind,
    severity: record.severity as NotificationSeverity,
    title: record.title,
    body: record.body,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    nodeId: record.nodeId,
    nodeName: typeof metadata?.nodeName === "string" ? metadata.nodeName : null,
    readAt: record.readAt?.toISOString() ?? null,
    dismissedAt: record.dismissedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString()
  } satisfies SystemNotification;
}
