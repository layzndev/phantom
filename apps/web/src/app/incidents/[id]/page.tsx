"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminShell } from "@/components/layout/AdminShell";
import { DetailCard } from "@/components/ui/DetailCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { adminApi } from "@/lib/api/admin-api";
import type { Incident, IncidentSeverity, IncidentStatus } from "@/types/admin";

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const incidentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  useEffect(() => {
    let active = true;
    void adminApi
      .incident(incidentId)
      .then(({ incident: nextIncident }) => {
        if (!active) return;
        setIncident(nextIncident);
        setRootCause(nextIncident.rootCause ?? "");
        setInternalNotes(nextIncident.internalNotes ?? "");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [incidentId]);

  if (loading || !incident) {
    return (
      <AdminShell>
        <SkeletonBlock label="Loading incident..." />
      </AdminShell>
    );
  }

  const sourceHref =
    incident.scope === "node" && incident.sourceId
      ? `/nodes/${encodeURIComponent(incident.sourceId)}`
      : incident.scope === "minecraft_server" && incident.sourceId
        ? `/services/minecraft/${encodeURIComponent(incident.sourceId)}`
        : null;

  return (
    <AdminShell>
      <div className="space-y-6">
        <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
          <SectionHeader
            eyebrow="Incident detail"
            title={incident.title}
            description={incident.description ?? incident.dedupeKey}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={severityBadgeClass(incident.severity)}>{incident.severity}</span>
            <span className={statusBadgeClass(incident.status)}>{incident.status}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              {incident.scope.replaceAll("_", " ")}
            </span>
            {sourceHref ? (
              <Link href={sourceHref} className="text-sm text-accent hover:text-accent/80">
                Open source
              </Link>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <DetailCard title="Overview">
            <dl className="grid gap-4 sm:grid-cols-2">
              <MetricRow label="Started" value={formatDateTime(incident.startedAt)} />
              <MetricRow label="Last seen" value={formatDateTime(incident.lastSeenAt)} />
              <MetricRow label="Resolved" value={formatDateTime(incident.resolvedAt)} />
              <MetricRow label="Duration" value={formatDuration(incident.startedAt, incident.resolvedAt)} />
              <MetricRow
                label="Assigned"
                value={incident.assignedTo?.displayName ?? "Unassigned"}
              />
              <MetricRow
                label="Acknowledged by"
                value={incident.acknowledgedBy?.displayName ?? "-"}
              />
            </dl>
          </DetailCard>

          <DetailCard title="Actions">
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() =>
                  void adminApi.acknowledgeIncident(incident.id).then(({ incident }) => setIncident(incident))
                }
                className={actionClass}
              >
                Acknowledge
              </button>
              <button
                type="button"
                onClick={() =>
                  void adminApi.assignIncidentToMe(incident.id).then(({ incident }) => setIncident(incident))
                }
                className={actionClass}
              >
                Assign to me
              </button>
              <button
                type="button"
                onClick={() =>
                  void adminApi
                    .resolveIncident(incident.id, { rootCause, internalNotes })
                    .then(({ incident }) => setIncident(incident))
                }
                className={actionClass}
              >
                Resolve manually
              </button>
              <button
                type="button"
                onClick={() =>
                  void adminApi.reopenIncident(incident.id).then(({ incident }) => setIncident(incident))
                }
                className={actionClass}
              >
                Reopen
              </button>
            </div>
          </DetailCard>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <DetailCard title="Notes">
            <div className="space-y-4">
              <label className="grid gap-2 text-sm text-white">
                <span>Root cause</span>
                <textarea
                  value={rootCause}
                  onChange={(event) => setRootCause(event.target.value)}
                  rows={4}
                  className={textareaClass}
                />
              </label>
              <label className="grid gap-2 text-sm text-white">
                <span>Internal notes</span>
                <textarea
                  value={internalNotes}
                  onChange={(event) => setInternalNotes(event.target.value)}
                  rows={6}
                  className={textareaClass}
                />
              </label>
              <label className="grid gap-2 text-sm text-white">
                <span>Add timeline note</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  className={textareaClass}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  void adminApi.addIncidentNote(incident.id, note).then(({ incident }) => {
                    setIncident(incident);
                    setInternalNotes(incident.internalNotes ?? "");
                    setNote("");
                  })
                }
                disabled={note.trim().length === 0}
                className={actionClass}
              >
                Add internal note
              </button>
            </div>
          </DetailCard>

          <DetailCard title="Timeline">
            <div className="space-y-4">
              {incident.events.map((event) => (
                <div key={event.id} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{event.message}</p>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {event.type}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatDateTime(event.createdAt)}
                    {event.actorDisplayName ? ` • ${event.actorDisplayName}` : ""}
                  </p>
                  {event.metadata ? (
                    <details className="mt-3 rounded-xl border border-white/5 bg-obsidian/40 p-3">
                      <summary className="cursor-pointer text-xs text-slate-400">
                        Metadata
                      </summary>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-300">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </DetailCard>
        </section>

        <DetailCard title="Metadata">
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-slate-300">
            {JSON.stringify(incident.metadata, null, 2)}
          </pre>
        </DetailCard>
      </div>
    </AdminShell>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-1 break-all text-slate-200">{value}</dd>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
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
      return "inline-flex rounded-full border border-red-300/20 bg-red-400/[0.06] px-2.5 py-1 text-xs text-red-200";
    case "acknowledged":
      return "inline-flex rounded-full border border-amber/20 bg-amber/[0.06] px-2.5 py-1 text-xs text-amber";
    case "resolved":
    default:
      return "inline-flex rounded-full border border-emerald-300/20 bg-emerald-400/[0.06] px-2.5 py-1 text-xs text-emerald-200";
  }
}

const actionClass =
  "rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white transition hover:bg-white/[0.08]";

const textareaClass =
  "rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40";
