import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import type { AdminWithRoleRecord } from "../../db/types.js";
import type { AdminUser, SafeAdminUser } from "./admins.types.js";
import { createAdmin, ensureAdminRole, findAdminByEmailRecord, findAdminByIdRecord, markAdminLogin, recordFailedAdminLogin, resetAdminLoginFailures } from "./admins.repository.js";

export async function seedBootstrapAdmin() {
  const superadminRole = await ensureAdminRole("superadmin", "Full access to the Phantom control plane.");
  await ensureAdminRole("ops", "Operational access to node supervision and safe node actions.");

  const existingAdmin = await findAdminByEmailRecord(env.adminBootstrapEmail);
  if (existingAdmin) return;

  const passwordHash = await bcrypt.hash(env.adminBootstrapPassword, 12);
  await createAdmin({
    email: env.adminBootstrapEmail,
    displayName: "Company Superadmin",
    passwordHash,
    roleId: superadminRole.id,
    twoFactorEnabled: false
  });
}

export async function getAdminByEmail(email: string) {
  const admin = await findAdminByEmailRecord(email);
  return admin ? toAdminUser(admin) : null;
}

export async function getAdminById(id: string) {
  const admin = await findAdminByIdRecord(id);
  return admin ? toAdminUser(admin) : null;
}

export function toSafeAdmin(admin: AdminUser): SafeAdminUser {
  return {
    id: admin.id,
    email: admin.email,
    displayName: admin.displayName,
    role: admin.role,
    twoFactorEnabled: admin.twoFactorEnabled
  };
}

export async function registerSuccessfulLogin(adminId: string) {
  await markAdminLogin(adminId);
}

export async function registerFailedLogin(adminId: string) {
  await recordFailedAdminLogin(adminId);
}

export async function clearLoginFailures(adminId: string) {
  await resetAdminLoginFailures(adminId);
}

function toAdminUser(admin: AdminWithRoleRecord): AdminUser {
  return {
    id: admin.id,
    email: admin.email,
    displayName: admin.displayName,
    role: admin.role.name === "ops" ? "ops" : "superadmin",
    passwordHash: admin.passwordHash,
    twoFactorEnabled: admin.twoFactorEnabled,
    createdAt: admin.createdAt.toISOString(),
    status: admin.status,
    failedLoginAttempts: admin.failedLoginAttempts,
    lockedUntil: admin.lockedUntil?.toISOString() ?? null,
    ipAllowlist: Array.isArray(admin.ipAllowlist) ? admin.ipAllowlist.filter((item): item is string => typeof item === "string") : []
  };
}
