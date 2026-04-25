import { spawn } from "node:child_process";
import { Logger } from "./logger.js";
import { DockerRuntime } from "./docker.js";

export interface MinecraftManagementTarget {
  workloadId: string;
  containerId: string;
  serverId?: string;
}

export interface MinecraftManagementTransport {
  sendCommand(
    target: MinecraftManagementTarget,
    command: string
  ): Promise<{ output: string; stderr: string }>;
  saveAll(
    target: MinecraftManagementTarget
  ): Promise<{ output: string; stderr: string }>;
  stopGracefully(
    target: MinecraftManagementTarget
  ): Promise<{ output: string; stderr: string }>;
  tailLogs(
    target: MinecraftManagementTarget,
    handlers: {
      onLine: (line: string) => void;
      onError?: (error: Error) => void;
      onClose?: () => void;
    },
    options?: { since?: string | null }
  ): { stop: () => void };
  getStatus(target: MinecraftManagementTarget): Promise<"running" | "stopped" | "missing">;
}

export class DockerMinecraftManagementTransport implements MinecraftManagementTransport {
  private readonly logger: Logger;

  constructor(
    private readonly docker: DockerRuntime,
    logger: Logger
  ) {
    this.logger = logger.child("minecraft-transport");
  }

  async sendCommand(target: MinecraftManagementTarget, command: string) {
    const { stdout, stderr } = await this.docker.execInContainer(target.containerId, [
      "rcon-cli",
      command
    ]);
    return { output: stdout, stderr };
  }

  async saveAll(target: MinecraftManagementTarget) {
    const { stdout, stderr } = await this.docker.execInContainer(target.containerId, [
      "rcon-cli",
      "save-all",
      "flush"
    ]);
    return { output: stdout, stderr };
  }

  async stopGracefully(target: MinecraftManagementTarget) {
    const { stdout, stderr } = await this.docker.execInContainer(target.containerId, [
      "rcon-cli",
      "stop"
    ]);
    return { output: stdout, stderr };
  }

  tailLogs(
    target: MinecraftManagementTarget,
    handlers: {
      onLine: (line: string) => void;
      onError?: (error: Error) => void;
      onClose?: () => void;
    },
    options: { since?: string | null } = {}
  ) {
    const args = ["logs", "--timestamps"];
    if (options.since) {
      args.push("--since", options.since);
    } else {
      args.push("--tail", "40");
    }
    args.push("--follow", target.containerId);
    const child = spawn(
      "docker",
      args,
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const consume = (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (trimmed.length > 0) {
          handlers.onLine(trimmed);
        }
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => {
      this.logger.warn("minecraft log tail failed", {
        workloadId: target.workloadId,
        containerId: target.containerId,
        error: error.message
      });
      handlers.onError?.(error);
    });
    child.on("close", () => {
      handlers.onClose?.();
    });

    return {
      stop: () => {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      }
    };
  }

  async getStatus(target: MinecraftManagementTarget) {
    const container = await this.docker.inspectContainer(target.containerId);
    if (!container) {
      return "missing";
    }
    return container.running ? "running" : "stopped";
  }
}
