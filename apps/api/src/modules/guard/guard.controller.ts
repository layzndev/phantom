import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  guardConnectionsQuerySchema,
  guardHostnameParamsSchema,
  guardIpParamsSchema,
  guardNoteSchema,
  guardOverviewQuerySchema,
  guardRuleActionSchema,
  guardServerParamsSchema,
  guardSettingsSchema,
  guardUsernameParamsSchema
} from "./guard.schema.js";
import {
  addGuardIpNote,
  addGuardPlayerNote,
  blockGuardIp,
  clearGuardIpScore,
  clearGuardPlayerScore,
  enforceGuardRetention,
  getGuardIpProfile,
  getGuardOverview,
  getGuardPlayerProfile,
  getGuardServerSummary,
  getGuardSettings,
  listGuardConnections,
  rateLimitGuardIp,
  shadowThrottleGuardHostname,
  trustGuardIp,
  trustGuardPlayer,
  updateGuardSettings
} from "./guard.service.js";

export const guardController = Router();

guardController.use(requireAdmin);

guardController.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const parsed = guardOverviewQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsed.error.flatten());
    }
    res.json(await getGuardOverview(parsed.data));
  })
);

guardController.get(
  "/connections",
  asyncHandler(async (req, res) => {
    const parsed = guardConnectionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsed.error.flatten());
    }
    res.json({ connections: await listGuardConnections(parsed.data) });
  })
);

guardController.get(
  "/players/:username",
  validateParams(guardUsernameParamsSchema),
  asyncHandler(async (req, res) => {
    res.json(await getGuardPlayerProfile(req.params.username));
  })
);

guardController.get(
  "/ip/:ip",
  validateParams(guardIpParamsSchema),
  asyncHandler(async (req, res) => {
    res.json(await getGuardIpProfile(req.params.ip));
  })
);

guardController.get(
  "/servers/:serverId/summary",
  validateParams(guardServerParamsSchema),
  asyncHandler(async (req, res) => {
    res.json({ summary: await getGuardServerSummary(req.params.serverId) });
  })
);

guardController.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getGuardSettings() });
  })
);

guardController.patch(
  "/settings",
  validateBody(guardSettingsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const settings = await updateGuardSettings(req.body);
    await writeAuditLog(req, {
      action: "guard.settings.update",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: "guard-settings",
      metadata: req.body
    });
    res.json({ settings });
  })
);

guardController.post(
  "/retention/run",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await enforceGuardRetention();
    await writeAuditLog(req, {
      action: "guard.retention.run",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: "guard-retention",
      metadata: result
    });
    res.json(result);
  })
);

guardController.post(
  "/ip/:ip/block",
  validateParams(guardIpParamsSchema),
  validateBody(guardRuleActionSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const rule = await blockGuardIp(req.params.ip, req.body, actor);
    await auditGuardAction(req, "guard.ip.block", req.params.ip, rule);
    res.json({ rule });
  })
);

guardController.post(
  "/ip/:ip/rate-limit",
  validateParams(guardIpParamsSchema),
  validateBody(guardRuleActionSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const rule = await rateLimitGuardIp(req.params.ip, req.body, actor);
    await auditGuardAction(req, "guard.ip.rate_limit", req.params.ip, rule);
    res.json({ rule });
  })
);

guardController.post(
  "/ip/:ip/trust",
  validateParams(guardIpParamsSchema),
  validateBody(guardRuleActionSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const rule = await trustGuardIp(req.params.ip, req.body, actor);
    await auditGuardAction(req, "guard.ip.trust", req.params.ip, rule);
    res.json({ rule });
  })
);

guardController.post(
  "/ip/:ip/clear-score",
  validateParams(guardIpParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await clearGuardIpScore(req.params.ip);
    await writeAuditLog(req, {
      action: "guard.ip.clear_score",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "ip",
      targetId: req.params.ip
    });
    res.json(result);
  })
);

guardController.post(
  "/ip/:ip/note",
  validateParams(guardIpParamsSchema),
  validateBody(guardNoteSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await addGuardIpNote(req.params.ip, req.body.note, actor);
    await writeAuditLog(req, {
      action: "guard.ip.note",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "ip",
      targetId: req.params.ip,
      metadata: { note: req.body.note }
    });
    res.json(result);
  })
);

guardController.post(
  "/players/:username/trust",
  validateParams(guardUsernameParamsSchema),
  validateBody(guardRuleActionSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const rule = await trustGuardPlayer(req.params.username, req.body, actor);
    await auditGuardAction(req, "guard.player.trust", req.params.username, rule);
    res.json({ rule });
  })
);

guardController.post(
  "/players/:username/clear-score",
  validateParams(guardUsernameParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await clearGuardPlayerScore(req.params.username);
    await writeAuditLog(req, {
      action: "guard.player.clear_score",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "player",
      targetId: req.params.username
    });
    res.json(result);
  })
);

guardController.post(
  "/players/:username/note",
  validateParams(guardUsernameParamsSchema),
  validateBody(guardNoteSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await addGuardPlayerNote(req.params.username, req.body.note, actor);
    await writeAuditLog(req, {
      action: "guard.player.note",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "player",
      targetId: req.params.username,
      metadata: { note: req.body.note }
    });
    res.json(result);
  })
);

guardController.post(
  "/hostnames/:hostname/shadow-throttle",
  validateParams(guardHostnameParamsSchema),
  validateBody(guardRuleActionSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const rule = await shadowThrottleGuardHostname(req.params.hostname, req.body, actor);
    await auditGuardAction(req, "guard.hostname.shadow_throttle", req.params.hostname, rule);
    res.json({ rule });
  })
);

async function auditGuardAction(
  req: Parameters<typeof writeAuditLog>[0],
  action:
    | "guard.ip.block"
    | "guard.ip.rate_limit"
    | "guard.ip.trust"
    | "guard.player.trust"
    | "guard.hostname.shadow_throttle",
  targetId: string,
  metadata: Record<string, unknown>
) {
  const actor = req.session.admin!;
  await writeAuditLog(req, {
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    targetType: "guard",
    targetId,
    metadata
  });
}
