import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import type { NodePool } from "../nodes/nodes.types.js";

const ADVISORY_LOCK_NAMESPACE = "phantom.workload_queued_start_monitor";
const PLACEMENT_LOCK_NAMESPACE = "workload:placement";
const DEFAULT_TX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PER_TICK = 1_000;
const INITIAL_DELAY_MS = 1_500;
const MINECRAFT_INTERNAL_PORT = 25565;

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
  const released = await db.$transaction(
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

      let releasedCount = 0;
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

        releasedCount += 1;
      }

      if (releasedCount > 0) {
        options.logger.info(`[queued-start-monitor] released ${releasedCount} queued workload(s)`);
      }

      return releasedCount;
    },
    { timeout: options.txTimeoutMs }
  );

  const pendingMinecraft = await db.workload.findMany({
    where: {
      status: "pending",
      desiredStatus: "running",
      deletedAt: null,
      nodeId: null,
      type: "minecraft",
      minecraftServer: {
        is: {
          deletedAt: null
        }
      }
    },
    select: {
      id: true,
      name: true,
      image: true,
      requestedCpu: true,
      requestedRamMb: true,
      requestedDiskGb: true,
      config: true,
      minecraftServer: {
        select: {
          id: true,
          planTier: true
        }
      }
    },
    orderBy: { createdAt: "asc" },
    take: options.maxPerTick
  });

  let assigned = 0;
  for (const workload of pendingMinecraft) {
    const requiredPool: NodePool =
      workload.minecraftServer?.planTier === "premium" ? "premium" : "free";
    const placed = await tryAssignPendingMinecraftWorkload({
      workloadId: workload.id,
      name: workload.name,
      image: workload.image,
      requestedCpu: workload.requestedCpu,
      requestedRamMb: workload.requestedRamMb,
      requestedDiskGb: workload.requestedDiskGb,
      config: workload.config as Prisma.InputJsonValue,
      requiredPool
    });
    if (placed) {
      assigned += 1;
    }
  }

  if (assigned > 0) {
    options.logger.info(`[queued-start-monitor] assigned ${assigned} pending minecraft workload(s)`);
  }

  return released + assigned;
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

async function tryAssignPendingMinecraftWorkload(input: {
  workloadId: string;
  name: string;
  image: string;
  requestedCpu: number;
  requestedRamMb: number;
  requestedDiskGb: number;
  config: Prisma.InputJsonValue;
  requiredPool: NodePool;
}) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PLACEMENT_LOCK_NAMESPACE}))`;

    const existing = await tx.workload.findUnique({
      where: { id: input.workloadId },
      select: {
        id: true,
        status: true,
        desiredStatus: true,
        nodeId: true,
        deletedAt: true
      }
    });

    if (
      !existing ||
      existing.deletedAt !== null ||
      existing.nodeId !== null ||
      existing.status !== "pending" ||
      existing.desiredStatus !== "running"
    ) {
      return false;
    }

    const allNodes = await tx.node.findMany({
      select: {
        id: true,
        pool: true,
        status: true,
        maintenanceMode: true,
        totalCpu: true,
        totalRamMb: true,
        usedCpu: true,
        usedRamMb: true,
        portRangeStart: true,
        portRangeEnd: true
      }
    });

    const eligible = allNodes.filter(
      (node) =>
        node.pool === input.requiredPool &&
        node.status === "healthy" &&
        !node.maintenanceMode &&
        node.totalCpu !== null &&
        node.totalRamMb !== null
    );

    if (eligible.length === 0) {
      return false;
    }

    const commitments = await tx.workload.groupBy({
      by: ["nodeId"],
      where: { nodeId: { in: eligible.map((node) => node.id) }, deletedAt: null },
      _sum: { requestedCpu: true, requestedRamMb: true }
    });

    const usageByNode = new Map<string, { cpu: number; ramMb: number }>();
    for (const row of commitments) {
      if (!row.nodeId) continue;
      usageByNode.set(row.nodeId, {
        cpu: row._sum.requestedCpu ?? 0,
        ramMb: row._sum.requestedRamMb ?? 0
      });
    }

    const candidates = eligible
      .map((node) => {
        const committed = usageByNode.get(node.id) ?? { cpu: 0, ramMb: 0 };
        const availableCpu = (node.totalCpu as number) - committed.cpu;
        const availableRamMb = (node.totalRamMb as number) - committed.ramMb;
        const queueStart =
          input.requiredPool === "free" &&
          !isWithinFreeTierThresholds({
            totalCpu: node.totalCpu as number,
            usedCpu: node.usedCpu ?? 0,
            totalRamMb: node.totalRamMb as number,
            usedRamMb: node.usedRamMb ?? 0
          });

        if (
          input.requiredPool !== "free" &&
          (availableCpu < input.requestedCpu || availableRamMb < input.requestedRamMb)
        ) {
          return null;
        }

        return {
          id: node.id,
          pool: node.pool as NodePool,
          totalCpu: node.totalCpu as number,
          totalRamMb: node.totalRamMb as number,
          usedCpu: node.usedCpu ?? 0,
          usedRamMb: node.usedRamMb ?? 0,
          portRangeStart: node.portRangeStart,
          portRangeEnd: node.portRangeEnd,
          queueStart,
          availableCpu,
          availableRamMb
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

    if (candidates.length === 0) {
      return false;
    }

    candidates.sort((left, right) => {
      if (left.queueStart !== right.queueStart) {
        return left.queueStart ? 1 : -1;
      }
      const leftScore =
        input.requiredPool === "free"
          ? Math.max(0, 1 - left.usedCpu / left.totalCpu) +
            Math.max(0, 1 - left.usedRamMb / left.totalRamMb)
          : left.availableCpu / left.totalCpu + left.availableRamMb / left.totalRamMb;
      const rightScore =
        input.requiredPool === "free"
          ? Math.max(0, 1 - right.usedCpu / right.totalCpu) +
            Math.max(0, 1 - right.usedRamMb / right.totalRamMb)
          : right.availableCpu / right.totalCpu + right.availableRamMb / right.totalRamMb;
      return rightScore - leftScore;
    });

    for (const candidate of candidates) {
      if (candidate.portRangeStart === null || candidate.portRangeEnd === null) {
        continue;
      }

      const usedPorts = await tx.workloadPort.findMany({
        where: { nodeId: candidate.id, protocol: "tcp" },
        select: { externalPort: true }
      });
      const used = new Set(usedPorts.map((port) => port.externalPort));
      let externalPort: number | null = null;
      for (let port = candidate.portRangeStart; port <= candidate.portRangeEnd; port += 1) {
        if (port === MINECRAFT_INTERNAL_PORT) continue;
        if (used.has(port)) continue;
        externalPort = port;
        break;
      }

      if (externalPort === null) {
        continue;
      }

      const nextStatus = candidate.queueStart ? "queued_start" : "creating";
      await tx.workload.update({
        where: { id: input.workloadId },
        data: {
          nodeId: candidate.id,
          status: nextStatus,
          config: input.config,
          ports: {
            create: {
              nodeId: candidate.id,
              internalPort: MINECRAFT_INTERNAL_PORT,
              externalPort,
              protocol: "tcp"
            }
          },
          statusEvents: {
            create: {
              previousStatus: "pending",
              newStatus: nextStatus,
              reason: candidate.queueStart
                ? `[placement-retry] placed on node ${candidate.id} with queued_start due to live cpu/ram thresholds`
                : `[placement-retry] placed on node ${candidate.id}`
            }
          }
        }
      });

      return true;
    }

    return false;
  });
}
