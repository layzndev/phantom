"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/admin-api";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { formatCpu, formatDisk, formatRam } from "@/lib/utils/format";
import type { MinecraftGlobalSettings, MinecraftServerWithWorkload } from "@/types/admin";

const REFRESH_MS = 10_000;

export function MinecraftServicesClient() {
  const router = useRouter();
  const [servers, setServers] = useState<MinecraftServerWithWorkload[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [freeTierSettings, setFreeTierSettings] = useState<MinecraftGlobalSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const [{ servers: next }, { settings }] = await Promise.all([
          adminApi.minecraftServers(),
          adminApi.minecraftFreeTierSettings()
        ]);
        if (active) {
          setServers(next);
          setFreeTierSettings(settings);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return servers;
    }

    return servers.filter(({ server, workload, node, hostname }) =>
      [
        server.name,
        server.id,
        server.templateId,
        server.minecraftVersion,
        workload.status,
        workload.nodeId ?? "",
        workload.id,
        workload.containerId ?? "",
        node?.name ?? "",
        node?.id ?? "",
        hostname ?? "",
        ...workload.ports.map((port) => String(port.externalPort))
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [query, servers]);

  if (loading) {
    return <SkeletonBlock label="Loading Minecraft services..." />;
  }

  const saveFreeTierSettings = async (next: MinecraftGlobalSettings) => {
    setSettingsBusy(true);
    try {
      const response = await adminApi.updateMinecraftFreeTierSettings(next);
      setFreeTierSettings(response.settings);
    } finally {
      setSettingsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/70 p-6 shadow-soft">
        <SectionHeader
          eyebrow="Services"
          title="Minecraft"
          description="Admin inventory for the Minecraft product layer running on top of Phantom workloads."
        />

        <div className="mt-6">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, UUID, hostname, node, status, template or port"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40"
          />
        </div>

        {freeTierSettings ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h3 className="text-sm font-semibold text-white">Free Tier Defaults</h3>
            <p className="mt-1 text-xs text-slate-500">
              Applies to Free servers without per-server override.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="grid gap-2 text-sm text-white">
                <span>AutoSleep enabled</span>
                <select
                  value={String(freeTierSettings.freeAutoSleepEnabled)}
                  onChange={(event) =>
                    setFreeTierSettings((current) =>
                      current
                        ? {
                            ...current,
                            freeAutoSleepEnabled: event.target.value === "true"
                          }
                        : current
                    )
                  }
                  className={inputClass}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm text-white">
                <span>Idle delay (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={freeTierSettings.freeAutoSleepIdleMinutes}
                  onChange={(event) =>
                    setFreeTierSettings((current) =>
                      current
                        ? {
                            ...current,
                            freeAutoSleepIdleMinutes: Number(event.target.value || 1)
                          }
                        : current
                    )
                  }
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-sm text-white">
                <span>Action</span>
                <select
                  value={freeTierSettings.freeAutoSleepAction}
                  onChange={(event) =>
                    setFreeTierSettings((current) =>
                      current
                        ? {
                            ...current,
                            freeAutoSleepAction: event.target.value as "sleep" | "stop"
                          }
                        : current
                    )
                  }
                  className={inputClass}
                >
                  <option value="sleep">Sleep</option>
                  <option value="stop">Stop</option>
                </select>
              </label>
            </div>
            <div className="mt-4">
              <button
                type="button"
                disabled={settingsBusy}
                onClick={() => freeTierSettings && void saveFreeTierSettings(freeTierSettings)}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {settingsBusy ? "Saving..." : "Save Free Tier Defaults"}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel/78 shadow-soft">
        {servers.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No Minecraft servers registered"
              description="Create a Minecraft server from the existing playground or API to populate this inventory."
            />
          </div>
        ) : (
          <DataTable
            rows={filtered}
            getRowKey={(entry) => entry.server.id}
            onRowClick={(entry) => router.push(`/services/minecraft/${entry.server.id}`)}
            rowClassName="cursor-pointer hover:bg-white/[0.025]"
            emptyTitle="No Minecraft service matches this search"
            emptyDescription="Clear the search to recover the full inventory."
            columns={[
              {
                key: "name",
                header: "Name",
                cell: ({ server }) => (
                  <div>
                    <Link
                      href={`/services/minecraft/${server.id}`}
                      className="font-semibold text-white hover:text-accent"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {server.name}
                    </Link>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">{server.id}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">{server.hostname}</p>
                  </div>
                )
              },
              {
                key: "node",
                header: "Node",
                cell: ({ node, workload }) => (
                  <div className="text-slate-300">
                    <p>{node?.name ?? "Unassigned"}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      {workload.nodeId ?? "no-node"}
                    </p>
                  </div>
                )
              },
              {
                key: "template",
                header: "Template",
                cell: ({ server }) => (
                  <div className="text-slate-300">
                    <p>{server.templateId}</p>
                    <p className="mt-1 text-xs text-slate-500">v{server.minecraftVersion}</p>
                  </div>
                )
              },
              {
                key: "status",
                header: "Status",
                cell: ({ server }) => <StatusChip label={formatRuntimeState(server.runtimeState)} />
              },
              {
                key: "port",
                header: "Connect",
                cell: (entry) => {
                  const { server, workload, connectAddress } = entry;
                  const gamePort =
                    workload.ports.find((port) => port.internalPort === 25565)?.externalPort ?? null;
                  return (
                    <div className="text-slate-300">
                      <p className="font-mono text-xs">
                        {connectAddress ?? server.hostname ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Proxy 25565/tcp
                        {gamePort ? ` · Direct ${gamePort}/tcp` : " · No direct port"}
                      </p>
                      {connectAddress ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void navigator.clipboard.writeText(connectAddress);
                            setCopiedId(entry.server.id);
                            window.setTimeout(() => setCopiedId((current) => (current === entry.server.id ? null : current)), 1500);
                          }}
                          className="mt-2 text-[11px] text-accent hover:text-accent/80"
                        >
                          {copiedId === entry.server.id ? "Copied" : "Copy address"}
                        </button>
                      ) : null}
                    </div>
                  );
                }
              },
              {
                key: "resources",
                header: "CPU / RAM / Disk",
                cell: ({ workload }) => (
                  <div className="text-slate-300">
                    <p>
                      CPU {formatCpu(workload.requestedCpu)} vCPU
                      <span className="text-slate-500">
                        {" · "}
                        {formatRuntimeCpu(workload.runtimeCpuPercent)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      RAM {formatRam(workload.requestedRamMb)}
                      {" · "}
                      {formatRuntimeRam(workload.runtimeMemoryMb)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Disk {formatDisk(workload.requestedDiskGb)}
                      {" · "}
                      {formatRuntimeDisk(workload.runtimeDiskGb)}
                    </p>
                  </div>
                )
              }
            ]}
          />
        )}
      </div>
    </div>
  );
}

const inputClass =
  "h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-white outline-none focus:border-accent/40";

function StatusChip({ label }: { label: string }) {
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

function formatRuntimeCpu(value: number | null) {
  if (value === null) {
    return "live n/a";
  }
  return `live ${value.toFixed(1)}%`;
}

function formatRuntimeRam(value: number | null) {
  if (value === null) {
    return "live n/a";
  }
  return `used ${formatRam(value)}`;
}

function formatRuntimeDisk(value: number | null) {
  if (value === null) {
    return "live n/a";
  }
  return `used ${formatDisk(value)}`;
}
