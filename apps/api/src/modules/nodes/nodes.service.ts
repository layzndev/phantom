import { randomBytes, createHash } from "node:crypto";
import { AppError } from "../../lib/appError.js";
import type { CreateNodeResult, CompanyNode, NodeHealth, NodeStatus, RuntimeMode } from "./nodes.types.js";
import {
  createNodeInRegistry,
  createNodeTokenInRegistry,
  findActiveNodeTokenInRegistry,
  findNodeFromRegistry,
  listNodesFromRegistry,
  rotateNodeTokenInRegistry,
  setNodeMaintenanceInRegistry,
  updateNodeHeartbeatInRegistry,
  createNodeStatusEventInRegistry
} from "./nodes.repository.js";
import type { createNodeSchema } from "./nodes.schema.js";
import type { z } from "zod";

type CreateNodeInput = z.infer<typeof createNodeSchema>;
type NodeRecord = Awaited<ReturnType<typeof findNodeFromRegistry>>;
type NonNullNodeRecord = NonNullable<NodeRecord>;

export async function listNodes() {
  const nodes = await listNodesFromRegistry();
  return nodes.map(toCompanyNode);
}

export async function getNode(id: string) {
  const node = await findNodeFromRegistry(id);
  if (!node) throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  return toCompanyNode(node);
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
  const nodes = await listNodes();

  return {
    totalNodes: nodes.length,
    healthyNodes: nodes.filter((node) => node.status === "healthy" || node.health === "healthy").length,
    offlineNodes: nodes.filter((node) => node.status === "offline" || node.health === "unreachable").length,
    totalHostedServers: 0,
    totalRamMb: nodes.reduce((sum, node) => sum + node.totalRamMb, 0),
    usedRamMb: 0,
    totalCpu: nodes.reduce((sum, node) => sum + node.totalCpu, 0),
    usedCpu: 0,
    recentIncidents: []
  };
}

export async function setNodeMaintenance(id: string, maintenanceMode: boolean, reason?: string) {
  const node = await findNodeFromRegistry(id);
  if (!node) throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  const updated = await setNodeMaintenanceInRegistry(
    id,
    maintenanceMode,
    reason ?? (maintenanceMode ? "maintenance enabled" : "maintenance disabled")
  );
  return toCompanyNode(updated);
}

export async function rotateNodeToken(id: string) {
  const node = await findNodeFromRegistry(id);
  if (!node) throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");

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
    ramUsedMb?: number;
    diskUsedGb?: number;
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
    health: nextHealth
  });

  await createNodeStatusEventInRegistry({
    nodeId,
    previousStatus: node.status,
    newStatus: nextStatus,
    reason: `heartbeat cpu=${payload.cpuUsed ?? "n/a"} ramMb=${payload.ramUsedMb ?? "n/a"} diskGb=${payload.diskUsedGb ?? "n/a"}`
  });

  return {
    ok: true,
    nodeId,
    receivedAt: new Date().toISOString()
  };
}

function generateNodeToken(nodeId: string) {
  return `phn_${nodeId}_${randomBytes(32).toString("base64url")}`;
}

function hashNodeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toCompanyNode(node: NonNullNodeRecord): CompanyNode {
  const portRange = `${node.portRangeStart}-${node.portRangeEnd}`;
  const totalPorts = node.portRangeEnd - node.portRangeStart + 1;

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
    heartbeat: null,
    totalRamMb: node.totalRamMb,
    usedRamMb: 0,
    totalCpu: node.totalCpu,
    usedCpu: 0,
    hostedServers: 0,
    availablePorts: totalPorts,
    reservedPorts: 0,
    portRange,
    portRangeStart: node.portRangeStart,
    portRangeEnd: node.portRangeEnd,
    maintenanceMode: node.maintenanceMode,
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