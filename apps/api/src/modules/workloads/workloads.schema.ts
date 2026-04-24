import { z } from "zod";

export const workloadParamsSchema = z.object({
  id: z.string().uuid()
});

const portField = z.coerce.number().int().min(1).max(65535);

const portSpecShape = z.object({
  internalPort: portField,
  protocol: z.enum(["tcp", "udp"]).default("tcp")
});

export const workloadTypeEnum = z.enum(["minecraft", "discord-bot", "proxy", "container"]);

export const createWorkloadSchema = z.object({
  name: z.string().min(2).max(120),
  type: workloadTypeEnum,
  image: z.string().min(2).max(255),
  requestedCpu: z.coerce.number().positive().max(4096),
  requestedRamMb: z.coerce.number().int().positive().max(2_097_152),
  requestedDiskGb: z.coerce.number().int().positive().max(65_536),
  ports: z.array(portSpecShape).max(64).optional(),
  config: z.record(z.unknown()).optional()
});

export const updateWorkloadSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    config: z.record(z.unknown()).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided."
  });

export const workloadListQuerySchema = z.object({
  nodeId: z.string().optional(),
  status: z
    .enum(["pending", "creating", "running", "stopped", "crashed", "deleting", "deleted"])
    .optional(),
  type: workloadTypeEnum.optional()
});

export type CreateWorkloadInput = z.infer<typeof createWorkloadSchema>;
export type UpdateWorkloadInput = z.infer<typeof updateWorkloadSchema>;
export type WorkloadPortSpec = z.infer<typeof portSpecShape>;
export type WorkloadListQuery = z.infer<typeof workloadListQuerySchema>;
