"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import { DetailCard } from "@/components/ui/DetailCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { WorkloadStatusBadge } from "@/components/workloads/WorkloadStatusBadge";
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
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await adminApi.minecraftServer(id);
      setEntry(next);
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

  const runtime = useMemo(() => {
    if (!entry) {
      return null;
    }
    const runningEvent = [...entry.workload.statusEvents]
      .reverse()
      .find((event) => event.newStatus === "running");
    return {
      startedAt: runningEvent?.createdAt ?? null,
      gamePort: entry.workload.ports.find((port) => port.internalPort === 25565)?.externalPort ?? null
    };
  }, [entry]);

  if (error) {
    return <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-8 text-red-100">{error}</div>;
  }

  if (!entry || !runtime) {
    return <SkeletonBlock label="Loading Minecraft service..." />;
  }

  const runAction = async (
    action: "start" | "stop" | "restart" | "delete"
  ) => {
    setBusy(action);
    try {
      if (action === "start") {
        await adminApi.startMinecraftServer(entry.server.id);
      } else if (action === "stop") {
        await adminApi.stopMinecraftServer(entry.server.id);
      } else if (action === "restart") {
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
              {entry.server.sleeping ? <StatePill label="Sleeping" /> : <WorkloadStatusBadge status={entry.workload.status} />}
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 font-mono text-[11px] text-slate-300">
                {entry.server.templateId}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 font-mono text-[11px] text-slate-300">
                v{entry.server.minecraftVersion}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[11px] text-slate-300">
                {entry.server.planTier}
              </span>
            </div>

            <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <Field label="UUID" value={entry.server.id} mono />
              <Field label="Node" value={entry.node?.name ?? "Unassigned"} />
              <Field label="Port" value={runtime.gamePort ? `${runtime.gamePort}/tcp` : "Unknown"} mono />
              <Field
                label="Hostname"
                value={entry.hostname ? `${entry.hostname}${runtime.gamePort ? `:${runtime.gamePort}` : ""}` : "Unknown"}
                mono
              />
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton
              label={entry.server.sleeping ? "Wake" : "Start"}
              busy={busy === "start"}
              onClick={() => void runAction("start")}
            />
            <ActionButton label="Stop" busy={busy === "stop"} onClick={() => void runAction("stop")} />
            <ActionButton label="Restart" busy={busy === "restart"} onClick={() => void runAction("restart")} />
            <ActionButton label="Delete" busy={busy === "delete"} destructive onClick={() => void runAction("delete")} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <DetailCard title="Resources">
          <div className="grid gap-3 text-sm">
            <MetricRow label="CPU" value={`${formatCpu(entry.workload.requestedCpu)} vCPU`} />
            <MetricRow label="RAM" value={formatRam(entry.workload.requestedRamMb)} />
            <MetricRow label="Disk" value={formatDisk(entry.workload.requestedDiskGb)} />
          </div>
        </DetailCard>

        <DetailCard title="Runtime">
          <div className="grid gap-3 text-sm">
            <MetricRow label="Uptime source" value={formatDateTime(runtime.startedAt)} />
            <MetricRow label="Restart count" value={String(entry.workload.restartCount)} />
            <MetricRow label="AutoSleep" value={entry.server.autoSleepEnabled ? "Enabled" : "Disabled"} />
            <MetricRow label="Idle since" value={formatDateTime(entry.server.idleSince)} />
            <MetricRow label="Last player seen" value={formatDateTime(entry.server.lastPlayerSeenAt)} />
            <MetricRow label="Idle duration" value={formatRelativeDurationSince(entry.server.idleSince)} />
            <MetricRow label="Workload ID" value={entry.workload.id} mono />
            <MetricRow label="Container ID" value={entry.workload.containerId ?? "Pending"} mono />
          </div>
        </DetailCard>

        <DetailCard title="Network">
          <div className="grid gap-3 text-sm">
            <MetricRow label="Node" value={entry.node?.name ?? "Unassigned"} />
            <MetricRow label="Public host" value={entry.node?.publicHost ?? "Unknown"} mono />
            <MetricRow label="Game port" value={runtime.gamePort ? `${runtime.gamePort}/tcp` : "Unknown"} mono />
            <MetricRow
              label="Reserved ports"
              value={
                entry.workload.ports.length > 0
                  ? entry.workload.ports.map((port) => `${port.externalPort}/${port.protocol}`).join(", ")
                  : "None"
              }
              mono
            />
          </div>
        </DetailCard>
      </section>

      <MinecraftServiceConsole entry={entry} onRefresh={refresh} />

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

function StatePill({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-indigo-300/30 bg-indigo-400/[0.09] px-2.5 py-1 text-[11px] font-semibold leading-none text-indigo-100">
      {label}
    </span>
  );
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
  href
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
}) {
  const content = href ? (
    <Link href={href} className="text-accent hover:text-accent/80">
      {value}
    </Link>
  ) : (
    value
  );

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-white/[0.04] px-4 py-3">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>
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
