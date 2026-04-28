import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin, requireRole } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  issuePlatformToken,
  listPlatformTokens,
  revokePlatformToken
} from "./platform.tokens.service.js";
import {
  issuePlatformTokenSchema,
  platformTokenParamsSchema
} from "./platform.schema.js";

/**
 * Admin-side management of the platform tokens used by the Hosting backend
 * (Nebula). Lives at /platform-admin/* so it can sit behind the regular
 * admin session + IP allowlist stack.
 */
export const platformAdminController = Router();

platformAdminController.use(requireAdmin);
platformAdminController.use(requireRole(["superadmin"]));

platformAdminController.get(
  "/tokens",
  asyncHandler(async (_req, res) => {
    const tokens = await listPlatformTokens();
    res.json({ tokens });
  })
);

platformAdminController.post(
  "/tokens",
  validateBody(issuePlatformTokenSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    const issued = await issuePlatformToken({
      name: req.body.name,
      scopes: req.body.scopes,
      expiresAt,
      createdById: actor.id
    });
    await writeAuditLog(req, {
      action: "platform.token.issue",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: issued.id,
      metadata: {
        name: issued.name,
        prefix: issued.prefix,
        last4: issued.last4,
        expiresAt: issued.expiresAt
      }
    });
    res.status(201).json({ token: issued });
  })
);

platformAdminController.post(
  "/tokens/:id/revoke",
  validateParams(platformTokenParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const token = await revokePlatformToken(req.params.id);
    await writeAuditLog(req, {
      action: "platform.token.revoke",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: token.id,
      metadata: { name: token.name, prefix: token.prefix }
    });
    res.json({ token });
  })
);
