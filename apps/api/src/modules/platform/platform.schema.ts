import { z } from "zod";

const tenantSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/);

const quotaSchema = z
  .object({
    maxServers: z.coerce.number().int().min(1).max(100).optional(),
    maxRamMb: z.coerce.number().int().min(256).max(131_072).optional(),
    maxCpu: z.coerce.number().min(0.25).max(64).optional(),
    maxDiskGb: z.coerce.number().int().min(1).max(2_000).optional()
  })
  .strict();

export const createTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: tenantSlug,
    planTier: z.enum(["free", "premium"]).optional(),
    quota: quotaSchema.optional()
  })
  .strict();

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    planTier: z.enum(["free", "premium"]).optional(),
    suspended: z.boolean().optional(),
    quota: quotaSchema.optional()
  })
  .strict();

export const platformTenantParamsSchema = z.object({
  id: z.string().uuid()
});

export const issuePlatformTokenSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    expiresAt: z
      .string()
      .datetime()
      .nullable()
      .optional(),
    scopes: z.array(z.string().min(1).max(64)).max(32).optional()
  })
  .strict();

export const platformTokenParamsSchema = z.object({
  id: z.string().uuid()
});

export const platformTenantServerParamsSchema = z.object({
  id: z.string().uuid(),
  serverId: z.string().uuid()
});

export const provisionTenantServerSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    templateId: z.string().min(1).max(100).optional(),
    version: z.string().max(20).optional(),
    motd: z.string().max(120).optional(),
    difficulty: z.enum(["peaceful", "easy", "normal", "hard"]).optional(),
    gameMode: z.enum(["survival", "creative", "adventure", "spectator"]).optional(),
    maxPlayers: z.coerce.number().int().min(1).max(500).optional(),
    hostnameSlug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/)
      .optional(),
    cpu: z.coerce.number().positive().max(32).optional(),
    ramMb: z.coerce.number().int().positive().max(65_536).optional(),
    diskGb: z.coerce.number().int().positive().max(512).optional()
  })
  .strict();

export const deleteTenantServerQuerySchema = z.object({
  hardDeleteData: z.coerce.boolean().optional().default(false)
});

export type CreateTenantInputSchema = z.infer<typeof createTenantSchema>;
export type UpdateTenantInputSchema = z.infer<typeof updateTenantSchema>;
export type IssuePlatformTokenInputSchema = z.infer<typeof issuePlatformTokenSchema>;
export type ProvisionTenantServerInputSchema = z.infer<typeof provisionTenantServerSchema>;
