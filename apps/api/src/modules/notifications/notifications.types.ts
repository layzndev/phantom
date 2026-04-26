export type NotificationSeverity = "critical" | "warning" | "success" | "info";
export type NotificationKind =
  | "node_offline"
  | "node_recovered"
  | "node_degraded"
  | "node_maintenance";

export interface SystemNotification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  nodeId: string | null;
  nodeName: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}
