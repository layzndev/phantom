import { z } from "zod";

export const nodeParamsSchema = z.object({
  id: z.string().min(3).max(128).regex(/^[a-zA-Z0-9._:-]+$/)
});

export const runtimeNodeParamsSchema = nodeParamsSchema;

const totalRamField = z.coerce.number().int().positive().max(2_097_152);
const totalCpuField = z.coerce.number().positive().max(4096);
const portField = z.coerce.number().int().min(1).max(65535);

export const createNodeSchema = z
  .object({
    id: z.string().min(3).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
    name: z.string().min(2).max(120),
    provider: z.string().min(2).max(80),
    region: z.string().min(2).max(80),
    internalHost: z.string().min(2).max(255),
    publicHost: z.string().min(2).max(255),
    runtimeMode: z.enum(["local", "remote"]).default("remote"),
    totalRamMb: totalRamField.optional(),
    totalCpu: totalCpuField.optional(),
    portRangeStart: portField,
    portRangeEnd: portField
  })
  .refine((value) => value.portRangeEnd >= value.portRangeStart, {
    message: "portRangeEnd must be greater than or equal to portRangeStart.",
    path: ["portRangeEnd"]
  });

export const updateNodeSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    provider: z.string().min(2).max(80).optional(),
    region: z.string().min(2).max(80).optional(),
    internalHost: z.string().min(2).max(255).optional(),
    publicHost: z.string().min(2).max(255).optional(),
    runtimeMode: z.enum(["local", "remote"]).optional(),
    totalRamMb: totalRamField.optional(),
    totalCpu: totalCpuField.optional(),
    portRangeStart: portField.optional(),
    portRangeEnd: portField.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided."
  })
  .refine(
    (value) =>
      value.portRangeStart === undefined ||
      value.portRangeEnd === undefined ||
      value.portRangeEnd >= value.portRangeStart,
    {
      message: "portRangeEnd must be greater than or equal to portRangeStart.",
      path: ["portRangeEnd"]
    }
  );

export const maintenanceSchema = z.object({
  maintenanceMode: z.boolean(),
  reason: z.string().max(240).optional()
});

export const nodeHeartbeatSchema = z.object({
  status: z.enum(["healthy", "degraded", "offline"]).default("healthy"),
  cpuUsed: z.coerce.number().min(0).optional(),
  ramUsedMb: z.coerce.number().min(0).optional(),
  diskUsedGb: z.coerce.number().min(0).optional(),
  totalRamMb: totalRamField.optional(),
  totalCpu: totalCpuField.optional()
});
