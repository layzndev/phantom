import { adminApi } from "@/lib/api/admin-api";

export function getCurrentAdmin() {
  return adminApi.me();
}

export function logoutAdmin() {
  return adminApi.logout();
}
