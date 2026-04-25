import { Logger } from "./logger.js";
import { MinecraftOperationsProcessor } from "./minecraft.js";
import { WorkloadReconciler } from "./reconciler.js";

export class PhantomAgent {
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly reconciler: WorkloadReconciler,
    private readonly minecraftOps: MinecraftOperationsProcessor,
    logger: Logger,
    private readonly pollIntervalMs: number
  ) {
    this.logger = logger.child("runner");
  }

  async start() {
    this.logger.info("starting reconciliation loop", {
      pollIntervalMs: this.pollIntervalMs
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
