import { z } from "zod";

export const nodeParamsSchema = z.object({
  id: z.string().min(3).max(128).regex(/^[a-zA-Z0-9._:-]+$/)
});

export const maintenanceSchema = z.object({
  maintenanceMode: z.boolean()
});
