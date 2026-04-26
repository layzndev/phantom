"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { adminApi } from "@/lib/api/admin-api";
import { formatRam, percent } from "@/lib/utils/format";
import type { AdminRole, CompanyNode, NodeHealth, NodePool, NodeStatus } from "@/types/admin";
import { HeartbeatHeart } from "./HeartbeatHeart";
import { NodeActions } from "./NodeActions";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateNodePanel } from "./CreateNodePanel";

const NODES_REFRESH_MS = 15_000;

export function NodesTableClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [nodes, setNodes] = useState<CompanyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodeStatus | "all">("all");
  const [health, setHealth] = useState<NodeHealth | "all">("all");
  const [pool, setPool] = useState<NodePool | "all">("all");
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);

  useEffect(() => {
    const nextQuery = searchParams.get("q") ?? "";
    const nextStatus = searchParams.get("status");
    const nextHealth = searchParams.get("health");
    const nextPool = searchParams.get("pool");

    setQuery(nextQuery);
    setStatus(
      nextStatus === "healthy" || nextStatus === "maintenance" || nextStatus === "offline"
        ? nextStatus
        : "all"
    );
    setHealth(
      nextHealth === "healthy" ||
        nextHealth === "degraded" ||
        nextHealth === "unreachable" ||
        nextHealth === "unknown"
        ? nextHealth
        : "all"
    );
    setPool(
      nextPool === "free" || nextPool === "premium" || nextPool === "internal"
        ? nextPool
        : "all"
    );
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const { nodes: nextNodes } = await adminApi.nodes();
        if (!active) return;
        setNodes(nextNodes);
      } catch {
        // silent: keep showing the last known snapshot
      } finally {
        if (active) setLoading(false);
      }
    }

    refresh();

    adminApi
      .me()
      .then(({ admin }) => {
        if (active) setAdminRole(admin.role);
      })
      .catch(() => {
        if (active) setAdminRole(null);
      });

    const timer = setInterval(refresh, NODES_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  function replaceNode(updated: CompanyNode) {
    setNodes((current) => current.map((node) => (node.id === updated.id ? updated : node)));
  }

  function addNode(created: CompanyNode) {
    setNodes((current) => [created, ...current]);
  }

  function removeNode(id: string) {
    setNodes((current) => current.filter((node) => node.id !== id));
  }

  if (loading) {
    return <SkeletonBlock label="Loading nodes inventory..." />;
  }

  const filteredNodes = nodes.filter((node) => {
    const search = `${node.id} ${node.name} ${node.provider} ${node.region} ${node.internalHost} ${node.publicHost}`.toLowerCase();

    return (
      search.includes(query.toLowerCase()) &&
      (status === "all" || node.status === status) &&
      (health === "all" || node.health === health) &&
      (pool === "all" || node.pool === pool)
    );
  });

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/70 p-6 shadow-soft">
        <SectionHeader
          eyebrow="Phantom registry"
          title="Nodes"
        />

        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_160px_160px_160px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by node, host, provider or region"
            className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40"
          />

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as NodeStatus | "all")}
            className="rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40"
          >
            <option value="all">All status</option>
            <option value="healthy">Healthy</option>
            <option value="maintenance">Maintenance</option>
            <option value="offline">Offline</option>
          </select>

          <select
            value={health}
            onChange={(event) => setHealth(event.target.value as NodeHealth | "all")}
            className="rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40"
          >
            <option value="all">All health</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="unreachable">Unreachable</option>
            <option value="unknown">Unknown</option>
          </select>

          <select
            value={pool}
            onChange={(event) => setPool(event.target.value as NodePool | "all")}
            className="rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40"
          >
            <option value="all">All pools</option>
            <option value="free">Free</option>
            <option value="premium">Premium</option>
            <option value="internal">Internal</option>
          </select>
        </div>
      </section>

      <CreateNodePanel onCreated={addNode} />

      <div className="overflow-hidden rounded-2xl border border-line bg-panel/78 shadow-soft">
        {nodes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No nodes registered"
              description="Create the first Phantom node to prepare the future runtime connection."
            />
          </div>
        ) : (
          <DataTable
            rows={filteredNodes}
            getRowKey={(node) => node.id}
            onRowClick={(node) => router.push(`/nodes/${node.id}`)}
            rowClassName="cursor-pointer hover:bg-white/[0.025]"
            emptyTitle="No node matches these filters"
            emptyDescription="Clear search or filters to recover the full inventory."
            columns={[
              {
                key: "heartbeat",
                header: "",
                cell: (node) => (
                  <HeartbeatHeart heartbeat={node.heartbeat} status={node.status} health={node.health} />
                )
              },
              {
                key: "node",
                header: "Name",
                cell: (node) => (
                  <Link
                    href={`/nodes/${node.id}`}
                    className="font-semibold text-white hover:text-accent"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {node.name}
                  </Link>
                )
              },
              {
                key: "provider",
                header: "Provider",
                cell: (node) => <span className="text-slate-300">{node.provider}</span>
              },
              {
                key: "pool",
                header: "Pool",
                cell: (node) => <PoolBadge pool={node.pool} />
              },
              {
                key: "hosts",
                header: "Hosts",
                cell: (node) => (
                  <>
                    <p className="font-mono text-xs text-slate-300">{node.internalHost}</p>
                    <p className="mt-1 font-mono text-xs text-slate-500">{node.publicHost}</p>
                  </>
                )
              },
              {
                key: "region",
                header: "Region",
                cell: (node) => <span className="text-slate-300">{node.region}</span>
              },
              {
                key: "ram",
                header: "RAM",
                cell: (node) => (
                  <div className="text-slate-300">
                    <p>{percent(node.usedRamMb, node.totalRamMb)}%</p>
                    <p className="text-xs text-slate-500">
                      {formatRam(node.usedRamMb)} / {formatRam(node.totalRamMb)}
                    </p>
                  </div>
                )
              },
              {
                key: "cpu",
                header: "CPU",
                cell: (node) => (
                  <div className="text-slate-300">
                    <p>{percent(node.usedCpu, node.totalCpu)}%</p>
                    <p className="text-xs text-slate-500">
                      {node.usedCpu.toFixed(1)} / {node.totalCpu}
                    </p>
                  </div>
                )
              },
              {
                key: "actions",
                header: "Actions",
                cell: (node) => (
                  <div
                    className="flex flex-wrap items-center gap-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <NodeActions
                      node={node}
                      onUpdated={replaceNode}
                      onRemoved={removeNode}
                      adminRole={adminRole}
                      compact
                    />
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

function PoolBadge({ pool }: { pool: NodePool }) {
  const styles: Record<NodePool, string> = {
    free: "border-white/15 bg-white/[0.04] text-slate-200",
    premium: "border-amber/30 bg-amber/[0.10] text-amber",
    internal: "border-accent/30 bg-accent/[0.10] text-accent"
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${styles[pool]}`}
    >
      {pool}
    </span>
  );
}
