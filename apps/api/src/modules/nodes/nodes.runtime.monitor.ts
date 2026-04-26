import type { Prisma } from "@prisma/client";
import { db } from "../../db/client.js";
import { env } from "../../config/env.js";

const ADVISORY_LOCK_NAMESPACE = "phantom.node_heartbeat_monitor";
const DEFAULT_TX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_STALE_PER_TICK = 1_000;
const INITIAL_DELAY_MS = 1_000;

type Logger = Pick<Console, "info" | "warn" | "error">;

export interface NodeRuntimeMonitorOptions {
  tickIntervalMs: number;
  heartbeatTimeoutMs: number;
  txTimeoutMs: number;
  maxStalePerTick: number;
  logger: Logger;
}

export interface NodeRuntimeMonitorHandle {
  stop: () => Promise<void>;
  runOnce: () => Promise<number>;
}

export function startNodeRuntimeMonitor(
  overrides: Partial<NodeRuntimeMonitorOptions> = {}
): NodeRuntimeMonitorHandle {
  const options: NodeRuntimeMonitorOptions = {
    tickIntervalMs: overrides.tickIntervalMs ?? env.nodeMonitorTickMs,
    heartbeatTimeoutMs: overrides.heartbeatTimeoutMs ?? env.nodeHeartbeatTimeoutMs,
    txTimeoutMs: overrides.txTimeoutMs ?? DEFAULT_TX_TIMEOUT_MS,
    maxStalePerTick: overrides.maxStalePerTick ?? DEFAULT_MAX_STALE_PER_TICK,
    logger: overrides.logger ?? console
  };

  let inflight: Promise<number> | null = null;
  let stopped = false;

  const runOnce = async (): Promise<number> => {
    if (stopped) return 0;
    if (inflight) return inflight;

    const task = runMonitorTick(options).catch((err) => {
      options.logger.error("[node-monitor] tick failed", err);
      return 0;
    });

    inflight = task;
    try {
      return await task;
    } finally {
      inflight = null;
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, options.tickIntervalMs);
  timer.unref();

  const bootstrap = setTimeout(() => {
    void runOnce();
  }, INITIAL_DELAY_MS);
  bootstrap.unref();

  options.logger.info(
    `[node-monitor] started (tick=${options.tickIntervalMs}ms threshold=${options.heartbeatTimeoutMs}ms)`
  );

  return {
    runOnce,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(bootstrap);
      if (inflight) {
        await inflight.catch(() => undefined);
      }
    }
  };
}

async function runMonitorTick(options: NodeRuntimeMonitorOptions): Promise<number> {
  const cutoff = new Date(Date.now() - options.heartbeatTimeoutMs);

  return db.$transaction(
    async (tx) => {
      const acquired = await tryAcquireAdvisoryLock(tx);
      if (!acquired) return 0;

      const stale = await tx.node.findMany({
        where: {
          maintenanceMode: false,
          status: { not: "offline" },
          OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: cutoff } }]
        },
        select: { id: true, name: true, publicHost: true, status: true, lastHeartbeatAt: true },
        orderBy: { lastHeartbeatAt: { sort: "asc", nulls: "first" } },
        take: options.maxStalePerTick
      });

      if (stale.length === 0) return 0;

      const ids = stale.map((node) => node.id);

      await tx.node.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "offline",
          health: "unreachable",
          usedRamMb: 0,
          usedCpu: 0
        }
      });

      await tx.nodeStatusEvent.createMany({
        data: stale.map((node) => ({
          nodeId: node.id,
          previousStatus: node.status,
          newStatus: "offline",
          reason: describeStaleReason(node.lastHeartbeatAt, options.heartbeatTimeoutMs)
        }))
      });

      await tx.systemNotification.createMany({
        data: stale.map((node) => ({
          kind: "node_offline",
          severity: "critical",
          title: "Node offline",
          body: `${node.name} (${node.publicHost}) is offline. ${describeStaleReason(
            node.lastHeartbeatAt,
            options.heartbeatTimeoutMs
          )}`.trim(),
          resourceType: "node",
          resourceId: node.id,
          nodeId: node.id,
          metadata: {
            previousStatus: node.status,
            newStatus: "offline",
            reason: describeStaleReason(node.lastHeartbeatAt, options.heartbeatTimeoutMs),
            nodeName: node.name,
            nodePublicHost: node.publicHost
          } as Prisma.InputJsonValue
        }))
      });

      options.logger.warn(
        `[node-monitor] ${stale.length} node(s) transitioned to offline: ${ids.join(", ")}`
      );
      for (const node of stale) {
        options.logger.warn("[node-monitor] offline transition", {
          nodeId: node.id,
          previousStatus: node.status,
          newStatus: "offline",
          lastHeartbeatAt: node.lastHeartbeatAt?.toISOString() ?? null,
          heartbeatTimeoutMs: options.heartbeatTimeoutMs,
          reason: describeStaleReason(node.lastHeartbeatAt, options.heartbeatTimeoutMs)
        });
      }

      return stale.length;
    },
    { timeout: options.txTimeoutMs }
  );
}

async function tryAcquireAdvisoryLock(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtext(${ADVISORY_LOCK_NAMESPACE})::bigint) AS acquired
  `;
  return rows[0]?.acquired === true;
}

function describeStaleReason(lastHeartbeatAt: Date | null, timeoutMs: number): string {
  const timeoutSeconds = Math.round(timeoutMs / 1000);
  if (!lastHeartbeatAt) {
    return `no heartbeat received; offline after ${timeoutSeconds}s threshold`;
  }
  const ageSeconds = Math.max(
    0,
    Math.round((Date.now() - lastHeartbeatAt.getTime()) / 1000)
  );
  return `no heartbeat for ${ageSeconds}s (threshold ${timeoutSeconds}s)`;
}
