"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_API_BASE_URL, adminApi } from "@/lib/api/admin-api";
import { MinecraftConsole, type MinecraftConsoleLine } from "@/components/playground/MinecraftConsole";
import type { MinecraftServerWithWorkload } from "@/types/admin";

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
  const [reconnectToken, setReconnectToken] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  const appendLines = useCallback(
    (
      incoming: Array<{ timestamp: string; kind: MinecraftConsoleLine["kind"]; text: string }>
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
          appendLines(payload.line.split(/\r?\n/).filter(Boolean).map((text) => ({
            timestamp,
            kind: "logs" as const,
            text
          })));
        } else if (payload.type === "status") {
          appendLines([{ timestamp, kind: "info", text: `status: ${payload.status}` }]);
          void onRefresh();
        } else if (payload.type === "command_result") {
          const output = payload.output.trim().length > 0 ? payload.output : "(no output)";
          appendLines(output.split(/\r?\n/).map((text) => ({
            timestamp,
            kind: "response" as const,
            text
          })));
          void onRefresh();
        } else if (payload.type === "error") {
          appendLines([{ timestamp, kind: "error", text: payload.message }]);
          void onRefresh();
        }
      } catch {
        appendLines([
          {
            timestamp: new Date().toISOString(),
            kind: "error",
            text: "Invalid console payload received."
          }
        ]);
      }
    });

    socket.addEventListener("open", () => {
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "info",
          text: `console attached to ${entry.server.name}`
        }
      ]);
    });

    socket.addEventListener("close", () => {
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "info",
          text: "console disconnected"
        }
      ]);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [appendLines, entry.server.id, entry.server.name, onRefresh, reconnectToken, wsUrl]);

  const sendMessage = (payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "error",
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
      appendLines([
        {
          timestamp: new Date().toISOString(),
          kind: "command",
          text: `> ${command}`
        }
      ]);
      setCommandInput("");
    }
  };

  const handleSave = () => {
    sendMessage({ type: "action", action: "save-all" });
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      sendMessage({ type: "action", action: "stop" });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setBusy(true);
    try {
      await adminApi.restartMinecraftServer(entry.server.id);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleReconnectLogs = () => {
    setReconnectToken((current) => current + 1);
  };

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
      busy={busy}
      operatorLabel="admin"
    />
  );
}
