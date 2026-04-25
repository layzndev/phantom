import { Logger } from "./logger.js";
import {
  DockerMinecraftManagementTransport,
  type MinecraftManagementTransport
} from "./minecraft-management.js";
import { PhantomApiClient } from "./phantom-api.js";
import type { RuntimeMinecraftConsoleStream } from "./types.js";
import { DockerRuntime } from "./docker.js";

type ActiveFollower = {
  stream: RuntimeMinecraftConsoleStream;
  stop: () => void;
  buffer: string[];
  flushTimer: NodeJS.Timeout | null;
};

const LOG_FLUSH_MS = 300;

export class MinecraftConsoleStreamManager {
  private readonly logger: Logger;
  private readonly transport: MinecraftManagementTransport;
  private readonly followers = new Map<string, ActiveFollower>();
  private running = false;

  constructor(
    private readonly api: PhantomApiClient,
    docker: DockerRuntime,
    logger: Logger
  ) {
    this.logger = logger.child("minecraft-console");
    this.transport = new DockerMinecraftManagementTransport(docker, logger);
  }

  async reconcileOnce() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const { streams } = await this.api.listMinecraftConsoleStreams();
      const nextIds = new Set(streams.map((stream) => stream.workloadId));

      for (const stream of streams) {
        const current = this.followers.get(stream.workloadId);
        if (!stream.containerId) {
          if (current) {
            this.stopFollower(stream.workloadId);
          }
          continue;
        }

        if (!current || current.stream.containerId !== stream.containerId) {
          if (current) {
            this.stopFollower(stream.workloadId);
          }
          this.startFollower(stream);
        }
      }

      for (const workloadId of this.followers.keys()) {
        if (!nextIds.has(workloadId)) {
          this.stopFollower(workloadId);
        }
      }
    } catch (error) {
      this.logger.debug("failed to reconcile minecraft console streams", {
        error: error instanceof Error ? error.message : "unknown"
      });
    } finally {
      this.running = false;
    }
  }

  async stopAll() {
    for (const workloadId of this.followers.keys()) {
      this.stopFollower(workloadId);
    }
  }

  private startFollower(stream: RuntimeMinecraftConsoleStream) {
    if (!stream.containerId) {
      return;
    }

    const follower: ActiveFollower = {
      stream,
      buffer: [],
      flushTimer: null,
      stop: () => undefined
    };

    follower.stop = this.transport.tailLogs(
      {
        serverId: stream.serverId,
        workloadId: stream.workloadId,
        containerId: stream.containerId
      },
      {
        onLine: (line) => {
          follower.buffer.push(line);
          if (!follower.flushTimer) {
            follower.flushTimer = setTimeout(() => {
              void this.flushFollower(stream.workloadId);
            }, LOG_FLUSH_MS);
          }
        },
        onError: (error) => {
          this.logger.debug("minecraft console follower error", {
            serverId: stream.serverId,
            workloadId: stream.workloadId,
            error: error.message
          });
        }
      }
    ).stop;

    this.followers.set(stream.workloadId, follower);
  }

  private stopFollower(workloadId: string) {
    const follower = this.followers.get(workloadId);
    if (!follower) {
      return;
    }

    follower.stop();
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
    }
    if (follower.buffer.length > 0) {
      void this.flushLines(follower.stream.serverId, follower.buffer.splice(0));
    }
    this.followers.delete(workloadId);
  }

  private async flushFollower(workloadId: string) {
    const follower = this.followers.get(workloadId);
    if (!follower || follower.buffer.length === 0) {
      if (follower) {
        follower.flushTimer = null;
      }
      return;
    }

    const lines = follower.buffer.splice(0);
    follower.flushTimer = null;
    await this.flushLines(follower.stream.serverId, lines);
  }

  private async flushLines(serverId: string, lines: string[]) {
    if (lines.length === 0) {
      return;
    }

    try {
      await this.api.publishMinecraftConsoleLogs(serverId, { lines });
    } catch (error) {
      this.logger.debug("failed to publish minecraft console logs", {
        serverId,
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}
