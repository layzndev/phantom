import { env } from "../../config/env.js";
import { runIncidentDetectionTick } from "./incidents.service.js";

type Logger = Pick<Console, "info" | "error">;

export interface IncidentMonitorOptions {
  tickIntervalMs: number;
  logger: Logger;
}

export interface IncidentMonitorHandle {
  stop: () => Promise<void>;
  runOnce: () => Promise<void>;
}

export function startIncidentMonitor(
  overrides: Partial<IncidentMonitorOptions> = {}
): IncidentMonitorHandle {
  const options: IncidentMonitorOptions = {
    tickIntervalMs: overrides.tickIntervalMs ?? env.incidentMonitorTickMs,
    logger: overrides.logger ?? console
  };

  let inflight: Promise<void> | null = null;
  let stopped = false;

  const runOnce = async () => {
    if (stopped) return;
    if (inflight) return inflight;

    inflight = runIncidentDetectionTick().catch((error) => {
      options.logger.error("[incident-monitor] tick failed", error);
    });

    try {
      await inflight;
    } finally {
      inflight = null;
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, options.tickIntervalMs);
  timer.unref();

  options.logger.info(`[incident-monitor] started (tick=${options.tickIntervalMs}ms)`);

  return {
    runOnce,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (inflight) {
        await inflight.catch(() => undefined);
      }
    }
  };
}
