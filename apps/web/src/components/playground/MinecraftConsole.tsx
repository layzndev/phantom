"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MinecraftServerWithWorkload } from "@/types/admin";

export type ConsoleLineKind =
  | "command"
  | "response"
  | "logs"
  | "info"
  | "error"
  | "divider";

export interface MinecraftConsoleLine {
  id: string;
  timestamp: string;
  kind: ConsoleLineKind;
  text: string;
  channel?: "SERVER" | "CHAT" | "WARN" | "ERROR" | "RCON" | "ADMIN" | "PHANTOM";
}

interface MinecraftConsoleProps {
  entry: MinecraftServerWithWorkload | null;
  servers: MinecraftServerWithWorkload[];
  selectedServerId: string | null;
  onSelectServer: (id: string | null) => void;
  lines: MinecraftConsoleLine[];
  commandInput: string;
  onCommandInputChange: (value: string) => void;
  onCommandSubmit: () => void;
  onStart: () => void;
  onRestart: () => void;
  onStop: () => void;
  busy: boolean;
  actionState?: "start" | "stop" | "restart" | null;
  operatorLabel?: string;
  phantomIdentity?: string;
  activeTab?: "console" | "files" | "settings";
  onTabChange?: (tab: "console" | "files" | "settings") => void;
  filesContent?: ReactNode;
  settingsContent?: ReactNode;
}

const TABS = [
  { value: "console", label: "Console" },
  { value: "files", label: "Files" },
  { value: "settings", label: "Settings" }
] as const;

export function MinecraftConsole({
  entry,
  servers,
  selectedServerId,
  onSelectServer,
  lines,
  commandInput,
  onCommandInputChange,
  onCommandSubmit,
  onStart,
  onRestart,
  onStop,
  busy,
  actionState = null,
  operatorLabel = "operator",
  phantomIdentity = "phantom@system~",
  activeTab = "console",
  onTabChange,
  filesContent,
  settingsContent
}: MinecraftConsoleProps) {
  const consoleReady = entry?.server.runtimeState === "running" && Boolean(entry?.server.readyAt);
  const singleServerView = servers.length <= 1;

  const startedAtMs = useMemo(() => {
    // Anchor uptime on the moment "Server marked as running" was emitted
    // (server.readyAt), not on the container boot timestamp.
    if (!entry || !entry.server.readyAt) return null;
    return new Date(entry.server.readyAt).getTime();
  }, [entry]);

  const finishedAtMs = useMemo(() => {
    if (!entry || !entry.workload.runtimeFinishedAt) return null;
    return new Date(entry.workload.runtimeFinishedAt).getTime();
  }, [entry]);

  const uptimeLabel = useUptime(startedAtMs, finishedAtMs, consoleReady);

  const externalPort = useMemo(() => {
    if (!entry) return null;
    return entry.workload.ports.find((port) => port.internalPort === 25565)?.externalPort ?? null;
  }, [entry]);

  const diskAllocGb = entry?.workload.requestedDiskGb ?? 0;
  const diskUsedGb = entry?.workload.runtimeDiskGb ?? null;
  const cpuLabel = entry ? `${entry.workload.requestedCpu} vCPU` : "— vCPU";
  const ramLabel = entry ? `${entry.workload.requestedRamMb} MB` : "— MB";
  const diskLabel =
    diskUsedGb !== null ? `${formatDiskGb(diskUsedGb)} / ${formatDiskGb(diskAllocGb)}` : formatDiskGb(diskAllocGb);
  const addressLabel = externalPort ? `:${externalPort}` : "—";
  const canSwitchTabs = Boolean(onTabChange);
  const runtimeState = entry?.server.runtimeState;
  const isStoppedState = runtimeState === "stopped";
  const showStartingBadge =
    actionState === "start" || (runtimeState === "starting" && !consoleReady);
  const showStoppingBadge =
    actionState === "stop" || runtimeState === "stopping";
  // Strict per-state gating so transient states do not allow conflicting actions.
  // Stop is intentionally NOT available while starting/waking — users must
  // wait for the server to be ready before they can stop it.
  const canStart = !!entry && ["stopped", "crashed", "error"].includes(runtimeState ?? "");
  const canRestart = !!entry && runtimeState === "running";
  const canStop = !!entry && ["running", "restarting", "stopping"].includes(runtimeState ?? "");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  const renderedLines = lines.length === 0 && entry
    ? [welcomeLine(entry)]
    : lines;
  const lastStoppedDividerIndex = findLastStoppedDividerIndex(renderedLines);
  const showVirtualStoppedDivider = Boolean(entry && isStoppedState && lastStoppedDividerIndex === -1);
  const staleLineCutoff = showVirtualStoppedDivider
    ? renderedLines.length
    : lastStoppedDividerIndex;

  return (
    <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="flex items-start gap-3">
          <PhantomMark />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-extrabold tracking-tight text-white">
                {entry ? entry.server.name : "No server selected"}
              </h2>
              <span
                className={`h-2 w-2 rounded-full ${
                  consoleReady
                    ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]"
                    : "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.55)]"
                }`}
                aria-hidden="true"
              />
              {entry ? (
                <span className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-300">
                  {entry.server.runtimeState}
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500">
              <span>
                <span className="text-slate-300">Uptime:</span> {uptimeLabel}
              </span>
              <span>·</span>
              <span>
                <span className="text-slate-300">Disk:</span> {diskLabel}
              </span>
              <span>·</span>
              <span className="text-slate-300">{addressLabel}</span>
              {entry ? (
                <>
                  <span>·</span>
                  <span className="text-slate-300">{templateFamilyLabel(entry.server.templateId)}</span>
                  <span>·</span>
                  <span>v{entry.server.minecraftVersion}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          {!singleServerView ? (
            <div className="flex flex-wrap justify-end gap-2 font-mono text-[11px] text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1">
                CPU {cpuLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1">
                RAM {ramLabel}
              </span>
              {externalPort ? (
                <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1">
                  PORT {externalPort}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!singleServerView ? (
              <select
                value={selectedServerId ?? ""}
                onChange={(event) => onSelectServer(event.target.value || null)}
                className="h-9 rounded-md border border-white/10 bg-obsidian px-3 text-xs text-slate-200 outline-none focus:border-accent/40"
              >
                <option value="">Select a server…</option>
                {servers.map(({ server, workload }) => (
                  <option key={server.id} value={server.id}>
                    {server.name} ({workload.status})
                  </option>
                ))}
              </select>
            ) : null}
            {showStartingBadge ? <StartingBadge /> : null}
            {showStoppingBadge ? (
              <div className="inline-flex h-11 items-center gap-3 rounded-xl border border-red-500/45 bg-red-500/[0.06] px-6 text-sm font-semibold text-red-300 shadow-[0_0_30px_rgba(239,68,68,0.08)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-red-500/30 border-t-red-300" />
                Stopping
              </div>
            ) : null}
            {canStart && !showStartingBadge && !showStoppingBadge ? (
              <button
                type="button"
                onClick={onStart}
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] px-4 text-sm font-bold text-emerald-200 transition hover:border-emerald-400/40 hover:bg-emerald-500/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PowerIcon className="h-[15px] w-[15px]" /> Start
              </button>
            ) : null}
            {!canStart && !showStartingBadge && !showStoppingBadge ? (
              <>
                <button
                  type="button"
                  onClick={onRestart}
                  disabled={!canRestart || busy}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.025] px-4 text-sm font-bold text-slate-100 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RestartIcon className="h-[15px] w-[15px]" /> Restart
                </button>
                <button
                  type="button"
                  onClick={onStop}
                  disabled={!canStop || busy}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-red-500/25 bg-red-500/[0.06] px-4 text-sm font-bold text-red-300 transition hover:border-red-400/40 hover:bg-red-500/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PowerIcon className="h-[15px] w-[15px]" /> Stop
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="mt-4 flex gap-6 border-b border-white/10 text-sm font-semibold text-slate-500">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onTabChange?.(tab.value)}
            disabled={!canSwitchTabs}
            className={`relative pb-3 transition disabled:cursor-not-allowed disabled:opacity-60 ${
              activeTab === tab.value
                ? "text-white after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-white"
                : "hover:text-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className={activeTab === "files" ? "mt-4 block" : "hidden"}>
        {filesContent ?? <p className="text-sm text-slate-500">Files panel unavailable.</p>}
      </div>

      <div className={activeTab === "settings" ? "mt-4 block" : "hidden"}>
        {settingsContent ?? <p className="text-sm text-slate-500">Settings panel unavailable.</p>}
      </div>

      <div
        className={`relative mt-4 overflow-hidden border border-white/10 bg-[#070707] shadow-[0_20px_60px_rgba(0,0,0,0.35)] ${
          activeTab === "console" ? "block" : "hidden"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(34,211,238,0.08),transparent_35%)]" />
        <div className="pointer-events-none absolute right-6 top-5 select-none font-mono text-[42px] font-black tracking-[0.22em] text-white/[0.025]">
          PHANTOM
        </div>

        <div
          ref={scrollRef}
          className="relative h-[480px] overflow-y-auto p-4 font-mono text-[13px] leading-6 text-slate-100"
        >
          {!entry ? (
            <p className="text-slate-600">Pick a server to attach the console.</p>
          ) : (
            <>
              {renderedLines.map((line, index) =>
                line.kind === "divider" ? (
                  <ConsoleDivider
                    key={line.id}
                    label={line.text}
                    variant={isStoppedDividerLine(line) ? "stopped" : "default"}
                  />
                ) : (
                  <p
                    key={line.id}
                    className={`whitespace-pre-wrap transition-opacity ${
                      staleLineCutoff >= 0 && index < staleLineCutoff ? "opacity-40 saturate-50" : ""
                    }`}
                  >
                    <span className="text-slate-500">[{formatClock(line.timestamp)} </span>
                    <span className={sourceTone(line.kind, line.channel)}>
                      {lineSource(line.kind, operatorLabel, line.channel)}
                    </span>
                    <span className="text-slate-500">] </span>
                    <span className={lineTone(line.kind, line.channel)}>
                      {line.channel === "PHANTOM" ? `${phantomIdentity} ${line.text}` : line.text}
                    </span>
                  </p>
                )
              )}
              {showVirtualStoppedDivider ? <ConsoleDivider label="Server stopped" variant="stopped" /> : null}
            </>
          )}
          {entry ? (
            <span
              className={`absolute bottom-4 right-4 h-2 w-2 rounded-full ${
                consoleReady
                  ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.75)]"
                  : "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.55)]"
              }`}
            />
          ) : null}
        </div>

        <form
          className={`relative flex h-11 items-center gap-3 border-t border-white/10 px-4 font-mono text-sm transition ${
            isStoppedState ? "bg-white/[0.03]" : "bg-white/[0.055]"
          }`}
          onSubmit={(event) => {
            event.preventDefault();
            onCommandSubmit();
          }}
        >
          <span className="text-cyan-300">{operatorLabel}</span>
          <span className="text-slate-500">\</span>
          <span className="text-slate-500">$</span>
          <input
            value={commandInput}
            onChange={(event) => onCommandInputChange(event.target.value)}
            placeholder={consoleReady ? "Enter command..." : "server is not ready"}
            disabled={!consoleReady || busy}
            className="min-w-0 flex-1 bg-transparent text-slate-200 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!consoleReady || busy || !commandInput.trim()}
            className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300 transition hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}

function templateFamilyLabel(templateId: string) {
  const family = templateId.split("-")[0] ?? templateId;
  if (!family) return templateId;
  return family.charAt(0).toUpperCase() + family.slice(1);
}

function StartingBadge() {
  // Read-only progress indicator — clicks must NOT cancel the start.
  return (
    <div
      role="status"
      aria-label="Server is starting"
      className="inline-flex h-11 items-center gap-3 rounded-xl border border-amber-500/45 bg-amber-500/[0.06] px-6 text-sm font-semibold text-amber-300 shadow-[0_0_30px_rgba(245,158,11,0.08)]"
    >
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-300" />
      Starting
    </div>
  );
}

function ConsoleDivider({
  label,
  variant = "default"
}: {
  label: string;
  variant?: "default" | "stopped";
}) {
  if (variant === "stopped") {
    return (
      <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-white/12" />
        <span className="shrink-0 font-medium">{label}</span>
        <span className="h-px flex-1 bg-white/12" />
      </div>
    );
  }

  return (
    <div className="my-5 flex items-center gap-4">
      <div className="h-px flex-1 bg-white/12" />
      <span className="rounded-full border border-white/10 bg-white/[0.08] px-4 py-1 text-sm font-medium text-slate-300">
        {label}
      </span>
      <div className="h-px flex-1 bg-white/12" />
    </div>
  );
}

function findLastStoppedDividerIndex(lines: MinecraftConsoleLine[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isStoppedDividerLine(lines[index])) {
      return index;
    }
  }
  return -1;
}

function isStoppedDividerLine(line: MinecraftConsoleLine | undefined) {
  return line?.kind === "divider" && line.text.trim().toLowerCase() === "server stopped";
}

function lineTone(kind: ConsoleLineKind, channel?: MinecraftConsoleLine["channel"]) {
  switch (channel ?? kind) {
    case "ADMIN":
    case "command":
      return "text-cyan-300";
    case "RCON":
    case "response":
      return "text-emerald-200";
    case "CHAT":
      return "text-sky-200";
    case "WARN":
      return "text-amber-200";
    case "ERROR":
    case "error":
      return "text-red-300";
    case "PHANTOM":
      return "text-cyan-100";
    case "SERVER":
    case "logs":
      return "text-slate-200";
    case "info":
    default:
      return "text-slate-400";
  }
}

function sourceTone(kind: ConsoleLineKind, channel?: MinecraftConsoleLine["channel"]) {
  switch (channel ?? kind) {
    case "ADMIN":
    case "command":
      return "text-cyan-300";
    case "RCON":
    case "response":
      return "text-emerald-300";
    case "CHAT":
      return "text-sky-300";
    case "WARN":
      return "text-amber-300";
    case "ERROR":
    case "error":
      return "text-red-300";
    case "PHANTOM":
      return "text-cyan-200";
    case "SERVER":
    case "logs":
      return "text-slate-300";
    case "info":
    default:
      return "text-slate-500";
  }
}

function lineSource(
  kind: ConsoleLineKind,
  operator: string,
  channel?: MinecraftConsoleLine["channel"]
) {
  switch (channel ?? kind) {
    case "ADMIN":
    case "command":
      return operator.toUpperCase();
    case "RCON":
    case "response":
      return "RCON";
    case "CHAT":
      return "CHAT";
    case "WARN":
      return "WARN";
    case "ERROR":
    case "error":
      return "ERROR";
    case "SERVER":
    case "logs":
      return "SERVER";
    case "PHANTOM":
    case "info":
    default:
      return "PHANTOM";
  }
}

function formatClock(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return "--:--:--";
  }
}

function welcomeLine(entry: MinecraftServerWithWorkload): MinecraftConsoleLine {
  return {
    id: `welcome-${entry.server.id}`,
    timestamp: new Date().toISOString(),
    kind: "info",
    channel: "PHANTOM",
    text: `Console attached to ${entry.server.name} (${templateFamilyLabel(entry.server.templateId)} v${entry.server.minecraftVersion})`
  };
}

function useUptime(startedAtMs: number | null, _finishedAtMs: number | null, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null || !running) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [running, startedAtMs]);
  if (!running || startedAtMs === null) return "--:--:--";
  const total = Math.max(0, Math.floor((now - startedAtMs) / 1_000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatDiskGb(value: number) {
  return `${value.toFixed(2)} GB`;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function PhantomMark() {
  return (
    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] shadow-[0_0_30px_rgba(34,211,238,0.08)]">
      <div className="absolute h-5 w-5 rounded-full border border-cyan-300/40" />
      <div className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.9)]" />
    </div>
  );
}

function RestartIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v6h6" />
    </svg>
  );
}

function PowerIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  );
}
