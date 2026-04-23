import {
  createNodeRecord,
  createNodeTokenRecord,
  findNodeRecordById,
  listNodeRecords,
  revokeActiveNodeTokens,
  setNodeMaintenanceRecord,
  findActiveNodeTokenRecord,
  updateNodeHeartbeatRecord,
  createNodeStatusEventRecord,
  type CreateNodeRecordInput
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

export function setNodeMaintenanceInRegistry(
  id: string,
  maintenanceMode: boolean,
  reason: string
) {
  return setNodeMaintenanceRecord(id, maintenanceMode, reason);
}

export async function rotateNodeTokenInRegistry(
  nodeId: string,
  tokenHash: string
) {
  await revokeActiveNodeTokens(nodeId);
  return createNodeTokenRecord(nodeId, tokenHash);
}

export function createNodeTokenInRegistry(
  nodeId: string,
  tokenHash: string
) {
  return createNodeTokenRecord(nodeId, tokenHash);
}

export function findActiveNodeTokenInRegistry(
  nodeId: string,
  tokenHash: string
) {
  return findActiveNodeTokenRecord(nodeId, tokenHash);
}

export function updateNodeHeartbeatInRegistry(
  nodeId: string,
  updates: { status: string; health: string }
) {
  return updateNodeHeartbeatRecord(nodeId, updates);
}

export function createNodeStatusEventInRegistry(input: {
  nodeId: string;
  previousStatus?: string | null;
  newStatus: string;
  reason?: string;
}) {
  return createNodeStatusEventRecord(input);
}