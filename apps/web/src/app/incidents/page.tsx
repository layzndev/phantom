"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { StatCard } from "@/components/ui/StatCard";
import { adminApi } from "@/lib/api/admin-api";
import type { Incident, IncidentScope, IncidentSeverity, IncidentStatus, IncidentSummary } from "@/types/admin";

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [summary, setSummary] = useState<IncidentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<IncidentStatus | "all">("all");
  const [severity, setSeverity] = useState<IncidentSeverity | "all">("all");
  const [scope, setScope] = useState<IncidentScope | "all">("all");
  const [windowFilter, setWindowFilter] = useState<"24h" | "7d" | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const [{ incidents: nextIncidents }, { summary: nextSummary }] = await Promise.all([
          adminApi.incidents({ limit: 200, window: windowFilter }),
          adminApi.incidentSummary()
        ]);
        if (!active) return;
        setIncidents(nextIncidents);
        setSummary(nextSummary);
      } finally {
        if (active) setLoading(false);
      }
    };

    void refresh();
    return () => {
      active = false;
    };
  }, [windowFilter]);

  const filtered = useMemo(() => {
    return incidents.filter((incident) => {
      const text = [
        incident.title,
        incident.description ?? "",
        incident.scope,
        incident.sourceType ?? "",
        incident.sourceId ?? "",
        incident.assignedTo?.displayName ?? "",
        incident.assignedTo?.email ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return (
        (status === "all" || incident.status === status) &&
        (severity === "all" || incident.severity === severity) &&
        (scope === "all" || incident.scope === scope) &&
        text.includes(query.trim().toLowerCase())
      );
    });
  }, [incidents, query, scope, severity, status]);

  if (loading || !summary) {
    return (
      <AdminShell>
        <SkeletonBlock label="Loading incidents..." />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
          <SectionHeader
            eyebrow="SRE"
            title="Incidents"
            description="Deduplicated infrastructure incidents with status, ownership and timeline."
          />

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Open critical" value={summary.openCritical} tone="bad" />
            <StatCard label="Open total" value={summary.openTotal} tone="warn" />
            <StatCard label="Acknowledged" value={summary.acknowledged} tone="neutral" />
            <StatCard
              label="Auto-resolved 24h"
              value={summary.autoResolvedLast24h}
              tone="good"
            />
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_180px_180px_180px_140px]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, source or assignee"
              className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40"
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as IncidentStatus | "all")}
              className={selectClass}
            >
              <option value="all">All status</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as IncidentSeverity | "all")
              }
              className={selectClass}
            >
              <option value="all">All severity</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as IncidentScope | "all")}
              className={selectClass}
            >
              <option value="all">All scope</option>
              <option value="node">Node</option>
              <option value="proxy">Proxy</option>
              <option value="minecraft_server">Minecraft</option>
              <option value="api">API</option>
              <option value="database">Database</option>
              <option value="global">Global</option>
              <option value="billing">Billing</option>
            </select>
            <select
              value={windowFilter}
              onChange={(event) => setWindowFilter(event.target.value as "24h" | "7d" | "all")}
              className={selectClass}
            >
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="all">All time</option>
            </select>
          </div>
        </section>

        <div className="overflow-hidden rounded-2xl border border-line bg-panel/78 shadow-soft">
          <DataTable
            rows={filtered}
            getRowKey={(incident) => incident.id}
            emptyTitle="No incident matches these filters"
            emptyDescription="Change filters to inspect more incident history."
            columns={[
              {
                key: "severity",
                header: "Severity",
                cell: (incident) => (
                  <span className={severityBadgeClass(incident.severity)}>
                    {incident.severity}
                  </span>
                )
              },
              {
                key: "status",
                header: "Status",
                cell: (incident) => (
                  <span className={statusBadgeClass(incident.status)}>{incident.status}</span>
                )
              },
              {
                key: "title",
                header: "Title",
                cell: (incident) => (
                  <div>
                    <Link
                      href={`/incidents/${encodeURIComponent(incident.id)}`}
                      className="font-medium text-white hover:text-accent"
                    >
                      {incident.title}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {incident.description ?? incident.dedupeKey}
                    </p>
                  </div>
                )
              },
              {
                key: "scope",
                header: "Scope",
                cell: (incident) => (
                  <span className="text-slate-300">{formatScope(incident.scope)}</span>
                )
              },
              {
                key: "source",
                header: "Source",
                cell: (incident) => (
                  <span className="font-mono text-xs text-slate-400">
                    {incident.sourceType ?? "-"}:{incident.sourceId ?? "-"}
                  </span>
                )
              },
              {
                key: "started",
                header: "Started",
                cell: (incident) => (
                  <span className="text-slate-400">
                    {new Date(incident.startedAt).toLocaleString("fr-FR")}
                  </span>
                )
              },
              {
                key: "duration",
                header: "Duration",
                cell: (incident) => (
                  <span className="text-slate-300">
                    {formatDuration(incident.startedAt, incident.resolvedAt)}
                  </span>
                )
              },
              {
                key: "assigned",
                header: "Assigned",
                cell: (incident) => (
                  <span className="text-slate-300">
                    {incident.assignedTo?.displayName ?? "-"}
                  </span>
                )
              },
              {
                key: "lastSeen",
                header: "Last seen",
                cell: (incident) => (
                  <span className="text-slate-400">
                    {new Date(incident.lastSeenAt).toLocaleString("fr-FR")}
                  </span>
                )
              }
            ]}
          />
        </div>
      </div>
    </AdminShell>
  );
}

function severityBadgeClass(severity: IncidentSeverity) {
  switch (severity) {
    case "critical":
      return "inline-flex rounded-full border border-red-300/25 bg-red-400/[0.075] px-2.5 py-1 text-xs font-medium text-red-200";
    case "high":
      return "inline-flex rounded-full border border-orange-300/25 bg-orange-400/[0.08] px-2.5 py-1 text-xs font-medium text-orange-100";
    case "medium":
      return "inline-flex rounded-full border border-amber/25 bg-amber/[0.08] px-2.5 py-1 text-xs font-medium text-amber";
    case "low":
    default:
      return "inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-300";
  }
}

function statusBadgeClass(status: IncidentStatus) {
  switch (status) {
    case "open":
      return "text-red-200";
    case "acknowledged":
      return "text-amber";
    case "resolved":
    default:
      return "text-emerald-200";
  }
}

function formatScope(scope: IncidentScope) {
  return scope.replaceAll("_", " ");
}

function formatDuration(startedAt: string, resolvedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const selectClass =
  "rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-slate-200 outline-none focus:border-accent/40";
