"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_API_BASE_URL } from "@/lib/api/admin-api";
import { MinecraftConsole, type MinecraftConsoleLine } from "@/components/playground/MinecraftConsole";
import type { MinecraftServerWithWorkload } from "@/types/admin";

const RECONNECT_DELAY_MS = 2_000;
const MAX_CONSOLE_LINES = 1_000;
const REFRESH_DEBOUNCE_MS = 300;

export function MinecraftServiceConsole({
  entry,
  onRefresh,
  onLiveActivity,
  activeTab,
  onTabChange,
  onStart,
  onStop,
  onRestart,
  actionInFlight,
  filesContent,
  settingsContent,
  uptimeContent
}: {
  entry: MinecraftServerWithWorkload;
  onRefresh: () => Promise<void> | void;
  onLiveActivity?: () => Promise<void> | void;
  activeTab: "console" | "files" | "settings" | "uptime";
  onTabChange: (tab: "console" | "files" | "settings" | "uptime") => void;
  onStart: () => Promise<void> | void;
  onStop: () => Promise<void> | void;
  onRestart: () => Promise<void> | void;
  actionInFlight: "start" | "stop" | "restart" | null;
  filesContent?: ReactNode;
  settingsContent?: ReactNode;
  uptimeContent?: ReactNode;
}) {
  const [lines, setLines] = useState<MinecraftConsoleLine[]>([]);
  const [commandInput, setCommandInput] = useState("");
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "reconnecting"
  >("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const manuallyClosedRef = useRef(false);
  const commandHistoryRef = useRef(new Set<string>());
  const lastStatusRef = useRef<string | null>(null);
  const lastRuntimeStartedAtRef = useRef<string | null>(entry.workload.runtimeStartedAt);
  const currentRuntimeStateRef = useRef(entry.server.runtimeState);
  const actionInFlightRef = useRef(actionInFlight);
  const lineFingerprintsRef = useRef(new Set<string>());
  const lifecycleDedupRef = useRef(new Map<string, number>());
  const linesRef = useRef<MinecraftConsoleLine[]>([]);

  const phantomIdentity = useMemo(() => {
    const base = entry.server.slug?.trim() || "phantom";
    return `${base}@phantom~`;
  }, [entry.server.slug]);

  const appendLines = useCallback(
    (
      incoming: Array<{
        timestamp: string;
        kind: MinecraftConsoleLine["kind"];
        text: string;
        channel?: MinecraftConsoleLine["channel"];
      }>
    ) => {
      const normalized = incoming
        .map((line) => toConsoleLine(line))
        .filter((line) => {
          if (line.channel !== "PHANTOM" && line.kind !== "divider") {
            return true;
          }
          const now = Date.parse(line.timestamp) || Date.now();
          const key = `${line.kind}:${line.text.trim().toLowerCase()}`;
          const lastSeenAt = lifecycleDedupRef.current.get(key) ?? 0;
          if (now - lastSeenAt < 30_000) {
            return false;
          }
          lifecycleDedupRef.current.set(key, now);
          return true;
        })
        .filter((line) => {
          const fingerprint = buildLineFingerprint(line);
          if (lineFingerprintsRef.current.has(fingerprint)) {
            return false;
          }
          lineFingerprintsRef.current.add(fingerprint);
          return true;
        });

      if (normalized.length === 0) {
        return;
      }

      setLines((current) => {
        const next = [...current, ...normalized];
        if (next.length <= MAX_CONSOLE_LINES) {
          linesRef.current = next;
          return next;
        }

        const trimmed = next.slice(-MAX_CONSOLE_LINES);
        lineFingerprintsRef.current = new Set(trimmed.map((line) => buildLineFingerprint(line)));
        linesRef.current = trimmed;
        return trimmed;
      });
    },
    []
  );

  const replaceLines = useCallback((incoming: MinecraftConsoleLine[]) => {
    const next = incoming.slice(-MAX_CONSOLE_LINES);
    lineFingerprintsRef.current = new Set(next.map((line) => buildLineFingerprint(line)));
    lifecycleDedupRef.current = new Map(
      next
        .filter((line) => line.channel === "PHANTOM" || line.kind === "divider")
        .map((line) => [`${line.kind}:${line.text.trim().toLowerCase()}`, Date.parse(line.timestamp) || Date.now()])
    );
    linesRef.current = next;
    setLines(next);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      return;
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void onRefresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [onRefresh]);

  const scheduleLiveActivityRefresh = useCallback(() => {
    void onLiveActivity?.();
  }, [onLiveActivity]);

  const wsUrl = useMemo(() => {
    const base = new URL(ADMIN_API_BASE_URL);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `/runtime/minecraft/servers/${entry.server.id}/console`;
    base.search = "";
    return base.toString();
  }, [entry.server.id]);

  useEffect(() => {
    currentRuntimeStateRef.current = entry.server.runtimeState;
  }, [entry.server.runtimeState]);

  useEffect(() => {
    actionInFlightRef.current = actionInFlight;
  }, [actionInFlight]);

  useEffect(() => {
    if (lastRuntimeStartedAtRef.current !== entry.workload.runtimeStartedAt) {
      lastRuntimeStartedAtRef.current = entry.workload.runtimeStartedAt;
      lastStatusRef.current = null;
      commandHistoryRef.current.clear();
      lineFingerprintsRef.current.clear();
      lifecycleDedupRef.current.clear();
    }
  }, [entry.workload.runtimeStartedAt]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    manuallyClosedRef.current = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      // Intentionally do NOT reset lastStatusRef on reconnect: the gateway
      // re-sends the current status on attach, and resetting would cause
      // the frontend to surface a fresh "Server stopped" divider every
      // time the WebSocket reconnects (eg. after an idle timeout).
      setConnectionState((current) =>
        current === "connected" ? "connected" : current === "disconnected" ? "reconnecting" : "connecting"
      );

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as
            | { type: "log"; line: string; timestamp?: string }
            | { type: "status"; status: string; timestamp?: string }
            | { type: "command_result"; id: string; output: string; timestamp?: string }
            | { type: "error"; message: string; timestamp?: string }
            | { type: "history"; events: ConsoleHistoryEvent[] };

          if (payload.type === "history") {
            const replay = renderHistory(payload.events, commandHistoryRef.current);
            if (linesRef.current.length === 0) {
              replaceLines(replay);
            } else {
              appendLines(
                replay.map((line) => ({
                  timestamp: line.timestamp,
                  kind: line.kind,
                  text: line.text,
                  channel: line.channel
                }))
              );
            }
            const lastStatus = [...payload.events].reverse().find(
              (event): event is Extract<ConsoleHistoryEvent, { type: "status" }> =>
                event.type === "status"
            );
            if (lastStatus) {
              lastStatusRef.current = lastStatus.status;
            }
            return;
          }

          const timestamp = payload.timestamp ?? new Date().toISOString();
          if (payload.type === "log") {
            const hasPlayerActivity = payload.line
              .split(/\r?\n/)
              .some((text) => isPlayerActivityLine(text));
            const normalizedLines = payload.line
              .split(/\r?\n/)
              .flatMap((text) => normalizeConsoleLogLine(text, timestamp));
            appendLines(normalizedLines);
            if (hasPlayerActivity) {
              scheduleLiveActivityRefresh();
            }
          } else if (payload.type === "status") {
            const normalizedStatus =
              payload.status === "starting" && currentRuntimeStateRef.current === "restarting"
                ? "starting"
                : payload.status;
            if (lastStatusRef.current !== normalizedStatus) {
              lastStatusRef.current = normalizedStatus;
              if (normalizedStatus === "stopped") {
                appendLines([createStoppedDivider(timestamp)]);
              }
              scheduleRefresh();
            }
          } else if (payload.type === "command_result") {
            const isAdminCommand = commandHistoryRef.current.has(payload.id);
            commandHistoryRef.current.delete(payload.id);
            appendLines(normalizeCommandResult(payload.output, timestamp, isAdminCommand));
            scheduleRefresh();
          } else if (payload.type === "error") {
            appendLines([{ timestamp, kind: "error", channel: "ERROR", text: payload.message }]);
            scheduleRefresh();
          }
        } catch {
          appendLines([
            {
              timestamp: new Date().toISOString(),
              kind: "error",
              channel: "ERROR",
              text: "Invalid console payload received."
            }
          ]);
        }
      });

      socket.addEventListener("open", () => {
        clearReconnectTimer();
        setConnectionState("connected");
      });

      socket.addEventListener("close", () => {
        socketRef.current = null;
        if (!shouldReconnectRef.current || manuallyClosedRef.current) {
          setConnectionState("disconnected");
          return;
        }

        setConnectionState("reconnecting");
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      });

      socket.addEventListener("error", () => {
        // WebSocket error events fire on every idle disconnect / reconnect
        // cycle. The connection-state badge in the header already reflects
        // this, so don't pollute the console log.
      });
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      manuallyClosedRef.current = true;
      clearReconnectTimer();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [appendLines, entry.server.id, entry.server.name, replaceLines, scheduleRefresh, wsUrl]);

  const sendMessage = (payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "error",
          channel: "ERROR",
          text: "console websocket is not connected"
        }
      ]);
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  };

  const runStop = async () => {
    lastStatusRef.current = "stopping";
    await onStop();
  };

  const runStart = async () => {
    lastStatusRef.current = "starting";
    await onStart();
    manuallyClosedRef.current = false;
    shouldReconnectRef.current = true;
    socketRef.current?.close();
  };

  const runRestart = async () => {
    lastStatusRef.current = "restarting";
    await onRestart();
    manuallyClosedRef.current = false;
    shouldReconnectRef.current = true;
    socketRef.current?.close();
  };

  const handleSubmit = () => {
    const command = commandInput.trim();
    if (!command) {
      return;
    }
    if (/^stop\b/i.test(command)) {
      // Typing `stop` in the console must change the desired state, not just
      // pipe through rcon (otherwise the reconciler restarts the container).
      void runStop();
      setCommandInput("");
      return;
    }
    const id = `cmd-${Date.now()}`;
    if (sendMessage({ type: "command", id, command })) {
      commandHistoryRef.current.add(id);
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "command",
          channel: "ADMIN",
          text: `> ${command}`
        }
      ]);
      setCommandInput("");
    }
  };

  const derivedBusy =
    actionInFlight !== null ||
    connectionState === "connecting" ||
    connectionState === "reconnecting";

  return (
    <MinecraftConsole
      entry={entry}
      servers={[entry]}
      selectedServerId={entry.server.id}
      onSelectServer={() => undefined}
      lines={lines}
      commandInput={commandInput}
      onCommandInputChange={setCommandInput}
      onCommandSubmit={handleSubmit}
      onStart={() => void runStart()}
      onRestart={() => void runRestart()}
      onStop={() => void runStop()}
      busy={derivedBusy}
      actionState={actionInFlight}
      operatorLabel="admin"
      phantomIdentity={phantomIdentity}
      activeTab={activeTab}
      onTabChange={onTabChange}
      filesContent={filesContent}
      settingsContent={settingsContent}
      uptimeContent={uptimeContent}
    />
  );
}

type ConsoleHistoryEvent =
  | { type: "log"; line: string; timestamp: string }
  | { type: "status"; status: string; timestamp: string }
  | { type: "command_result"; id: string; output: string; timestamp: string }
  | { type: "error"; message: string; timestamp: string };

function toConsoleLine(input: {
  timestamp: string;
  kind: MinecraftConsoleLine["kind"];
  text: string;
  channel?: MinecraftConsoleLine["channel"];
}): MinecraftConsoleLine {
  return {
    id: crypto.randomUUID(),
    timestamp: input.timestamp,
    kind: input.kind,
    text: input.text,
    channel: input.channel
  };
}

function buildLineFingerprint(line: Pick<MinecraftConsoleLine, "timestamp" | "kind" | "channel" | "text">) {
  return [line.timestamp, line.kind, line.channel ?? "", line.text].join("|");
}

function createStoppedDivider(timestamp: string): MinecraftConsoleLine {
  return {
    id: crypto.randomUUID(),
    timestamp,
    kind: "divider",
    text: "Server stopped"
  };
}

function renderHistory(
  events: ConsoleHistoryEvent[],
  pendingAdminIds: Set<string>
): MinecraftConsoleLine[] {
  const out: MinecraftConsoleLine[] = [];
  const lifecycleSeenAt = new Map<string, number>();
  const pushLine = (line: MinecraftConsoleLine) => {
    if (line.channel === "PHANTOM" || line.kind === "divider") {
      const now = Date.parse(line.timestamp) || Date.now();
      const key = `${line.kind}:${line.text.trim().toLowerCase()}`;
      const lastSeenAt = lifecycleSeenAt.get(key) ?? 0;
      if (now - lastSeenAt < 30_000) {
        return;
      }
      lifecycleSeenAt.set(key, now);
    }
    out.push(line);
  };

  for (const event of events) {
    const timestamp = event.timestamp ?? new Date().toISOString();
    if (event.type === "log") {
      for (const text of event.line.split(/\r?\n/)) {
        for (const line of normalizeConsoleLogLine(text, timestamp)) {
          pushLine(line);
        }
      }
    } else if (event.type === "status") {
      if (event.status === "stopped") {
        pushLine(createStoppedDivider(timestamp));
      }
      continue;
    } else if (event.type === "command_result") {
      const isAdminCommand = pendingAdminIds.has(event.id);
      pendingAdminIds.delete(event.id);
      for (const line of normalizeCommandResult(event.output, timestamp, isAdminCommand)) {
        pushLine(line);
      }
    } else if (event.type === "error") {
      pushLine({
        id: crypto.randomUUID(),
        timestamp,
        kind: "error",
        channel: "ERROR",
        text: event.message
      });
    }
  }
  return out;
}

function normalizeConsoleLogLine(
  rawLine: string,
  timestamp: string
): MinecraftConsoleLine[] {
  const line = rawLine.trim();
  if (!line) {
    return [];
  }

  if (line.startsWith("__PHANTOM__ ")) {
    const text = line.slice("__PHANTOM__ ".length);
    if (isStoppedLifecycleMessage(text)) {
      return [createStoppedDivider(timestamp)];
    }

    return [
      {
        id: crypto.randomUUID(),
        timestamp,
        kind: "info",
        channel: "PHANTOM",
        text
      }
    ];
  }

  const displayTimestamp = deriveDisplayTimestamp(line, timestamp);
  const cleaned = stripDockerAndMinecraftTimestamps(line);
  if (!cleaned) {
    return [];
  }

  const parsed = parseMinecraftConsoleLine(cleaned);
  if (!parsed) {
    return [];
  }

  return [
    {
      id: crypto.randomUUID(),
      timestamp: displayTimestamp,
      kind: parsed.kind,
      channel: parsed.channel,
      text: parsed.text
    }
  ];
}

function normalizeCommandResult(
  output: string,
  timestamp: string,
  isAdminCommand: boolean
): MinecraftConsoleLine[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '{"output":"\\n","stderr":""}');

  if (lines.length === 0) {
    return isAdminCommand
      ? [
          {
            id: crypto.randomUUID(),
            timestamp,
            kind: "response",
            channel: "RCON",
            text: "Command executed"
          }
        ]
      : [];
  }

  return lines
    .filter((line) => !isHiddenRconNoise(line))
    .map((line) => ({
      id: crypto.randomUUID(),
      timestamp: deriveDisplayTimestamp(line, timestamp),
      kind: "response" as const,
      channel: "RCON" as const,
      text: stripDockerAndMinecraftTimestamps(line)
    }))
    .filter((line) => Boolean(line.text));
}

function deriveDisplayTimestamp(rawLine: string, fallbackTimestamp: string) {
  const embedded = extractEmbeddedMinecraftClock(rawLine);
  if (!embedded) {
    return fallbackTimestamp;
  }

  const base = new Date(fallbackTimestamp);
  if (Number.isNaN(base.getTime())) {
    return fallbackTimestamp;
  }

  base.setUTCHours(embedded.hours, embedded.minutes, embedded.seconds, 0);
  return base.toISOString();
}

function extractEmbeddedMinecraftClock(line: string) {
  const withoutDockerIso = line.replace(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s+/,
    ""
  );
  const match = withoutDockerIso.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
  if (!match) {
    return null;
  }

  return {
    hours: Number.parseInt(match[1] ?? "0", 10),
    minutes: Number.parseInt(match[2] ?? "0", 10),
    seconds: Number.parseInt(match[3] ?? "0", 10)
  };
}

function stripDockerAndMinecraftTimestamps(line: string) {
  return line
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s+/, "")
    .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")
    .trim();
}

function parseMinecraftConsoleLine(line: string): {
  kind: MinecraftConsoleLine["kind"];
  channel: NonNullable<MinecraftConsoleLine["channel"]>;
  text: string;
} | null {
  const match = line.match(/^\[([^\]]+?)\/(INFO|WARN|ERROR)\]:\s*(.*)$/);
  const source = match?.[1] ?? null;
  const level = match?.[2] ?? null;
  const message = (match?.[3] ?? line).trim();

  if (!message || isHiddenRconNoise(message)) {
    return null;
  }

  if (isChatLine(message)) {
    return { kind: "logs", channel: "CHAT", text: message };
  }

  if (level === "ERROR") {
    return { kind: "error", channel: "ERROR", text: message };
  }

  if (level === "WARN") {
    return { kind: "logs", channel: "WARN", text: message };
  }

  if (source?.includes("RCON")) {
    return { kind: "response", channel: "RCON", text: message };
  }

  return { kind: "logs", channel: "SERVER", text: message };
}

function isChatLine(message: string) {
  return (
    / joined the game$/i.test(message) ||
    / left the game$/i.test(message) ||
    /^<[^>]+> /.test(message)
  );
}

function isHiddenRconNoise(message: string) {
  return (
    /^Thread RCON Client .* started$/i.test(message) ||
    /^Thread RCON Client .* shutting down$/i.test(message) ||
    /^Thread RCON Listener started$/i.test(message) ||
    /^Thread RCON Listener .* started$/i.test(message) ||
    /^RCON running on /.test(message)
  );
}

function isStoppedLifecycleMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === "server stopped" || normalized === "server marked as stopped";
}

function isPlayerActivityLine(message: string) {
  const sanitized = stripDockerAndMinecraftTimestamps(message);
  return / joined the game$/i.test(sanitized) || / left the game$/i.test(sanitized);
}
