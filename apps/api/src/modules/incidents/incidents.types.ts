export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "acknowledged" | "resolved";
export type IncidentScope =
  | "global"
  | "node"
  | "proxy"
  | "api"
  | "database"
  | "minecraft_server"
  | "billing";
export type IncidentResolutionType = "auto" | "manual";
export type IncidentEventType =
  | "detected"
  | "updated"
  | "acknowledged"
  | "assigned"
  | "auto_resolved"
  | "manually_resolved"
  | "reopened"
  | "note";

export interface IncidentEvent {
  id: string;
  incidentId: string;
  type: IncidentEventType;
  message: string;
  metadata: Record<string, unknown> | null;
  actorId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  scope: IncidentScope;
  sourceType: string | null;
  sourceId: string | null;
  dedupeKey: string;
  startedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  resolutionType: IncidentResolutionType | null;
  rootCause: string | null;
  internalNotes: string | null;
  metadata: Record<string, unknown> | null;
  nodeId: string | null;
  createdAt: string;
  updatedAt: string;
  events: IncidentEvent[];
}

export interface IncidentSummary {
  openCritical: number;
  openTotal: number;
  acknowledged: number;
  autoResolvedLast24h: number;
}
