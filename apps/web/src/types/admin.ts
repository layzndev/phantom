export type AdminRole = "superadmin" | "ops";
export type NodeStatus = "offline" | "healthy" | "maintenance";
export type NodeHealth = "unknown" | "healthy" | "degraded" | "unreachable";
export type RuntimeMode = "local" | "remote";

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
  type: "status" | "maintenance";
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
  runtimeMode: RuntimeMode;
  heartbeat: string | null;
  totalRamMb: number;
  usedRamMb: number;
  totalCpu: number;
  usedCpu: number;
  hostedServers: number;
  availablePorts: number;
  reservedPorts: number;
  portRange: string;
  portRangeStart: number;
  portRangeEnd: number;
  maintenanceMode: boolean;
  hostedServersList?: HostedServer[];
  history?: NodeHistoryEvent[];
  logs?: string[];
}

export interface CreateNodePayload {
  id: string;
  name: string;
  provider: string;
  region: string;
  internalHost: string;
  publicHost: string;
  runtimeMode: RuntimeMode;
  totalRamMb?: number;
  totalCpu?: number;
  portRangeStart: number;
  portRangeEnd: number;
}

export interface UpdateNodePayload {
  name?: string;
  provider?: string;
  region?: string;
  internalHost?: string;
  publicHost?: string;
  runtimeMode?: RuntimeMode;
  totalRamMb?: number;
  totalCpu?: number;
  portRangeStart?: number;
  portRangeEnd?: number;
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
