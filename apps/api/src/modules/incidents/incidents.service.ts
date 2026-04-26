import { Prisma } from "@prisma/client";
import { db } from "../../db/client.js";
import type { DbJsonInput } from "../../db/types.js";
import { AppError } from "../../lib/appError.js";
import type {
  incidentListQuerySchema,
  incidentNoteSchema,
  incidentReopenSchema,
  incidentResolveSchema
} from "./incidents.schema.js";
import type {
  Incident,
  IncidentEvent,
  IncidentEventType,
  IncidentScope,
  IncidentSeverity,
  IncidentStatus,
  IncidentSummary
} from "./incidents.types.js";
import type { z } from "zod";

type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;
type IncidentResolveInput = z.infer<typeof incidentResolveSchema>;
type IncidentReopenInput = z.infer<typeof incidentReopenSchema>;
type IncidentNoteInput = z.infer<typeof incidentNoteSchema>;

type AdminActor = {
  id: string;
  email: string;
  displayName?: string;
};

const UPDATE_EVENT_THROTTLE_MS = 5 * 60_000;
const INCIDENT_MONITOR_RESTART_THRESHOLD = 3;

const incidentInclude = {
  acknowledgedBy: {
    select: { id: true, email: true, displayName: true }
  },
  assignedTo: {
    select: { id: true, email: true, displayName: true }
  },
  events: {
    orderBy: { createdAt: "asc" as const },
    include: {
      actor: {
        select: { id: true, email: true, displayName: true }
      }
    }
  }
};

type IncidentRecord = Prisma.IncidentGetPayload<{
  include: typeof incidentInclude;
}>;
type IncidentEventRecord = Prisma.IncidentEventGetPayload<{
  include: {
    actor: {
      select: { id: true; email: true; displayName: true };
    };
  };
}>;
type MinecraftIncidentServerRecord = Prisma.MinecraftServerGetPayload<{
  include: { workload: true };
}>;

export async function listIncidents(query: IncidentListQuery): Promise<Incident[]> {
  const where = buildIncidentWhere(query);
  const records = await db.incident.findMany({
    where,
    orderBy: [{ status: "asc" }, { severity: "asc" }, { lastSeenAt: "desc" }],
    take: query.limit,
    include: incidentInclude
  });
  return records.map(toIncident);
}

export async function getIncident(id: string): Promise<Incident> {
  const record = await db.incident.findUnique({
    where: { id },
    include: incidentInclude
  });
  if (!record) {
    throw new AppError(404, "Incident not found.", "INCIDENT_NOT_FOUND");
  }
  return toIncident(record);
}

export async function getIncidentSummary(): Promise<IncidentSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [openCritical, openTotal, acknowledged, autoResolvedLast24h] = await Promise.all([
    db.incident.count({ where: { status: "open", severity: "critical" } }),
    db.incident.count({ where: { status: "open" } }),
    db.incident.count({ where: { status: "acknowledged" } }),
    db.incident.count({
      where: {
        status: "resolved",
        resolutionType: "auto",
        resolvedAt: { gte: since }
      }
    })
  ]);

  return {
    openCritical,
    openTotal,
    acknowledged,
    autoResolvedLast24h
  };
}

export async function acknowledgeIncident(id: string, actor: AdminActor) {
  const existing = await db.incident.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "Incident not found.", "INCIDENT_NOT_FOUND");
  }

  const record = await db.incident.update({
    where: { id },
    data: {
      status: existing.status === "resolved" ? existing.status : "acknowledged",
      acknowledgedAt: new Date(),
      acknowledgedById: actor.id,
      events: {
        create: {
          type: "acknowledged",
          message: `${actor.displayName ?? actor.email} acknowledged the incident`,
          actorId: actor.id
        }
      }
    },
    include: incidentInclude
  });

  return toIncident(record);
}

export async function assignIncidentToMe(id: string, actor: AdminActor) {
  const record = await db.incident.update({
    where: { id },
    data: {
      assignedToId: actor.id,
      events: {
        create: {
          type: "assigned",
          message: `${actor.displayName ?? actor.email} assigned the incident to themselves`,
          actorId: actor.id
        }
      }
    },
    include: incidentInclude
  }).catch(() => null);

  if (!record) {
    throw new AppError(404, "Incident not found.", "INCIDENT_NOT_FOUND");
  }

  return toIncident(record);
}

export async function manuallyResolveIncident(
  id: string,
  actor: AdminActor,
  input: IncidentResolveInput
) {
  const existing = await db.incident.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "Incident not found.", "INCIDENT_NOT_FOUND");
  }

  const resolvedAt = new Date();
  const record = await db.incident.update({
    where: { id },
    data: {
      status: "resolved",
      resolvedAt,
      resolutionType: "manual",
      rootCause: input.rootCause ?? existing.rootCause,
      internalNotes: appendInternalNotes(existing.internalNotes, input.internalNotes),
      events: {
        create: {
          type: "manually_resolved",
          message: `${actor.displayName ?? actor.email} resolved the incident manually`,
          metadata: {
            rootCause: input.rootCause ?? null,
            internalNotes: input.internalNotes ?? null
          } as DbJsonInput,
          actorId: actor.id
        }
      }
    },
    include: incidentInclude
  });

  return toIncident(record);
}

export async function reopenIncident(
  id: string,
  actor: AdminActor,
  input: IncidentReopenInput
) {
  const existing = await db.incident.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "Incident not found.", "INCIDENT_NOT_FOUND");
  }

  const now = new Date();
  const record = await db.incident.update({
    where: { id },
    data: {
      status: "open",
      resolvedAt: null,
      resolutionType: null,
      lastSeenAt: now,
      events: {
        create: {
          type: "reopened",
          message: input.note?.trim()
            ? `${actor.displayName ?? actor.email} reopened the incident: ${input.note.trim()}`
            : `${actor.displayName ?? actor.email} reopened the incident`,
          actorId: actor.id,
          metadata: input.note?.trim()
            ? ({ note: input.note.trim() } as DbJsonInput)
            : undefined
        }
      }
    },
    include: incidentInclude
  });

  return toIncident(record);
}

export async function addIncidentNote(
  id: string,
  actor: AdminActor,
  input: IncidentNoteInput
) {
  const existing = await db.incident.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "Incident not found.", "INCIDENT_NOT_FOUND");
  }

  const note = input.note.trim();
  const record = await db.incident.update({
    where: { id },
    data: {
      internalNotes: appendInternalNotes(existing.internalNotes, note),
      events: {
        create: {
          type: "note",
          message: `${actor.displayName ?? actor.email} added an internal note`,
          metadata: { note } as DbJsonInput,
          actorId: actor.id
        }
      }
    },
    include: incidentInclude
  });

  return toIncident(record);
}

export async function observeIncident(input: {
  dedupeKey: string;
  title: string;
  description?: string | null;
  severity: IncidentSeverity;
  scope: IncidentScope;
  sourceType?: string | null;
  sourceId?: string | null;
  nodeId?: string | null;
  metadata?: Record<string, unknown>;
  eventMessage: string;
}) {
  const now = new Date();
  const existing = await db.incident.findFirst({
    where: { dedupeKey: input.dedupeKey },
    orderBy: { createdAt: "desc" },
    include: { events: { orderBy: { createdAt: "desc" as const }, take: 1 } }
  });

  if (!existing) {
    const created = await db.incident.create({
      data: {
        dedupeKey: input.dedupeKey,
        title: input.title,
        description: input.description ?? null,
        severity: input.severity,
        status: "open",
        scope: input.scope,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        nodeId: input.nodeId ?? null,
        metadata: (input.metadata ?? null) as DbJsonInput,
        startedAt: now,
        lastSeenAt: now,
        events: {
          create: {
            type: "detected",
            message: input.eventMessage,
            metadata: (input.metadata ?? null) as DbJsonInput
          }
        }
      },
      include: incidentInclude
    });
    return toIncident(created);
  }

  const reopened = existing.status === "resolved";
  const shouldCreateUpdateEvent =
    reopened ||
    existing.title !== input.title ||
    existing.description !== (input.description ?? null) ||
    existing.severity !== input.severity ||
    !isSameMetadata(existing.metadata, input.metadata) ||
    now.getTime() - existing.lastSeenAt.getTime() >= UPDATE_EVENT_THROTTLE_MS;

  const updateData: Record<string, unknown> = {
    title: input.title,
    description: input.description ?? null,
    severity: input.severity,
    scope: input.scope,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    nodeId: input.nodeId ?? null,
    metadata: (input.metadata ?? null) as DbJsonInput,
    lastSeenAt: now
  };

  if (reopened) {
    updateData.status = "open";
    updateData.resolvedAt = null;
    updateData.resolutionType = null;
  }

  const record = await db.incident.update({
    where: { id: existing.id },
    data: {
      ...updateData,
      events: shouldCreateUpdateEvent
        ? {
            create: {
              type: reopened ? "reopened" : "updated",
              message: reopened ? `Incident reopened: ${input.eventMessage}` : input.eventMessage,
              metadata: (input.metadata ?? null) as DbJsonInput
            }
          }
        : undefined
    },
    include: incidentInclude
  });

  return toIncident(record);
}

export async function autoResolveIncidentByDedupeKey(
  dedupeKey: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  const existing = await db.incident.findFirst({
    where: {
      dedupeKey,
      status: { in: ["open", "acknowledged"] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!existing) {
    return null;
  }

  const resolvedAt = new Date();
  const record = await db.incident.update({
    where: { id: existing.id },
    data: {
      status: "resolved",
      resolvedAt,
      resolutionType: "auto",
      lastSeenAt: resolvedAt,
      events: {
        create: {
          type: "auto_resolved",
          message,
          metadata: (metadata ?? null) as DbJsonInput
        }
      }
    },
    include: incidentInclude
  });

  return toIncident(record);
}

export async function runIncidentDetectionTick() {
  const [nodes, minecraftServers, proxyWorkloads] = await Promise.all([
    db.node.findMany({
      include: {
        statusEvents: {
          orderBy: { createdAt: "desc" },
          take: 5
        }
      }
    }),
    db.minecraftServer.findMany({
      where: { deletedAt: null },
      include: {
        workload: true
      }
    }),
    db.workload.findMany({
      where: {
        deletedAt: null,
        type: "proxy"
      }
    })
  ]);

  for (const node of nodes) {
    const cpuPercent =
      node.totalCpu && node.totalCpu > 0 ? ((node.usedCpu ?? 0) / node.totalCpu) * 100 : 0;
    const ramPercent =
      node.totalRamMb && node.totalRamMb > 0 ? ((node.usedRamMb ?? 0) / node.totalRamMb) * 100 : 0;
    const diskPercent =
      node.totalDiskGb && node.totalDiskGb > 0
        ? (((node as { usedDiskGb?: number | null }).usedDiskGb ?? 0) / node.totalDiskGb) * 100
        : 0;
    const latestStatusReason = node.statusEvents[0]?.reason ?? null;

    if (node.status === "offline") {
      await observeIncident({
        dedupeKey: `node:${node.id}:offline`,
        title: `${node.name} offline`,
        description: latestStatusReason ?? "Node heartbeat stopped.",
        severity: "critical",
        scope: "node",
        sourceType: "node",
        sourceId: node.id,
        nodeId: node.id,
        metadata: {
          nodeName: node.name,
          nodePublicHost: node.publicHost,
          reason: latestStatusReason
        },
        eventMessage: `${node.name} is offline`
      });
    } else {
      await autoResolveIncidentByDedupeKey(`node:${node.id}:offline`, `${node.name} recovered`, {
        nodeName: node.name
      });
    }

    if (node.health === "degraded" || node.status === "degraded") {
      await observeIncident({
        dedupeKey: `node:${node.id}:degraded`,
        title: `${node.name} degraded`,
        description: latestStatusReason ?? "Node health is degraded.",
        severity: "high",
        scope: "node",
        sourceType: "node",
        sourceId: node.id,
        nodeId: node.id,
        metadata: {
          nodeName: node.name,
          nodePublicHost: node.publicHost,
          reason: latestStatusReason
        },
        eventMessage: `${node.name} is degraded`
      });
    } else {
      await autoResolveIncidentByDedupeKey(`node:${node.id}:degraded`, `${node.name} health recovered`);
    }

    if (node.maintenanceMode) {
      await observeIncident({
        dedupeKey: `node:${node.id}:maintenance`,
        title: `${node.name} in maintenance`,
        description: latestStatusReason ?? "Node is isolated for maintenance.",
        severity: "low",
        scope: "node",
        sourceType: "node",
        sourceId: node.id,
        nodeId: node.id,
        metadata: { nodeName: node.name },
        eventMessage: `${node.name} entered maintenance mode`
      });
    } else {
      await autoResolveIncidentByDedupeKey(`node:${node.id}:maintenance`, `${node.name} left maintenance mode`);
    }

    await evaluateThresholdIncident({
      active: cpuPercent >= 90,
      dedupeKey: `node:${node.id}:cpu_high`,
      title: `${node.name} high CPU`,
      description: `CPU usage at ${cpuPercent.toFixed(1)}%.`,
      severity: "high",
      scope: "node",
      sourceType: "node",
      sourceId: node.id,
      nodeId: node.id,
      metadata: { nodeName: node.name, cpuPercent: cpuPercent.toFixed(1) },
      eventMessage: `${node.name} CPU usage is high`,
      resolveMessage: `${node.name} CPU usage returned to normal`
    });

    await evaluateThresholdIncident({
      active: ramPercent >= 90,
      dedupeKey: `node:${node.id}:ram_high`,
      title: `${node.name} high RAM`,
      description: `RAM usage at ${ramPercent.toFixed(1)}%.`,
      severity: "high",
      scope: "node",
      sourceType: "node",
      sourceId: node.id,
      nodeId: node.id,
      metadata: { nodeName: node.name, ramPercent: ramPercent.toFixed(1) },
      eventMessage: `${node.name} RAM usage is high`,
      resolveMessage: `${node.name} RAM usage returned to normal`
    });

    if (node.totalDiskGb && node.totalDiskGb > 0) {
      await evaluateThresholdIncident({
        active: diskPercent >= 90,
        dedupeKey: `node:${node.id}:disk_high`,
        title: `${node.name} high disk`,
        description: `Disk usage at ${diskPercent.toFixed(1)}%.`,
        severity: "medium",
        scope: "node",
        sourceType: "node",
        sourceId: node.id,
        nodeId: node.id,
        metadata: { nodeName: node.name, diskPercent: diskPercent.toFixed(1) },
        eventMessage: `${node.name} disk usage is high`,
        resolveMessage: `${node.name} disk usage returned to normal`
      });
    }
  }

  for (const server of minecraftServers) {
    const runtimeState = deriveRuntimeState(server);

    if (runtimeState === "crashed") {
      await observeIncident({
        dedupeKey: `minecraft:${server.id}:crashed`,
        title: `${server.name} crashed`,
        description: `Minecraft server ${server.name} is crashed.`,
        severity: "high",
        scope: "minecraft_server",
        sourceType: "minecraft_server",
        sourceId: server.id,
        nodeId: server.workload.nodeId,
        metadata: {
          serverName: server.name,
          serverId: server.id,
          workloadId: server.workloadId,
          restartCount: server.workload.restartCount
        },
        eventMessage: `${server.name} runtime crashed`
      });
    } else {
      await autoResolveIncidentByDedupeKey(
        `minecraft:${server.id}:crashed`,
        `${server.name} recovered from crash`
      );
    }

    if (server.workload.restartCount >= INCIDENT_MONITOR_RESTART_THRESHOLD) {
      await observeIncident({
        dedupeKey: `minecraft:${server.id}:restart_failures`,
        title: `${server.name} restart failures`,
        description: `Restart count reached ${server.workload.restartCount}.`,
        severity: "medium",
        scope: "minecraft_server",
        sourceType: "minecraft_server",
        sourceId: server.id,
        nodeId: server.workload.nodeId,
        metadata: {
          serverName: server.name,
          serverId: server.id,
          workloadId: server.workloadId,
          restartCount: server.workload.restartCount
        },
        eventMessage: `${server.name} is restarting repeatedly`
      });
    } else {
      await autoResolveIncidentByDedupeKey(
        `minecraft:${server.id}:restart_failures`,
        `${server.name} restart count returned below threshold`
      );
    }
  }

  for (const workload of proxyWorkloads) {
    const unhealthy =
      workload.desiredStatus === "running" &&
      !["running", "creating"].includes(workload.status) &&
      workload.status !== "deleting";
    if (unhealthy) {
      await observeIncident({
        dedupeKey: `proxy:${workload.id}:down`,
        title: `${workload.name} proxy down`,
        description: `Proxy workload ${workload.name} is ${workload.status}.`,
        severity: "critical",
        scope: "proxy",
        sourceType: "proxy",
        sourceId: workload.id,
        nodeId: workload.nodeId,
        metadata: {
          workloadId: workload.id,
          workloadName: workload.name,
          status: workload.status
        },
        eventMessage: `${workload.name} proxy is unavailable`
      });
    } else {
      await autoResolveIncidentByDedupeKey(
        `proxy:${workload.id}:down`,
        `${workload.name} proxy recovered`
      );
    }
  }
}

async function evaluateThresholdIncident(input: {
  active: boolean;
  dedupeKey: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  scope: IncidentScope;
  sourceType: string;
  sourceId: string;
  nodeId: string | null;
  metadata: Record<string, unknown>;
  eventMessage: string;
  resolveMessage: string;
}) {
  if (input.active) {
    await observeIncident({
      dedupeKey: input.dedupeKey,
      title: input.title,
      description: input.description,
      severity: input.severity,
      scope: input.scope,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      nodeId: input.nodeId,
      metadata: input.metadata,
      eventMessage: input.eventMessage
    });
    return;
  }

  await autoResolveIncidentByDedupeKey(input.dedupeKey, input.resolveMessage, input.metadata);
}

function deriveRuntimeState(server: MinecraftIncidentServerRecord) {
  const workloadStatus = server.workload.status;
  if (server.sleepRequestedAt !== null) return "stopping";
  if (workloadStatus === "crashed") return "crashed";
  if (workloadStatus === "stopped") return "stopped";
  if (workloadStatus === "queued_start" || workloadStatus === "pending") return "stopped";
  if (workloadStatus === "creating") return "starting";
  if (workloadStatus === "running") return server.readyAt !== null ? "running" : "starting";
  return "starting";
}

function buildIncidentWhere(query: IncidentListQuery) {
  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  if (query.severity) where.severity = query.severity;
  if (query.scope) where.scope = query.scope;
  if (query.sourceId) where.sourceId = query.sourceId;
  if (query.sourceType) where.sourceType = query.sourceType;
  if (query.window && query.window !== "all") {
    const since =
      query.window === "24h"
        ? new Date(Date.now() - 24 * 60 * 60_000)
        : new Date(Date.now() - 7 * 24 * 60 * 60_000);
    where.lastSeenAt = { gte: since };
  }
  return where;
}

function appendInternalNotes(existing: string | null, next: string | undefined) {
  const note = next?.trim();
  if (!note) return existing;
  return existing ? `${existing}\n\n${note}` : note;
}

function isSameMetadata(
  left: unknown,
  right: Record<string, unknown> | undefined
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function toIncident(record: IncidentRecord): Incident {
  return {
    id: record.id,
    title: record.title,
    description: record.description ?? null,
    severity: record.severity as IncidentSeverity,
    status: record.status as IncidentStatus,
    scope: record.scope as IncidentScope,
    sourceType: record.sourceType ?? null,
    sourceId: record.sourceId ?? null,
    dedupeKey: record.dedupeKey,
    startedAt: record.startedAt.toISOString(),
    lastSeenAt: record.lastSeenAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: record.acknowledgedBy ?? null,
    assignedTo: record.assignedTo ?? null,
    resolutionType: (record.resolutionType as Incident["resolutionType"]) ?? null,
    rootCause: record.rootCause ?? null,
    internalNotes: record.internalNotes ?? null,
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : null,
    nodeId: record.nodeId ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    events: (record.events ?? []).map(toIncidentEvent)
  };
}

function toIncidentEvent(record: IncidentEventRecord): IncidentEvent {
  return {
    id: record.id,
    incidentId: record.incidentId,
    type: record.type as IncidentEventType,
    message: record.message,
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : null,
    actorId: record.actor?.id ?? null,
    actorEmail: record.actor?.email ?? null,
    actorDisplayName: record.actor?.displayName ?? null,
    createdAt: record.createdAt.toISOString()
  };
}
