export interface LoginSecurityResult {
  allowed: boolean;
  reason?: "locked" | "inactive" | "invalid_credentials";
}
