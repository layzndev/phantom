import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody } from "../../lib/validate.js";
import { requireAdmin } from "../../middleware/authMiddleware.js";
import {
  clearLoginFailuresForIp,
  loginIpGuard,
  recordLoginFailureForIp
} from "../../middleware/loginIpThrottle.js";
import { authRateLimiter } from "../../middleware/security.js";
import { buildAccountAllowlist, normalizeIp, parseIpAllowlist } from "../../lib/ipAccess.js";
import { getAdminByEmail, setAdminIpAllowlist } from "../admins/admins.service.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { authenticateAdmin, getSafeAdminById } from "./auth.service.js";
import { loginSchema } from "./auth.schema.js";

export const authController = Router();

authController.post(
  "/login",
  authRateLimiter,
  loginIpGuard,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const admin = await authenticateAdmin(req.body.email, req.body.password);
    if (!admin) {
      recordLoginFailureForIp(req, req.body.email);
      await writeAuditLog(req, {
        action: "admin.login_failed",
        actorEmail: req.body.email,
        targetType: "admin",
        metadata: { reason: "invalid_credentials_or_locked" }
      });
      throw new AppError(401, "Invalid admin credentials.", "INVALID_CREDENTIALS");
    }

    // Per-admin IP allowlist enforcement at login: even with a valid
    // password, refuse to issue a session for an off-network IP.
    const adminWithAllowlist = await getAdminByEmail(req.body.email);
    if (adminWithAllowlist && adminWithAllowlist.ipAllowlist.length > 0) {
      const allowlist = buildAccountAllowlist(adminWithAllowlist.ipAllowlist);
      const currentIp = normalizeIp(req.ip);
      if (!currentIp || !allowlist.matches(currentIp)) {
        recordLoginFailureForIp(req, req.body.email);
        await writeAuditLog(req, {
          action: "admin.login_failed",
          actorEmail: req.body.email,
          targetType: "admin",
          targetId: adminWithAllowlist.id,
          metadata: {
            reason: "ip_not_in_admin_allowlist",
            ip: currentIp ?? "unknown"
          }
        });
        throw new AppError(403, "This account is not allowed from your network.", "IP_NOT_ALLOWED");
      }
    }

    clearLoginFailuresForIp(req);

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });

    req.session.admin = { id: admin.id, email: admin.email, role: admin.role };
    req.session.security = { ipAddress: req.ip, userAgent: req.get("user-agent") };
    await writeAuditLog(req, {
      action: "admin.login",
      actorId: admin.id,
      actorEmail: admin.email,
      targetType: "admin",
      targetId: admin.id,
      metadata: { role: admin.role, twoFactorEnabled: admin.twoFactorEnabled }
    });

    res.json({ admin });
  })
);

authController.post(
  "/logout",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await writeAuditLog(req, {
      action: "admin.logout",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "admin",
      targetId: actor.id
    });

    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });

    res.clearCookie("phantom.sid");
    res.status(204).send();
  })
);

authController.get("/me", requireAdmin, asyncHandler(async (req, res) => {
  const admin = await getSafeAdminById(req.session.admin?.id ?? "");
  if (!admin) {
    throw new AppError(401, "Admin session is no longer valid.", "INVALID_SESSION");
  }

  res.json({ admin });
}));

authController.put(
  "/me/ip-allowlist",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const raw = (req.body?.entries ?? []) as unknown;
    if (!Array.isArray(raw)) {
      throw new AppError(400, "entries must be an array of strings.", "VALIDATION_ERROR");
    }
    const entries = raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (entries.length > 32) {
      throw new AppError(400, "Maximum 32 entries.", "VALIDATION_ERROR");
    }
    // Validate each entry is a parseable IP or CIDR.
    const validated = parseIpAllowlist(entries.join(","));
    if (entries.length > 0 && validated.entries.length !== entries.length) {
      throw new AppError(400, "Some entries are not valid IPs or CIDRs.", "INVALID_IP_ALLOWLIST");
    }

    // Refuse to lock the admin out: the new allowlist must include the IP
    // they are connecting from right now (only when not empty).
    const currentIp = normalizeIp(req.ip);
    if (entries.length > 0 && (!currentIp || !validated.matches(currentIp))) {
      throw new AppError(
        400,
        "Allowlist must include your current IP or you would be locked out.",
        "WOULD_LOCK_OUT"
      );
    }

    const updated = await setAdminIpAllowlist(actor.id, validated.entries);
    await writeAuditLog(req, {
      action: "admin.ip_allowlist.update",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "admin",
      targetId: actor.id,
      metadata: { entries: validated.entries }
    });
    res.json({ admin: { id: updated.id, ipAllowlist: updated.ipAllowlist } });
  })
);
