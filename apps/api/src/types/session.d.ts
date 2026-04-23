import type { AdminRole } from "../modules/auth/auth.types.js";

declare module "express-session" {
  interface SessionData {
    admin?: {
      id: string;
      email: string;
      role: AdminRole;
    };
    security?: {
      ipAddress?: string;
      userAgent?: string;
    };
  }
}
