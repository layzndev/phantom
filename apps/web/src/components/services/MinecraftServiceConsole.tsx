"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_API_BASE_URL, adminApi } from "@/lib/api/admin-api";
import { MinecraftConsole, type MinecraftConsoleLine } from "@/components/playground/MinecraftConsole";
import type { MinecraftServerWithWorkload } from "@/types/admin";

const RECONNECT_DELAY_MS = 2_000;

export function MinecraftServiceConsole({
  entry,
  onRefresh
}: {
  entry: MinecraftServerWithWorkload;
  onRefresh: () => Promise<void> | void;
}) {
  const [lines, setLines] = useState<MinecraftConsoleLine[]>([]);
  const [commandInput, setCommandInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "reconnecting"
  >("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const manuallyClosedRef = useRef(false);
  const commandHistoryRef = useRef(new Set<string>());

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
      setLines((current) =>
        [...current, ...incoming.map((line, index) => ({
          id: `${line.timestamp}-${index}-${Math.random().toString(16).slice(2, 8)}`,
          ...line
        }))].slice(-500)
      );
    },
    []
  );

  const wsUrl = useMemo(() => {
    const base = new URL(ADMIN_API_BASE_URL);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `/runtime/minecraft/servers/${entry.server.id}/console`;
    base.search = "";
    return base.toString();
  }, [entry.server.id]);

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
      setConnectionState((current) =>
        current === "connected" ? "connected" : current === "disconnected" ? "reconnecting" : "connecting"
      );

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as
            | { type: "log"; line: string }
            | { type: "status"; status: string }
            | { type: "command_result"; id: string; output: string }
            | { type: "error"; message: string };

          const timestamp = new Date().toISOString();
          if (payload.type === "log") {
            appendLines(
              payload.line
                .split(/\r?\n/)
                .flatMap((text) => normalizeConsoleLogLine(text, timestamp))
            );
          } else if (payload.type === "status") {
            appendLines([
              {
                timestamp,
                kind: "info",
                channel: "PHANTOM",
                text: describeStatusTransition(payload.status)
              }
            ]);
            void onRefresh();
          } else if (payload.type === "command_result") {
            const isAdminCommand = commandHistoryRef.current.has(payload.id);
            commandHistoryRef.current.delete(payload.id);
            appendLines(normalizeCommandResult(payload.output, timestamp, isAdminCommand));
            void onRefresh();
          } else if (payload.type === "error") {
            appendLines([{ timestamp, kind: "error", channel: "ERROR", text: payload.message }]);
            void onRefresh();
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
        appendLines([
          {
            timestamp: new Date().toISOString(),
            kind: "info",
            channel: "PHANTOM",
            text: "Connected"
          }
        ]);
      });

      socket.addEventListener("close", () => {
        socketRef.current = null;
        if (!shouldReconnectRef.current || manuallyClosedRef.current) {
          setConnectionState("disconnected");
          appendLines([
            {
              timestamp: new Date().toISOString(),
              kind: "info",
              channel: "PHANTOM",
              text: "Console disconnected"
            }
          ]);
          return;
        }

        setConnectionState("reconnecting");
        appendLines([
          {
            timestamp: new Date().toISOString(),
            kind: "info",
            channel: "PHANTOM",
            text: `Console disconnected, retrying in ${RECONNECT_DELAY_MS / 1000}s`
          }
        ]);
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      });

      socket.addEventListener("error", () => {
        appendLines([
          {
            timestamp: new Date().toISOString(),
            kind: "error",
            channel: "ERROR",
            text: "WebSocket error"
          }
        ]);
      });
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      manuallyClosedRef.current = true;
      clearReconnectTimer();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [appendLines, entry.server.id, entry.server.name, onRefresh, wsUrl]);

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

  const handleSubmit = () => {
    const command = commandInput.trim();
    if (!command) {
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

  const handleSave = () => {
    appendLines([
      {
        timestamp: new Date().toISOString(),
        kind: "info",
        channel: "PHANTOM",
        text: "Saving world..."
      }
    ]);
    sendMessage({ type: "action", action: "save-all" });
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "info",
          channel: "PHANTOM",
          text: "Stopping server..."
        }
      ]);
      sendMessage({ type: "action", action: "stop" });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setBusy(true);
    try {
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "info",
          channel: "PHANTOM",
          text: "Restarting server..."
        }
      ]);
      await adminApi.restartMinecraftServer(entry.server.id);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleReconnectLogs = () => {
    manuallyClosedRef.current = false;
    shouldReconnectRef.current = true;
    socketRef.current?.close();
  };

  const derivedBusy = busy || connectionState === "connecting" || connectionState === "reconnecting";

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
      onSave={handleSave}
      onFetchLogs={handleReconnectLogs}
      onRestart={() => void handleRestart()}
      onStop={() => void handleStop()}
      onClear={() => setLines([])}
      busy={derivedBusy}
      operatorLabel="admin"
      phantomIdentity={phantomIdentity}
    />
  );
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
    return [
      {
        id: crypto.randomUUID(),
        timestamp,
        kind: "info",
        channel: "PHANTOM",
        text: line.slice("__PHANTOM__ ".length)
      }
    ];
  }

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
      timestamp,
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
      timestamp,
      kind: "response" as const,
      channel: "RCON" as const,
      text: stripDockerAndMinecraftTimestamps(line)
    }))
    .filter((line) => Boolean(line.text));
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

function describeStatusTransition(status: string) {
  switch (status) {
    case "running":
      return "Server marked as running";
    case "stopped":
      return "Server marked as stopped";
    case "creating":
      return "Starting container";
    case "crashed":
      return "Server crashed";
    default:
      return `Status changed: ${status}`;
  }
}
