import bcrypt from "bcryptjs";
import { getAdminById, registerSuccessfulLogin, toSafeAdmin } from "../admins/admins.service.js";
import { clearLoginFailures, findLoginCandidate, recordLoginFailure } from "./auth.repository.js";

export async function authenticateAdmin(email: string, password: string) {
  const admin = await findLoginCandidate(email);
  if (!admin) return null;
  if (admin.status !== "active") return null;
  if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) return null;

  const validPassword = await bcrypt.compare(password, admin.passwordHash);
  if (!validPassword) {
    await recordLoginFailure(admin.id);
    return null;
  }

  await clearLoginFailures(admin.id);
  await registerSuccessfulLogin(admin.id);
  return toSafeAdmin(admin);
}

export async function getSafeAdminById(id: string) {
  const admin = await getAdminById(id);
  return admin ? toSafeAdmin(admin) : null;
}
