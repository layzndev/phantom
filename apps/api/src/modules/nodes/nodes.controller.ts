import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin, requireRole } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getNode, getNodeSummary, listNodes, reconcileNode, refreshNode, rotateNodeToken, setNodeMaintenance, syncNode } from "./nodes.service.js";
import { maintenanceSchema, nodeParamsSchema } from "./nodes.schema.js";

export const nodesController = Router();

nodesController.use(requireAdmin);

nodesController.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    res.json({ summary: await getNodeSummary() });
  })
);

nodesController.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await writeAuditLog(req, { action: "node.list", actorId: actor.id, actorEmail: actor.email });
    res.json({ nodes: await listNodes() });
  })
);

nodesController.get(
  "/:id",
  validateParams(nodeParamsSchema),
  asyncHandler(async (req, res) => {
    const node = await getNode(req.params.id);
    const actor = req.session.admin!;
    await writeAuditLog(req, {
      action: "node.detail",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      targetId: req.params.id
    });
    res.json({ node });
  })
);

nodesController.post(
  "/:id/sync",
  requireRole(["superadmin", "ops"]),
  validateParams(nodeParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await writeAuditLog(req, { action: "node.sync", actorId: actor.id, actorEmail: actor.email, targetType: "node", targetId: req.params.id });
    res.json({ node: await syncNode(req.params.id) });
  })
);

nodesController.post(
  "/:id/maintenance",
  requireRole(["superadmin", "ops"]),
  validateParams(nodeParamsSchema),
  validateBody(maintenanceSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await writeAuditLog(req, {
      action: "node.maintenance",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      targetId: req.params.id,
      metadata: req.body
    });
    res.json({ node: await setNodeMaintenance(req.params.id, req.body.maintenanceMode) });
  })
);

nodesController.post(
  "/:id/reconcile",
  requireRole(["superadmin", "ops"]),
  validateParams(nodeParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await writeAuditLog(req, { action: "node.reconcile", actorId: actor.id, actorEmail: actor.email, targetType: "node", targetId: req.params.id });
    res.json({ node: await reconcileNode(req.params.id) });
  })
);

nodesController.post(
  "/:id/refresh",
  requireRole(["superadmin", "ops"]),
  validateParams(nodeParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await writeAuditLog(req, { action: "node.refresh", actorId: actor.id, actorEmail: actor.email, targetType: "node", targetId: req.params.id });
    res.json({ node: await refreshNode(req.params.id) });
  })
);

nodesController.post(
  "/:id/rotate-token",
  requireRole(["superadmin"]),
  validateParams(nodeParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await writeAuditLog(req, { action: "node.rotate-token", actorId: actor.id, actorEmail: actor.email, targetType: "node", targetId: req.params.id });
    res.json({ rotation: await rotateNodeToken(req.params.id) });
  })
);
