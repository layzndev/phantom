export type WorkloadDesiredStatus = "running" | "stopped";
export type WorkloadRuntimeStatus = "creating" | "running" | "stopped" | "crashed";
export type WorkloadEventType =
  | "pulled"
  | "created"
  | "started"
  | "stopped"
  | "killed"
  | "crashed";
export type WorkloadPortProtocol = "tcp" | "udp";

export interface AssignedWorkloadPort {
  internalPort: number;
  externalPort: number;
  protocol: WorkloadPortProtocol;
}

export interface AssignedWorkload {
  id: string;
  name: string;
  type: string;
  image: string;
  nodeId: string | null;
  status: string;
  desiredStatus: WorkloadDesiredStatus;
  requestedCpu: number;
  requestedRamMb: number;
  requestedDiskGb: number;
  config: Record<string, unknown>;
  containerId: string | null;
  lastHeartbeatAt: string | null;
  lastExitCode: number | null;
  restartCount: number;
  ports: AssignedWorkloadPort[];
}

export interface AssignedWorkloadsResponse {
  nodeId: string;
  workloads: AssignedWorkload[];
}

export interface WorkloadHeartbeatPayload {
  status: WorkloadRuntimeStatus;
  containerId?: string;
  exitCode?: number | null;
  restartCount?: number;
  cpuPercent?: number;
  memoryMb?: number;
  startedAt?: string;
  finishedAt?: string | null;
  reason?: string;
}

export interface WorkloadEventPayload {
  type: WorkloadEventType;
  status?: WorkloadRuntimeStatus;
  reason?: string;
}

export interface WorkloadAckActionPayload {
  handledDesiredStatus: "restart" | "kill";
  status?: WorkloadRuntimeStatus;
  containerId?: string | null;
  reason?: string;
}

export interface AgentConfig {
  apiUrl: string;
  nodeToken: string;
  nodeId: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  agentId: string;
  logLevel: LogLevel;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  labels: Record<string, string>;
  stateStatus: string;
  running: boolean;
  exitCode: number | null;
  restartCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
}

export interface DockerContainerStats {
  cpuPercent?: number;
  memoryMb?: number;
}

export interface DockerCreateOptions {
  workload: AssignedWorkload;
  nodeId: string;
}
