"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/admin-api";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { WorkloadStatusBadge } from "@/components/workloads/WorkloadStatusBadge";
import { formatCpu, formatDisk, formatRam } from "@/lib/utils/format";
import type { MinecraftServerWithWorkload } from "@/types/admin";

const REFRESH_MS = 10_000;

export function MinecraftServicesClient() {
  const router = useRouter();
  const [servers, setServers] = useState<MinecraftServerWithWorkload[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const { servers: next } = await adminApi.minecraftServers();
        if (active) {
          setServers(next);
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
                cell: ({ server, workload }) =>
                  server.sleeping ? <StatusChip label="Sleeping" /> : <WorkloadStatusBadge status={workload.status} />
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
                      <p className="font-mono text-xs">{connectAddress ?? server.hostname ?? (gamePort ? `${gamePort}/tcp` : "—")}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {gamePort ? `${gamePort}/tcp` : "No port"}
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
                    <p>{formatCpu(workload.requestedCpu)} CPU</p>
                    <p className="text-xs text-slate-500">
                      {formatRam(workload.requestedRamMb)} / {formatDisk(workload.requestedDiskGb)}
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

function StatusChip({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-indigo-300/30 bg-indigo-400/[0.09] px-2.5 py-1 text-[11px] font-semibold leading-none text-indigo-100">
      {label}
    </span>
  );
}
