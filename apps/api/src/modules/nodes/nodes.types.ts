export type NodeStatus = "offline" | "healthy" | "maintenance";
export type NodeHealth = "unknown" | "healthy" | "degraded" | "unreachable";
export type RuntimeMode = "local" | "remote";

export interface NodeStatusEvent {
  id: string;
  nodeId: string;
  previousStatus: NodeStatus | null;
  newStatus: NodeStatus;
  reason: string | null;
  createdAt: string;
}

export interface HostedServer {
  id: string;
  name: string;
  kind: "minecraft";
  status: string;
  desiredStatus: string;
  ramMb: number;
  cpu: number;
  diskGb: number;
  port?: number;
  templateId?: string;
  version?: string;
  workloadId: string;
}

export interface SuggestedPortRange {
  start: number;
  end: number;
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
  portRange: string | null;
  portRangeStart: number | null;
  portRangeEnd: number | null;
  openPorts: number[];
  suggestedPortRanges: SuggestedPortRange[] | null;
  maintenanceMode: boolean;
  hostedServersList?: HostedServer[];
  history?: Array<{
    id: string;
    type: "status" | "maintenance";
    message: string;
    createdAt: string;
  }>;
  statusEvents?: NodeStatusEvent[];
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
  recentIncidents: Array<{ id: string; type: string; message: string; createdAt: string }>;
}

export interface CreateNodeResult {
  node: CompanyNode;
  token: string;
}
