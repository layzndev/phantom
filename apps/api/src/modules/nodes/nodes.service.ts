import { randomBytes, createHash } from "node:crypto";
import { AppError } from "../../lib/appError.js";
import {
  listMinecraftServerNodeAssignments,
  listMinecraftServerRecordsForNode
} from "../../db/minecraftRepository.js";
import { listWorkloadsFromRegistry } from "../workloads/workloads.repository.js";
import type {
  CreateNodeResult,
  CompanyNode,
  HostedServer,
  NodeHealth,
  NodeStatus,
  RuntimeMode
} from "./nodes.types.js";
import {
  createNodeInRegistry,
  createNodeTokenInRegistry,
  deleteNodeFromRegistry,
  findActiveNodeTokenByHashInRegistry,
  findActiveNodeTokenInRegistry,
  findNodeFromRegistry,
  listNodesFromRegistry,
  rotateNodeTokenInRegistry,
  setNodeMaintenanceInRegistry,
  updateNodeHeartbeatInRegistry,
  updateNodeInRegistry,
  createNodeStatusEventInRegistry
} from "./nodes.repository.js";
import type { createNodeSchema, updateNodeSchema } from "./nodes.schema.js";
import type { z } from "zod";

type CreateNodeInput = z.infer<typeof createNodeSchema>;
type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
type NodeRecord = Awaited<ReturnType<typeof findNodeFromRegistry>>;
type NonNullNodeRecord = NonNullable<NodeRecord>;

export async function listNodes() {
  const [nodes, hostedAssignments] = await Promise.all([
    listNodesFromRegistry(),
    listMinecraftServerNodeAssignments()
  ]);

  const countsByNode = new Map<string, number>();
  for (const assignment of hostedAssignments) {
    const nodeId = assignment.workload.nodeId;
    if (!nodeId) continue;
    countsByNode.set(nodeId, (countsByNode.get(nodeId) ?? 0) + 1);
  }

  return nodes.map((node) =>
    toCompanyNode(node, { hostedServersCount: countsByNode.get(node.id) ?? 0 })
  );
}

export async function getNode(id: string) {
  const [node, hostedRecords] = await Promise.all([
    findNodeFromRegistry(id),
    listMinecraftServerRecordsForNode(id)
  ]);

  if (!node) {
    throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  }

  const hostedServersList = hostedRecords.map(toHostedServer);
  return toCompanyNode(node, {
    hostedServersCount: hostedServersList.length,
    hostedServersList
  });
}

export async function createNode(input: CreateNodeInput): Promise<CreateNodeResult> {
  const existingNode = await findNodeFromRegistry(input.id);
  if (existingNode) {
    throw new AppError(409, "Node already exists.", "NODE_ALREADY_EXISTS");
  }

  const token = generateNodeToken(input.id);
  const tokenHash = hashNodeToken(token);
  const node = await createNodeInRegistry(input);
  await createNodeTokenInRegistry(node.id, tokenHash);

  return { node: toCompanyNode(node), token };
}

export async function getNodeSummary() {
  const [nodes, workloads] = await Promise.all([
    listNodes(),
    listWorkloadsFromRegistry()
  ]);

  const runningWorkloads = workloads.filter((workload) => workload.status === "running").length;
  const deletingWorkloads = workloads.filter((workload) => workload.status === "deleting").length;
  const stoppedWorkloads = workloads.filter((workload) =>
    ["stopped", "crashed", "pending", "creating"].includes(workload.status)
  ).length;

  return {
    totalNodes: nodes.length,
    healthyNodes: nodes.filter(
      (node) => node.status === "healthy" || node.health === "healthy"
    ).length,
    offlineNodes: nodes.filter(
      (node) => node.status === "offline" || node.health === "unreachable"
    ).length,
    totalHostedServers: nodes.reduce((sum, node) => sum + node.hostedServers, 0),
    totalWorkloads: workloads.length,
    runningWorkloads,
    stoppedWorkloads,
    deletingWorkloads,
    totalRamMb: nodes.reduce((sum, node) => sum + node.totalRamMb, 0),
    usedRamMb: nodes.reduce((sum, node) => sum + node.usedRamMb, 0),
    totalCpu: nodes.reduce((sum, node) => sum + node.totalCpu, 0),
    usedCpu: nodes.reduce((sum, node) => sum + node.usedCpu, 0),
    recentIncidents: []
  };
}

export async function setNodeMaintenance(
  id: string,
  maintenanceMode: boolean,
  reason?: string
) {
  const node = await findNodeFromRegistry(id);
  if (!node) {
    throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  }

  const updated = await setNodeMaintenanceInRegistry(
    id,
    maintenanceMode,
    reason ?? (maintenanceMode ? "maintenance enabled" : "maintenance disabled")
  );

  return toCompanyNode(updated);
}

export async function rotateNodeToken(id: string) {
  const node = await findNodeFromRegistry(id);
  if (!node) {
    throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  }

  const token = generateNodeToken(id);
  const tokenHash = hashNodeToken(token);
  await rotateNodeTokenInRegistry(id, tokenHash);

  return {
    nodeId: id,
    token,
    rotatedAt: new Date().toISOString()
  };
}

export async function acceptNodeHeartbeat(
  nodeId: string,
  rawToken: string,
  payload: {
    status: "healthy" | "degraded" | "offline";
    cpuUsed?: number;
    loadAverage1m?: number;
    ramUsedMb?: number;
    diskUsedGb?: number;
    totalRamMb?: number;
    totalCpu?: number;
    totalDiskGb?: number;
    agentVersion?: string;
    runtimeVersion?: string;
    dockerVersion?: string;
    osPlatform?: string;
    osRelease?: string;
    kernelVersion?: string;
    osArch?: string;
    hostname?: string;
    uptimeSec?: number;
    cpuModel?: string;
    cpuCores?: number;
    openPorts?: number[];
    openPortDetails?: Array<{
      port: number;
      protocol: "tcp" | "udp";
      address: string;
      category: "phantom-range" | "system";
    }>;
    portRanges?: Array<{ start: number; end: number }>;
  }
) {
  const node = await findNodeFromRegistry(nodeId);
  if (!node) {
    throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  }

  const tokenHash = hashNodeToken(rawToken);
  const activeToken = await findActiveNodeTokenInRegistry(nodeId, tokenHash);

  if (!activeToken) {
    throw new AppError(401, "Invalid node token.", "INVALID_NODE_TOKEN");
  }

  const nextStatus =
    payload.status === "offline"
      ? "offline"
      : payload.status === "degraded"
        ? "degraded"
        : "healthy";

  const nextHealth =
    payload.status === "offline"
      ? "unreachable"
      : payload.status === "degraded"
        ? "degraded"
        : "healthy";

  await updateNodeHeartbeatInRegistry(nodeId, {
    status: nextStatus,
    health: nextHealth,
    ...(payload.ramUsedMb !== undefined ? { usedRamMb: payload.ramUsedMb } : {}),
    ...(payload.cpuUsed !== undefined ? { usedCpu: payload.cpuUsed } : {}),
    totalRamMb: payload.totalRamMb,
    totalCpu: payload.totalCpu,
    totalDiskGb: payload.totalDiskGb,
    agentVersion: payload.agentVersion,
    runtimeVersion: payload.runtimeVersion,
    dockerVersion: payload.dockerVersion,
    osPlatform: payload.osPlatform,
    osRelease: payload.osRelease,
    kernelVersion: payload.kernelVersion,
    osArch: payload.osArch,
    hostname: payload.hostname,
    uptimeSec: payload.uptimeSec,
    cpuModel: payload.cpuModel,
    cpuCores: payload.cpuCores,
    openPorts: payload.openPorts,
    openPortDetails: payload.openPortDetails,
    suggestedPortRanges: payload.portRanges
  });

  if (node.status !== nextStatus) {
    await createNodeStatusEventInRegistry({
      nodeId,
      previousStatus: node.status,
      newStatus: nextStatus,
      reason: `heartbeat cpu=${payload.cpuUsed ?? "n/a"} ramMb=${payload.ramUsedMb ?? "n/a"} diskGb=${payload.diskUsedGb ?? "n/a"}`
    });
  }

  return {
    ok: true,
    nodeId,
    receivedAt: new Date().toISOString()
  };
}

export async function authenticateRuntimeNode(rawToken: string) {
  const tokenHash = hashNodeToken(rawToken);
  const activeToken = await findActiveNodeTokenByHashInRegistry(tokenHash);

  if (!activeToken) {
    throw new AppError(401, "Invalid node token.", "INVALID_NODE_TOKEN");
  }

  return activeToken.node;
}

export async function deleteNode(id: string) {
  const node = await findNodeFromRegistry(id);
  if (!node) {
    throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  }

  await deleteNodeFromRegistry(id);
}

export async function updateNode(id: string, input: UpdateNodeInput) {
  const node = await findNodeFromRegistry(id);
  if (!node) {
    throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  }

  const effectivePortStart = input.portRangeStart ?? node.portRangeStart;
  const effectivePortEnd = input.portRangeEnd ?? node.portRangeEnd;
  if (
    effectivePortStart !== null &&
    effectivePortEnd !== null &&
    effectivePortEnd < effectivePortStart
  ) {
    throw new AppError(
      400,
      "portRangeEnd must be greater than or equal to portRangeStart.",
      "INVALID_PORT_RANGE"
    );
  }

  const updated = await updateNodeInRegistry(id, input);
  return toCompanyNode(updated);
}

function generateNodeToken(nodeId: string) {
  return `phn_${nodeId}_${randomBytes(32).toString("base64url")}`;
}

type MinecraftHostedRecord = Awaited<
  ReturnType<typeof listMinecraftServerRecordsForNode>
>[number];

function toHostedServer(record: MinecraftHostedRecord): HostedServer {
  const port = record.workload.ports.find((entry) => entry.internalPort === 25565);
  return {
    id: record.id,
    name: record.name,
    kind: "minecraft",
    status: record.workload.status,
    desiredStatus: record.workload.desiredStatus,
    ramMb: record.workload.requestedRamMb,
    cpu: record.workload.requestedCpu,
    diskGb: record.workload.requestedDiskGb,
    port: port?.externalPort,
    templateId: record.templateId,
    version: record.minecraftVersion,
    workloadId: record.workloadId
  };
}

function hashNodeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

interface ToCompanyNodeOptions {
  hostedServersCount?: number;
  hostedServersList?: HostedServer[];
}

function toCompanyNode(
  node: NonNullNodeRecord,
  options: ToCompanyNodeOptions = {}
): CompanyNode {
  const hasRange = node.portRangeStart !== null && node.portRangeEnd !== null;
  const portRange = hasRange ? `${node.portRangeStart}-${node.portRangeEnd}` : null;
  const totalPorts = hasRange ? (node.portRangeEnd as number) - (node.portRangeStart as number) + 1 : 0;
  const suggestedPortRanges = Array.isArray(node.suggestedPortRanges)
    ? (node.suggestedPortRanges as Array<{ start: number; end: number }>)
    : null;

  return {
    id: node.id,
    name: node.name,
    provider: node.provider,
    region: node.region,
    internalHost: node.internalHost,
    publicHost: node.publicHost,
    status: node.status as NodeStatus,
    health: node.health as NodeHealth,
    runtimeMode: node.runtimeMode as RuntimeMode,
    heartbeat: node.lastHeartbeatAt?.toISOString() ?? null,
    totalRamMb: node.totalRamMb ?? 0,
    usedRamMb: node.usedRamMb ?? 0,
    totalCpu: node.totalCpu ?? 0,
    usedCpu: node.usedCpu ?? 0,
    hostedServers: options.hostedServersCount ?? 0,
    availablePorts: totalPorts,
    reservedPorts: 0,
    portRange,
    portRangeStart: node.portRangeStart,
    portRangeEnd: node.portRangeEnd,
    openPorts: node.openPorts ?? [],
    openPortDetails: Array.isArray(node.openPortDetails)
      ? (node.openPortDetails as Array<{
          port: number;
          protocol: "tcp" | "udp";
          address: string;
          category: "phantom-range" | "system";
        }>)
      : [],
    suggestedPortRanges,
    agentVersion: node.agentVersion,
    runtimeVersion: node.runtimeVersion,
    dockerVersion: node.dockerVersion,
    osPlatform: node.osPlatform,
    osRelease: node.osRelease,
    kernelVersion: node.kernelVersion,
    osArch: node.osArch,
    hostname: node.hostname,
    uptimeSec: node.uptimeSec,
    cpuModel: node.cpuModel,
    cpuCores: node.cpuCores,
    totalDiskGb: node.totalDiskGb ?? 0,
    maintenanceMode: node.maintenanceMode,
    hostedServersList: options.hostedServersList,
    history: node.statusEvents.map((event) => ({
      id: event.id,
      type: event.newStatus === "maintenance" ? "maintenance" : "status",
      message: `${event.previousStatus ?? "none"} -> ${event.newStatus}${event.reason ? `: ${event.reason}` : ""}`,
      createdAt: event.createdAt.toISOString()
    })),
    statusEvents: node.statusEvents.map((event) => ({
      id: event.id,
      nodeId: event.nodeId,
      previousStatus: event.previousStatus as NodeStatus | null,
      newStatus: event.newStatus as NodeStatus,
      reason: event.reason,
      createdAt: event.createdAt.toISOString()
    }))
  };
}
