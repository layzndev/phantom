export type AdminRole = "superadmin" | "ops";
export type NodeStatus = "offline" | "healthy" | "maintenance";
export type NodeHealth = "unknown" | "healthy" | "degraded" | "unreachable";
export type RuntimeMode = "local" | "remote";
export type NodePool = "free" | "premium" | "internal";

export const NODE_POOLS: readonly NodePool[] = ["free", "premium", "internal"] as const;

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  twoFactorEnabled: boolean;
  ipAllowlist?: string[];
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
  type: "status" | "maintenance" | "node_offline";
  message: string;
  createdAt: string;
  nodeId?: string;
  nodeName?: string;
}

export interface SuggestedPortRange {
  start: number;
  end: number;
}

export interface OpenPortDetail {
  port: number;
  protocol: "tcp" | "udp";
  address: string;
  category: "phantom-range" | "system";
}

export interface DockerPublishedPort {
  containerId: string;
  containerName: string;
  workloadId: string | null;
  protocol: "tcp" | "udp";
  publishedPort: number;
  targetPort: number;
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
  pool: NodePool;
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
  openPortDetails: OpenPortDetail[];
  dockerPublishedPorts: DockerPublishedPort[];
  suggestedPortRanges: SuggestedPortRange[] | null;
  agentVersion: string | null;
  runtimeVersion: string | null;
  dockerVersion: string | null;
  osPlatform: string | null;
  osRelease: string | null;
  kernelVersion: string | null;
  osArch: string | null;
  hostname: string | null;
  uptimeSec: number | null;
  cpuModel: string | null;
  cpuCores: number | null;
  totalDiskGb: number;
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
  pool?: NodePool;
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
  pool?: NodePool;
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
  totalWorkloads: number;
  runningWorkloads: number;
  stoppedWorkloads: number;
  deletingWorkloads: number;
  totalRamMb: number;
  usedRamMb: number;
  totalCpu: number;
  usedCpu: number;
  recentIncidents: NodeHistoryEvent[];
}

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
  resolutionType: "auto" | "manual" | null;
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
  | "queued_start"
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
  runtimeStartedAt: string | null;
  runtimeFinishedAt: string | null;
  runtimeCpuPercent: number | null;
  runtimeMemoryMb: number | null;
  runtimeDiskGb: number | null;
  lastExitCode: number | null;
  restartCount: number;
  deleteRequestedAt: string | null;
  deleteRuntimeAckAt: string | null;
  deleteHardData: boolean;
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

export interface DeleteWorkloadOptions {
  hardDeleteData?: boolean;
}

export interface DeleteWorkloadResult {
  workload: CompanyWorkload | null;
  finalized: boolean;
}

export type MinecraftTemplateFamily =
  | "vanilla"
  | "paper"
  | "purpur"
  | "forge"
  | "fabric";

export type MinecraftDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type MinecraftGameMode = "survival" | "creative" | "adventure" | "spectator";
export type PlanTier = "free" | "premium";
export type MinecraftDnsStatus = "wildcard" | "pending" | "active" | "failed" | "disabled";
export type MinecraftAutoSleepAction = "sleep" | "stop";
export type MinecraftRuntimeState =
  | "starting"
  | "restarting"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed"
  | "error";

export const PLAN_TIERS: readonly PlanTier[] = ["free", "premium"] as const;

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
  hostname: string;
  hostnameSlug: string;
  hostnameUpdatedAt: string | null;
  dnsStatus: MinecraftDnsStatus;
  dnsLastError: string | null;
  dnsSyncedAt: string | null;
  workloadId: string;
  templateId: string;
  minecraftVersion: string;
  motd: string | null;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  maxPlayers: number;
  eula: boolean;
  planTier: PlanTier;
  autoSleepUseGlobalDefaults: boolean;
  autoSleepEnabled: boolean;
  autoSleepIdleMinutes: number;
  autoSleepAction: MinecraftAutoSleepAction;
  onlineMode: boolean;
  whitelistEnabled: boolean;
  runtimeState: MinecraftRuntimeState;
  currentPlayerCount: number;
  idleSince: string | null;
  lastPlayerSeenAt: string | null;
  lastPlayerSampleAt: string | null;
  lastPlayerCheckFailedAt: string | null;
  lastPlayerCheckError: string | null;
  lastConsoleCommandAt: string | null;
  sleepRequestedAt: string | null;
  wakeRequestedAt: string | null;
  readyAt: string | null;
  serverProperties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MinecraftGlobalSettings {
  freeAutoSleepEnabled: boolean;
  freeAutoSleepIdleMinutes: number;
  freeAutoSleepAction: MinecraftAutoSleepAction;
}

export interface MinecraftServerWithWorkload {
  server: MinecraftServer;
  workload: CompanyWorkload;
  node?: {
    id: string;
    name: string;
    publicHost: string;
    internalHost: string;
  } | null;
  hostname?: string | null;
  connectAddress: string | null;
}

export interface MinecraftUptimeSession {
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
  reason: string | null;
  ongoing: boolean;
}

export interface MinecraftUptimeHistory {
  serverId: string;
  sessions: MinecraftUptimeSession[];
}

export interface PlatformTokenSummary {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface PlatformTokenIssued extends PlatformTokenSummary {
  /** Plain-text token, only available right after creation. */
  token: string;
}

export interface CreateMinecraftServerPayload {
  name: string;
  hostnameSlug?: string;
  templateId: string;
  eula: true;
  planTier?: PlanTier;
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

export interface DeleteMinecraftServerOptions {
  hardDeleteData?: boolean;
}

export interface UpdateMinecraftServerSettingsPayload {
  autoSleepUseGlobalDefaults: boolean;
  autoSleepEnabled: boolean;
  autoSleepIdleMinutes: number;
  autoSleepAction: MinecraftAutoSleepAction;
  maxPlayers: number;
  onlineMode: boolean;
  difficulty: MinecraftDifficulty;
  gameMode: MinecraftGameMode;
  motd: string;
  whitelistEnabled: boolean;
}

export interface DeleteMinecraftServerResult {
  server: MinecraftServer | null;
  workload: CompanyWorkload | null;
  finalized: boolean;
}

export type GuardAction =
  | "ping"
  | "login_attempt"
  | "login_success"
  | "disconnect"
  | "invalid_session"
  | "rate_limited"
  | "blocked";

export interface GuardConnectionEvent {
  id: string;
  createdAt: string;
  serverId: string | null;
  nodeId: string | null;
  hostname: string | null;
  sourceIp: string | null;
  sourceIpHash: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: string | null;
  isp: string | null;
  usernameAttempted: string | null;
  normalizedUsername: string | null;
  onlineMode: boolean | null;
  protocolVersion: number | null;
  clientBrand: string | null;
  action: GuardAction;
  disconnectReason: string | null;
  latencyMs: number | null;
  sessionId: string | null;
  metadata: Record<string, unknown>;
  riskScore: number;
  server: { id: string; name: string; hostname: string | null } | null;
  node: { id: string; name: string } | null;
}

export interface GuardOverview {
  cards: {
    activeConnections: number;
    uniqueIpsToday: number;
    uniqueUsernamesToday: number;
    topAttackedServer: { id: string; name: string; hostname: string | null; suspiciousEvents: number } | null;
    invalidSessionRate: number;
    suspectedBots: number;
  };
  charts: {
    joinsPerHour: Array<{ hour: string; count: number }>;
    failedLoginsPerHour: Array<{ hour: string; count: number }>;
    topServers: Array<{ serverId: string; serverName: string; hostname: string | null; count: number }>;
    topCountries: Array<{ countryCode: string; count: number }>;
  };
}

export interface GuardPlayerProfile {
  profile: {
    normalizedUsername: string;
    displayUsername: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    totalConnections: number;
    totalServersVisited: number;
    totalPlaySessions: number;
    riskScore: number;
    trusted: boolean;
    notes: string | null;
  };
  servers: Array<{
    serverId: string;
    serverName: string;
    hostname: string | null;
    joins: number;
    lastSeenAt: string;
    totalPlayMinutes: number;
  }>;
  countries: Array<{ countryCode: string; count: number }>;
  recentIps: Array<{ sourceIp: string | null; sourceIpHash: string; countryCode: string | null; lastSeenAt: string }>;
  suspiciousEvents: GuardConnectionEvent[];
  timeline: GuardConnectionEvent[];
}

export interface GuardRule {
  id: string;
  targetScope: string;
  targetValue: string | null;
  targetHash: string | null;
  action: string;
  reason: string | null;
  note: string | null;
  rateLimitPerMinute: number | null;
  delayMs: number | null;
  expiresAt: string | null;
  createdByAdminId: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuardIpProfile {
  profile: {
    sourceIp: string | null;
    sourceIpHash: string;
    firstSeenAt: string;
    lastSeenAt: string;
    totalConnections: number;
    totalServersTargeted: number;
    totalUsernames: number;
    riskScore: number;
    trusted: boolean;
    notes: string | null;
    blocked: boolean;
  };
  countries: Array<{ countryCode: string; count: number }>;
  usernames: Array<{ username: string; count: number }>;
  servers: Array<{ serverId: string; serverName: string; hostname: string | null; count: number }>;
  requestsLastHour: number;
  requestsLastDay: number;
  activeRules: GuardRule[];
  timeline: GuardConnectionEvent[];
}

export interface GuardServerSummary {
  protected: boolean;
  threatLevel: "Low" | "Medium" | "High";
  recentSuspiciousIps: number;
  eventsLast24h: number;
  maxRiskScore: number;
}

export interface GuardSettings {
  rawIpRetentionDays: 7 | 30 | 90;
  aggregateRetentionDays: number;
  hashIpsAfterRetention: boolean;
  privacyMode: boolean;
}

export type MinecraftOperationKind =
  | "command"
  | "save"
  | "logs"
  | "stop"
  | "players"
  | "files.list"
  | "files.read"
  | "files.write"
  | "files.upload"
  | "files.mkdir"
  | "files.rename"
  | "files.delete"
  | "files.archive"
  | "files.extract";
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

export interface MinecraftFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  sizeBytes: number;
  modifiedAt: string;
}

export interface MinecraftFilesListResult {
  path: string;
  parentPath: string | null;
  entries: MinecraftFileEntry[];
}

export interface MinecraftFileReadResult {
  path: string;
  content: string;
  modifiedAt: string;
  sizeBytes: number;
  encoding: "utf-8";
  readOnly?: boolean;
  redacted?: boolean;
}
