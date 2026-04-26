import { WebSocketConnection } from "../../lib/websocket.js";

type ConnectionEntry = {
  serverId: string;
  workloadId: string;
  connection: WebSocketConnection;
};

type HistoryEntry =
  | { type: "log"; line: string; timestamp: string }
  | { type: "status"; status: string; timestamp: string }
  | { type: "command_result"; id: string; output: string; timestamp: string }
  | { type: "error"; message: string; timestamp: string };

const HISTORY_LIMIT_LINES = 500;
const HISTORY_RETENTION_MS = 30 * 60_000; // keep at most ~30 minutes of recent events

class MinecraftConsoleGateway {
  private readonly byServerId = new Map<string, Set<ConnectionEntry>>();
  private readonly byWorkloadId = new Map<string, Set<ConnectionEntry>>();
  private readonly lifecycleDedup = new Map<string, number>();
  private readonly lastStatusByServerId = new Map<string, string>();
  private readonly historyByServerId = new Map<string, HistoryEntry[]>();
  private readonly workloadIdByServerId = new Map<string, string>();
  private static readonly LIFECYCLE_DEDUP_MS = 30_000;

  attach(connection: WebSocketConnection, serverId: string, workloadId: string) {
    const entry: ConnectionEntry = { connection, serverId, workloadId };
    this.add(this.byServerId, serverId, entry);
    this.add(this.byWorkloadId, workloadId, entry);
    this.workloadIdByServerId.set(serverId, workloadId);

    const history = this.historyByServerId.get(serverId);
    if (history && history.length > 0) {
      connection.sendJson({ type: "history", events: history });
    }

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
    const timestamp = new Date().toISOString();
    this.recordHistory(serverId, { type: "status", status, timestamp });
    this.publishByServer(serverId, { type: "status", status, timestamp });
  }

  publishLogs(serverId: string, lines: string[]) {
    const timestamp = new Date().toISOString();
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
      this.recordHistory(serverId, { type: "log", line, timestamp });
      this.publishByServer(serverId, { type: "log", line, timestamp });
    }
  }

  publishCommandResult(
    workloadId: string,
    payload: { id: string; output: string }
  ) {
    const timestamp = new Date().toISOString();
    const serverId = this.findServerIdForWorkload(workloadId);
    const event = { type: "command_result" as const, id: payload.id, output: payload.output, timestamp };
    if (serverId) {
      this.recordHistory(serverId, event);
    }
    this.publishByWorkload(workloadId, event);
  }

  publishError(workloadId: string, message: string) {
    const timestamp = new Date().toISOString();
    const serverId = this.findServerIdForWorkload(workloadId);
    const event = { type: "error" as const, message, timestamp };
    if (serverId) {
      this.recordHistory(serverId, event);
    }
    this.publishByWorkload(workloadId, event);
  }

  private recordHistory(serverId: string, entry: HistoryEntry) {
    const list = this.historyByServerId.get(serverId) ?? [];
    list.push(entry);
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    while (list.length > 0) {
      const head = list[0];
      const headTime = Date.parse(head.timestamp);
      if (Number.isFinite(headTime) && headTime < cutoff) {
        list.shift();
        continue;
      }
      break;
    }
    if (list.length > HISTORY_LIMIT_LINES) {
      list.splice(0, list.length - HISTORY_LIMIT_LINES);
    }
    this.historyByServerId.set(serverId, list);
  }

  private findServerIdForWorkload(workloadId: string) {
    const entries = this.byWorkloadId.get(workloadId);
    const fromConnection = entries?.values().next().value?.serverId;
    if (fromConnection) {
      return fromConnection;
    }
    for (const [serverId, mapped] of this.workloadIdByServerId.entries()) {
      if (mapped === workloadId) {
        return serverId;
      }
    }
    return null;
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
