import { RuntimeCleanupService } from "./cleanup.js";
import { Logger } from "./logger.js";
import { MinecraftOperationsProcessor } from "./minecraft.js";
import { WorkloadReconciler } from "./reconciler.js";

const DEFAULT_FULL_GC_INTERVAL_MS = 5 * 60 * 1000;

export class PhantomAgent {
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private lastFullGcAt = 0;

  constructor(
    private readonly reconciler: WorkloadReconciler,
    private readonly cleanup: RuntimeCleanupService,
    private readonly minecraftOps: MinecraftOperationsProcessor,
    logger: Logger,
    private readonly pollIntervalMs: number,
    private readonly fullGcIntervalMs: number = DEFAULT_FULL_GC_INTERVAL_MS
  ) {
    this.logger = logger.child("runner");
  }

  async start() {
    this.logger.info("starting reconciliation loop", {
      pollIntervalMs: this.pollIntervalMs,
      fullGcIntervalMs: this.fullGcIntervalMs
    });

    await this.tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info("agent stopped");
  }

  private async tick() {
    if (this.stopped || this.running) {
      return;
    }

    this.running = true;
    try {
      await this.reconciler.reconcileOnce();
      await this.minecraftOps.processOnce();

      try {
        await this.cleanup.purgeOrphanedManaged();
      } catch (error) {
        this.logger.error("orphan cleanup failed", {
          error: error instanceof Error ? error.message : "unknown"
        });
      }

      if (Date.now() - this.lastFullGcAt >= this.fullGcIntervalMs) {
        try {
          await this.cleanup.runFullGarbageCollection();
        } catch (error) {
          this.logger.error("full garbage collection failed", {
            error: error instanceof Error ? error.message : "unknown"
          });
        } finally {
          this.lastFullGcAt = Date.now();
        }
      }
    } catch (error) {
      this.logger.error("reconciliation failed", {
        error: error instanceof Error ? error.message : "unknown"
      });
    } finally {
      this.running = false;
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.tick(), this.pollIntervalMs);
      }
    }
  }
}
