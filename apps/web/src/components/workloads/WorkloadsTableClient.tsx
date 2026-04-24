"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/admin-api";
import { formatCpu, formatDisk, formatRam, formatWorkloadType } from "@/lib/utils/format";
import type {
  AdminRole,
  CompanyNode,
  CompanyWorkload,
  WorkloadDesiredStatus,
  WorkloadStatus
} from "@/types/admin";
import { CreateWorkloadPanel } from "./CreateWorkloadPanel";
import { WorkloadActions } from "./WorkloadActions";
import {
  WorkloadDesiredStatusBadge,
  WorkloadStatusBadge
} from "./WorkloadStatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

const WORKLOADS_REFRESH_MS = 15_000;

export function WorkloadsTableClient() {
  const router = useRouter();

  const [workloads, setWorkloads] = useState<CompanyWorkload[]>([]);
  const [nodes, setNodes] = useState<CompanyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WorkloadStatus | "all">("all");
  const [desiredStatus, setDesiredStatus] = useState<WorkloadDesiredStatus | "all">("all");
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const [{ workloads: nextWorkloads }, { nodes: nextNodes }] = await Promise.all([
          adminApi.workloads(),
          adminApi.nodes()
        ]);

        if (!active) return;
        setWorkloads(nextWorkloads);
        setNodes(nextNodes);
      } catch {
        // keep the last known snapshot
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

    const timer = setInterval(refresh, WORKLOADS_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const nodeNameById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.name])),
    [nodes]
  );

  function replaceWorkload(updated: CompanyWorkload) {
    setWorkloads((current) =>
      current.map((workload) => (workload.id === updated.id ? updated : workload))
    );
  }

  function addWorkload(created: CompanyWorkload) {
    setWorkloads((current) => [created, ...current]);
  }

  function removeWorkload(workloadId: string) {
    setWorkloads((current) => current.filter((workload) => workload.id !== workloadId));
  }

  if (loading) {
    return <SkeletonBlock label="Loading workloads inventory..." />;
  }

  const filteredWorkloads = workloads.filter((workload) => {
    const search = [
      workload.name,
      workload.type,
      workload.image,
      workload.nodeId ?? "",
      nodeNameById.get(workload.nodeId ?? "") ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return (
      search.includes(query.toLowerCase()) &&
      (status === "all" || workload.status === status) &&
      (desiredStatus === "all" || workload.desiredStatus === desiredStatus)
    );
  });

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/70 p-6 shadow-soft">
        <SectionHeader
          eyebrow="Phantom runtime"
          title="Workloads"
          description="Manage the scheduled runtime inventory, desired state and lifecycle actions."
        />

        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by workload, image, type or node"
            className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40"
          />

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkloadStatus | "all")}
            className="rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40"
          >
            <option value="all">All status</option>
            <option value="pending">Pending</option>
            <option value="creating">Creating</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
            <option value="crashed">Crashed</option>
            <option value="deleting">Deleting</option>
            <option value="deleted">Deleted</option>
          </select>

          <select
            value={desiredStatus}
            onChange={(event) =>
              setDesiredStatus(event.target.value as WorkloadDesiredStatus | "all")
            }
            className="rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40"
          >
            <option value="all">All desired state</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>
      </section>

      <CreateWorkloadPanel onCreated={addWorkload} />

      <div className="overflow-hidden rounded-2xl border border-line bg-panel/78 shadow-soft">
        {workloads.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No workloads registered"
              description="Create the first Phantom workload to start testing runtime scheduling."
            />
          </div>
        ) : (
          <DataTable
            rows={filteredWorkloads}
            getRowKey={(workload) => workload.id}
            onRowClick={(workload) => router.push(`/workloads/${workload.id}`)}
            rowClassName="cursor-pointer hover:bg-white/[0.025]"
            emptyTitle="No workload matches these filters"
            emptyDescription="Clear search or filters to recover the full runtime inventory."
            columns={[
              {
                key: "name",
                header: "Name",
                cell: (workload) => (
                  <div>
                    <Link
                      href={`/workloads/${workload.id}`}
                      className="font-semibold text-white hover:text-accent"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {workload.name}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">{workload.image}</p>
                  </div>
                )
              },
              {
                key: "type",
                header: "Type",
                cell: (workload) => (
                  <span className="text-slate-300">{formatWorkloadType(workload.type)}</span>
                )
              },
              {
                key: "node",
                header: "Assigned node",
                cell: (workload) => (
                  <div className="text-slate-300">
                    <p>{workload.nodeId ? nodeNameById.get(workload.nodeId) ?? workload.nodeId : "Unassigned"}</p>
                    {workload.nodeId ? (
                      <p className="mt-1 font-mono text-xs text-slate-500">{workload.nodeId}</p>
                    ) : null}
                  </div>
                )
              },
              {
                key: "status",
                header: "Status",
                cell: (workload) => <WorkloadStatusBadge status={workload.status} />
              },
              {
                key: "desired",
                header: "Desired",
                cell: (workload) => (
                  <WorkloadDesiredStatusBadge desiredStatus={workload.desiredStatus} />
                )
              },
              {
                key: "resources",
                header: "CPU / RAM / Disk",
                cell: (workload) => (
                  <div className="text-slate-300">
                    <p>{formatCpu(workload.requestedCpu)} CPU</p>
                    <p className="text-xs text-slate-500">
                      {formatRam(workload.requestedRamMb)} / {formatDisk(workload.requestedDiskGb)}
                    </p>
                  </div>
                )
              },
              {
                key: "ports",
                header: "Ports",
                cell: (workload) =>
                  workload.ports.length === 0 ? (
                    <span className="text-slate-500">No ports</span>
                  ) : (
                    <div className="space-y-1">
                      {workload.ports.slice(0, 3).map((port) => (
                        <p key={port.id} className="font-mono text-xs text-slate-300">
                          {port.internalPort} -&gt; {port.externalPort}/{port.protocol}
                        </p>
                      ))}
                      {workload.ports.length > 3 ? (
                        <p className="text-xs text-slate-500">
                          +{workload.ports.length - 3} more
                        </p>
                      ) : null}
                    </div>
                  )
              },
              {
                key: "actions",
                header: "Actions",
                cell: (workload) => (
                  <div onClick={(event) => event.stopPropagation()}>
                    <WorkloadActions
                      workload={workload}
                      adminRole={adminRole}
                      onUpdated={replaceWorkload}
                      onRemoved={removeWorkload}
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
