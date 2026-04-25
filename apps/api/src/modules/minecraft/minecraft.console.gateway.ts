import { WebSocketConnection } from "../../lib/websocket.js";

type ConnectionEntry = {
  serverId: string;
  workloadId: string;
  connection: WebSocketConnection;
};

class MinecraftConsoleGateway {
  private readonly byServerId = new Map<string, Set<ConnectionEntry>>();
  private readonly byWorkloadId = new Map<string, Set<ConnectionEntry>>();
  private readonly lifecycleDedup = new Map<string, number>();
  private readonly lastStatusByServerId = new Map<string, string>();
  private static readonly LIFECYCLE_DEDUP_MS = 30_000;

  attach(connection: WebSocketConnection, serverId: string, workloadId: string) {
    const entry: ConnectionEntry = { connection, serverId, workloadId };
    this.add(this.byServerId, serverId, entry);
    this.add(this.byWorkloadId, workloadId, entry);
    return () => this.detach(entry);
  }

  listActiveWorkloads() {
    return Array.from(this.byWorkloadId.entries()).map(([workloadId, entries]) => ({
      workloadId,
      serverId: entries.values().next().value?.serverId as string | undefined
    })).filter((entry): entry is { workloadId: string; serverId: string } => Boolean(entry.serverId));
  }

  publishStatus(serverId: string, status: string) {
    if (this.lastStatusByServerId.get(serverId) === status) {
      return;
    }
    this.lastStatusByServerId.set(serverId, status);
    this.publishByServer(serverId, { type: "status", status });
  }

  publishLogs(serverId: string, lines: string[]) {
    for (const line of lines) {
      if (line.startsWith("__PHANTOM__ ")) {
        const key = `${serverId}:${line}`;
        const now = Date.now();
        const lastSentAt = this.lifecycleDedup.get(key) ?? 0;
        if (now - lastSentAt < MinecraftConsoleGateway.LIFECYCLE_DEDUP_MS) {
          continue;
        }
        this.lifecycleDedup.set(key, now);
      }
      this.publishByServer(serverId, { type: "log", line });
    }
  }

  publishCommandResult(
    workloadId: string,
    payload: { id: string; output: string }
  ) {
    this.publishByWorkload(workloadId, {
      type: "command_result",
      id: payload.id,
      output: payload.output
    });
  }

  publishError(workloadId: string, message: string) {
    this.publishByWorkload(workloadId, {
      type: "error",
      message
    });
  }

  private publishByServer(serverId: string, payload: unknown) {
    const entries = this.byServerId.get(serverId);
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      entry.connection.sendJson(payload);
    }
  }

  private publishByWorkload(workloadId: string, payload: unknown) {
    const entries = this.byWorkloadId.get(workloadId);
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      entry.connection.sendJson(payload);
    }
  }

  private detach(entry: ConnectionEntry) {
    this.remove(this.byServerId, entry.serverId, entry);
    this.remove(this.byWorkloadId, entry.workloadId, entry);
  }

  private add(
    bucket: Map<string, Set<ConnectionEntry>>,
    key: string,
    entry: ConnectionEntry
  ) {
    const set = bucket.get(key) ?? new Set<ConnectionEntry>();
    set.add(entry);
    bucket.set(key, set);
  }

  private remove(
    bucket: Map<string, Set<ConnectionEntry>>,
    key: string,
    entry: ConnectionEntry
  ) {
    const set = bucket.get(key);
    if (!set) {
      return;
    }
    set.delete(entry);
    if (set.size === 0) {
      bucket.delete(key);
      if (bucket === this.byServerId) {
        this.lastStatusByServerId.delete(key);
      }
    }
  }
}

export const minecraftConsoleGateway = new MinecraftConsoleGateway();
