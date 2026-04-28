import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody } from "../../lib/validate.js";
import {
  guardDecisionQuerySchema,
  guardEventBatchSchema
} from "./guard.schema.js";
import {
  getRuntimeGuardDecision,
  recordRuntimeGuardEvents
} from "./guard.service.js";

export const guardRuntimeController = Router();

guardRuntimeController.post(
  "/events",
  validateBody(guardEventBatchSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await recordRuntimeGuardEvents(token, req.body.events);
    res.json(result);
  })
);

guardRuntimeController.get(
  "/decision",
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const parsed = guardDecisionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsed.error.flatten());
    }
    const decision = await getRuntimeGuardDecision(token, parsed.data);
    res.json({ decision });
  })
);

function extractBearerToken(authorization?: string) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) {
    throw new AppError(401, "Missing node token.", "MISSING_NODE_TOKEN");
  }
  return token;
}
