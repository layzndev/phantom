import { z } from "zod";

export const notificationParamsSchema = z.object({
  id: z.string().uuid()
});

export const notificationListQuerySchema = z.object({
  includeDismissed: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
  limit: z.coerce.number().int().min(1).max(500).optional()
});
