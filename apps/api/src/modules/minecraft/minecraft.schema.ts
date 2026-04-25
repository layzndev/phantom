import { z } from "zod";

export const minecraftServerParamsSchema = z.object({
  id: z.string().uuid()
});

export const createMinecraftServerSchema = z.object({
  name: z.string().min(2).max(60),
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

export type CreateMinecraftServerInput = z.infer<typeof createMinecraftServerSchema>;
export type MinecraftServerListQuery = z.infer<typeof minecraftServerListQuerySchema>;
export type DeleteMinecraftServerQuery = z.infer<typeof deleteMinecraftServerQuerySchema>;
export type MinecraftCommandInput = z.infer<typeof minecraftCommandSchema>;
export type MinecraftLogsQuery = z.infer<typeof minecraftLogsQuerySchema>;
