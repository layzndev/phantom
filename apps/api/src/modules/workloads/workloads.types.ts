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

export interface CreateWorkloadResult {
  workload: CompanyWorkload;
  placed: boolean;
  reason?: string;
  diagnostics?: import("./workloads.scheduler.js").SchedulerDiagnostics;
}

export interface DeleteWorkloadResult {
  workload: CompanyWorkload | null;
  finalized: boolean;
}
