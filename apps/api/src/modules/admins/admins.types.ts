export type AdminRole = "superadmin" | "ops";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  passwordHash: string;
  status: string;
  twoFactorEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  ipAllowlist: string[];
  createdAt: string;
}

export interface SafeAdminUser {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  twoFactorEnabled: boolean;
}
