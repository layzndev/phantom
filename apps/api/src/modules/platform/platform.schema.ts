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

export type CreateTenantInputSchema = z.infer<typeof createTenantSchema>;
export type UpdateTenantInputSchema = z.infer<typeof updateTenantSchema>;
export type IssuePlatformTokenInputSchema = z.infer<typeof issuePlatformTokenSchema>;
