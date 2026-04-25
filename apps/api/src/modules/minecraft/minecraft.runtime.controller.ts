import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import {
  claimRuntimeMinecraftOperation,
  completeRuntimeMinecraftOperation,
  getMinecraftConsoleSession,
  getRuntimeMinecraftRouting,
  listRuntimeMinecraftConsoleStreams,
  listRuntimeMinecraftOperations,
  publishRuntimeMinecraftConsoleLogs,
  wakeRuntimeMinecraftServer
} from "./minecraft.service.js";

export const minecraftRuntimeController = Router();

const runtimeOpParamsSchema = z.object({ opId: z.string().uuid() });
const runtimeConsoleParamsSchema = z.object({ id: z.string().uuid() });
const runtimeServerParamsSchema = z.object({ serverId: z.string().uuid() });
const runtimeRoutingQuerySchema = z.object({ hostname: z.string().min(1).max(255) });

const runtimeCompleteSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  result: z.record(z.unknown()).nullish(),
  error: z.string().max(2000).nullish()
});

const runtimeConsoleLogsSchema = z.object({
  lines: z.array(z.string().min(1).max(4000)).max(200)
});

minecraftRuntimeController.get(
  "/routing",
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const parsed = runtimeRoutingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsed.error.flatten());
    }
    const result = await getRuntimeMinecraftRouting(token, parsed.data.hostname);
    res.json(result);
  })
);

minecraftRuntimeController.get(
  "/servers/:id/console",
  validateParams(runtimeConsoleParamsSchema),
  asyncHandler(async (req, res) => {
    await getMinecraftConsoleSession(req.params.id);
    res.status(426).json({
      error: "Upgrade Required.",
      code: "WEBSOCKET_UPGRADE_REQUIRED",
      endpoint: `/runtime/minecraft/servers/${req.params.id}/console`
    });
  })
);

minecraftRuntimeController.post(
  "/wake/:serverId",
  validateParams(runtimeServerParamsSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await wakeRuntimeMinecraftServer(token, req.params.serverId);
    res.json(result);
  })
);

minecraftRuntimeController.get(
  "/operations/pending",
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await listRuntimeMinecraftOperations(token);
    res.json(result);
  })
);

minecraftRuntimeController.get(
  "/consoles/active",
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await listRuntimeMinecraftConsoleStreams(token);
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

minecraftRuntimeController.post(
  "/servers/:id/console/logs",
  validateParams(runtimeConsoleParamsSchema),
  validateBody(runtimeConsoleLogsSchema),
  asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const result = await publishRuntimeMinecraftConsoleLogs(token, req.params.id, {
      lines: req.body.lines
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
