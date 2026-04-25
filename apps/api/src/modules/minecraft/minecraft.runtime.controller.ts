import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import {
  claimRuntimeMinecraftOperation,
  completeRuntimeMinecraftOperation,
  listRuntimeMinecraftOperations
} from "./minecraft.service.js";

export const minecraftRuntimeController = Router();

const runtimeOpParamsSchema = z.object({ opId: z.string().uuid() });

const runtimeCompleteSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  result: z.record(z.unknown()).nullish(),
  error: z.string().max(2000).nullish()
});

minecraftRuntimeController.get(
  "/operations/pending",
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await listRuntimeMinecraftOperations(token);
    res.json(result);
  })
);

minecraftRuntimeController.post(
  "/operations/:opId/claim",
  validateParams(runtimeOpParamsSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await claimRuntimeMinecraftOperation(token, req.params.opId);
    res.json(result);
  })
);

minecraftRuntimeController.post(
  "/operations/:opId/complete",
  validateParams(runtimeOpParamsSchema),
  validateBody(runtimeCompleteSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await completeRuntimeMinecraftOperation(token, req.params.opId, {
      status: req.body.status,
      result: (req.body.result ?? null) as Record<string, unknown> | null,
      error: req.body.error ?? null
    });
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
