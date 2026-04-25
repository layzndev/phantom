import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";

const ADVISORY_LOCK_NAMESPACE = "phantom.workload_queued_start_monitor";
const DEFAULT_TX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PER_TICK = 1_000;
const INITIAL_DELAY_MS = 1_500;

type Logger = Pick<Console, "info" | "warn" | "error">;

export interface WorkloadQueuedStartMonitorOptions {
  tickIntervalMs: number;
  txTimeoutMs: number;
  maxPerTick: number;
  logger: Logger;
}

export interface WorkloadQueuedStartMonitorHandle {
  stop: () => Promise<void>;
  runOnce: () => Promise<number>;
}

export function startWorkloadQueuedStartMonitor(
  overrides: Partial<WorkloadQueuedStartMonitorOptions> = {}
): WorkloadQueuedStartMonitorHandle {
  const options: WorkloadQueuedStartMonitorOptions = {
    tickIntervalMs: overrides.tickIntervalMs ?? env.queuedStartMonitorTickMs,
    txTimeoutMs: overrides.txTimeoutMs ?? DEFAULT_TX_TIMEOUT_MS,
    maxPerTick: overrides.maxPerTick ?? DEFAULT_MAX_PER_TICK,
    logger: overrides.logger ?? console
  };

  let inflight: Promise<number> | null = null;
  let stopped = false;

  const runOnce = async (): Promise<number> => {
    if (stopped) return 0;
    if (inflight) return inflight;

    const task = runMonitorTick(options).catch((error) => {
      options.logger.error("[queued-start-monitor] tick failed", error);
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
    `[queued-start-monitor] started (tick=${options.tickIntervalMs}ms cpu<${env.freeTierMaxCpuPercent}% ram<${env.freeTierMaxRamPercent}%)`
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

async function runMonitorTick(options: WorkloadQueuedStartMonitorOptions): Promise<number> {
  return db.$transaction(
    async (tx) => {
      const acquired = await tryAcquireAdvisoryLock(tx);
      if (!acquired) return 0;

      const queued = await tx.workload.findMany({
        where: {
          status: "queued_start",
          desiredStatus: "running",
          deletedAt: null,
          nodeId: { not: null },
          node: {
            pool: "free",
            maintenanceMode: false,
            status: "healthy"
          }
        },
        select: {
          id: true,
          nodeId: true,
          status: true,
          node: {
            select: {
              id: true,
              totalCpu: true,
              usedCpu: true,
              totalRamMb: true,
              usedRamMb: true
            }
          }
        },
        orderBy: { createdAt: "asc" },
        take: options.maxPerTick
      });

      let released = 0;
      for (const workload of queued) {
        const node = workload.node;
        if (!node || !isWithinFreeTierThresholds(node)) {
          continue;
        }

        await tx.workload.update({
          where: { id: workload.id },
          data: { status: "stopped" }
        });

        await tx.workloadStatusEvent.create({
          data: {
            workloadId: workload.id,
            previousStatus: "queued_start",
            newStatus: "stopped",
            reason: `[queued-start] released on node ${node.id}; live usage back under thresholds`
          }
        });

        released += 1;
      }

      if (released > 0) {
        options.logger.info(`[queued-start-monitor] released ${released} queued workload(s)`);
      }

      return released;
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

function isWithinFreeTierThresholds(node: {
  totalCpu: number | null;
  usedCpu: number;
  totalRamMb: number | null;
  usedRamMb: number;
}) {
  const cpuPercent =
    node.totalCpu && node.totalCpu > 0 ? (node.usedCpu / node.totalCpu) * 100 : 100;
  const ramPercent =
    node.totalRamMb && node.totalRamMb > 0 ? (node.usedRamMb / node.totalRamMb) * 100 : 100;

  return cpuPercent < env.freeTierMaxCpuPercent && ramPercent < env.freeTierMaxRamPercent;
}
