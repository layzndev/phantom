import {
  createAdminRecord,
  findAdminRecordByEmail,
  findAdminRecordById,
  markAdminLoginRecord,
  recordFailedAdminLoginRecord,
  resetAdminLoginFailuresRecord,
  updateAdminIpAllowlistRecord,
  upsertAdminRole
} from "../../db/adminRepository.js";

export function ensureAdminRole(name: string, description: string) {
  return upsertAdminRole(name, description);
}

export function createAdmin(input: {
  email: string;
  displayName: string;
  passwordHash: string;
  roleId: string;
  twoFactorEnabled?: boolean;
}) {
  return createAdminRecord(input);
}

export function findAdminByEmailRecord(email: string) {
  return findAdminRecordByEmail(email);
}

export function findAdminByIdRecord(id: string) {
  return findAdminRecordById(id);
}

export function markAdminLogin(adminId: string) {
  return markAdminLoginRecord(adminId);
}

export function recordFailedAdminLogin(adminId: string) {
  return recordFailedAdminLoginRecord(adminId);
}

export function resetAdminLoginFailures(adminId: string) {
  return resetAdminLoginFailuresRecord(adminId);
}

export function updateAdminIpAllowlist(adminId: string, allowlist: string[]) {
  return updateAdminIpAllowlistRecord(adminId, allowlist);
}
