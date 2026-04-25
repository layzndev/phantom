import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin, requireRole } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  createWorkload,
  getWorkload,
  killWorkload,
  listWorkloads,
  requestWorkloadDeletion,
  restartWorkload,
  startWorkload,
  stopWorkload,
  updateWorkload
} from "./workloads.service.js";
import {
  createWorkloadSchema,
  updateWorkloadSchema,
  workloadDeleteQuerySchema,
  workloadListQuerySchema,
  workloadParamsSchema
} from "./workloads.schema.js";

export const workloadsController = Router();

workloadsController.use(requireAdmin);

workloadsController.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsed = workloadListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters.", details: parsed.error.flatten() });
      return;
    }
    const workloads = await listWorkloads(parsed.data);
    await writeAuditLog(req, {
      action: "workload.list",
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: parsed.data
    });
    res.json({ workloads });
  })
);

workloadsController.post(
  "/",
  requireRole(["superadmin", "ops"]),
  validateBody(createWorkloadSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await createWorkload(req.body);
    await writeAuditLog(req, {
      action: "workload.create",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: result.workload.id,
      metadata: {
        type: result.workload.type,
        nodeId: result.workload.nodeId,
        placed: result.placed,
        reason: result.reason
      }
    });
    if (!result.placed) {
      await writeAuditLog(req, {
        action: "workload.schedule_failed",
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "system",
        targetId: result.workload.id,
        metadata: { reason: result.reason }
      });
    }
    res.status(201).json(result);
  })
);

workloadsController.get(
  "/:id",
  validateParams(workloadParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const workload = await getWorkload(req.params.id);
    await writeAuditLog(req, {
      action: "workload.detail",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json({ workload });
  })
);

workloadsController.patch(
  "/:id",
  requireRole(["superadmin", "ops"]),
  validateParams(workloadParamsSchema),
  validateBody(updateWorkloadSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const workload = await updateWorkload(req.params.id, req.body);
    await writeAuditLog(req, {
      action: "workload.update",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { fields: Object.keys(req.body) }
    });
    res.json({ workload });
  })
);

workloadsController.post(
  "/:id/start",
  requireRole(["superadmin", "ops"]),
  validateParams(workloadParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const workload = await startWorkload(req.params.id);
    await writeAuditLog(req, {
      action: "workload.start",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json({ workload });
  })
);

workloadsController.post(
  "/:id/stop",
  requireRole(["superadmin", "ops"]),
  validateParams(workloadParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const workload = await stopWorkload(req.params.id);
    await writeAuditLog(req, {
      action: "workload.stop",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json({ workload });
  })
);

workloadsController.post(
  "/:id/restart",
  requireRole(["superadmin", "ops"]),
  validateParams(workloadParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const workload = await restartWorkload(req.params.id);
    await writeAuditLog(req, {
      action: "workload.restart",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json({ workload });
  })
);

workloadsController.post(
  "/:id/kill",
  requireRole(["superadmin"]),
  validateParams(workloadParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const workload = await killWorkload(req.params.id);
    await writeAuditLog(req, {
      action: "workload.kill",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json({ workload });
  })
);

workloadsController.delete(
  "/:id",
  requireRole(["superadmin"]),
  validateParams(workloadParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsed = workloadDeleteQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters.", details: parsed.error.flatten() });
      return;
    }
    const result = await requestWorkloadDeletion(req.params.id, parsed.data);
    await writeAuditLog(req, {
      action: "workload.delete",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: {
        finalized: result.finalized,
        hardDeleteData: parsed.data.hardDeleteData
      }
    });
    res.status(result.finalized ? 200 : 202).json(result);
  })
);
