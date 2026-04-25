import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import {
  ackRuntimeWorkloadAction,
  ackRuntimeWorkloadDelete,
  acceptWorkloadHeartbeat,
  appendRuntimeWorkloadEvent,
  listAssignedRuntimeWorkloads
} from "./workloads.service.js";
import {
  workloadParamsSchema,
  workloadRuntimeAckActionSchema,
  workloadRuntimeAckDeleteSchema,
  workloadRuntimeEventSchema,
  workloadRuntimeHeartbeatSchema
} from "./workloads.schema.js";

export const workloadsRuntimeController = Router();

workloadsRuntimeController.get(
  "/assigned",
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await listAssignedRuntimeWorkloads(token);
    res.json(result);
  })
);

workloadsRuntimeController.post(
  "/:id/heartbeat",
  validateParams(workloadParamsSchema),
  validateBody(workloadRuntimeHeartbeatSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await acceptWorkloadHeartbeat(req.params.id, token, req.body);
    res.json(result);
  })
);

workloadsRuntimeController.post(
  "/:id/events",
  validateParams(workloadParamsSchema),
  validateBody(workloadRuntimeEventSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await appendRuntimeWorkloadEvent(req.params.id, token, req.body);
    res.json(result);
  })
);

workloadsRuntimeController.post(
  "/:id/ack-action",
  validateParams(workloadParamsSchema),
  validateBody(workloadRuntimeAckActionSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await ackRuntimeWorkloadAction(req.params.id, token, req.body);
    res.json(result);
  })
);

workloadsRuntimeController.post(
  "/:id/ack-delete",
  validateParams(workloadParamsSchema),
  validateBody(workloadRuntimeAckDeleteSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await ackRuntimeWorkloadDelete(req.params.id, token, req.body);
    res.json(result);
  })
);

function extractBearerToken(authorization?: string) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;

  if (!token) {
    throw new AppError(401, "Missing node token.", "MISSING_NODE_TOKEN");
  }

  return token;
}
