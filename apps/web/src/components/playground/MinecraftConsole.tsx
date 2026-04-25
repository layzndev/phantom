"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MinecraftServerWithWorkload } from "@/types/admin";

export type ConsoleLineKind =
  | "command"
  | "response"
  | "logs"
  | "info"
  | "error";

export interface MinecraftConsoleLine {
  id: string;
  timestamp: string;
  kind: ConsoleLineKind;
  text: string;
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
  onSave: () => void;
  onFetchLogs: () => void;
  onRestart: () => void;
  onStop: () => void;
  onClear: () => void;
  busy: boolean;
  operatorLabel?: string;
}

const TABS = ["Console", "Files", "Upgrade", "Backups", "Plugins", "Monetise", "Settings"] as const;

export function MinecraftConsole({
  entry,
  servers,
  selectedServerId,
  onSelectServer,
  lines,
  commandInput,
  onCommandInputChange,
  onCommandSubmit,
  onSave,
  onFetchLogs,
  onRestart,
  onStop,
  onClear,
  busy,
  operatorLabel = "operator"
}: MinecraftConsoleProps) {
  const consoleReady = entry?.workload.status === "running";

  const startedAtMs = useMemo(() => {
    if (!entry || !entry.workload.runtimeStartedAt) return null;
    return new Date(entry.workload.runtimeStartedAt).getTime();
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
  const cpuLabel = entry ? `${entry.workload.requestedCpu} vCPU` : "— vCPU";
  const ramLabel = entry ? `${entry.workload.requestedRamMb} MB` : "— MB";
  const addressLabel = externalPort ? `:${externalPort}` : "—";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  const renderedLines = lines.length === 0 && entry
    ? [welcomeLine(entry)]
    : lines;

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
                  {entry.workload.status}
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500">
              <span>
                <span className="text-slate-300">Uptime:</span> {uptimeLabel}
              </span>
              <span>·</span>
              <span>
                <span className="text-slate-300">Disk:</span> {diskAllocGb} GB
              </span>
              <span>·</span>
              <span className="text-slate-300">{addressLabel}</span>
              {entry ? (
                <>
                  <span>·</span>
                  <span className="text-slate-300">{entry.server.templateId}</span>
                  <span>·</span>
                  <span>v{entry.server.minecraftVersion}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
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
          <div className="flex flex-wrap items-center justify-end gap-2">
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
            <button
              type="button"
              onClick={onRestart}
              disabled={!entry || busy}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.025] px-4 text-sm font-bold text-slate-100 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RestartIcon className="h-[15px] w-[15px]" /> Restart
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={!entry || busy || entry.workload.desiredStatus === "stopped"}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-red-500/25 bg-red-500/[0.06] px-4 text-sm font-bold text-red-300 transition hover:border-red-400/40 hover:bg-red-500/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PowerIcon className="h-[15px] w-[15px]" /> Stop
            </button>
          </div>
        </div>
      </header>

      <nav className="mt-4 flex gap-6 border-b border-white/10 text-sm font-semibold text-slate-500">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            disabled={tab !== "Console"}
            className={`relative pb-3 transition disabled:cursor-not-allowed ${
              tab === "Console"
                ? "text-white after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-white"
                : "hover:text-slate-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ToolbarButton onClick={onSave} disabled={!consoleReady || busy} label="Save world" />
        <ToolbarButton onClick={onFetchLogs} disabled={!consoleReady || busy} label="Fetch logs" />
        <ToolbarButton onClick={onClear} disabled={lines.length === 0} label="Clear" />
        {entry && !consoleReady ? (
          <span className="ml-auto text-[11px] text-amber-300">
            Server status: {entry.workload.status}. Console requires a running server.
          </span>
        ) : null}
      </div>

      <div className="relative mt-4 overflow-hidden border border-white/10 bg-[#070707] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
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
            renderedLines.map((line) => (
              <p key={line.id} className="whitespace-pre-wrap">
                {line.kind === "logs" && looksLikeMinecraftRuntimeLine(line.text) ? (
                  <span className={lineTone(line.kind)}>{line.text}</span>
                ) : (
                  <>
                    <span className="text-slate-500">[{formatClock(line.timestamp)} </span>
                    <span className={sourceTone(line.kind)}>{lineSource(line.kind, operatorLabel)}</span>
                    <span className="text-slate-500">] </span>
                    <span className={lineTone(line.kind)}>{line.text}</span>
                  </>
                )}
              </p>
            ))
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
          className="relative flex h-11 items-center gap-3 border-t border-white/10 bg-white/[0.055] px-4 font-mono text-sm"
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
            placeholder={consoleReady ? "Enter command..." : "server is not running"}
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

function lineTone(kind: ConsoleLineKind) {
  switch (kind) {
    case "command":
      return "text-cyan-300";
    case "response":
      return "text-emerald-200";
    case "logs":
      return "text-slate-200";
    case "error":
      return "text-red-300";
    case "info":
    default:
      return "text-slate-400";
  }
}

function sourceTone(kind: ConsoleLineKind) {
  switch (kind) {
    case "command":
      return "text-cyan-300";
    case "response":
      return "text-emerald-300";
    case "logs":
      return "text-slate-300";
    case "error":
      return "text-red-300";
    case "info":
    default:
      return "text-slate-500";
  }
}

function lineSource(kind: ConsoleLineKind, operator: string) {
  switch (kind) {
    case "command":
      return operator.toUpperCase();
    case "response":
      return "RCON";
    case "logs":
      return "LOG";
    case "error":
      return "ERROR";
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
    text: `Runtime attached to ${entry.server.name} (${entry.server.templateId} v${entry.server.minecraftVersion})`
  };
}

function useUptime(startedAtMs: number | null, finishedAtMs: number | null, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null || !running) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [running, startedAtMs]);
  if (startedAtMs === null) return "00:00:00";
  const endMs = running ? now : finishedAtMs ?? startedAtMs;
  const total = Math.max(0, Math.floor((endMs - startedAtMs) / 1_000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function looksLikeMinecraftRuntimeLine(value: string) {
  return /^\[\d{2}:\d{2}:\d{2}\]\s+\[[^\]]+\]:/.test(value);
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

function ToolbarButton({
  label,
  onClick,
  disabled
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-8 rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}
