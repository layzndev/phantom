import {
  createNodeRecord,
  createNodeTokenRecord,
  findNodeRecordById,
  listNodeRecords,
  revokeActiveNodeTokens,
  setNodeMaintenanceRecord,
  findActiveNodeTokenRecord,
  updateNodeHeartbeatRecord,
  updateNodeRecord,
  createNodeStatusEventRecord,
  type CreateNodeRecordInput,
  type UpdateNodeHeartbeatRecordInput,
  type UpdateNodeRecordInput
} from "../../db/nodeRepository.js";

export function listNodesFromRegistry() {
  return listNodeRecords();
}

export function findNodeFromRegistry(id: string) {
  return findNodeRecordById(id);
}

export function createNodeInRegistry(input: CreateNodeRecordInput) {
  return createNodeRecord(input);
}

export function setNodeMaintenanceInRegistry(id: string, maintenanceMode: boolean, reason: string) {
  return setNodeMaintenanceRecord(id, maintenanceMode, reason);
}

export async function rotateNodeTokenInRegistry(nodeId: string, tokenHash: string) {
  await revokeActiveNodeTokens(nodeId);
  return createNodeTokenRecord(nodeId, tokenHash);
}

export function createNodeTokenInRegistry(nodeId: string, tokenHash: string) {
  return createNodeTokenRecord(nodeId, tokenHash);
}

export function findActiveNodeTokenInRegistry(nodeId: string, tokenHash: string) {
  return findActiveNodeTokenRecord(nodeId, tokenHash);
}

export function updateNodeHeartbeatInRegistry(
  nodeId: string,
  updates: UpdateNodeHeartbeatRecordInput
) {
  return updateNodeHeartbeatRecord(nodeId, updates);
}

export function updateNodeInRegistry(nodeId: string, updates: UpdateNodeRecordInput) {
  return updateNodeRecord(nodeId, updates);
}

export function createNodeStatusEventInRegistry(input: {
  nodeId: string;
  previousStatus?: string | null;
  newStatus: string;
  reason?: string;
}) {
  return createNodeStatusEventRecord(input);
}

