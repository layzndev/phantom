import { AppError } from "../../lib/appError.js";
import { getNodeRecord, listNodeRecords, postNodeActionRecord } from "./nodes.repository.js";
import type { CompanyNode, NodeSummary } from "./nodes.types.js";

export async function listNodes() {
  return listNodeRecords();
}

export async function getNode(id: string) {
  const node = await getNodeRecord(id);
  if (!node) throw new AppError(404, "Node not found.", "NODE_NOT_FOUND");
  return node;
}

export async function getNodeSummary(): Promise<NodeSummary> {
  const nodes = await listNodes();
  const recentIncidents = nodes
    .flatMap((node) => node.history ?? [])
    .filter((event) => event.type === "incident")
    .slice(0, 5);

  return {
    totalNodes: nodes.length,
    healthyNodes: nodes.filter((node) => node.health === "healthy").length,
    offlineNodes: nodes.filter((node) => node.status === "offline").length,
    totalHostedServers: nodes.reduce((sum, node) => sum + node.hostedServers, 0),
    totalRamMb: nodes.reduce((sum, node) => sum + node.totalRamMb, 0),
    usedRamMb: nodes.reduce((sum, node) => sum + node.usedRamMb, 0),
    totalCpu: nodes.reduce((sum, node) => sum + node.totalCpu, 0),
    usedCpu: nodes.reduce((sum, node) => sum + node.usedCpu, 0),
    recentIncidents
  };
}

export async function syncNode(id: string) {
  return postNodeActionRecord<CompanyNode>(id, "sync");
}

export async function refreshNode(id: string) {
  return postNodeActionRecord<CompanyNode>(id, "refresh");
}

export async function reconcileNode(id: string) {
  return postNodeActionRecord<CompanyNode>(id, "reconcile");
}

export async function setNodeMaintenance(id: string, maintenanceMode: boolean) {
  return postNodeActionRecord<CompanyNode>(id, "maintenance", { maintenanceMode });
}

export async function rotateNodeToken(id: string) {
  return postNodeActionRecord<{ accepted: boolean; nodeId: string; rotatedAt: string }>(id, "rotate-token");
}
