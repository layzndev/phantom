"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import {
  formatCpu,
  formatDateTime,
  formatDisk,
  formatRam,
  formatWorkloadType
} from "@/lib/utils/format";
import type { AdminRole, CompanyNode, CompanyWorkload } from "@/types/admin";
import { WorkloadActions } from "./WorkloadActions";
import {
  WorkloadDesiredStatusBadge,
  WorkloadStatusBadge
} from "./WorkloadStatusBadge";
import { DetailCard } from "@/components/ui/DetailCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

const WORKLOAD_DETAIL_REFRESH_MS = 15_000;

export function WorkloadDetailClient({ id }: { id: string }) {
  const [workload, setWorkload] = useState<CompanyWorkload | null>(null);
  const [nodes, setNodes] = useState<CompanyNode[]>([]);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadedOnceRef.current = false;

    async function refresh() {
      try {
        const [{ workload: nextWorkload }, { nodes: nextNodes }] = await Promise.all([
          adminApi.workload(id),
          adminApi.nodes()
        ]);

        if (!active) return;

        setWorkload(nextWorkload);
        setNodes(nextNodes);
        setError(null);
        loadedOnceRef.current = true;
      } catch (detailError) {
        if (!active) return;

        if (!loadedOnceRef.current) {
          setError(
            detailError instanceof Error ? detailError.message : "Unable to load workload"
          );
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

    const timer = setInterval(refresh, WORKLOAD_DETAIL_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);

  const assignedNode = useMemo(
    () => nodes.find((node) => node.id === workload?.nodeId) ?? null,
    [nodes, workload?.nodeId]
  );

  if (error) {
    return (
      <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-8 text-red-100">
        {error}
      </div>
    );
  }

  if (!workload) {
    return <SkeletonBlock label="Loading workload detail..." />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <SectionHeader
              eyebrow="Workload detail"
              title={workload.name}
              description={workload.image}
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <WorkloadStatusBadge status={workload.status} />
              <WorkloadDesiredStatusBadge desiredStatus={workload.desiredStatus} />
            </div>

            <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-slate-500">ID</dt>
                <dd className="mt-1 font-mono text-slate-200">{workload.id}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Type</dt>
                <dd className="mt-1 text-slate-200">{formatWorkloadType(workload.type)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Container</dt>
                <dd className="mt-1 font-mono text-slate-200">
                  {workload.containerId ?? "Not reported yet"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Heartbeat</dt>
                <dd className="mt-1 text-slate-200">
                  {formatDateTime(workload.lastHeartbeatAt)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Assigned node</dt>
                <dd className="mt-1 text-slate-200">
                  {assignedNode ? (
                    <Link href={`/nodes/${assignedNode.id}`} className="hover:text-accent">
                      {assignedNode.name}
                    </Link>
                  ) : workload.nodeId ? (
                    workload.nodeId
                  ) : (
                    "Pending placement"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Desired status</dt>
                <dd className="mt-1 text-slate-200">{workload.desiredStatus}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Runtime status</dt>
                <dd className="mt-1 text-slate-200">{workload.status}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last exit code</dt>
                <dd className="mt-1 text-slate-200">
                  {workload.lastExitCode === null ? "None" : workload.lastExitCode}
                </dd>
              </div>
            </dl>
          </div>

          <WorkloadActions workload={workload} adminRole={adminRole} onUpdated={setWorkload} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <DetailCard title="Resources">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">CPU</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {formatCpu(workload.requestedCpu)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">RAM</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {formatRam(workload.requestedRamMb)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Disk</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {formatDisk(workload.requestedDiskGb)}
              </p>
            </div>
          </div>
        </DetailCard>

        <DetailCard title="Ports">
          <div className="space-y-3">
            {workload.ports.length === 0 ? (
              <p className="text-slate-500">No exposed ports configured.</p>
            ) : null}

            {workload.ports.map((port) => (
              <div
                key={port.id}
                className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-4"
              >
                <div>
                  <p className="font-mono text-sm text-white">{port.internalPort}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                    Internal
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-white">
                    {port.externalPort}/{port.protocol}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                    External
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DetailCard>

        <DetailCard title="Desired vs runtime">
          <div className="space-y-3">
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Desired status</p>
              <p className="mt-3 text-xl font-semibold text-white">{workload.desiredStatus}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Runtime status</p>
              <p className="mt-3 text-xl font-semibold text-white">{workload.status}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Restart count</p>
              <p className="mt-3 text-xl font-semibold text-white">{workload.restartCount}</p>
            </div>
          </div>
        </DetailCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <DetailCard title="Timeline" description="Recent workload status events from the control plane.">
          <div className="space-y-3">
            {workload.statusEvents.length === 0 ? (
              <p className="text-slate-500">No runtime history yet.</p>
            ) : null}

            {workload.statusEvents.map((event) => (
              <div key={event.id} className="rounded-2xl bg-white/[0.04] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <WorkloadStatusBadge status={event.newStatus} />
                  {event.previousStatus ? (
                    <p className="text-xs text-slate-500">from {event.previousStatus}</p>
                  ) : null}
                </div>
                <p className="mt-3 text-sm text-slate-200">
                  {event.reason ?? "No reason provided."}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                  {formatDateTime(event.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </DetailCard>

        <DetailCard
          title="Phantom console"
          description="Placeholder console area for future runtime logs and interactive exec."
        >
          <div className="rounded-2xl border border-line bg-obsidian p-4 font-mono text-xs text-slate-300">
            <p>[phantom-console] feature not wired yet</p>
            <p className="py-1">workload_id={workload.id}</p>
            <p className="py-1">node_id={workload.nodeId ?? "unassigned"}</p>
            <p className="py-1">status={workload.status}</p>
            <p className="py-1 text-slate-500">
              stdout/stderr streaming will land here in a later runtime iteration.
            </p>
          </div>
        </DetailCard>
      </section>

      <DetailCard title="Config JSON">
        <pre className="overflow-x-auto rounded-2xl border border-line bg-obsidian p-4 text-xs text-slate-300">
          {JSON.stringify(workload.config, null, 2)}
        </pre>
      </DetailCard>
    </div>
  );
}
