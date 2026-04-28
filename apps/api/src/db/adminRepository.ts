import { db } from "./client.js";

export function upsertAdminRole(name: string, description: string) {
  return db.adminRole.upsert({
    where: { name },
    create: { name, description },
    update: {}
  });
}

export function findAdminRecordByEmail(email: string) {
  return db.admin.findUnique({
    where: { email: email.toLowerCase() },
    include: { role: true }
  });
}

export function findAdminRecordById(id: string) {
  return db.admin.findUnique({
    where: { id },
    include: { role: true }
  });
}

export function createAdminRecord(input: {
  email: string;
  displayName: string;
  passwordHash: string;
  roleId: string;
  twoFactorEnabled?: boolean;
}) {
  return db.admin.create({
    data: {
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      roleId: input.roleId,
      twoFactorEnabled: input.twoFactorEnabled ?? false
    }
  });
}

export function markAdminLoginRecord(adminId: string) {
  return db.admin.update({
    where: { id: adminId },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null }
  });
}

export async function recordFailedAdminLoginRecord(adminId: string) {
  const admin = await db.admin.findUnique({
    where: { id: adminId },
    select: { failedLoginAttempts: true }
  });

  const failedLoginAttempts = (admin?.failedLoginAttempts ?? 0) + 1;
  const shouldLock = failedLoginAttempts >= 5;

  return db.admin.update({
    where: { id: adminId },
    data: {
      failedLoginAttempts,
      lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null
    }
  });
}

export function resetAdminLoginFailuresRecord(adminId: string) {
  return db.admin.update({
    where: { id: adminId },
    data: { failedLoginAttempts: 0, lockedUntil: null }
  });
}

export function updateAdminIpAllowlistRecord(adminId: string, allowlist: string[]) {
  return db.admin.update({
    where: { id: adminId },
    data: { ipAllowlist: allowlist },
    include: { role: true }
  });
}
