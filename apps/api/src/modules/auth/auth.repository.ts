import { clearLoginFailures as clearAdminLoginFailures, getAdminByEmail, registerFailedLogin } from "../admins/admins.service.js";

export async function findLoginCandidate(email: string) {
  return getAdminByEmail(email);
}

export async function recordLoginFailure(adminId: string) {
  return registerFailedLogin(adminId);
}

export async function clearLoginFailures(adminId: string) {
  return clearAdminLoginFailures(adminId);
}
