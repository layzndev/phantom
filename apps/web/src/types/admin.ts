export type AdminRole = "superadmin" | "ops";
export type NodeStatus = "online" | "offline" | "maintenance" | "degraded";
export type NodeHealth = "healthy" | "warning" | "critical" | "unknown";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  twoFactorEnabled: boolean;
}

export interface HostedServer {
  id: string;
  name: string;
  ownerId?: string;
  status: string;
  ramMb: number;
  cpu: number;
  port?: number;
}

export interface NodeHistoryEvent {
  id: string;
  type: "heartbeat" | "status" | "maintenance" | "sync" | "incident";
  message: string;
  createdAt: string;
}

export interface CompanyNode {
  id: string;
  name: string;
  provider: string;
  region: string;
  internalHost: string;
  publicHost: string;
  status: NodeStatus;
  health: NodeHealth;
  runtimeMode: string;
  heartbeat: string | null;
  totalRamMb: number;
  usedRamMb: number;
  totalCpu: number;
  usedCpu: number;
  hostedServers: number;
  availablePorts: number;
  reservedPorts: number;
  portRange: string;
  maintenanceMode: boolean;
  hostedServersList?: HostedServer[];
  history?: NodeHistoryEvent[];
  logs?: string[];
}

export interface NodeSummary {
  totalNodes: number;
  healthyNodes: number;
  offlineNodes: number;
  totalHostedServers: number;
  totalRamMb: number;
  usedRamMb: number;
  totalCpu: number;
  usedCpu: number;
  recentIncidents: NodeHistoryEvent[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorEmail: string;
  targetType?: string;
  targetId?: string;
  createdAt: string;
}
