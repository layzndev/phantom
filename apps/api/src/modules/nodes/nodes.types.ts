export type NodeStatus = "online" | "offline" | "maintenance" | "degraded";
export type NodeHealth = "healthy" | "warning" | "critical" | "unknown";
export type RuntimeMode = "docker" | "firecracker" | "bare-metal" | "unknown";

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
