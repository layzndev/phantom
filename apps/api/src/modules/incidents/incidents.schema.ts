import { z } from "zod";

export const incidentParamsSchema = z.object({
  id: z.string().uuid()
});

export const incidentListQuerySchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved"]).optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  scope: z
    .enum(["global", "node", "proxy", "api", "database", "minecraft_server", "billing"])
    .optional(),
  sourceId: z.string().min(1).max(191).optional(),
  sourceType: z.string().min(1).max(64).optional(),
  window: z.enum(["24h", "7d", "all"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200)
});

export const incidentResolveSchema = z.object({
  rootCause: z.string().max(10_000).optional(),
  internalNotes: z.string().max(10_000).optional()
});

export const incidentReopenSchema = z.object({
  note: z.string().max(10_000).optional()
});

export const incidentNoteSchema = z.object({
  note: z.string().min(1).max(10_000)
});
