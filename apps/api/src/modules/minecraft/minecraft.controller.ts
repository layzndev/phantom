import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin, requireRole } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  createMinecraftServer,
  deleteMinecraftServer,
  enqueueMinecraftOperation,
  getMinecraftOperation,
  getMinecraftServer,
  getMinecraftTemplates,
  listMinecraftServers,
  restartMinecraftServer,
  startMinecraftServer,
  stopMinecraftServer
} from "./minecraft.service.js";
import {
  createMinecraftServerSchema,
  deleteMinecraftServerQuerySchema,
  minecraftCommandSchema,
  minecraftLogsQuerySchema,
  minecraftOperationParamsSchema,
  minecraftServerParamsSchema
} from "./minecraft.schema.js";

export const minecraftController = Router();

minecraftController.use(requireAdmin);

minecraftController.get(
  "/templates",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const templates = getMinecraftTemplates();
    await writeAuditLog(req, {
      action: "minecraft.template.list",
      actorId: actor.id,
      actorEmail: actor.email
    });
    res.json({ templates });
  })
);

minecraftController.get(
  "/servers",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const servers = await listMinecraftServers();
    await writeAuditLog(req, {
      action: "minecraft.server.list",
      actorId: actor.id,
      actorEmail: actor.email
    });
    res.json({ servers });
  })
);

minecraftController.post(
  "/servers",
  requireRole(["superadmin", "ops"]),
  validateBody(createMinecraftServerSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await createMinecraftServer(req.body);
    await writeAuditLog(req, {
      action: "minecraft.server.create",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: result.server.id,
      metadata: {
        workloadId: result.workload.id,
        templateId: result.server.templateId,
        version: result.server.minecraftVersion,
        placed: result.placed,
        nodeId: result.workload.nodeId,
        reason: result.reason,
        planTier: result.server.planTier,
        requiredPool: result.diagnostics?.requiredPool,
        candidates: result.diagnostics?.candidates
      }
    });
    res.status(201).json(result);
  })
);

minecraftController.get(
  "/servers/:id",
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await getMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.detail",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

minecraftController.post(
  "/servers/:id/start",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await startMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.start",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

minecraftController.post(
  "/servers/:id/stop",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await stopMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.stop",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

minecraftController.post(
  "/servers/:id/restart",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await restartMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.restart",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

minecraftController.delete(
  "/servers/:id",
  requireRole(["superadmin"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsedQuery = deleteMinecraftServerQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsedQuery.error.flatten());
    }
    const result = await deleteMinecraftServer(req.params.id, parsedQuery.data);
    await writeAuditLog(req, {
      action: "minecraft.server.delete",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: {
        finalized: result.finalized,
        hardDeleteData: parsedQuery.data.hardDeleteData
      }
    });
    res.status(result.finalized ? 200 : 202).json(result);
  })
);

minecraftController.post(
  "/servers/:id/command",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftCommandSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await enqueueMinecraftOperation(
      req.params.id,
      "command",
      { command: req.body.command },
      actor
    );
    await writeAuditLog(req, {
      action: "minecraft.server.command",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { command: req.body.command, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.post(
  "/servers/:id/save",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await enqueueMinecraftOperation(req.params.id, "save", {}, actor);
    await writeAuditLog(req, {
      action: "minecraft.server.save",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.get(
  "/servers/:id/logs",
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsedQuery = minecraftLogsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsedQuery.error.flatten());
    }
    const tail = parsedQuery.data.tail ?? 200;
    const result = await enqueueMinecraftOperation(
      req.params.id,
      "logs",
      { tail },
      actor
    );
    await writeAuditLog(req, {
      action: "minecraft.server.logs",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { tail, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.get(
  "/servers/:id/operations/:opId",
  validateParams(minecraftOperationParamsSchema),
  asyncHandler(async (req, res) => {
    const result = await getMinecraftOperation(req.params.id, req.params.opId);
    res.json(result);
  })
);
