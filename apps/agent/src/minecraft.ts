import { DockerRuntime } from "./docker.js";
import { Logger } from "./logger.js";
import { PhantomApiClient } from "./phantom-api.js";
import type {
  MinecraftOperationCompletePayload,
  MinecraftOperationKind,
  MinecraftRuntimeOperation
} from "./types.js";

export class MinecraftOperationsProcessor {
  private readonly logger: Logger;
  private running = false;

  constructor(
    private readonly api: PhantomApiClient,
    private readonly docker: DockerRuntime,
    logger: Logger
  ) {
    this.logger = logger.child("minecraft-ops");
  }

  async processOnce() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const { operations } = await this.api.listMinecraftOperations();
      for (const op of operations) {
        await this.processOperation(op);
      }
    } catch (error) {
      this.logger.warn("failed to fetch minecraft operations", {
        error: error instanceof Error ? error.message : "unknown"
      });
    } finally {
      this.running = false;
    }
  }

  private async processOperation(op: MinecraftRuntimeOperation) {
    if (!op.containerId) {
      await this.complete(op.id, {
        status: "failed",
        error: "container not yet running"
      });
      return;
    }

    try {
      await this.api.claimMinecraftOperation(op.id);
    } catch (error) {
      this.logger.debug("operation already claimed", {
        opId: op.id,
        error: error instanceof Error ? error.message : "unknown"
      });
      return;
    }

    try {
      const result = await this.execute(op.kind, op.containerId, op.payload);
      await this.complete(op.id, { status: "succeeded", result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      this.logger.warn("minecraft operation failed", {
        opId: op.id,
        kind: op.kind,
        error: message
      });
      await this.complete(op.id, { status: "failed", error: message });
    }
  }

  private async execute(
    kind: MinecraftOperationKind,
    containerId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (kind) {
      case "command": {
        const command = typeof payload.command === "string" ? payload.command.trim() : "";
        if (!command) {
          throw new Error("missing command");
        }
        const { stdout, stderr } = await this.docker.execInContainer(containerId, [
          "rcon-cli",
          command
        ]);
        return { output: stdout, stderr };
      }
      case "save": {
        const { stdout, stderr } = await this.docker.execInContainer(containerId, [
          "rcon-cli",
          "save-all",
          "flush"
        ]);
        return { output: stdout, stderr };
      }
      case "logs": {
        const tail = typeof payload.tail === "number" ? payload.tail : 200;
        const output = await this.docker.getContainerLogs(containerId, { tail });
        const lines = output.split(/\r?\n/);
        return { lines, tail };
      }
      default:
        throw new Error(`unsupported operation kind: ${kind}`);
    }
  }

  private async complete(opId: string, payload: MinecraftOperationCompletePayload) {
    try {
      await this.api.completeMinecraftOperation(opId, payload);
    } catch (error) {
      this.logger.warn("failed to ack minecraft operation", {
        opId,
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}
