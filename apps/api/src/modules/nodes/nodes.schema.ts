import { z } from "zod";

export const nodeParamsSchema = z.object({
  id: z.string().min(3).max(128).regex(/^[a-zA-Z0-9._:-]+$/)
});

export const createNodeSchema = z
  .object({
    id: z.string().min(3).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
    name: z.string().min(2).max(120),
    provider: z.string().min(2).max(80),
    region: z.string().min(2).max(80),
    internalHost: z.string().min(2).max(255),
    publicHost: z.string().min(2).max(255),
    runtimeMode: z.enum(["local", "remote"]).default("remote"),
    totalRamMb: z.coerce.number().int().positive().max(2_097_152),
    totalCpu: z.coerce.number().positive().max(4096),
    portRangeStart: z.coerce.number().int().min(1).max(65535),
    portRangeEnd: z.coerce.number().int().min(1).max(65535)
  })
  .refine((value) => value.portRangeEnd >= value.portRangeStart, {
    message: "portRangeEnd must be greater than or equal to portRangeStart.",
    path: ["portRangeEnd"]
  });

export const maintenanceSchema = z.object({
  maintenanceMode: z.boolean(),
  reason: z.string().max(240).optional()
});
