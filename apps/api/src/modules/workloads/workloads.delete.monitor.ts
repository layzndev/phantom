import type { Prisma } from "@prisma/client";
import { db } from "../../db/client.js";
import { env } from "../../config/env.js";

const ADVISORY_LOCK_NAMESPACE = "phantom.workload_delete_monitor";
const DEFAULT_TX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_DELETES_PER_TICK = 500;
const INITIAL_DELAY_MS = 1_000;

type Logger = Pick<Console, "info" | "warn" | "error">;

export interface WorkloadDeleteMonitorOptions {
  tickIntervalMs: number;
  deleteTimeoutMs: number;
  txTimeoutMs: number;
  maxDeletesPerTick: number;
  logger: Logger;
}

export interface WorkloadDeleteMonitorHandle {
  stop: () => Promise<void>;
  runOnce: () => Promise<number>;
}

export function startWorkloadDeleteMonitor(
  overrides: Partial<WorkloadDeleteMonitorOptions> = {}
): WorkloadDeleteMonitorHandle {
  const options: WorkloadDeleteMonitorOptions = {
    tickIntervalMs: overrides.tickIntervalMs ?? env.workloadDeleteMonitorTickMs,
    deleteTimeoutMs: overrides.deleteTimeoutMs ?? env.workloadDeleteTimeoutMs,
    txTimeoutMs: overrides.txTimeoutMs ?? DEFAULT_TX_TIMEOUT_MS,
    maxDeletesPerTick: overrides.maxDeletesPerTick ?? DEFAULT_MAX_DELETES_PER_TICK,
    logger: overrides.logger ?? console
  };

  let inflight: Promise<number> | null = null;
  let stopped = false;

  const runOnce = async (): Promise<number> => {
    if (stopped) return 0;
    if (inflight) return inflight;

    const task = runMonitorTick(options).catch((err) => {
      options.logger.error("[workload-delete-monitor] tick failed", err);
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
    `[workload-delete-monitor] started (tick=${options.tickIntervalMs}ms timeout=${options.deleteTimeoutMs}ms)`
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

async function runMonitorTick(options: WorkloadDeleteMonitorOptions): Promise<number> {
  const cutoff = new Date(Date.now() - options.deleteTimeoutMs);

  return db.$transaction(
    async (tx) => {
      const acquired = await tryAcquireAdvisoryLock(tx);
      if (!acquired) return 0;

      const candidates = await tx.workload.findMany({
        where: {
          status: "deleting",
          deletedAt: null,
          deleteRequestedAt: { not: null, lt: cutoff }
        },
        select: {
          id: true,
          name: true,
          type: true,
          nodeId: true,
          deleteHardData: true,
          node: {
            select: {
              status: true,
              health: true,
              lastHeartbeatAt: true
            }
          }
        },
        orderBy: { deleteRequestedAt: "asc" },
        take: options.maxDeletesPerTick
      });

      if (candidates.length === 0) {
        return 0;
      }

      let finalized = 0;

      for (const workload of candidates) {
        const nodeOffline =
          !workload.node ||
          workload.node.status === "offline" ||
          workload.node.health === "unreachable";

        if (!nodeOffline) {
          continue;
        }

        if (workload.deleteHardData) {
          options.logger.warn(
            `[workload-delete-monitor] keeping ${workload.id} in deleting until node cleanup can remove data`
          );
          continue;
        }

        await tx.minecraftServer.updateMany({
          where: { workloadId: workload.id, deletedAt: null },
          data: { deletedAt: new Date() }
        });

        await tx.workloadPort.deleteMany({
          where: { workloadId: workload.id }
        });

        const updated = await tx.workload.update({
          where: { id: workload.id },
          data: {
            status: "deleted",
            desiredStatus: "stopped",
            containerId: null,
            lastExitCode: null,
            restartCount: 0,
            deletedAt: new Date(),
            deleteRuntimeAckAt: new Date()
          }
        });

        await tx.workloadStatusEvent.create({
          data: {
            workloadId: workload.id,
            previousStatus: "deleting",
            newStatus: "deleted",
            reason:
              "[delete] timeout fallback: node offline, ports released, awaiting orphan cleanup on agent resume"
          }
        });

        finalized += 1;
        options.logger.warn(
          `[workload-delete-monitor] timeout fallback finalized ${updated.id} (${workload.type}:${workload.name})`
        );
      }

      return finalized;
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
