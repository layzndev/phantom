import { Logger } from "./logger.js";
import {
  DockerMinecraftManagementTransport,
  type MinecraftManagementTransport
} from "./minecraft-management.js";
import { PhantomApiClient } from "./phantom-api.js";
import type { RuntimeMinecraftConsoleStream, RuntimeMinecraftConsoleStreamsResponse } from "./types.js";
import { DockerRuntime } from "./docker.js";

type ActiveFollower = {
  stream: RuntimeMinecraftConsoleStream;
  stop: () => void;
  buffer: string[];
  flushTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
};

const LOG_FLUSH_MS = 75;
const ACTIVE_RECONCILE_MS = 250;
const IDLE_WATCH_TIMEOUT_MS = 30_000;
const FOLLOWER_STOP_GRACE_MS = 5_000;

export class MinecraftConsoleStreamManager {
  private readonly logger: Logger;
  private readonly transport: MinecraftManagementTransport;
  private readonly followers = new Map<string, ActiveFollower>();
  private loopTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;
  private cursor = 0;
  private lastKnownActiveCount = 0;

  constructor(
    private readonly api: PhantomApiClient,
    docker: DockerRuntime,
    logger: Logger
  ) {
    this.logger = logger.child("minecraft-console");
    this.transport = new DockerMinecraftManagementTransport(docker, logger);
  }

  start() {
    this.stopped = false;
    void this.loop();
  }

  async stopAll() {
    this.stopped = true;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    for (const workloadId of Array.from(this.followers.keys())) {
      this.stopFollower(workloadId);
    }
  }

  private async loop() {
    if (this.stopped || this.running) {
      return;
    }

    this.running = true;
    try {
      if (this.shouldPollActiveStreams()) {
        const snapshot = await this.api.listMinecraftConsoleStreams();
        this.applySnapshot(snapshot);
        this.scheduleNext(ACTIVE_RECONCILE_MS);
        return;
      }

      const snapshot = await this.api.waitMinecraftConsoleStreams(
        this.cursor,
        IDLE_WATCH_TIMEOUT_MS
      );
      this.applySnapshot(snapshot);
      this.scheduleNext(this.shouldPollActiveStreams() ? ACTIVE_RECONCILE_MS : 0);
    } catch (error) {
      this.logger.debug("failed to reconcile minecraft console streams", {
        error: error instanceof Error ? error.message : "unknown"
      });
      this.scheduleNext(1_000);
    } finally {
      this.running = false;
    }
  }

  private shouldPollActiveStreams() {
    return this.lastKnownActiveCount > 0 || this.followers.size > 0;
  }

  private scheduleNext(delayMs: number) {
    if (this.stopped) {
      return;
    }
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.loopTimer = setTimeout(() => void this.loop(), delayMs);
  }

  private applySnapshot(snapshot: RuntimeMinecraftConsoleStreamsResponse) {
    this.cursor = snapshot.cursor;
    this.lastKnownActiveCount = snapshot.streams.length;
    const nextByWorkloadId = new Map(snapshot.streams.map((stream) => [stream.workloadId, stream]));

    for (const stream of snapshot.streams) {
      const current = this.followers.get(stream.workloadId);

      if (!stream.containerId) {
        if (current) {
          this.scheduleFollowerStop(stream.workloadId);
        }
        continue;
      }

      if (!current) {
        this.startFollower(stream);
        continue;
      }

      if (current.graceTimer) {
        clearTimeout(current.graceTimer);
        current.graceTimer = null;
      }

      if (
        current.stream.containerId !== stream.containerId ||
        current.stream.runtimeStartedAt !== stream.runtimeStartedAt
      ) {
        this.stopFollower(stream.workloadId);
        this.startFollower(stream);
      } else {
        current.stream = stream;
      }
    }

    for (const workloadId of Array.from(this.followers.keys())) {
      if (!nextByWorkloadId.has(workloadId)) {
        this.scheduleFollowerStop(workloadId);
      }
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
      graceTimer: null,
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
      },
      { since: stream.runtimeStartedAt }
    ).stop;

    this.followers.set(stream.workloadId, follower);
  }

  private scheduleFollowerStop(workloadId: string) {
    const follower = this.followers.get(workloadId);
    if (!follower || follower.graceTimer) {
      return;
    }

    follower.graceTimer = setTimeout(() => {
      this.stopFollower(workloadId);
    }, FOLLOWER_STOP_GRACE_MS);
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
    if (follower.graceTimer) {
      clearTimeout(follower.graceTimer);
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
