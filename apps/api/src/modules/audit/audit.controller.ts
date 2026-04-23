import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { requireAdmin } from "../../middleware/authMiddleware.js";
import { listAuditLogs } from "./audit.service.js";

export const auditController = Router();

auditController.use(requireAdmin);
auditController.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ auditLogs: await listAuditLogs() });
  })
);
