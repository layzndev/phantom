import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { buildAccountAllowlist, normalizeIp } from "../lib/ipAccess.js";
import { getAdminById } from "../modules/admins/admins.service.js";
import { createAuditLog } from "../modules/audit/audit.repository.js";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = req.session.admin;
  if (!session) {
    res.status(401).json({ error: "Admin authentication required." });
    return;
  }

  const reason = await evaluateSessionGuards(req, session);
  if (reason !== null) {
    void createAuditLog({
      action: "admin.session_revoked",
      actorId: session.id,
      actorEmail: session.email,
      targetType: "admin",
      targetId: session.id,
      metadata: {
        reason,
        ip: normalizeIp(req.ip) ?? "unknown",
        userAgent: req.get("user-agent") ?? null,
        path: req.originalUrl
      }
    }).catch((error) => {
      console.error("[auth] failed to write admin.session_revoked audit", error);
    });
    await new Promise<void>((resolve) => {
      req.session.destroy(() => resolve());
    });
    res.clearCookie("phantom.sid");
    res.status(401).json({ error: "Session is no longer valid.", code: "SESSION_REVOKED" });
    return;
  }

  next();
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.admin || !roles.includes(req.session.admin.role)) {
      res.status(403).json({ error: "Insufficient admin permissions." });
      return;
    }

    next();
  };
}

async function evaluateSessionGuards(
  req: Request,
  session: NonNullable<Request["session"]["admin"]>
): Promise<string | null> {
  const currentIp = normalizeIp(req.ip);

  // 1. Account still exists, is active and not locked.
  const admin = await getAdminById(session.id);
  if (!admin) return "admin_not_found";
  if (admin.status !== "active") return "admin_disabled";
  if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) return "admin_locked";

  // 2. Per-admin IP allowlist (stored on the admin record).
  if (admin.ipAllowlist.length > 0) {
    const allowlist = buildAccountAllowlist(admin.ipAllowlist);
    if (!currentIp || !allowlist.matches(currentIp)) {
      return "ip_not_in_admin_allowlist";
    }
  }

  // 3. Session pinning: the cookie can only be used from the IP / UA we
  //    saw at login. Defends against stolen cookies.
  const pinned = req.session.security ?? {};
  if (env.sessionPinIp && pinned.ipAddress) {
    const pinnedIp = normalizeIp(pinned.ipAddress);
    if (currentIp && pinnedIp && currentIp !== pinnedIp) {
      return "ip_pin_mismatch";
    }
  }
  if (env.sessionPinUserAgent && pinned.userAgent) {
    const currentUa = req.get("user-agent") ?? "";
    if (currentUa && currentUa !== pinned.userAgent) {
      return "user_agent_pin_mismatch";
    }
  }

  return null;
}
