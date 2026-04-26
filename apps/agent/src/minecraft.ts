import { DockerRuntime } from "./docker.js";
import { Logger } from "./logger.js";
import {
  DockerMinecraftManagementTransport,
  type MinecraftManagementTransport
} from "./minecraft-management.js";
import { MinecraftFilesManager } from "./minecraft-files.js";
import { PhantomApiClient } from "./phantom-api.js";
import type {
  MinecraftFileAccessMode,
  MinecraftOperationCompletePayload,
  MinecraftOperationKind,
  MinecraftRuntimeOperation
} from "./types.js";

export class MinecraftOperationsProcessor {
  private readonly logger: Logger;
  private readonly transport: MinecraftManagementTransport;
  private readonly files: MinecraftFilesManager;
  private running = false;

  constructor(
    private readonly api: PhantomApiClient,
    private readonly docker: DockerRuntime,
    logger: Logger
  ) {
    this.logger = logger.child("minecraft-ops");
    this.transport = new DockerMinecraftManagementTransport(this.docker, logger);
    this.files = new MinecraftFilesManager(logger);
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
      const result = await this.execute(op.kind, op.workloadId, op.containerId, op.payload);
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
    workloadId: string,
    containerId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const target = { workloadId, containerId };
    const accessMode = readFileAccessMode(payload);
    switch (kind) {
      case "command": {
        const command = typeof payload.command === "string" ? payload.command.trim() : "";
        if (!command) {
          throw new Error("missing command");
        }
        return this.transport.sendCommand(target, command);
      }
      case "save": {
        return this.transport.saveAll(target);
      }
      case "logs": {
        const tail = typeof payload.tail === "number" ? payload.tail : 200;
        const output = await this.docker.getContainerLogs(containerId, { tail });
        const lines = output.split(/\r?\n/);
        return { lines, tail };
      }
      case "stop": {
        return this.transport.stopGracefully(target);
      }
      case "players": {
        return this.transport.sendCommand(target, "list");
      }
      case "files.list": {
        return this.files.list(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          accessMode
        );
      }
      case "files.read": {
        return this.files.readText(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          accessMode
        );
      }
      case "files.write": {
        return this.files.writeText(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          typeof payload.content === "string" ? payload.content : "",
          accessMode
        );
      }
      case "files.upload": {
        return this.files.upload(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          typeof payload.contentBase64 === "string" ? payload.contentBase64 : "",
          accessMode
        );
      }
      case "files.mkdir": {
        return this.files.mkdir(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          accessMode
        );
      }
      case "files.rename": {
        return this.files.rename(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.from === "string" ? payload.from : "/",
          typeof payload.to === "string" ? payload.to : "/",
          accessMode
        );
      }
      case "files.delete": {
        return this.files.delete(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          accessMode
        );
      }
      case "files.archive": {
        return this.files.archive(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          accessMode
        );
      }
      case "files.extract": {
        return this.files.extract(
          this.docker.getWorkloadVolumePath(workloadId, "minecraft-data"),
          typeof payload.path === "string" ? payload.path : "/",
          accessMode
        );
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

function readFileAccessMode(payload: Record<string, unknown>): MinecraftFileAccessMode {
  return payload.accessMode === "infra_admin" ? "infra_admin" : "tenant_user";
}
