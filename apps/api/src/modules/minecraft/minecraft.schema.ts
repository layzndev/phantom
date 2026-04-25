import { z } from "zod";

const HOSTNAME_RESERVED = [
  "admin",
  "api",
  "www",
  "mail",
  "ftp",
  "support",
  "root",
  "status",
  "ns1",
  "ns2"
] as const;

export const hostnameSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, {
    message: "Hostname slug must use lowercase letters, numbers or hyphens, without leading/trailing hyphens."
  })
  .refine((value) => !HOSTNAME_RESERVED.includes(value as (typeof HOSTNAME_RESERVED)[number]), {
    message: "Hostname slug is reserved."
  });

export const minecraftServerParamsSchema = z.object({
  id: z.string().uuid()
});

export const createMinecraftServerSchema = z.object({
  name: z.string().min(2).max(60),
  hostnameSlug: hostnameSlugSchema.optional(),
  templateId: z.string().min(1).max(100),
  version: z.string().max(20).optional(),
  motd: z.string().max(120).optional(),
  difficulty: z.enum(["peaceful", "easy", "normal", "hard"]).optional(),
  gameMode: z.enum(["survival", "creative", "adventure", "spectator"]).optional(),
  maxPlayers: z.coerce.number().int().min(1).max(500).optional(),
  eula: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Minecraft EULA (eula=true)." })
  }),
  planTier: z.enum(["free", "premium"]).default("free"),
  cpu: z.coerce.number().positive().max(32).optional(),
  ramMb: z.coerce.number().int().positive().max(65_536).optional(),
  diskGb: z.coerce.number().int().positive().max(512).optional()
});

export const minecraftServerListQuerySchema = z.object({
  templateId: z.string().optional()
});

export const deleteMinecraftServerQuerySchema = z.object({
  hardDeleteData: z.coerce.boolean().optional().default(false)
});

export const minecraftCommandSchema = z.object({
  command: z.string().min(1).max(500)
});

export const minecraftLogsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(2_000).optional()
});

export const minecraftOperationParamsSchema = z.object({
  id: z.string().uuid(),
  opId: z.string().uuid()
});

export const updateMinecraftHostnameSchema = z.object({
  hostnameSlug: hostnameSlugSchema
});

export type CreateMinecraftServerInput = z.infer<typeof createMinecraftServerSchema>;
export type MinecraftServerListQuery = z.infer<typeof minecraftServerListQuerySchema>;
export type DeleteMinecraftServerQuery = z.infer<typeof deleteMinecraftServerQuerySchema>;
export type MinecraftCommandInput = z.infer<typeof minecraftCommandSchema>;
export type MinecraftLogsQuery = z.infer<typeof minecraftLogsQuerySchema>;
export type UpdateMinecraftHostnameInput = z.infer<typeof updateMinecraftHostnameSchema>;
