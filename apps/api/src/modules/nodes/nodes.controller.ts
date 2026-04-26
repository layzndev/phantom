import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin, requireRole } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { clearRecentNodeIncidents, createNode, deleteNode, getNode, getNodeSummary, listNodes, rotateNodeToken, setNodeMaintenance, updateNode } from "./nodes.service.js";
import { createNodeSchema, maintenanceSchema, nodeParamsSchema, updateNodeSchema } from "./nodes.schema.js";

export const nodesController = Router();

nodesController.use(requireAdmin);

nodesController.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    res.json({ summary: await getNodeSummary() });
  })
);

nodesController.post(
  "/incidents/clear",
  requireRole(["superadmin", "ops"]),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await clearRecentNodeIncidents();
    await writeAuditLog(req, {
      action: "node.incidents.clear",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      metadata: result
    });
    res.json(result);
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

nodesController.post(
  "/",
  requireRole(["superadmin", "ops"]),
  validateBody(createNodeSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await createNode(req.body);
    await writeAuditLog(req, {
      action: "node.create",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      targetId: result.node.id,
      metadata: { provider: result.node.provider, region: result.node.region }
    });
    res.status(201).json(result);
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

nodesController.patch(
  "/:id",
  requireRole(["superadmin", "ops"]),
  validateParams(nodeParamsSchema),
  validateBody(updateNodeSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const node = await updateNode(req.params.id, req.body);
    await writeAuditLog(req, {
      action: "node.update",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      targetId: req.params.id,
      metadata: { fields: Object.keys(req.body) }
    });
    res.json({ node });
  })
);

nodesController.post(
  "/:id/maintenance",
  requireRole(["superadmin", "ops"]),
  validateParams(nodeParamsSchema),
  validateBody(maintenanceSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const node = await setNodeMaintenance(req.params.id, req.body.maintenanceMode, req.body.reason);
    await writeAuditLog(req, {
      action: "node.maintenance",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      targetId: req.params.id,
      metadata: req.body
    });
    res.json({ node });
  })
);

nodesController.post(
  "/:id/rotate-token",
  requireRole(["superadmin"]),
  validateParams(nodeParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const rotation = await rotateNodeToken(req.params.id);
    await writeAuditLog(req, {
      action: "node.rotate-token",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      targetId: req.params.id
    });
    res.json({ rotation });
  })
);

nodesController.delete(
  "/:id",
  requireRole(["superadmin"]),
  validateParams(nodeParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    await deleteNode(req.params.id);
    await writeAuditLog(req, {
      action: "node.delete",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "node",
      targetId: req.params.id
    });
    res.status(204).send();
  })
);
