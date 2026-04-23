import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody } from "../../lib/validate.js";
import { requireAdmin } from "../../middleware/authMiddleware.js";
import { authRateLimiter } from "../../middleware/security.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { authenticateAdmin, getSafeAdminById } from "./auth.service.js";
import { loginSchema } from "./auth.schema.js";

export const authController = Router();

authController.post(
  "/login",
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const admin = await authenticateAdmin(req.body.email, req.body.password);
    if (!admin) {
      await writeAuditLog(req, {
        action: "admin.login_failed",
        actorEmail: req.body.email,
        targetType: "admin",
        metadata: { reason: "invalid_credentials_or_locked" }
      });
      throw new AppError(401, "Invalid admin credentials.", "INVALID_CREDENTIALS");
    }

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
