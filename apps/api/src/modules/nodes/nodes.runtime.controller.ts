import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { AppError } from "../../lib/appError.js";
import { nodeHeartbeatSchema, runtimeNodeParamsSchema } from "./nodes.schema.js";
import { acceptNodeHeartbeat } from "./nodes.service.js";

export const nodesRuntimeController = Router();

nodesRuntimeController.post(
  "/:id/heartbeat",
  validateParams(runtimeNodeParamsSchema),
  validateBody(nodeHeartbeatSchema),
  asyncHandler(async (req, res) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      throw new AppError(401, "Missing node token.", "MISSING_NODE_TOKEN");
    }

    const result = await acceptNodeHeartbeat(req.params.id, token, req.body);
    res.json(result);
  })
);