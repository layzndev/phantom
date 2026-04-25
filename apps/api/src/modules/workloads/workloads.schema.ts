import { z } from "zod";

export const workloadParamsSchema = z.object({
  id: z.string().uuid()
});

const portField = z.coerce.number().int().min(1).max(65535);
const runtimeMetricField = z.coerce.number().min(0);

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

export const workloadDeleteQuerySchema = z.object({
  hardDeleteData: z.coerce.boolean().optional().default(false)
});

export const workloadRuntimeHeartbeatSchema = z
  .object({
    status: z.enum(["creating", "running", "stopped", "crashed"]),
    containerId: z.string().min(1).max(255).optional(),
    exitCode: z.coerce.number().int().nullable().optional(),
    restartCount: z.coerce.number().int().min(0).optional(),
    cpuPercent: runtimeMetricField.optional(),
    memoryMb: runtimeMetricField.optional(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().nullable().optional(),
    reason: z.string().max(500).optional()
  })
  .strict();

export const workloadRuntimeEventSchema = z
  .object({
    type: z.enum([
      "pulled",
      "created",
      "started",
      "stopped",
      "killed",
      "crashed"
    ]),
    status: z.enum(["creating", "running", "stopped", "crashed"]).optional(),
    reason: z.string().min(1).max(500).optional()
  })
  .strict();

export const workloadRuntimeAckActionSchema = z
  .object({
    handledDesiredStatus: z.enum(["restart", "kill"]),
    status: z.enum(["creating", "running", "stopped", "crashed"]).optional(),
    containerId: z.string().min(1).max(255).nullable().optional(),
    reason: z.string().max(500).optional()
  })
  .strict();

export const workloadRuntimeAckDeleteSchema = z
  .object({
    removedRuntime: z.boolean().optional(),
    removedData: z.boolean().optional(),
    containerId: z.string().min(1).max(255).nullable().optional(),
    reason: z.string().max(500).optional()
  })
  .strict();

export type CreateWorkloadInput = z.infer<typeof createWorkloadSchema>;
export type UpdateWorkloadInput = z.infer<typeof updateWorkloadSchema>;
export type WorkloadPortSpec = z.infer<typeof portSpecShape>;
export type WorkloadListQuery = z.infer<typeof workloadListQuerySchema>;
export type WorkloadDeleteQuery = z.infer<typeof workloadDeleteQuerySchema>;
export type WorkloadRuntimeHeartbeatInput = z.infer<typeof workloadRuntimeHeartbeatSchema>;
export type WorkloadRuntimeEventInput = z.infer<typeof workloadRuntimeEventSchema>;
export type WorkloadRuntimeAckActionInput = z.infer<typeof workloadRuntimeAckActionSchema>;
export type WorkloadRuntimeAckDeleteInput = z.infer<typeof workloadRuntimeAckDeleteSchema>;
