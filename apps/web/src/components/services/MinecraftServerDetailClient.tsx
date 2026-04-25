"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import { DetailCard } from "@/components/ui/DetailCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import {
  formatCpu,
  formatDateTime,
  formatDisk,
  formatRam,
  formatRelativeDurationSince
} from "@/lib/utils/format";
import { MinecraftServiceConsole } from "./MinecraftServiceConsole";
import type { MinecraftServerWithWorkload } from "@/types/admin";

const REFRESH_MS = 10_000;

export function MinecraftServerDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [entry, setEntry] = useState<MinecraftServerWithWorkload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostnameError, setHostnameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hostnameSlug, setHostnameSlug] = useState("");
  const [optimisticRuntimeState, setOptimisticRuntimeState] = useState<MinecraftServerWithWorkload["server"]["runtimeState"] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await adminApi.minecraftServer(id);
      setEntry(next);
      setHostnameSlug(next.server.hostnameSlug);
      setHostnameError(null);
      setError(null);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Unable to load Minecraft server");
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [id, refresh]);

  useEffect(() => {
    if (!entry || !optimisticRuntimeState) {
      return;
    }

    if (optimisticRuntimeState === "restarting") {
      if (entry.server.runtimeState === "running" && entry.server.readyAt) {
        setOptimisticRuntimeState(null);
        return;
      }
      if (entry.server.runtimeState === "starting" || entry.server.runtimeState === "waking") {
        setOptimisticRuntimeState("starting");
        return;
      }
      if (entry.server.runtimeState === "crashed") {
        setOptimisticRuntimeState("error");
        return;
      }
      return;
    }

    if (
      (optimisticRuntimeState === "starting" || optimisticRuntimeState === "waking") &&
      entry.server.runtimeState === "running" &&
      entry.server.readyAt
    ) {
      setOptimisticRuntimeState(null);
      return;
    }

    if (optimisticRuntimeState === "stopping" && ["stopped", "sleeping"].includes(entry.server.runtimeState)) {
      setOptimisticRuntimeState(null);
      return;
    }

    if (optimisticRuntimeState === "error" && entry.server.runtimeState === "running" && entry.server.readyAt) {
      setOptimisticRuntimeState(null);
    }
  }, [entry, optimisticRuntimeState]);

  const runtime = useMemo(() => {
    if (!entry) {
      return null;
    }
    const uptimeSeconds = getRuntimeUptimeSeconds(
      entry.workload.runtimeStartedAt,
      entry.workload.runtimeFinishedAt,
      entry.workload.status === "running"
    );
    return {
      startedAt: entry.workload.runtimeStartedAt,
      finishedAt: entry.workload.runtimeFinishedAt,
      uptimeSeconds,
      gamePort: entry.workload.ports.find((port) => port.internalPort === 25565)?.externalPort ?? null
    };
  }, [entry]);

  const displayEntry = useMemo(() => {
    if (!entry) {
      return null;
    }

    if (!optimisticRuntimeState) {
      return entry;
    }

    return {
      ...entry,
      server: {
        ...entry.server,
        runtimeState:
          optimisticRuntimeState === "starting" && entry.server.runtimeState === "waking"
            ? "starting"
            : optimisticRuntimeState,
        readyAt:
          optimisticRuntimeState === "running" || optimisticRuntimeState === null
            ? entry.server.readyAt
            : null
      }
    };
  }, [entry, optimisticRuntimeState]);

  if (error) {
    return <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-8 text-red-100">{error}</div>;
  }

  if (!entry || !displayEntry || !runtime) {
    return <SkeletonBlock label="Loading Minecraft service..." />;
  }

  const runAction = async (
    action: "start" | "stop" | "restart" | "delete"
  ) => {
    setBusy(action);
    try {
      if (action === "start") {
        setOptimisticRuntimeState(entry.server.sleeping ? "waking" : "starting");
        await adminApi.startMinecraftServer(entry.server.id);
      } else if (action === "stop") {
        setOptimisticRuntimeState("stopping");
        await adminApi.stopMinecraftServer(entry.server.id);
      } else if (action === "restart") {
        setOptimisticRuntimeState("restarting");
        await adminApi.restartMinecraftServer(entry.server.id);
      } else {
        await adminApi.deleteMinecraftServer(entry.server.id, { hardDeleteData: false });
        router.push("/services/minecraft");
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const runHostnameUpdate = async () => {
    if (!entry) return;
    setBusy("hostname");
    try {
      const next = await adminApi.updateMinecraftServerHostname(entry.server.id, hostnameSlug);
      setEntry(next);
      setHostnameSlug(next.server.hostnameSlug);
      setHostnameError(null);
    } catch (updateError) {
      setHostnameError(updateError instanceof Error ? updateError.message : "Unable to update hostname.");
    } finally {
      setBusy(null);
    }
  };

  const rootDomain = entry.server.hostname.split(".").slice(1).join(".");
  const hostnamePreview = `${hostnameSlug.trim().toLowerCase() || entry.server.hostnameSlug}.${rootDomain}`;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <SectionHeader
              eyebrow="Minecraft service"
              title={entry.server.name}
              description="Dedicated admin view on top of the Phantom workload runtime."
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatePill label={formatRuntimeState(displayEntry.server.runtimeState)} />
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 font-mono text-[11px] text-slate-300">
                {displayEntry.server.templateId}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 font-mono text-[11px] text-slate-300">
                v{displayEntry.server.minecraftVersion}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[11px] text-slate-300">
                {displayEntry.server.planTier}
              </span>
            </div>

            <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <Field label="UUID" value={displayEntry.server.id} mono />
              <Field label="Node" value={displayEntry.node?.name ?? "Unassigned"} />
              <Field label="Direct port" value={runtime.gamePort ? `${runtime.gamePort}/tcp` : "Unknown"} mono />
              <Field label="Proxy address" value={displayEntry.server.hostname} mono />
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton
              label={displayEntry.server.runtimeState === "sleeping" ? "Wake" : "Start"}
              busy={busy === "start"}
              onClick={() => void runAction("start")}
            />
            <ActionButton label="Stop" busy={busy === "stop"} onClick={() => void runAction("stop")} />
            <ActionButton label="Restart" busy={busy === "restart"} onClick={() => void runAction("restart")} />
            <ActionButton label="Delete" busy={busy === "delete"} destructive onClick={() => void runAction("delete")} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <DetailCard title="Resources">
          <div className="grid gap-3 text-sm">
            <MetricRow label="CPU" value={`${formatCpu(entry.workload.requestedCpu)} vCPU`} />
            <MetricRow label="RAM" value={formatRam(entry.workload.requestedRamMb)} />
            <MetricRow label="Disk" value={formatDisk(entry.workload.requestedDiskGb)} />
          </div>
        </DetailCard>

        <DetailCard title="Runtime">
          <div className="grid min-w-0 gap-3 text-sm">
            <MetricRow label="Uptime" value={formatHms(runtime.uptimeSeconds)} />
            <MetricRow label="Started at" value={formatDateTime(runtime.startedAt)} />
            <MetricRow label="Finished at" value={formatDateTime(runtime.finishedAt)} />
            <MetricRow label="Restart count" value={String(entry.workload.restartCount)} />
            <MetricRow label="AutoSleep" value={displayEntry.server.autoSleepEnabled ? "Enabled" : "Disabled"} />
            <MetricRow label="Idle since" value={formatDateTime(displayEntry.server.idleSince)} />
            <MetricRow label="Last player seen" value={formatDateTime(displayEntry.server.lastPlayerSeenAt)} />
            <MetricRow label="Idle duration" value={formatRelativeDurationSince(displayEntry.server.idleSince)} />
            <MetricRow label="Workload ID" value={entry.workload.id} mono wrap />
            <MetricRow label="Container ID" value={entry.workload.containerId ?? "Pending"} mono wrap />
          </div>
        </DetailCard>

        <DetailCard title="Network">
          <div className="grid min-w-0 gap-3 text-sm">
            <MetricRow label="Node" value={displayEntry.node?.name ?? "Unassigned"} />
            <MetricRow label="Public host" value={displayEntry.node?.publicHost ?? "Unknown"} mono wrap />
            <MetricRow label="Proxy address" value={displayEntry.server.hostname} mono wrap />
            <MetricRow
              label="Direct address"
              value={runtime.gamePort ? `${displayEntry.server.hostname}:${runtime.gamePort}` : "Pending assignment"}
              mono
              wrap
            />
            <MetricRow label="Internal container port" value="25565/tcp" mono />
            <MetricRow label="Public direct port" value={runtime.gamePort ? `${runtime.gamePort}/tcp` : "Unknown"} mono />
            <MetricRow label="DNS status" value={displayEntry.server.dnsStatus} />
            <MetricRow label="Hostname updated" value={formatDateTime(displayEntry.server.hostnameUpdatedAt)} />
            <MetricRow
              label="DNS error"
              value={displayEntry.server.dnsLastError ?? "Wildcard DNS handled outside Phantom."}
              wrap
            />
            <div className="mt-2 rounded-2xl bg-white/[0.04] px-4 py-4">
              <p className="text-sm text-slate-500">Hostname slug</p>
              <div className="mt-3 flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 items-center rounded-xl border border-white/10 bg-white/[0.03] px-3">
                  <input
                    value={hostnameSlug}
                    onChange={(event) => {
                      setHostnameSlug(event.target.value.toLowerCase());
                      setHostnameError(null);
                    }}
                    className="h-10 min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
                  />
                  <span className="shrink-0 text-xs text-slate-500">.{rootDomain}</span>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void runHostnameUpdate()}
                    disabled={busy === "hostname" || hostnameSlug.trim().length === 0 || hostnameSlug === entry.server.hostnameSlug}
                    className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === "hostname" ? "Saving..." : "Save hostname"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(entry.connectAddress ?? hostnamePreview)}
                    className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white transition hover:bg-white/[0.08]"
                  >
                    Copy address
                  </button>
                </div>
              </div>
              <p className="mt-3 break-all font-mono text-xs text-slate-400">Preview: {hostnamePreview}</p>
              {hostnameError ? <p className="mt-2 text-xs text-red-300">{hostnameError}</p> : null}
            </div>
          </div>
        </DetailCard>
      </section>

      <MinecraftServiceConsole entry={displayEntry} onRefresh={refresh} />

      <section className="grid gap-6 xl:grid-cols-4">
        <PlaceholderCard
          title="Files"
          description="Future file browser and editor will reuse the same Minecraft service API surface."
        />
        <PlaceholderCard
          title="Backups"
          description="Backup orchestration will plug into this service detail without changing the console transport."
        />
        <PlaceholderCard
          title="Plugins"
          description="Plugin inventory and install actions will be layered on top of the current admin service model."
        />
        <PlaceholderCard
          title="Settings"
          description="Server properties and template-specific settings will be exposed here next."
        />
      </section>

      <DetailCard title="References">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <MetricRow label="Created" value={formatDateTime(entry.server.createdAt)} />
          <MetricRow label="Updated" value={formatDateTime(entry.server.updatedAt)} />
          <MetricRow label="Last player sample" value={formatDateTime(entry.server.lastPlayerSampleAt)} />
          <MetricRow label="Last console command" value={formatDateTime(entry.server.lastConsoleCommandAt)} />
          <MetricRow label="MOTD" value={entry.server.motd ?? "None"} />
          <MetricRow
            label="Workload detail"
            value="Open workload"
            href={`/workloads/${entry.workload.id}`}
          />
        </div>
      </DetailCard>
    </div>
  );
}

function getRuntimeUptimeSeconds(
  startedAt: string | null,
  finishedAt: string | null,
  isRunning: boolean
) {
  if (!startedAt) {
    return 0;
  }
  const startMs = new Date(startedAt).getTime();
  const endMs = isRunning ? Date.now() : finishedAt ? new Date(finishedAt).getTime() : startMs;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

function formatHms(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function StatePill({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-indigo-300/30 bg-indigo-400/[0.09] px-2.5 py-1 text-[11px] font-semibold leading-none text-indigo-100">
      {label}
    </span>
  );
}

function formatRuntimeState(value: MinecraftServerWithWorkload["server"]["runtimeState"]) {
  switch (value) {
    case "sleeping":
      return "Sleeping";
    case "waking":
      return "Waking";
    case "starting":
      return "Starting";
    case "restarting":
      return "Restarting";
    case "stopping":
      return "Stopping";
    case "running":
      return "Running";
    case "crashed":
      return "Crashed";
    case "error":
      return "Error";
    default:
      return "Stopped";
  }
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-1 text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function MetricRow({
  label,
  value,
  mono = false,
  href,
  wrap = false
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
  wrap?: boolean;
}) {
  const content = href ? (
    <Link href={href} className="text-accent hover:text-accent/80">
      {value}
    </Link>
  ) : (
    value
  );

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,120px)_minmax(0,1fr)] items-start gap-4 rounded-2xl bg-white/[0.04] px-4 py-3">
      <span className="min-w-0 text-slate-500">{label}</span>
      <span
        title={value}
        className={`min-w-0 text-right text-slate-200 ${
          mono ? "font-mono text-xs" : ""
        } ${wrap ? "break-all whitespace-normal" : "truncate"}`}
      >
        {content}
      </span>
    </div>
  );
}

function ActionButton({
  label,
  busy,
  onClick,
  destructive = false
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
        destructive
          ? "border border-red-500/30 bg-red-500/[0.08] text-red-200 hover:bg-red-500/[0.14]"
          : "border border-white/10 bg-white/[0.035] text-white hover:bg-white/[0.07]"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {busy ? `${label}...` : label}
    </button>
  );
}

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <DetailCard title={title}>
      <p className="text-sm text-slate-400">{description}</p>
    </DetailCard>
  );
}
