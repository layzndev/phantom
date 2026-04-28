import { z } from "zod";

export const guardActions = [
  "ping",
  "login_attempt",
  "login_success",
  "disconnect",
  "invalid_session",
  "rate_limited",
  "blocked"
] as const;

export const guardConnectionEventSchema = z.object({
  id: z.string().uuid().optional(),
  createdAt: z.string().datetime().optional(),
  serverId: z.string().uuid().nullish(),
  nodeId: z.string().min(1).max(120).nullish(),
  hostname: z.string().min(1).max(255).nullish(),
  sourceIp: z.string().min(2).max(128),
  countryCode: z.string().min(2).max(2).nullish(),
  region: z.string().max(120).nullish(),
  city: z.string().max(120).nullish(),
  asn: z.union([z.string(), z.number()]).nullish(),
  isp: z.string().max(180).nullish(),
  usernameAttempted: z.string().min(1).max(64).nullish(),
  normalizedUsername: z.string().min(1).max(64).nullish(),
  onlineMode: z.boolean().nullish(),
  protocolVersion: z.number().int().positive().nullish(),
  clientBrand: z.string().max(120).nullish(),
  action: z.enum(guardActions),
  disconnectReason: z.string().max(500).nullish(),
  latencyMs: z.number().int().min(0).max(120_000).nullish(),
  sessionId: z.string().uuid().nullish(),
  metadata: z.record(z.unknown()).nullish()
});

export const guardEventBatchSchema = z.object({
  events: z.array(guardConnectionEventSchema).min(1).max(250)
});

export const guardDecisionQuerySchema = z.object({
  sourceIp: z.string().min(2).max(128),
  hostname: z.string().min(1).max(255).optional()
});

export const guardConnectionsQuerySchema = z.object({
  username: z.string().max(64).optional(),
  ip: z.string().max(128).optional(),
  country: z.string().max(2).optional(),
  server: z.string().uuid().optional(),
  action: z.enum(guardActions).optional(),
  timeframe: z.enum(["1h", "24h", "7d", "30d", "all"]).default("24h"),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

export const guardOverviewQuerySchema = z.object({
  timeframe: z.enum(["1h", "24h", "7d", "30d"]).default("24h")
});

export const guardUsernameParamsSchema = z.object({
  username: z.string().min(1).max(64)
});

export const guardIpParamsSchema = z.object({
  ip: z.string().min(2).max(128)
});

export const guardServerParamsSchema = z.object({
  serverId: z.string().uuid()
});

export const guardHostnameParamsSchema = z.object({
  hostname: z.string().min(1).max(255)
});

export const guardRuleActionSchema = z.object({
  expiresMinutes: z.number().int().min(1).max(525_600).optional(),
  reason: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
  delayMs: z.number().int().min(250).max(30_000).optional()
});

export const guardNoteSchema = z.object({
  note: z.string().min(1).max(4000)
});

export const guardSettingsSchema = z.object({
  rawIpRetentionDays: z.number().int().refine((value) => [7, 30, 90].includes(value), {
    message: "rawIpRetentionDays must be one of 7, 30 or 90."
  }),
  aggregateRetentionDays: z.number().int().min(30).max(1095),
  hashIpsAfterRetention: z.boolean(),
  privacyMode: z.boolean()
});
