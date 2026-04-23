"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Zap } from "lucide-react";
import { adminApi } from "@/lib/api/admin-api";
import { formatRam, percent } from "@/lib/utils/format";
import type { NodeSummary } from "@/types/admin";
import { StatCard } from "@/components/ui/StatCard";
import { ActionButton } from "@/components/ui/ActionButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DetailCard } from "@/components/ui/DetailCard";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";

export function DashboardClient() {
  const [summary, setSummary] = useState<NodeSummary | null>(null);

  useEffect(() => {
    adminApi.nodeSummary().then(({ summary: nextSummary }) => setSummary(nextSummary));
  }, []);

  if (!summary) {
    return <SkeletonBlock label="Loading infrastructure telemetry..." />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/70 p-6 shadow-soft">
        <SectionHeader
          eyebrow="Nodes only V1"
          title="Company infrastructure cockpit"
          description="Supervision et actions admin sur les nodes via la Phantom API, sans dependance UI avec le panel client."
          actions={
            <>
              <ActionButton onClick={() => location.assign("/nodes")}>Open nodes</ActionButton>
              <ActionButton onClick={() => location.assign("/audit-logs")}>Audit trail</ActionButton>
            </>
          }
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total nodes" value={summary.totalNodes} caption="registered" />
        <StatCard label="Healthy nodes" value={summary.healthyNodes} caption="green health" tone="good" />
        <StatCard label="Offline nodes" value={summary.offlineNodes} caption="requires attention" tone={summary.offlineNodes > 0 ? "bad" : "neutral"} />
        <StatCard label="Hosted servers" value={summary.totalHostedServers} caption="across nodes" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <StatCard label="Global RAM load" value={`${percent(summary.usedRamMb, summary.totalRamMb)}%`} caption={`${formatRam(summary.usedRamMb)} / ${formatRam(summary.totalRamMb)}`} tone="warn" />
        <StatCard label="Global CPU load" value={`${percent(summary.usedCpu, summary.totalCpu)}%`} caption={`${summary.usedCpu.toFixed(1)} / ${summary.totalCpu} cores`} tone="neutral" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <DetailCard title="Incidents recents" actions={<AlertTriangle className="text-amber" size={20} />}>
          <div className="space-y-3">
            {summary.recentIncidents.length === 0 ? (
              <p className="text-slate-400">Aucun incident recent remonte par la Hosting API.</p>
            ) : (
              summary.recentIncidents.map((incident) => (
                <div key={incident.id} className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="font-medium text-white">{incident.message}</p>
                  <p className="mt-1 text-sm text-slate-500">{new Date(incident.createdAt).toLocaleString("fr-FR")}</p>
                </div>
              ))
            )}
          </div>
        </DetailCard>
        <DetailCard title="Actions rapides" actions={<Zap className="text-accent" size={20} />}>
          <div className="grid gap-3">
            <ActionButton onClick={() => location.assign("/nodes")}>Open nodes</ActionButton>
            <ActionButton onClick={() => location.assign("/audit-logs")}>Audit trail</ActionButton>
          </div>
        </DetailCard>
      </section>
    </div>
  );
}
