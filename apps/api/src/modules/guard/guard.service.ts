import { createHmac, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { AppError } from "../../lib/appError.js";
import { authenticateRuntimeNode } from "../nodes/nodes.service.js";
import { lookupGuardGeo } from "./guard.geo.js";
import type {
  guardConnectionEventSchema,
  guardConnectionsQuerySchema,
  guardOverviewQuerySchema,
  guardRuleActionSchema,
  guardSettingsSchema
} from "./guard.schema.js";
import type { z } from "zod";

type GuardConnectionEventInput = z.infer<typeof guardConnectionEventSchema>;
type GuardConnectionsQuery = z.infer<typeof guardConnectionsQuerySchema>;
type GuardOverviewQuery = z.infer<typeof guardOverviewQuerySchema>;
type GuardRuleActionInput = z.infer<typeof guardRuleActionSchema>;
type GuardSettingsInput = z.infer<typeof guardSettingsSchema>;

const SETTINGS_ID = "default";
const SUSPICIOUS_ACTIONS = ["invalid_session", "rate_limited", "blocked"] as const;

interface EnrichedGuardEvent {
  id: string;
  createdAt: Date;
  serverId: string | null;
  nodeId: string | null;
  hostname: string | null;
  sourceIp: string;
  sourceIpHash: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: string | null;
  isp: string | null;
  usernameAttempted: string | null;
  normalizedUsername: string | null;
  onlineMode: boolean | null;
  protocolVersion: number | null;
  clientBrand: string | null;
  action: string;
  disconnectReason: string | null;
  latencyMs: number | null;
  sessionId: string | null;
  metadata: Record<string, unknown>;
}

interface RiskAssessment {
  score: number;
  signals: string[];
}

export async function recordRuntimeGuardEvents(
  rawToken: string,
  events: GuardConnectionEventInput[]
) {
  const node = await authenticateRuntimeNode(rawToken);
  const settings = await getGuardSettingsRecord();
  const enriched: EnrichedGuardEvent[] = [];

  for (const event of events) {
    const sourceIp = normalizeIp(event.sourceIp);
    const sourceIpHash = hashIp(sourceIp);
    const geo = await lookupGuardGeo(sourceIp);
    const normalizedUsername =
      normalizeMinecraftUsername(event.normalizedUsername) ??
      normalizeMinecraftUsername(event.usernameAttempted);

    const enrichedEvent: EnrichedGuardEvent = {
      id: event.id ?? randomUUID(),
      createdAt: event.createdAt ? new Date(event.createdAt) : new Date(),
      serverId: event.serverId ?? null,
      nodeId: event.nodeId ?? node.id,
      hostname: normalizeHostname(event.hostname),
      sourceIp,
      sourceIpHash,
      countryCode: normalizeCountry(event.countryCode) ?? geo.countryCode,
      region: trimNullable(event.region, 120) ?? geo.region,
      city: trimNullable(event.city, 120) ?? geo.city,
      asn: stringifyNullable(event.asn, 64) ?? geo.asn,
      isp: trimNullable(event.isp, 180) ?? geo.isp,
      usernameAttempted: trimNullable(event.usernameAttempted, 64),
      normalizedUsername,
      onlineMode: event.onlineMode ?? null,
      protocolVersion: event.protocolVersion ?? null,
      clientBrand: trimNullable(event.clientBrand, 120),
      action: event.action,
      disconnectReason: trimNullable(event.disconnectReason, 500),
      latencyMs: event.latencyMs ?? null,
      sessionId: event.sessionId ?? null,
      metadata: sanitizeMetadata(event.metadata)
    };

    const risk = await assessRisk(enrichedEvent);
    enrichedEvent.metadata = {
      ...enrichedEvent.metadata,
      riskScore: risk.score,
      riskSignals: risk.signals
    };
    enriched.push(enrichedEvent);
  }

  if (enriched.length === 0) {
    return { accepted: 0, maxRiskScore: 0 };
  }

  await db.connectionEvent.createMany({
    data: enriched.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      serverId: event.serverId,
      nodeId: event.nodeId,
      hostname: event.hostname,
      sourceIp: settings.privacyMode ? null : event.sourceIp,
      sourceIpHash: event.sourceIpHash,
      countryCode: event.countryCode,
      region: event.region,
      city: event.city,
      asn: event.asn,
      isp: event.isp,
      usernameAttempted: event.usernameAttempted,
      normalizedUsername: event.normalizedUsername,
      onlineMode: event.onlineMode,
      protocolVersion: event.protocolVersion,
      clientBrand: event.clientBrand,
      action: event.action,
      disconnectReason: event.disconnectReason,
      latencyMs: event.latencyMs,
      sessionId: event.sessionId,
      metadata: event.metadata as Prisma.InputJsonValue
    })),
    skipDuplicates: true
  });

  await Promise.all([updatePlayerProfiles(enriched), updateIpProfiles(enriched, settings.privacyMode)]);

  return {
    accepted: enriched.length,
    maxRiskScore: Math.max(...enriched.map((event) => riskFromMetadata(event.metadata)))
  };
}

export async function getRuntimeGuardDecision(
  rawToken: string,
  input: { sourceIp: string; hostname?: string }
) {
  await authenticateRuntimeNode(rawToken);
  const sourceIp = normalizeIp(input.sourceIp);
  const sourceIpHash = hashIp(sourceIp);
  const hostname = normalizeHostname(input.hostname);
  const now = new Date();

  const rules = await db.guardRule.findMany({
    where: {
      OR: [
        { targetScope: "ip", targetHash: sourceIpHash },
        ...(hostname ? [{ targetScope: "hostname", targetValue: hostname }] : [])
      ],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }]
    },
    orderBy: { createdAt: "desc" }
  });
  const ipProfile = await db.guardIpProfile.findUnique({ where: { sourceIpHash } });

  if (ipProfile?.trusted || rules.some((rule) => rule.action === "trusted")) {
    return {
      action: "allow" as const,
      trusted: true,
      riskScore: ipProfile?.riskScore ?? 0
    };
  }

  const block = rules.find((rule) => rule.action === "block");
  if (block) {
    return {
      action: "blocked" as const,
      trusted: false,
      reason: block.reason ?? block.note ?? "blocked",
      expiresAt: block.expiresAt?.toISOString() ?? null,
      riskScore: ipProfile?.riskScore ?? 0
    };
  }

  const rateLimit = rules.find((rule) => rule.action === "rate_limit");
  if (rateLimit) {
    return {
      action: "rate_limited" as const,
      trusted: false,
      rateLimitPerMinute: rateLimit.rateLimitPerMinute ?? 10,
      expiresAt: rateLimit.expiresAt?.toISOString() ?? null,
      riskScore: ipProfile?.riskScore ?? 0
    };
  }

  const throttle = rules.find((rule) => rule.action === "shadow_throttle");
  if (throttle) {
    return {
      action: "shadow_throttle" as const,
      trusted: false,
      delayMs: throttle.delayMs ?? 1500,
      expiresAt: throttle.expiresAt?.toISOString() ?? null,
      riskScore: ipProfile?.riskScore ?? 0
    };
  }

  return {
    action: "allow" as const,
    trusted: false,
    riskScore: ipProfile?.riskScore ?? 0
  };
}

export async function listGuardConnections(query: GuardConnectionsQuery) {
  const where: Prisma.ConnectionEventWhereInput = {
    createdAt: timeframeWhere(query.timeframe)
  };
  if (query.username) {
    where.normalizedUsername = normalizeMinecraftUsername(query.username);
  }
  if (query.ip) {
    where.sourceIpHash = hashIp(normalizeIp(query.ip));
  }
  if (query.country) {
    where.countryCode = query.country.toUpperCase();
  }
  if (query.server) {
    where.serverId = query.server;
  }
  if (query.action) {
    where.action = query.action;
  }

  const records = await db.connectionEvent.findMany({
    where,
    include: {
      server: { select: { id: true, name: true, hostname: true } },
      node: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: "desc" },
    take: query.limit
  });

  return records.map(toConnectionDto);
}

export async function getGuardOverview(query: GuardOverviewQuery) {
  const since = timeframeStart(query.timeframe);
  const today = startOfToday();

  const [
    todayIps,
    todayUsers,
    invalidCount,
    authCount,
    suspiciousIps,
    countryGroups,
    attackedGroups,
    eventSeries,
    serverGroups
  ] = await Promise.all([
    db.connectionEvent.groupBy({
      by: ["sourceIpHash"],
      where: { createdAt: { gte: today } }
    }),
    db.connectionEvent.groupBy({
      by: ["normalizedUsername"],
      where: { createdAt: { gte: today }, normalizedUsername: { not: null } }
    }),
    db.connectionEvent.count({
      where: { createdAt: { gte: since }, action: "invalid_session" }
    }),
    db.connectionEvent.count({
      where: { createdAt: { gte: since }, action: { in: ["login_attempt", "invalid_session"] } }
    }),
    db.guardIpProfile.count({ where: { riskScore: { gte: 70 }, trusted: false } }),
    db.connectionEvent.groupBy({
      by: ["countryCode"],
      where: { createdAt: { gte: since }, countryCode: { not: null } },
      _count: { _all: true }
    }),
    db.connectionEvent.groupBy({
      by: ["serverId"],
      where: {
        createdAt: { gte: since },
        action: { in: [...SUSPICIOUS_ACTIONS] },
        serverId: { not: null }
      },
      _count: { _all: true }
    }),
    db.connectionEvent.findMany({
      where: {
        createdAt: { gte: since },
        action: { in: ["login_success", "invalid_session", "rate_limited", "blocked"] }
      },
      select: { createdAt: true, action: true }
    }),
    db.connectionEvent.groupBy({
      by: ["serverId"],
      where: { createdAt: { gte: since }, serverId: { not: null } },
      _count: { _all: true }
    })
  ]);

  const [activeConnections, topAttackedServer, topServers] = await Promise.all([
    estimateActiveConnections(),
    hydrateTopServer(attackedGroups),
    hydrateTopServers(serverGroups)
  ]);

  return {
    cards: {
      activeConnections,
      uniqueIpsToday: todayIps.length,
      uniqueUsernamesToday: todayUsers.length,
      topAttackedServer,
      invalidSessionRate: authCount === 0 ? 0 : Math.round((invalidCount / authCount) * 1000) / 10,
      suspectedBots: suspiciousIps
    },
    charts: {
      joinsPerHour: bucketEvents(eventSeries, "login_success", since),
      failedLoginsPerHour: bucketEvents(eventSeries, ["invalid_session", "rate_limited", "blocked"], since),
      topServers,
      topCountries: countryGroups
        .map((entry) => ({ countryCode: entry.countryCode ?? "ZZ", count: entry._count._all }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 12)
    }
  };
}

export async function getGuardPlayerProfile(username: string) {
  const normalizedUsername = normalizeMinecraftUsername(username);
  if (!normalizedUsername) {
    throw new AppError(400, "Invalid username.", "GUARD_INVALID_USERNAME");
  }

  const profile = await db.playerProfile.findUnique({
    where: { normalizedUsername },
    include: {
      serverRelations: {
        include: { server: { select: { id: true, name: true, hostname: true } } },
        orderBy: { lastSeenAt: "desc" }
      }
    }
  });

  if (!profile) {
    throw new AppError(404, "Player profile not found.", "GUARD_PLAYER_NOT_FOUND");
  }

  const [countries, recentIps, suspiciousEvents, timeline] = await Promise.all([
    db.connectionEvent.groupBy({
      by: ["countryCode"],
      where: { normalizedUsername, countryCode: { not: null } },
      _count: { _all: true }
    }),
    db.connectionEvent.findMany({
      where: { normalizedUsername },
      select: { sourceIp: true, sourceIpHash: true, countryCode: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 80
    }),
    db.connectionEvent.findMany({
      where: { normalizedUsername, action: { in: [...SUSPICIOUS_ACTIONS] } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { server: { select: { id: true, name: true, hostname: true } } }
    }),
    db.connectionEvent.findMany({
      where: { normalizedUsername },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { server: { select: { id: true, name: true, hostname: true } } }
    })
  ]);

  return {
    profile: {
      normalizedUsername: profile.normalizedUsername,
      displayUsername: profile.displayUsername,
      firstSeenAt: profile.firstSeenAt.toISOString(),
      lastSeenAt: profile.lastSeenAt.toISOString(),
      totalConnections: profile.totalConnections,
      totalServersVisited: profile.totalServersVisited,
      totalPlaySessions: profile.totalPlaySessions,
      riskScore: profile.riskScore,
      trusted: profile.trusted,
      notes: profile.notes
    },
    servers: profile.serverRelations.map((relation) => ({
      serverId: relation.serverId,
      serverName: relation.server.name,
      hostname: relation.server.hostname,
      joins: relation.joins,
      lastSeenAt: relation.lastSeenAt.toISOString(),
      totalPlayMinutes: relation.totalPlayMinutes
    })),
    countries: countries
      .map((entry) => ({ countryCode: entry.countryCode ?? "ZZ", count: entry._count._all }))
      .sort((left, right) => right.count - left.count),
    recentIps: dedupeRecentIps(recentIps),
    suspiciousEvents: suspiciousEvents.map(toConnectionDto),
    timeline: timeline.map(toConnectionDto)
  };
}

export async function getGuardIpProfile(ip: string) {
  const sourceIp = normalizeIp(ip);
  const sourceIpHash = hashIp(sourceIp);
  const profile = await db.guardIpProfile.findUnique({ where: { sourceIpHash } });
  if (!profile) {
    throw new AppError(404, "IP profile not found.", "GUARD_IP_NOT_FOUND");
  }

  const sinceHour = new Date(Date.now() - 60 * 60 * 1000);
  const sinceDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [countries, usernames, servers, requestsLastHour, requestsLastDay, activeRules, timeline] =
    await Promise.all([
      db.connectionEvent.groupBy({
        by: ["countryCode"],
        where: { sourceIpHash, countryCode: { not: null } },
        _count: { _all: true }
      }),
      db.connectionEvent.groupBy({
        by: ["normalizedUsername"],
        where: { sourceIpHash, normalizedUsername: { not: null } },
        _count: { _all: true }
      }),
      db.connectionEvent.groupBy({
        by: ["serverId"],
        where: { sourceIpHash, serverId: { not: null } },
        _count: { _all: true }
      }),
      db.connectionEvent.count({ where: { sourceIpHash, createdAt: { gte: sinceHour } } }),
      db.connectionEvent.count({ where: { sourceIpHash, createdAt: { gte: sinceDay } } }),
      db.guardRule.findMany({
        where: {
          targetScope: "ip",
          targetHash: sourceIpHash,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        orderBy: { createdAt: "desc" }
      }),
      db.connectionEvent.findMany({
        where: { sourceIpHash },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { server: { select: { id: true, name: true, hostname: true } } }
      })
    ]);

  const hydratedServers = await hydrateServerGroups(servers);

  return {
    profile: {
      sourceIp: profile.sourceIp ?? sourceIp,
      sourceIpHash: profile.sourceIpHash,
      firstSeenAt: profile.firstSeenAt.toISOString(),
      lastSeenAt: profile.lastSeenAt.toISOString(),
      totalConnections: profile.totalConnections,
      totalServersTargeted: profile.totalServersTargeted,
      totalUsernames: profile.totalUsernames,
      riskScore: profile.riskScore,
      trusted: profile.trusted,
      notes: profile.notes,
      blocked: activeRules.some((rule) => rule.action === "block")
    },
    countries: countries
      .map((entry) => ({ countryCode: entry.countryCode ?? "ZZ", count: entry._count._all }))
      .sort((left, right) => right.count - left.count),
    usernames: usernames
      .map((entry) => ({ username: entry.normalizedUsername ?? "-", count: entry._count._all }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 50),
    servers: hydratedServers,
    requestsLastHour,
    requestsLastDay,
    activeRules: activeRules.map(toRuleDto),
    timeline: timeline.map(toConnectionDto)
  };
}

export async function getGuardServerSummary(serverId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [events, suspiciousIps, highRiskEvents] = await Promise.all([
    db.connectionEvent.count({ where: { serverId, createdAt: { gte: since } } }),
    db.connectionEvent.groupBy({
      by: ["sourceIpHash"],
      where: { serverId, createdAt: { gte: since }, action: { in: [...SUSPICIOUS_ACTIONS] } },
      _count: { _all: true }
    }),
    db.connectionEvent.findMany({
      where: { serverId, createdAt: { gte: since }, action: { in: [...SUSPICIOUS_ACTIONS] } },
      select: { metadata: true },
      take: 100
    })
  ]);
  const maxRisk = highRiskEvents.reduce(
    (max, event) => Math.max(max, riskFromMetadata((event.metadata as Record<string, unknown>) ?? {})),
    0
  );
  const threatLevel = maxRisk >= 70 || suspiciousIps.length >= 10 ? "High" : maxRisk >= 35 || suspiciousIps.length >= 3 ? "Medium" : "Low";

  return {
    protected: true,
    threatLevel,
    recentSuspiciousIps: suspiciousIps.length,
    eventsLast24h: events,
    maxRiskScore: maxRisk
  };
}

export async function blockGuardIp(ip: string, input: GuardRuleActionInput, actor: GuardActor) {
  return createGuardRule("ip", normalizeIp(ip), "block", input, actor);
}

export async function rateLimitGuardIp(ip: string, input: GuardRuleActionInput, actor: GuardActor) {
  return createGuardRule("ip", normalizeIp(ip), "rate_limit", input, actor);
}

export async function trustGuardIp(ip: string, input: GuardRuleActionInput, actor: GuardActor) {
  const sourceIp = normalizeIp(ip);
  const sourceIpHash = hashIp(sourceIp);
  const rule = await createGuardRule("ip", sourceIp, "trusted", input, actor);
  await db.guardIpProfile.upsert({
    where: { sourceIpHash },
    create: {
      sourceIpHash,
      sourceIp,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      totalConnections: 0,
      totalServersTargeted: 0,
      totalUsernames: 0,
      riskScore: 0,
      trusted: true,
      notes: input.note ?? null
    },
    update: { trusted: true, riskScore: 0, notes: input.note ?? undefined }
  });
  return rule;
}

export async function shadowThrottleGuardHostname(
  hostname: string,
  input: GuardRuleActionInput,
  actor: GuardActor
) {
  return createGuardRule("hostname", normalizeHostname(hostname) ?? hostname.toLowerCase(), "shadow_throttle", input, actor);
}

export async function trustGuardPlayer(username: string, input: GuardRuleActionInput, actor: GuardActor) {
  const normalizedUsername = requireNormalizedUsername(username);
  const rule = await createGuardRule("player", normalizedUsername, "trusted", input, actor);
  await db.playerProfile.upsert({
    where: { normalizedUsername },
    create: {
      normalizedUsername,
      displayUsername: username,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      totalConnections: 0,
      totalServersVisited: 0,
      totalPlaySessions: 0,
      riskScore: 0,
      trusted: true,
      notes: input.note ?? null
    },
    update: { trusted: true, riskScore: 0, notes: input.note ?? undefined }
  });
  return rule;
}

export async function clearGuardIpScore(ip: string) {
  const sourceIpHash = hashIp(normalizeIp(ip));
  await db.guardIpProfile.updateMany({ where: { sourceIpHash }, data: { riskScore: 0 } });
  return { ok: true };
}

export async function clearGuardPlayerScore(username: string) {
  const normalizedUsername = requireNormalizedUsername(username);
  await db.playerProfile.updateMany({ where: { normalizedUsername }, data: { riskScore: 0 } });
  return { ok: true };
}

export async function addGuardIpNote(ip: string, note: string, actor: GuardActor) {
  const sourceIp = normalizeIp(ip);
  const sourceIpHash = hashIp(sourceIp);
  const current = await db.guardIpProfile.findUnique({ where: { sourceIpHash } });
  const notes = appendNote(current?.notes ?? null, note, actor.email);
  const profile = await db.guardIpProfile.upsert({
    where: { sourceIpHash },
    create: {
      sourceIpHash,
      sourceIp,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      totalConnections: 0,
      totalServersTargeted: 0,
      totalUsernames: 0,
      riskScore: 0,
      notes
    },
    update: { notes }
  });
  return { profile };
}

export async function addGuardPlayerNote(username: string, note: string, actor: GuardActor) {
  const normalizedUsername = requireNormalizedUsername(username);
  const current = await db.playerProfile.findUnique({ where: { normalizedUsername } });
  const notes = appendNote(current?.notes ?? null, note, actor.email);
  const profile = await db.playerProfile.upsert({
    where: { normalizedUsername },
    create: {
      normalizedUsername,
      displayUsername: username,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      totalConnections: 0,
      totalServersVisited: 0,
      totalPlaySessions: 0,
      riskScore: 0,
      notes
    },
    update: { notes }
  });
  return { profile };
}

export async function getGuardSettings() {
  const settings = await getGuardSettingsRecord();
  return toSettingsDto(settings);
}

export async function updateGuardSettings(input: GuardSettingsInput) {
  if (input.aggregateRetentionDays < input.rawIpRetentionDays) {
    throw new AppError(
      400,
      "Aggregate retention must be at least as long as raw IP retention.",
      "GUARD_RETENTION_INVALID"
    );
  }
  const settings = await db.guardSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...input },
    update: input
  });
  return toSettingsDto(settings);
}

export async function enforceGuardRetention() {
  const settings = await getGuardSettingsRecord();
  const rawCutoff = new Date(Date.now() - settings.rawIpRetentionDays * 24 * 60 * 60 * 1000);
  const aggregateCutoff = new Date(Date.now() - settings.aggregateRetentionDays * 24 * 60 * 60 * 1000);

  const [hashedEvents, hashedProfiles, deletedEvents] = await Promise.all([
    settings.hashIpsAfterRetention
      ? db.connectionEvent.updateMany({
          where: { createdAt: { lt: rawCutoff }, sourceIp: { not: null } },
          data: { sourceIp: null }
        })
      : Promise.resolve({ count: 0 }),
    settings.hashIpsAfterRetention
      ? db.guardIpProfile.updateMany({
          where: { lastSeenAt: { lt: rawCutoff }, sourceIp: { not: null } },
          data: { sourceIp: null }
        })
      : Promise.resolve({ count: 0 }),
    db.connectionEvent.deleteMany({ where: { createdAt: { lt: aggregateCutoff } } })
  ]);

  return {
    hashedEventIps: hashedEvents.count,
    hashedProfileIps: hashedProfiles.count,
    deletedEvents: deletedEvents.count
  };
}

export interface GuardRetentionMonitorHandle {
  stop(): Promise<void>;
}

export function startGuardRetentionMonitor(): GuardRetentionMonitorHandle {
  const timer = setInterval(() => {
    void enforceGuardRetention().catch((error) => {
      console.error("[guard] retention sweep failed", error);
    });
  }, env.guardRetentionSweepMs);
  timer.unref();

  void enforceGuardRetention().catch((error) => {
    console.error("[guard] initial retention sweep failed", error);
  });

  return {
    async stop() {
      clearInterval(timer);
    }
  };
}

interface GuardActor {
  id: string;
  email: string;
}

async function createGuardRule(
  targetScope: "ip" | "hostname" | "player",
  targetValue: string,
  action: "block" | "rate_limit" | "shadow_throttle" | "trusted",
  input: GuardRuleActionInput,
  actor: GuardActor
) {
  const targetHash = targetScope === "ip" ? hashIp(targetValue) : null;
  const expiresAt = input.expiresMinutes
    ? new Date(Date.now() + input.expiresMinutes * 60 * 1000)
    : null;
  const rule = await db.guardRule.create({
    data: {
      targetScope,
      targetValue: targetScope === "ip" ? targetValue : targetValue.toLowerCase(),
      targetHash,
      action,
      reason: input.reason ?? null,
      note: input.note ?? null,
      rateLimitPerMinute: action === "rate_limit" ? input.rateLimitPerMinute ?? 10 : null,
      delayMs: action === "shadow_throttle" ? input.delayMs ?? 1500 : null,
      expiresAt,
      createdByAdminId: actor.id,
      createdByEmail: actor.email
    }
  });
  return toRuleDto(rule);
}

async function getGuardSettingsRecord() {
  return db.guardSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {}
  });
}

async function assessRisk(event: EnrichedGuardEvent): Promise<RiskAssessment> {
  const signals: string[] = [];
  let score = baseRiskForAction(event.action);
  const now = event.createdAt.getTime();
  const tenMinutes = new Date(now - 10 * 60 * 1000);
  const hour = new Date(now - 60 * 60 * 1000);
  const minute = new Date(now - 60 * 1000);
  const day = new Date(now - 24 * 60 * 60 * 1000);

  const [serverTargets, usernameTargets, invalidSessions, pingFlood] = await Promise.all([
    db.connectionEvent.groupBy({
      by: ["serverId"],
      where: {
        sourceIpHash: event.sourceIpHash,
        createdAt: { gte: tenMinutes },
        serverId: { not: null }
      }
    }),
    db.connectionEvent.groupBy({
      by: ["normalizedUsername"],
      where: {
        sourceIpHash: event.sourceIpHash,
        createdAt: { gte: hour },
        normalizedUsername: { not: null }
      }
    }),
    db.connectionEvent.count({
      where: {
        sourceIpHash: event.sourceIpHash,
        createdAt: { gte: tenMinutes },
        action: "invalid_session"
      }
    }),
    db.connectionEvent.count({
      where: {
        sourceIpHash: event.sourceIpHash,
        createdAt: { gte: minute },
        action: "ping"
      }
    })
  ]);

  if (serverTargets.length >= 5) {
    score += 30;
    signals.push("same_ip_many_servers");
  }
  if (usernameTargets.length >= 6) {
    score += 25;
    signals.push("many_usernames_from_ip");
  }
  if (invalidSessions >= 5) {
    score += 35;
    signals.push("invalid_session_spam");
  }
  if (pingFlood >= 60) {
    score += 25;
    signals.push("ping_flood");
  }

  if (event.normalizedUsername) {
    const countries = await db.connectionEvent.groupBy({
      by: ["countryCode"],
      where: {
        normalizedUsername: event.normalizedUsername,
        createdAt: { gte: day },
        countryCode: { not: null }
      }
    });
    if (countries.length >= 3) {
      score += 25;
      signals.push("username_many_countries");
    }
  }

  if (event.serverId) {
    const [serverBurst, successfulJoins, server] = await Promise.all([
      db.connectionEvent.count({
        where: { serverId: event.serverId, createdAt: { gte: new Date(now - 5 * 60 * 1000) } }
      }),
      db.connectionEvent.count({
        where: {
          serverId: event.serverId,
          createdAt: { gte: new Date(now - 5 * 60 * 1000) },
          action: "login_success"
        }
      }),
      db.minecraftServer.findUnique({
        where: { id: event.serverId },
        select: { workload: { select: { restartCount: true } } }
      })
    ]);

    if (serverBurst >= 80 && successfulJoins / Math.max(serverBurst, 1) >= 0.35) {
      signals.push("viral_successful_burst");
      score += 5;
    } else if (serverBurst >= 80) {
      signals.push("connection_burst");
      score += 25;
    }

    const ipEventsForServer = await db.connectionEvent.count({
      where: {
        serverId: event.serverId,
        sourceIpHash: event.sourceIpHash,
        createdAt: { gte: new Date(now - 15 * 60 * 1000) }
      }
    });
    if ((server?.workload.restartCount ?? 0) >= 3 && ipEventsForServer >= 5) {
      signals.push("restart_loop_correlation");
      score += 25;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), signals };
}

function baseRiskForAction(action: string) {
  switch (action) {
    case "blocked":
      return 80;
    case "rate_limited":
      return 55;
    case "invalid_session":
      return 45;
    case "disconnect":
      return 5;
    default:
      return 0;
  }
}

async function updatePlayerProfiles(events: EnrichedGuardEvent[]) {
  const byUsername = groupBy(
    events.filter((event) => event.normalizedUsername),
    (event) => event.normalizedUsername!
  );

  for (const [username, entries] of byUsername) {
    const displayUsername = entries.find((event) => event.usernameAttempted)?.usernameAttempted ?? username;
    const firstSeenAt = minDate(entries.map((event) => event.createdAt));
    const lastSeenAt = maxDate(entries.map((event) => event.createdAt));
    const sessions = entries.filter((event) => event.action === "login_success").length;
    const riskScore = Math.max(...entries.map((event) => riskFromMetadata(event.metadata)));
    const current = await db.playerProfile.findUnique({ where: { normalizedUsername: username } });

    await db.playerProfile.upsert({
      where: { normalizedUsername: username },
      create: {
        normalizedUsername: username,
        displayUsername,
        firstSeenAt,
        lastSeenAt,
        totalConnections: entries.length,
        totalServersVisited: 0,
        totalPlaySessions: sessions,
        riskScore
      },
      update: {
        displayUsername,
        lastSeenAt,
        totalConnections: { increment: entries.length },
        totalPlaySessions: { increment: sessions },
        riskScore: current ? Math.max(current.riskScore, riskScore) : riskScore
      }
    });

    for (const event of entries) {
      if (!event.serverId) continue;
      if (event.action === "login_success") {
        await db.playerServerRelation.upsert({
          where: { username_serverId: { username, serverId: event.serverId } },
          create: {
            username,
            serverId: event.serverId,
            joins: 1,
            lastSeenAt: event.createdAt,
            totalPlayMinutes: 0
          },
          update: {
            joins: { increment: 1 },
            lastSeenAt: event.createdAt
          }
        });
      }
      if (event.action === "disconnect") {
        const minutes = playMinutesFromMetadata(event.metadata);
        if (minutes > 0) {
          await db.playerServerRelation.upsert({
            where: { username_serverId: { username, serverId: event.serverId } },
            create: {
              username,
              serverId: event.serverId,
              joins: 0,
              lastSeenAt: event.createdAt,
              totalPlayMinutes: minutes
            },
            update: {
              lastSeenAt: event.createdAt,
              totalPlayMinutes: { increment: minutes }
            }
          });
        }
      }
    }

    const totalServersVisited = await db.playerServerRelation.count({ where: { username } });
    await db.playerProfile.update({
      where: { normalizedUsername: username },
      data: { totalServersVisited }
    });
  }
}

async function updateIpProfiles(events: EnrichedGuardEvent[], privacyMode: boolean) {
  const byIp = groupBy(events, (event) => event.sourceIpHash);

  for (const [sourceIpHash, entries] of byIp) {
    const sourceIp = privacyMode ? null : entries[0].sourceIp;
    const firstSeenAt = minDate(entries.map((event) => event.createdAt));
    const lastSeenAt = maxDate(entries.map((event) => event.createdAt));
    const riskScore = Math.max(...entries.map((event) => riskFromMetadata(event.metadata)));
    const current = await db.guardIpProfile.findUnique({ where: { sourceIpHash } });

    await db.guardIpProfile.upsert({
      where: { sourceIpHash },
      create: {
        sourceIpHash,
        sourceIp,
        firstSeenAt,
        lastSeenAt,
        totalConnections: entries.length,
        totalServersTargeted: 0,
        totalUsernames: 0,
        riskScore
      },
      update: {
        sourceIp,
        lastSeenAt,
        totalConnections: { increment: entries.length },
        riskScore: current ? Math.max(current.riskScore, riskScore) : riskScore
      }
    });

    const [servers, usernames] = await Promise.all([
      db.connectionEvent.groupBy({
        by: ["serverId"],
        where: { sourceIpHash, serverId: { not: null } }
      }),
      db.connectionEvent.groupBy({
        by: ["normalizedUsername"],
        where: { sourceIpHash, normalizedUsername: { not: null } }
      })
    ]);
    await db.guardIpProfile.update({
      where: { sourceIpHash },
      data: {
        totalServersTargeted: servers.length,
        totalUsernames: usernames.length
      }
    });
  }
}

async function estimateActiveConnections() {
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const [starts, stops] = await Promise.all([
    db.connectionEvent.findMany({
      where: { createdAt: { gte: since }, action: "login_success", sessionId: { not: null } },
      select: { sessionId: true }
    }),
    db.connectionEvent.findMany({
      where: { createdAt: { gte: since }, action: "disconnect", sessionId: { not: null } },
      select: { sessionId: true }
    })
  ]);
  const stopped = new Set(stops.map((event) => event.sessionId));
  return starts.filter((event) => event.sessionId && !stopped.has(event.sessionId)).length;
}

async function hydrateTopServer(
  groups: Array<{ serverId: string | null; _count: { _all: number } }>
) {
  const top = [...groups].sort((left, right) => right._count._all - left._count._all)[0];
  if (!top?.serverId) {
    return null;
  }
  const server = await db.minecraftServer.findUnique({
    where: { id: top.serverId },
    select: { id: true, name: true, hostname: true }
  });
  return server ? { ...server, suspiciousEvents: top._count._all } : null;
}

async function hydrateTopServers(
  groups: Array<{ serverId: string | null; _count: { _all: number } }>
) {
  return hydrateServerGroups(groups).then((servers) => servers.slice(0, 8));
}

async function hydrateServerGroups(
  groups: Array<{ serverId: string | null; _count: { _all: number } }>
) {
  const ids = groups.map((entry) => entry.serverId).filter((id): id is string => Boolean(id));
  const servers = await db.minecraftServer.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, hostname: true }
  });
  const byId = new Map(servers.map((server) => [server.id, server]));
  return groups
    .filter((entry) => entry.serverId)
    .map((entry) => ({
      serverId: entry.serverId!,
      serverName: byId.get(entry.serverId!)?.name ?? "Unknown server",
      hostname: byId.get(entry.serverId!)?.hostname ?? null,
      count: entry._count._all
    }))
    .sort((left, right) => right.count - left.count);
}

function bucketEvents(
  events: Array<{ createdAt: Date; action: string }>,
  action: string | string[],
  since: Date
) {
  const actions = Array.isArray(action) ? new Set(action) : new Set([action]);
  const buckets = new Map<string, number>();
  const start = new Date(since);
  start.setMinutes(0, 0, 0);
  const end = new Date();
  end.setMinutes(0, 0, 0);

  for (let cursor = new Date(start); cursor <= end; cursor.setHours(cursor.getHours() + 1)) {
    buckets.set(cursor.toISOString(), 0);
  }
  for (const event of events) {
    if (!actions.has(event.action)) continue;
    const bucket = new Date(event.createdAt);
    bucket.setMinutes(0, 0, 0);
    const key = bucket.toISOString();
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([hour, count]) => ({ hour, count }));
}

function toConnectionDto(record: {
  id: string;
  createdAt: Date;
  serverId: string | null;
  nodeId: string | null;
  hostname: string | null;
  sourceIp: string | null;
  sourceIpHash: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: string | null;
  isp: string | null;
  usernameAttempted: string | null;
  normalizedUsername: string | null;
  onlineMode: boolean | null;
  protocolVersion: number | null;
  clientBrand: string | null;
  action: string;
  disconnectReason: string | null;
  latencyMs: number | null;
  sessionId: string | null;
  metadata: Prisma.JsonValue;
  server?: { id: string; name: string; hostname: string | null } | null;
  node?: { id: string; name: string } | null;
}) {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    serverId: record.serverId,
    nodeId: record.nodeId,
    hostname: record.hostname,
    sourceIp: record.sourceIp,
    sourceIpHash: record.sourceIpHash,
    countryCode: record.countryCode,
    region: record.region,
    city: record.city,
    asn: record.asn,
    isp: record.isp,
    usernameAttempted: record.usernameAttempted,
    normalizedUsername: record.normalizedUsername,
    onlineMode: record.onlineMode,
    protocolVersion: record.protocolVersion,
    clientBrand: record.clientBrand,
    action: record.action,
    disconnectReason: record.disconnectReason,
    latencyMs: record.latencyMs,
    sessionId: record.sessionId,
    metadata: record.metadata as Record<string, unknown>,
    riskScore: riskFromMetadata((record.metadata as Record<string, unknown>) ?? {}),
    server: record.server ?? null,
    node: record.node ?? null
  };
}

function toRuleDto(rule: {
  id: string;
  targetScope: string;
  targetValue: string | null;
  targetHash: string | null;
  action: string;
  reason: string | null;
  note: string | null;
  rateLimitPerMinute: number | null;
  delayMs: number | null;
  expiresAt: Date | null;
  createdByAdminId: string | null;
  createdByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: rule.id,
    targetScope: rule.targetScope,
    targetValue: rule.targetValue,
    targetHash: rule.targetHash,
    action: rule.action,
    reason: rule.reason,
    note: rule.note,
    rateLimitPerMinute: rule.rateLimitPerMinute,
    delayMs: rule.delayMs,
    expiresAt: rule.expiresAt?.toISOString() ?? null,
    createdByAdminId: rule.createdByAdminId,
    createdByEmail: rule.createdByEmail,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

function toSettingsDto(settings: {
  rawIpRetentionDays: number;
  aggregateRetentionDays: number;
  hashIpsAfterRetention: boolean;
  privacyMode: boolean;
}) {
  return {
    rawIpRetentionDays: settings.rawIpRetentionDays,
    aggregateRetentionDays: settings.aggregateRetentionDays,
    hashIpsAfterRetention: settings.hashIpsAfterRetention,
    privacyMode: settings.privacyMode
  };
}

function dedupeRecentIps(
  rows: Array<{ sourceIp: string | null; sourceIpHash: string; countryCode: string | null; createdAt: Date }>
) {
  const seen = new Set<string>();
  const result: Array<{
    sourceIp: string | null;
    sourceIpHash: string;
    countryCode: string | null;
    lastSeenAt: string;
  }> = [];
  for (const row of rows) {
    if (seen.has(row.sourceIpHash)) continue;
    seen.add(row.sourceIpHash);
    result.push({
      sourceIp: row.sourceIp,
      sourceIpHash: row.sourceIpHash,
      countryCode: row.countryCode,
      lastSeenAt: row.createdAt.toISOString()
    });
  }
  return result.slice(0, 12);
}

function timeframeWhere(value: GuardConnectionsQuery["timeframe"]) {
  const start = value === "all" ? null : timeframeStart(value);
  return start ? { gte: start } : undefined;
}

function timeframeStart(value: GuardOverviewQuery["timeframe"] | GuardConnectionsQuery["timeframe"]) {
  const now = Date.now();
  switch (value) {
    case "1h":
      return new Date(now - 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "24h":
    default:
      return new Date(now - 24 * 60 * 60 * 1000);
  }
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function hashIp(ip: string) {
  return createHmac("sha256", env.guardIpHashSalt).update(normalizeIp(ip)).digest("hex");
}

function normalizeIp(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(400, "Invalid IP address.", "GUARD_INVALID_IP");
  }
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

function normalizeHostname(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 255) : null;
}

function normalizeMinecraftUsername(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (!/^[a-z0-9_]{1,64}$/.test(normalized)) return normalized.slice(0, 64);
  return normalized;
}

function requireNormalizedUsername(value: string) {
  const normalized = normalizeMinecraftUsername(value);
  if (!normalized) {
    throw new AppError(400, "Invalid username.", "GUARD_INVALID_USERNAME");
  }
  return normalized;
}

function normalizeCountry(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function trimNullable(value: string | null | undefined, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function stringifyNullable(value: string | number | null | undefined, max: number) {
  if (value === null || value === undefined) return null;
  return String(value).trim().slice(0, max) || null;
}

function sanitizeMetadata(value: Record<string, unknown> | null | undefined) {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function riskFromMetadata(metadata: Record<string, unknown>) {
  const value = metadata.riskScore;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function playMinutesFromMetadata(metadata: Record<string, unknown>) {
  const durationMs = metadata.durationMs;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(durationMs / 60_000));
}

function appendNote(current: string | null, note: string, actorEmail: string) {
  const line = `[${new Date().toISOString()}] ${actorEmail}: ${note.trim()}`;
  return current ? `${current}\n${line}` : line;
}

function minDate(dates: Date[]) {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function maxDate(dates: Date[]) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
