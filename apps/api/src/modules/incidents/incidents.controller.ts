import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  acknowledgeIncident,
  addIncidentNote,
  assignIncidentToMe,
  getIncident,
  getIncidentSummary,
  listIncidents,
  manuallyResolveIncident,
  reopenIncident
} from "./incidents.service.js";
import {
  incidentListQuerySchema,
  incidentNoteSchema,
  incidentParamsSchema,
  incidentReopenSchema,
  incidentResolveSchema
} from "./incidents.schema.js";

export const incidentsController = Router();

incidentsController.use(requireAdmin);

incidentsController.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    res.json({ summary: await getIncidentSummary() });
  })
);

incidentsController.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = incidentListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        400,
        "Invalid query parameters.",
        "VALIDATION_ERROR",
        parsed.error.flatten()
      );
    }
    res.json({ incidents: await listIncidents(parsed.data) });
  })
);

incidentsController.get(
  "/:id",
  validateParams(incidentParamsSchema),
  asyncHandler(async (req, res) => {
    res.json({ incident: await getIncident(req.params.id) });
  })
);

incidentsController.post(
  "/:id/acknowledge",
  validateParams(incidentParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const incident = await acknowledgeIncident(req.params.id, actor);
    await writeAuditLog(req, {
      action: "incident.acknowledge",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json({ incident });
  })
);

incidentsController.post(
  "/:id/assign-to-me",
  validateParams(incidentParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const incident = await assignIncidentToMe(req.params.id, actor);
    await writeAuditLog(req, {
      action: "incident.assign",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json({ incident });
  })
);

incidentsController.post(
  "/:id/resolve",
  validateParams(incidentParamsSchema),
  validateBody(incidentResolveSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const incident = await manuallyResolveIncident(req.params.id, actor, req.body);
    await writeAuditLog(req, {
      action: "incident.resolve",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: req.body
    });
    res.json({ incident });
  })
);

incidentsController.post(
  "/:id/reopen",
  validateParams(incidentParamsSchema),
  validateBody(incidentReopenSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const incident = await reopenIncident(req.params.id, actor, req.body);
    await writeAuditLog(req, {
      action: "incident.reopen",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: req.body
    });
    res.json({ incident });
  })
);

incidentsController.post(
  "/:id/note",
  validateParams(incidentParamsSchema),
  validateBody(incidentNoteSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const incident = await addIncidentNote(req.params.id, actor, req.body);
    await writeAuditLog(req, {
      action: "incident.note",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { note: req.body.note }
    });
    res.json({ incident });
  })
);
