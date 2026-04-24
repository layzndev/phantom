"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminApi } from "@/lib/api/admin-api";
import { formatRam, percent } from "@/lib/utils/format";
import type { AdminRole, CompanyNode, NodeHealth, NodeStatus } from "@/types/admin";
import { HeartbeatHeart } from "./HeartbeatHeart";
import { NodeHealthBadge } from "./NodeHealthBadge";
import { NodeStatusBadge } from "./NodeStatusBadge";
import { NodeActions } from "./NodeActions";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateNodePanel } from "./CreateNodePanel";

const NODES_REFRESH_MS = 15_000;

export function NodesTableClient() {
  const [nodes, setNodes] = useState<CompanyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodeStatus | "all">("all");
  const [health, setHealth] = useState<NodeHealth | "all">("all");
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);

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

  if (loading) {
    return <SkeletonBlock label="Loading nodes inventory..." />;
  }

  const filteredNodes = nodes.filter((node) => {
    const search = `${node.id} ${node.name} ${node.provider} ${node.region} ${node.internalHost} ${node.publicHost}`.toLowerCase();
    return search.includes(query.toLowerCase()) && (status === "all" || node.status === status) && (health === "all" || node.health === health);
  });

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/70 p-6 shadow-soft">
        <SectionHeader
          eyebrow="Phantom registry"
          title="Nodes"
          description="Source de verite interne des nodes. Le runtime et la Hosting API seront branches plus tard."
        />
        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by node, host, provider or region"
            className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40"
          />
          <select value={status} onChange={(event) => setStatus(event.target.value as NodeStatus | "all")} className="rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40">
            <option value="all">All status</option>
            <option value="healthy">Healthy</option>
            <option value="maintenance">Maintenance</option>
            <option value="offline">Offline</option>
          </select>
          <select value={health} onChange={(event) => setHealth(event.target.value as NodeHealth | "all")} className="rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40">
            <option value="all">All health</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="unreachable">Unreachable</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </section>

      <CreateNodePanel onCreated={addNode} />

      <div className="overflow-hidden rounded-2xl border border-line bg-panel/78 shadow-soft">
        {nodes.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No nodes registered" description="Create the first Phantom node to prepare the future runtime connection." />
          </div>
        ) : (
          <DataTable
            rows={filteredNodes}
            getRowKey={(node) => node.id}
            emptyTitle="No node matches these filters"
            emptyDescription="Clear search or filters to recover the full inventory."
            columns={[
              {
                key: "node",
                header: "Node",
                cell: (node) => (
                  <>
                    <Link href={`/nodes/${node.id}`} className="font-semibold text-white hover:text-accent">{node.name}</Link>
                    <p className="mt-1 font-mono text-xs text-slate-500">{node.id}</p>
                    <p className="mt-2 text-xs text-slate-400">{node.region}</p>
                  </>
                )
              },
              { key: "provider", header: "Provider", cell: (node) => <span className="text-slate-300">{node.provider}</span> },
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
                key: "state",
                header: "State",
                cell: (node) => (
                  <div className="space-y-2">
                    <NodeStatusBadge status={node.status} />
                    <NodeHealthBadge health={node.health} />
                  </div>
                )
              },
              { key: "runtime", header: "Runtime", cell: (node) => <span className="text-slate-300">{node.runtimeMode}</span> },
              { key: "heartbeat", header: "Heartbeat", cell: (node) => <HeartbeatHeart heartbeat={node.heartbeat} /> },
              {
                key: "capacity",
                header: "Capacity",
                cell: (node) => (
                  <div className="text-slate-300">
                    <p>RAM {percent(node.usedRamMb, node.totalRamMb)}%</p>
                    <p className="text-xs text-slate-500">{formatRam(node.usedRamMb)} / {formatRam(node.totalRamMb)}</p>
                    <p className="mt-2">CPU {percent(node.usedCpu, node.totalCpu)}%</p>
                    <p className="text-xs text-slate-500">{node.usedCpu.toFixed(1)} / {node.totalCpu}</p>
                    <p className="mt-2 text-xs text-slate-500">{node.hostedServers} servers</p>
                  </div>
                )
              },
              {
                key: "ports",
                header: "Ports",
                cell: (node) => (
                  <div className="text-slate-300">
                    {node.portRange ? (
                      <>
                        <p>{node.availablePorts} available</p>
                        <p className="text-xs text-slate-500">{node.reservedPorts} reserved</p>
                        <p className="text-xs text-slate-500">{node.portRange}</p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-500">Awaiting heartbeat</p>
                    )}
                    {node.openPorts.length > 0 ? (
                      <p className="mt-1 text-xs text-slate-500">{node.openPorts.length} open detected</p>
                    ) : null}
                  </div>
                )
              },
              { key: "maintenance", header: "Maint.", cell: (node) => <span className="text-slate-300">{node.maintenanceMode ? "Enabled" : "Disabled"}</span> },
              { key: "actions", header: "Actions", cell: (node) => <NodeActions node={node} onUpdated={replaceNode} adminRole={adminRole} /> }
            ]}
          />
        )}
      </div>
    </div>
  );
}
