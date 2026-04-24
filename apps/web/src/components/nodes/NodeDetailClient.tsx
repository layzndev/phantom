"use client";

import { useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import { formatDateTime } from "@/lib/utils/format";
import type { AdminRole, CompanyNode } from "@/types/admin";
import { NodeCapacityCard } from "./NodeCapacityCard";
import { NodePortsCard } from "./NodePortsCard";
import { NodeServersTable } from "./NodeServersTable";
import { NodeActions } from "./NodeActions";
import { NodeHealthBadge } from "./NodeHealthBadge";
import { NodeStatusBadge } from "./NodeStatusBadge";
import { DetailCard } from "@/components/ui/DetailCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

const NODE_DETAIL_REFRESH_MS = 15_000;

export function NodeDetailClient({ id }: { id: string }) {
  const [node, setNode] = useState<CompanyNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadedOnceRef.current = false;

    async function refresh() {
      try {
        const { node: nextNode } = await adminApi.node(id);
        if (!active) return;
        setNode(nextNode);
        setError(null);
        loadedOnceRef.current = true;
      } catch (detailError) {
        if (!active) return;
        if (!loadedOnceRef.current) {
          setError(detailError instanceof Error ? detailError.message : "Unable to load node");
        }
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

    const timer = setInterval(refresh, NODE_DETAIL_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);

  if (error) {
    return <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-8 text-red-100">{error}</div>;
  }

  if (!node) {
    return <SkeletonBlock label="Loading node detail..." />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <SectionHeader
              eyebrow="Node detail"
              title={node.name}
              description="Vue haute confiance du registre Phantom avant branchement runtime."
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <NodeStatusBadge status={node.status} />
              <NodeHealthBadge health={node.health} />
            </div>
            <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-slate-500">ID</dt><dd className="mt-1 font-mono text-slate-200">{node.id}</dd></div>
              <div><dt className="text-slate-500">Provider</dt><dd className="mt-1 text-slate-200">{node.provider}</dd></div>
              <div><dt className="text-slate-500">Region</dt><dd className="mt-1 text-slate-200">{node.region}</dd></div>
              <div><dt className="text-slate-500">Runtime</dt><dd className="mt-1 text-slate-200">{node.runtimeMode}</dd></div>
              <div><dt className="text-slate-500">Internal host</dt><dd className="mt-1 font-mono text-slate-200">{node.internalHost}</dd></div>
              <div><dt className="text-slate-500">Public host</dt><dd className="mt-1 font-mono text-slate-200">{node.publicHost}</dd></div>
              <div><dt className="text-slate-500">Heartbeat</dt><dd className="mt-1 text-slate-200">{formatDateTime(node.heartbeat)}</dd></div>
              <div><dt className="text-slate-500">Maintenance</dt><dd className="mt-1 text-slate-200">{node.maintenanceMode ? "Enabled" : "Disabled"}</dd></div>
            </dl>
          </div>

          <NodeActions node={node} onUpdated={setNode} adminRole={adminRole} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <NodeCapacityCard node={node} />
        <NodePortsCard node={node} adminRole={adminRole} onUpdated={setNode} />
      </section>

      <NodeServersTable servers={node.hostedServersList} />

      <section className="grid gap-6 xl:grid-cols-2">
        <DetailCard title="Timeline">
          <div className="space-y-3">
            {(node.history ?? []).length === 0 ? <p className="text-slate-500">No history provided.</p> : null}
            {(node.history ?? []).map((event) => (
              <div key={event.id} className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-sm font-medium text-white">{event.message}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                  {event.type} - {formatDateTime(event.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </DetailCard>

        <DetailCard title="Node logs">
          <div className="rounded-2xl border border-line bg-obsidian p-4 font-mono text-xs text-slate-300">
            {(node.logs ?? ["No logs."]).map((line) => (
              <p key={line} className="py-1">{line}</p>
            ))}
          </div>
        </DetailCard>
      </section>
    </div>
  );
}