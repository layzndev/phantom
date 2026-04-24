import {
  createWorkloadRecord,
  createWorkloadStatusEventRecord,
  deleteWorkloadRecord,
  findAssignedWorkloadRecordById,
  findWorkloadRecordById,
  listWorkloadRecords,
  listRuntimeAssignedWorkloadRecords,
  setWorkloadDesiredStatusRecord,
  updateWorkloadRuntimeRecord,
  updateWorkloadRecord,
  type CreateWorkloadRecordInput,
  type UpdateWorkloadRuntimeRecordInput,
  type UpdateWorkloadRecordInput,
  type WorkloadFilter
} from "../../db/workloadRepository.js";

export function listWorkloadsFromRegistry(filter: WorkloadFilter = {}) {
  return listWorkloadRecords(filter);
}

export function findWorkloadFromRegistry(id: string) {
  return findWorkloadRecordById(id);
}

export function listAssignedRuntimeWorkloadsFromRegistry(nodeId: string) {
  return listRuntimeAssignedWorkloadRecords(nodeId);
}

export function findAssignedWorkloadFromRegistry(nodeId: string, workloadId: string) {
  return findAssignedWorkloadRecordById(nodeId, workloadId);
}

export function createWorkloadInRegistry(input: CreateWorkloadRecordInput) {
  return createWorkloadRecord(input);
}

export function updateWorkloadInRegistry(id: string, updates: UpdateWorkloadRecordInput) {
  return updateWorkloadRecord(id, updates);
}

export function setWorkloadDesiredStatusInRegistry(
  id: string,
  desiredStatus: string,
  reason: string
) {
  return setWorkloadDesiredStatusRecord(id, desiredStatus, reason);
}

export function emitWorkloadStatusEvent(input: {
  workloadId: string;
  previousStatus?: string | null;
  newStatus: string;
  reason?: string;
}) {
  return createWorkloadStatusEventRecord(input);
}

export function deleteWorkloadFromRegistry(id: string) {
  return deleteWorkloadRecord(id);
}

export function updateWorkloadRuntimeInRegistry(
  workloadId: string,
  updates: UpdateWorkloadRuntimeRecordInput
) {
  return updateWorkloadRuntimeRecord(workloadId, updates);
}
