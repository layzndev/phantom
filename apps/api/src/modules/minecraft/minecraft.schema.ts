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

const relativeFilePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes("\0"), { message: "Path contains invalid characters." });

export const minecraftFilesListQuerySchema = z.object({
  path: relativeFilePathSchema.optional().default("/")
});

export const minecraftFilesReadQuerySchema = z.object({
  path: relativeFilePathSchema
});

export const minecraftFilesWriteSchema = z.object({
  path: relativeFilePathSchema,
  content: z.string().max(2_000_000)
});

export const minecraftFilesMkdirSchema = z.object({
  path: relativeFilePathSchema
});

export const minecraftFilesRenameSchema = z.object({
  from: relativeFilePathSchema,
  to: relativeFilePathSchema
});

export const minecraftFilesDeleteSchema = z.object({
  path: relativeFilePathSchema
});

export const minecraftFilesArchiveSchema = z.object({
  path: relativeFilePathSchema
});

export const minecraftFilesExtractSchema = z.object({
  path: relativeFilePathSchema
});

export const minecraftOperationParamsSchema = z.object({
  id: z.string().uuid(),
  opId: z.string().uuid()
});

export const updateMinecraftHostnameSchema = z.object({
  hostnameSlug: hostnameSlugSchema
});

export const updateMinecraftServerSettingsSchema = z.object({
  autoSleepUseGlobalDefaults: z.boolean(),
  autoSleepEnabled: z.boolean(),
  autoSleepIdleMinutes: z.coerce.number().int().min(1).max(240),
  autoSleepAction: z.enum(["sleep", "stop"]),
  maxPlayers: z.coerce.number().int().min(1).max(500),
  onlineMode: z.boolean(),
  difficulty: z.enum(["peaceful", "easy", "normal", "hard"]),
  gameMode: z.enum(["survival", "creative", "adventure", "spectator"]),
  motd: z.string().trim().min(1).max(120),
  whitelistEnabled: z.boolean()
});

export const updateMinecraftGlobalSettingsSchema = z.object({
  freeAutoSleepEnabled: z.boolean(),
  freeAutoSleepIdleMinutes: z.coerce.number().int().min(1).max(240),
  freeAutoSleepAction: z.enum(["sleep", "stop"])
});

export type CreateMinecraftServerInput = z.infer<typeof createMinecraftServerSchema>;
export type MinecraftServerListQuery = z.infer<typeof minecraftServerListQuerySchema>;
export type DeleteMinecraftServerQuery = z.infer<typeof deleteMinecraftServerQuerySchema>;
export type MinecraftCommandInput = z.infer<typeof minecraftCommandSchema>;
export type MinecraftLogsQuery = z.infer<typeof minecraftLogsQuerySchema>;
export type UpdateMinecraftHostnameInput = z.infer<typeof updateMinecraftHostnameSchema>;
export type MinecraftFilesListQuery = z.infer<typeof minecraftFilesListQuerySchema>;
export type MinecraftFilesReadQuery = z.infer<typeof minecraftFilesReadQuerySchema>;
export type MinecraftFilesWriteInput = z.infer<typeof minecraftFilesWriteSchema>;
export type MinecraftFilesMkdirInput = z.infer<typeof minecraftFilesMkdirSchema>;
export type MinecraftFilesRenameInput = z.infer<typeof minecraftFilesRenameSchema>;
export type MinecraftFilesDeleteInput = z.infer<typeof minecraftFilesDeleteSchema>;
export type MinecraftFilesArchiveInput = z.infer<typeof minecraftFilesArchiveSchema>;
export type MinecraftFilesExtractInput = z.infer<typeof minecraftFilesExtractSchema>;
export type UpdateMinecraftServerSettingsInput = z.infer<typeof updateMinecraftServerSettingsSchema>;
export type UpdateMinecraftGlobalSettingsInput = z.infer<typeof updateMinecraftGlobalSettingsSchema>;
