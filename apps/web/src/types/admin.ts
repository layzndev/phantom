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
  kind?: "minecraft";
  status: string;
  desiredStatus?: string;
  ramMb: number;
  cpu: number;
  diskGb?: number;
  port?: number;
  templateId?: string;
  version?: string;
  workloadId?: string;
  ownerId?: string;
}

export interface NodeHistoryEvent {
  id: string;
  type: "status" | "maintenance";
  message: string;
  createdAt: string;
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
  portRangeStart?: number;
  portRangeEnd?: number;
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

export type WorkloadType = "minecraft" | "discord-bot" | "proxy" | "container";
export type WorkloadStatus =
  | "pending"
  | "creating"
  | "running"
  | "stopped"
  | "crashed"
  | "deleting"
  | "deleted";
export type WorkloadDesiredStatus = "running" | "stopped";
export type WorkloadPortProtocol = "tcp" | "udp";

export interface WorkloadPort {
  id: string;
  internalPort: number;
  externalPort: number;
  protocol: WorkloadPortProtocol;
}

export interface WorkloadStatusEvent {
  id: string;
  workloadId: string;
  previousStatus: WorkloadStatus | null;
  newStatus: WorkloadStatus;
  reason: string | null;
  createdAt: string;
}

export interface CompanyWorkload {
  id: string;
  name: string;
  type: WorkloadType;
  image: string;
  nodeId: string | null;
  status: WorkloadStatus;
  desiredStatus: WorkloadDesiredStatus;
  requestedCpu: number;
  requestedRamMb: number;
  requestedDiskGb: number;
  config: Record<string, unknown>;
  containerId: string | null;
  lastHeartbeatAt: string | null;
  lastExitCode: number | null;
  restartCount: number;
  ports: WorkloadPort[];
  statusEvents: WorkloadStatusEvent[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateWorkloadPortSpec {
  internalPort: number;
  protocol?: WorkloadPortProtocol;
}

export interface CreateWorkloadPayload {
  name: string;
  type: WorkloadType;
  image: string;
  requestedCpu: number;
  requestedRamMb: number;
  requestedDiskGb: number;
  ports?: CreateWorkloadPortSpec[];
  config?: Record<string, unknown>;
}

export interface UpdateWorkloadPayload {
  name?: string;
  config?: Record<string, unknown>;
}

export interface CreateWorkloadResult {
  workload: CompanyWorkload;
  placed: boolean;
  reason?: string;
}

export type MinecraftTemplateFamily =
  | "vanilla"
  | "paper"
  | "purpur"
  | "forge"
  | "fabric";

export type MinecraftDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type MinecraftGameMode = "survival" | "creative" | "adventure" | "spectator";

export interface MinecraftTemplateDefaults {
  cpu: number;
  ramMb: number;
  diskGb: number;
}

export interface MinecraftTemplate {
  id: string;
  family: MinecraftTemplateFamily;
  displayName: string;
  description: string;
  image: string;
  defaultVersion: string;
  supportedVersions: string[];
  defaults: MinecraftTemplateDefaults;
  baseEnv: Record<string, string>;
}

export interface MinecraftServer {
  id: string;
  name: string;
  slug: string;
  workloadId: string;
  templateId: string;
  minecraftVersion: string;
  motd: string | null;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  maxPlayers: number;
  eula: boolean;
  serverProperties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MinecraftServerWithWorkload {
  server: MinecraftServer;
  workload: CompanyWorkload;
}

export interface CreateMinecraftServerPayload {
  name: string;
  templateId: string;
  eula: true;
  version?: string;
  motd?: string;
  difficulty?: MinecraftDifficulty;
  gameMode?: MinecraftGameMode;
  maxPlayers?: number;
  cpu?: number;
  ramMb?: number;
  diskGb?: number;
}

export interface CreateMinecraftServerResult {
  server: MinecraftServer;
  workload: CompanyWorkload;
  placed: boolean;
  reason?: string;
}

export type MinecraftOperationKind = "command" | "save" | "logs";
export type MinecraftOperationStatus =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed";

export interface MinecraftOperation {
  id: string;
  workloadId: string;
  kind: MinecraftOperationKind;
  status: MinecraftOperationStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MinecraftOperationResponse {
  operation: MinecraftOperation;
  pending: boolean;
}
