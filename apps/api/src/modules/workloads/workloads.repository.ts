import {
  createWorkloadRecord,
  createWorkloadStatusEventRecord,
  deleteWorkloadRecord,
  finalizeWorkloadDeletionRecord,
  findAssignedWorkloadRecordById,
  findWorkloadRecordById,
  listWorkloadRecords,
  listRuntimeAssignedWorkloadRecords,
  markWorkloadDeletingRecord,
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

export function markWorkloadDeletingInRegistry(
  id: string,
  options: { hardDeleteData: boolean; reason: string }
) {
  return markWorkloadDeletingRecord(id, options);
}

export function finalizeWorkloadDeletionInRegistry(
  id: string,
  options: { mode: "hard" | "soft"; reason: string }
) {
  return finalizeWorkloadDeletionRecord(id, options);
}

export function updateWorkloadRuntimeInRegistry(
  workloadId: string,
  updates: UpdateWorkloadRuntimeRecordInput
) {
  return updateWorkloadRuntimeRecord(workloadId, updates);
}
