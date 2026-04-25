"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ADMIN_API_BASE_URL } from "@/lib/api/admin-api";
import type {
  CreateMinecraftServerPayload,
  CreateMinecraftServerResult,
  MinecraftDifficulty,
  MinecraftGameMode,
  MinecraftOperationResponse,
  MinecraftServerWithWorkload,
  MinecraftTemplate
} from "@/types/admin";

type HttpMethod = "GET" | "POST" | "DELETE";

interface Operation {
  id: string;
  timestamp: string;
  method: HttpMethod;
  path: string;
  status: number | null;
  payload: unknown;
  response: unknown;
  error: string | null;
  durationMs: number;
}

interface ConsoleLine {
  id: string;
  timestamp: string;
  kind: "command" | "response" | "logs" | "info" | "error";
  text: string;
}

interface CreateFormState {
  name: string;
  templateId: string;
  version: string;
  motd: string;
  difficulty: MinecraftDifficulty | "";
  gameMode: MinecraftGameMode | "";
  maxPlayers: string;
  cpu: string;
  ramMb: string;
  diskGb: string;
  eula: boolean;
}

const REFRESH_MS = 10_000;
const MAX_OPERATIONS = 30;

const DIFFICULTIES: MinecraftDifficulty[] = ["peaceful", "easy", "normal", "hard"];
const GAME_MODES: MinecraftGameMode[] = ["survival", "creative", "adventure", "spectator"];

export function PlaygroundClient() {
  const searchParams = useSearchParams();
  const initialServerId = searchParams.get("server");

  const [templates, setTemplates] = useState<MinecraftTemplate[]>([]);
  const [servers, setServers] = useState<MinecraftServerWithWorkload[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateFormState>(emptyForm());
  const [actionPending, setActionPending] = useState<Record<string, boolean>>({});
  const [consoleServerId, setConsoleServerId] = useState<string | null>(initialServerId);
  const [commandInput, setCommandInput] = useState("");
  const [consoleOutput, setConsoleOutput] = useState<ConsoleLine[]>([]);
  const [consoleBusy, setConsoleBusy] = useState(false);
  const latestOpId = useRef<string | null>(null);

  const callApi = useCallback(
    async <T,>(method: HttpMethod, path: string, payload?: unknown): Promise<T | null> => {
      const startedAt = performance.now();
      const opId = `op-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      let status: number | null = null;
      let response: unknown = null;
      let error: string | null = null;

      try {
        const init: RequestInit = {
          method,
          credentials: "include",
          headers: { "content-type": "application/json" }
        };
        if (payload !== undefined) {
          init.body = JSON.stringify(payload);
        }

        const res = await fetch(`${ADMIN_API_BASE_URL}${path}`, init);
        status = res.status;

        if (res.status !== 204) {
          const text = await res.text();
          if (text.length > 0) {
            try {
              response = JSON.parse(text);
            } catch {
              response = text;
            }
          }
        }

        if (!res.ok) {
          const message =
            response && typeof response === "object" && "error" in response
              ? String((response as { error: unknown }).error)
              : `HTTP ${res.status}`;
          error = message;
          return null;
        }

        return response as T;
      } catch (err) {
        error = err instanceof Error ? err.message : "Unknown error";
        return null;
      } finally {
        const durationMs = Math.round(performance.now() - startedAt);
        const op: Operation = {
          id: opId,
          timestamp: new Date().toISOString(),
          method,
          path,
          status,
          payload,
          response,
          error,
          durationMs
        };
        latestOpId.current = opId;
        setOperations((current) => [op, ...current].slice(0, MAX_OPERATIONS));
      }
    },
    []
  );

  const refreshTemplates = useCallback(async () => {
    const data = await callApi<{ templates: MinecraftTemplate[] }>(
      "GET",
      "/minecraft/templates"
    );
    if (data) {
      setTemplates(data.templates);
      setForm((prev) => {
        if (prev.templateId || data.templates.length === 0) return prev;
        return { ...prev, templateId: data.templates[0].id };
      });
    }
  }, [callApi]);

  const refreshServers = useCallback(async () => {
    const data = await callApi<{ servers: MinecraftServerWithWorkload[] }>(
      "GET",
      "/minecraft/servers"
    );
    if (data) {
      setServers(data.servers);
    }
  }, [callApi]);

  useEffect(() => {
    (async () => {
      await Promise.all([refreshTemplates(), refreshServers()]);
      setLoading(false);
    })();

    const timer = setInterval(() => {
      void refreshServers();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshTemplates, refreshServers]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === form.templateId) ?? null,
    [templates, form.templateId]
  );

  const handleCreate = async () => {
    if (!form.name.trim() || !form.templateId || !form.eula) return;
    setCreating(true);
    try {
      const payload: CreateMinecraftServerPayload = {
        name: form.name.trim(),
        templateId: form.templateId,
        eula: true
      };
      if (form.version) payload.version = form.version;
      if (form.motd) payload.motd = form.motd;
      if (form.difficulty) payload.difficulty = form.difficulty;
      if (form.gameMode) payload.gameMode = form.gameMode;
      if (form.maxPlayers) payload.maxPlayers = Number(form.maxPlayers);
      if (form.cpu) payload.cpu = Number(form.cpu);
      if (form.ramMb) payload.ramMb = Number(form.ramMb);
      if (form.diskGb) payload.diskGb = Number(form.diskGb);

      const result = await callApi<CreateMinecraftServerResult>(
        "POST",
        "/minecraft/servers",
        payload
      );
      if (result) {
        setForm(emptyForm(form.templateId));
        await refreshServers();
      }
    } finally {
      setCreating(false);
    }
  };

  const setServerPending = (id: string, pending: boolean) =>
    setActionPending((current) => ({ ...current, [id]: pending }));

  const handleAction = async (id: string, action: "start" | "stop" | "restart") => {
    setServerPending(id, true);
    try {
      await callApi("POST", `/minecraft/servers/${id}/${action}`);
      await refreshServers();
    } finally {
      setServerPending(id, false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete Minecraft server "${name}"? This is irreversible.`)) return;
    setServerPending(id, true);
    try {
      await callApi("DELETE", `/minecraft/servers/${id}`);
      await refreshServers();
    } finally {
      setServerPending(id, false);
    }
  };

  const errorOps = operations.filter((op) => op.error !== null);
  const latestOp = operations[0] ?? null;

  const consoleServer = useMemo(
    () => servers.find((entry) => entry.server.id === consoleServerId) ?? null,
    [servers, consoleServerId]
  );
  const consoleReady = consoleServer?.workload.status === "running";

  const appendConsoleLines = useCallback(
    (lines: Array<Omit<ConsoleLine, "id" | "timestamp">>) => {
      const ts = new Date().toISOString();
      setConsoleOutput((current) => {
        const next = [
          ...current,
          ...lines.map((line, idx) => ({
            id: `${ts}-${idx}-${Math.random().toString(16).slice(2, 8)}`,
            timestamp: ts,
            ...line
          }))
        ];
        return next.slice(-500);
      });
    },
    []
  );

  const handleConsoleCommand = async () => {
    if (!consoleServerId || !commandInput.trim() || !consoleReady) return;
    const command = commandInput.trim();
    setCommandInput("");
    appendConsoleLines([{ kind: "command", text: `> ${command}` }]);
    setConsoleBusy(true);
    try {
      const result = await callApi<MinecraftOperationResponse>(
        "POST",
        `/minecraft/servers/${consoleServerId}/command`,
        { command }
      );
      if (!result) {
        appendConsoleLines([{ kind: "error", text: "Command request failed." }]);
        return;
      }
      const final = await waitForOperation(consoleServerId, result);
      handleOperationResult(final, "command");
    } finally {
      setConsoleBusy(false);
    }
  };

  const handleConsoleSave = async () => {
    if (!consoleServerId || !consoleReady) return;
    appendConsoleLines([{ kind: "command", text: "> save-all flush" }]);
    setConsoleBusy(true);
    try {
      const result = await callApi<MinecraftOperationResponse>(
        "POST",
        `/minecraft/servers/${consoleServerId}/save`
      );
      if (!result) {
        appendConsoleLines([{ kind: "error", text: "Save request failed." }]);
        return;
      }
      const final = await waitForOperation(consoleServerId, result);
      handleOperationResult(final, "save");
    } finally {
      setConsoleBusy(false);
    }
  };

  const handleConsoleLogs = async () => {
    if (!consoleServerId || !consoleReady) return;
    appendConsoleLines([{ kind: "info", text: "fetching last 200 log lines..." }]);
    setConsoleBusy(true);
    try {
      const result = await callApi<MinecraftOperationResponse>(
        "GET",
        `/minecraft/servers/${consoleServerId}/logs?tail=200`
      );
      if (!result) {
        appendConsoleLines([{ kind: "error", text: "Logs request failed." }]);
        return;
      }
      const final = await waitForOperation(consoleServerId, result);
      handleOperationResult(final, "logs");
    } finally {
      setConsoleBusy(false);
    }
  };

  const waitForOperation = async (
    serverId: string,
    initial: MinecraftOperationResponse
  ): Promise<MinecraftOperationResponse> => {
    let current = initial;
    const deadline = Date.now() + 30_000;
    while (current.pending && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const next = await callApi<MinecraftOperationResponse>(
        "GET",
        `/minecraft/servers/${serverId}/operations/${current.operation.id}`
      );
      if (!next) break;
      current = next;
    }
    return current;
  };

  const handleOperationResult = (
    response: MinecraftOperationResponse,
    kind: "command" | "save" | "logs"
  ) => {
    const op = response.operation;
    if (response.pending) {
      appendConsoleLines([{ kind: "info", text: "operation still pending after timeout." }]);
      return;
    }
    if (op.status === "failed") {
      appendConsoleLines([
        { kind: "error", text: op.error ?? "operation failed" }
      ]);
      return;
    }
    if (kind === "logs") {
      const rawLines = (op.result?.lines as string[] | undefined) ?? [];
      if (rawLines.length === 0) {
        appendConsoleLines([{ kind: "info", text: "(no log output)" }]);
        return;
      }
      appendConsoleLines(rawLines.map((text) => ({ kind: "logs", text })));
      return;
    }
    const output = (op.result?.output as string | undefined) ?? "";
    const stderr = (op.result?.stderr as string | undefined) ?? "";
    const lines: Array<{ kind: ConsoleLine["kind"]; text: string }> = [];
    if (output.trim()) {
      for (const line of output.split(/\r?\n/)) {
        if (line.length > 0) lines.push({ kind: "response", text: line });
      }
    }
    if (stderr.trim()) {
      for (const line of stderr.split(/\r?\n/)) {
        if (line.length > 0) lines.push({ kind: "error", text: line });
      }
    }
    if (lines.length === 0) {
      lines.push({ kind: "info", text: "(no output)" });
    }
    appendConsoleLines(lines);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/70 p-6 shadow-soft">
        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Internal tool</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-white">
          Minecraft playground
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Create, control and inspect Minecraft servers end-to-end. All calls hit the live
          control plane at <span className="font-mono text-xs text-slate-300">{ADMIN_API_BASE_URL}</span>.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Templates</h2>
            <button
              type="button"
              onClick={() => void refreshTemplates()}
              className="text-xs text-slate-400 hover:text-white"
            >
              Refresh
            </button>
          </header>

          <div className="mt-3 space-y-2">
            {loading && templates.length === 0 ? (
              <p className="text-sm text-slate-500">Loading templates...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-slate-500">No templates returned.</p>
            ) : (
              templates.map((template) => {
                const active = form.templateId === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, templateId: template.id }))}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-accent/40 bg-accent/[0.08]"
                        : "border-white/10 bg-white/[0.025] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">
                        {template.displayName}
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                        {template.family}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{template.description}</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-500">
                      default {template.defaultVersion} · {template.defaults.cpu} CPU ·{" "}
                      {template.defaults.ramMb} MB · {template.defaults.diskGb} GB
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <h2 className="text-sm font-semibold text-white">Create server</h2>
          <p className="mt-1 text-xs text-slate-500">
            Blank fields fall back to template defaults on the server side.
          </p>

          <div className="mt-4 grid gap-3">
            <TextField
              label="Name"
              value={form.name}
              onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
              placeholder="nebula-smp"
            />

            <SelectField
              label="Version"
              value={form.version}
              onChange={(value) => setForm((prev) => ({ ...prev, version: value }))}
              options={[
                { value: "", label: selectedTemplate ? `Default (${selectedTemplate.defaultVersion})` : "Default" },
                ...(selectedTemplate?.supportedVersions.map((v) => ({ value: v, label: v })) ?? [])
              ]}
            />

            <TextField
              label="MOTD"
              value={form.motd}
              onChange={(value) => setForm((prev) => ({ ...prev, motd: value }))}
              placeholder="optional"
            />

            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Difficulty"
                value={form.difficulty}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    difficulty: (value || "") as MinecraftDifficulty | ""
                  }))
                }
                options={[
                  { value: "", label: "Default (normal)" },
                  ...DIFFICULTIES.map((d) => ({ value: d, label: d }))
                ]}
              />
              <SelectField
                label="Game mode"
                value={form.gameMode}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    gameMode: (value || "") as MinecraftGameMode | ""
                  }))
                }
                options={[
                  { value: "", label: "Default (survival)" },
                  ...GAME_MODES.map((m) => ({ value: m, label: m }))
                ]}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Max players"
                value={form.maxPlayers}
                onChange={(value) => setForm((prev) => ({ ...prev, maxPlayers: value }))}
                placeholder="20"
                inputMode="numeric"
              />
              <TextField
                label="CPU"
                value={form.cpu}
                onChange={(value) => setForm((prev) => ({ ...prev, cpu: value }))}
                placeholder={selectedTemplate ? String(selectedTemplate.defaults.cpu) : "2"}
                inputMode="decimal"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="RAM (MB)"
                value={form.ramMb}
                onChange={(value) => setForm((prev) => ({ ...prev, ramMb: value }))}
                placeholder={selectedTemplate ? String(selectedTemplate.defaults.ramMb) : "4096"}
                inputMode="numeric"
              />
              <TextField
                label="Disk (GB)"
                value={form.diskGb}
                onChange={(value) => setForm((prev) => ({ ...prev, diskGb: value }))}
                placeholder={selectedTemplate ? String(selectedTemplate.defaults.diskGb) : "10"}
                inputMode="numeric"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={form.eula}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, eula: event.target.checked }))
                }
                className="h-4 w-4 rounded border-white/20 bg-white/10 accent-accent"
              />
              I accept the{" "}
              <a
                href="https://www.minecraft.net/en-us/eula"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Minecraft EULA
              </a>
            </label>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={
                creating ||
                !form.name.trim() ||
                !form.templateId ||
                !form.eula
              }
              className="mt-2 h-10 rounded-xl bg-accent/80 px-4 text-sm font-semibold text-obsidian transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? "Creating..." : "Create Minecraft server"}
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-panel/78 shadow-soft">
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Servers ({servers.length})</h2>
          <button
            type="button"
            onClick={() => void refreshServers()}
            className="text-xs text-slate-400 hover:text-white"
          >
            Refresh
          </button>
        </header>

        {loading && servers.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Loading servers...</p>
        ) : servers.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No Minecraft server yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Template</th>
                  <th className="px-5 py-3">Node</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Desired</th>
                  <th className="px-5 py-3">Port</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {servers.map(({ server, workload }) => {
                  const port = workload.ports.find((p) => p.internalPort === 25565);
                  const pending = actionPending[server.id] ?? false;
                  return (
                    <tr key={server.id} className="border-t border-white/5">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-white">{server.name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{server.slug}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p>{server.templateId}</p>
                        <p className="text-xs text-slate-500">v{server.minecraftVersion}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-slate-300">
                          {workload.nodeId ?? "Unassigned"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill value={workload.status} />
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs text-slate-300">{workload.desiredStatus}</span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">
                        {port ? `${port.externalPort} → 25565/tcp` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          <ActionButton
                            label="Start"
                            onClick={() => void handleAction(server.id, "start")}
                            disabled={pending || workload.desiredStatus === "running"}
                          />
                          <ActionButton
                            label="Stop"
                            onClick={() => void handleAction(server.id, "stop")}
                            disabled={pending || workload.desiredStatus === "stopped"}
                          />
                          <ActionButton
                            label="Restart"
                            onClick={() => void handleAction(server.id, "restart")}
                            disabled={pending}
                          />
                          <ActionButton
                            label="Delete"
                            tone="danger"
                            onClick={() => void handleDelete(server.id, server.name)}
                            disabled={pending}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Console</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Send RCON commands, save the world, or fetch the last log lines. Routes to the
              agent over a private channel — no port exposed.
            </p>
          </div>
          <select
            value={consoleServerId ?? ""}
            onChange={(event) => {
              setConsoleServerId(event.target.value || null);
              setConsoleOutput([]);
            }}
            className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-xs text-slate-200 outline-none focus:border-accent/40"
          >
            <option value="">Select a server…</option>
            {servers.map(({ server, workload }) => (
              <option key={server.id} value={server.id}>
                {server.name} ({workload.status})
              </option>
            ))}
          </select>
        </header>

        {consoleServer ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <ActionButton
                label="Save world"
                onClick={() => void handleConsoleSave()}
                disabled={consoleBusy || !consoleReady}
              />
              <ActionButton
                label="Fetch logs"
                onClick={() => void handleConsoleLogs()}
                disabled={consoleBusy || !consoleReady}
              />
              <ActionButton
                label="Clear"
                onClick={() => setConsoleOutput([])}
                disabled={consoleOutput.length === 0}
              />
              {!consoleReady ? (
                <span className="ml-auto text-[11px] text-amber-300">
                  Server status: {consoleServer.workload.status}. Console requires a running server.
                </span>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[12px]">
              {consoleOutput.length === 0 ? (
                <p className="text-slate-600">No output yet.</p>
              ) : (
                consoleOutput.map((line) => (
                  <p
                    key={line.id}
                    className={
                      line.kind === "error"
                        ? "text-red-300"
                        : line.kind === "command"
                        ? "text-accent"
                        : line.kind === "info"
                        ? "text-slate-500"
                        : line.kind === "logs"
                        ? "text-slate-300"
                        : "text-emerald-200"
                    }
                  >
                    {line.text}
                  </p>
                ))
              )}
            </div>

            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleConsoleCommand();
              }}
            >
              <input
                value={commandInput}
                onChange={(event) => setCommandInput(event.target.value)}
                placeholder={consoleReady ? "say hello" : "server is not running"}
                disabled={consoleBusy || !consoleReady}
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 font-mono text-sm text-white outline-none focus:border-accent/40 disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={consoleBusy || !consoleReady || !commandInput.trim()}
                className="h-10 rounded-lg bg-accent/80 px-4 text-xs font-semibold text-obsidian transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {consoleBusy ? "..." : "Send"}
              </button>
            </form>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Pick a server above to open its console.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <h2 className="text-sm font-semibold text-white">Last request</h2>
          {latestOp ? (
            <OperationCard operation={latestOp} />
          ) : (
            <p className="mt-3 text-sm text-slate-500">No request yet.</p>
          )}

          <details className="mt-4 group">
            <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-white">
              History ({operations.length})
            </summary>
            <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-2">
              {operations.slice(1).map((op) => (
                <OperationCard key={op.id} operation={op} compact />
              ))}
            </div>
          </details>
        </section>

        <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <h2 className="text-sm font-semibold text-white">
            Error log ({errorOps.length})
          </h2>
          {errorOps.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No errors recorded.</p>
          ) : (
            <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-2 text-xs">
              {errorOps.map((op) => (
                <li
                  key={op.id}
                  className="rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-2 font-mono text-red-200"
                >
                  <p className="text-[10px] uppercase tracking-wider text-red-300/80">
                    {new Date(op.timestamp).toLocaleTimeString()} · {op.method} {op.path}
                    {op.status !== null ? ` · ${op.status}` : ""}
                  </p>
                  <p className="mt-1 break-all">{op.error}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function emptyForm(templateId = ""): CreateFormState {
  return {
    name: "",
    templateId,
    version: "",
    motd: "",
    difficulty: "",
    gameMode: "",
    maxPlayers: "",
    cpu: "",
    ramMb: "",
    diskGb: "",
    eula: false
  };
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  inputMode
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate-200 outline-none focus:border-accent/40"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  tone = "neutral"
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  const base =
    "h-8 rounded-md border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
  const tones =
    tone === "danger"
      ? "border-red-500/30 bg-red-500/10 text-red-200 hover:border-red-400/50 hover:bg-red-500/20"
      : "border-white/10 bg-white/[0.035] text-slate-200 hover:border-white/20 hover:bg-white/[0.07]";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tones}`}>
      {label}
    </button>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone =
    value === "running"
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      : value === "crashed"
      ? "text-red-300 border-red-500/30 bg-red-500/10"
      : value === "creating" || value === "pending"
      ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
      : "text-slate-300 border-white/15 bg-white/[0.035]";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {value}
    </span>
  );
}

function OperationCard({ operation, compact }: { operation: Operation; compact?: boolean }) {
  return (
    <div
      className={`mt-3 rounded-lg border px-3 py-2 font-mono text-xs ${
        operation.error
          ? "border-red-500/25 bg-red-500/[0.04]"
          : "border-white/10 bg-white/[0.025]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
        <span className="text-slate-300">{operation.method}</span>
        <span>{operation.path}</span>
        <span>·</span>
        <span>{operation.status ?? "—"}</span>
        <span>·</span>
        <span>{operation.durationMs}ms</span>
        <span>·</span>
        <span>{new Date(operation.timestamp).toLocaleTimeString()}</span>
      </div>
      {operation.error ? (
        <p className="mt-2 break-all text-red-300">{operation.error}</p>
      ) : null}
      {!compact && operation.payload !== undefined ? (
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Payload</p>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/50 p-2 text-[11px] text-slate-200">
            {safeStringify(operation.payload)}
          </pre>
        </div>
      ) : null}
      {!compact && operation.response !== null ? (
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Response</p>
          <pre className="mt-1 max-h-72 overflow-auto rounded bg-black/50 p-2 text-[11px] text-slate-200">
            {safeStringify(operation.response)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
