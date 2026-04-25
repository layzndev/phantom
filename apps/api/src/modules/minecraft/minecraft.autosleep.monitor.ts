import { env } from "../../config/env.js";
import { runMinecraftAutoSleepTick } from "./minecraft.service.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export interface MinecraftAutoSleepMonitorOptions {
  tickIntervalMs: number;
  logger: Logger;
}

export interface MinecraftAutoSleepMonitorHandle {
  stop: () => Promise<void>;
  runOnce: () => Promise<number>;
}

const INITIAL_DELAY_MS = 2_000;

export function startMinecraftAutoSleepMonitor(
  overrides: Partial<MinecraftAutoSleepMonitorOptions> = {}
): MinecraftAutoSleepMonitorHandle {
  const options: MinecraftAutoSleepMonitorOptions = {
    tickIntervalMs: overrides.tickIntervalMs ?? env.autoSleepMonitorTickMs,
    logger: overrides.logger ?? console
  };

  let inflight: Promise<number> | null = null;
  let stopped = false;

  const runOnce = async () => {
    if (stopped || !env.autoSleepEnabled) return 0;
    if (inflight) return inflight;

    const task = runMinecraftAutoSleepTick().catch((error) => {
      options.logger.error("[minecraft-autosleep-monitor] tick failed", error);
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
    `[minecraft-autosleep-monitor] started (tick=${options.tickIntervalMs}ms idle=${env.autoSleepIdleMinutes}m)`
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
