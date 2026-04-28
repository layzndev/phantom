"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { DataTable } from "@/components/ui/DataTable";
import { DetailCard } from "@/components/ui/DetailCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { StatCard } from "@/components/ui/StatCard";
import { adminApi } from "@/lib/api/admin-api";
import type { GuardPlayerProfile } from "@/types/admin";
import { ActionBadge, GuardNav, RiskBadge, formatMaybe } from "./GuardCommon";

export function GuardPlayerClient({ username }: { username: string }) {
  const [profile, setProfile] = useState<GuardPlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProfile(await adminApi.guardPlayer(username));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load player profile.");
    }
  }, [username]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = async (action: "trust" | "clear" | "note") => {
    setBusy(action);
    try {
      if (action === "trust") await adminApi.trustGuardPlayer(username, { note: "Trusted by admin" });
      if (action === "clear") await adminApi.clearGuardPlayerScore(username);
      if (action === "note" && note.trim()) {
        await adminApi.addGuardPlayerNote(username, note.trim());
        setNote("");
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <AdminShell>
        <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-8 text-red-100">{error}</div>
      </AdminShell>
    );
  }

  if (!profile) {
    return (
      <AdminShell>
        <SkeletonBlock label="Loading player analytics..." />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
            <SectionHeader
              eyebrow="Player profile"
              title={profile.profile.displayUsername ?? profile.profile.normalizedUsername}
              description="Cross-server movement, countries, risk and recent connection timeline."
            />
            <GuardNav />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Risk score" value={profile.profile.riskScore} tone={profile.profile.riskScore >= 70 ? "bad" : profile.profile.riskScore >= 35 ? "warn" : "good"} />
            <StatCard label="Servers visited" value={profile.profile.totalServersVisited} />
            <StatCard label="Total sessions" value={profile.profile.totalPlaySessions} />
            <StatCard label="Connections" value={profile.profile.totalConnections} />
            <StatCard label="Countries" value={profile.countries.length} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button className={buttonClass} disabled={busy === "trust"} onClick={() => void runAction("trust")}>Mark trusted</button>
            <button className={buttonClass} disabled={busy === "clear"} onClick={() => void runAction("clear")}>Clear score</button>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <DetailCard title="Recent IPs">
            <div className="space-y-3">
              {profile.recentIps.map((ip) => (
                <div key={ip.sourceIpHash} className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
                  {ip.sourceIp ? (
                    <Link href={`/guard/ip/${encodeURIComponent(ip.sourceIp)}`} className="font-mono text-slate-100 hover:text-accent">
                      {ip.sourceIp}
                    </Link>
                  ) : (
                    <span className="font-mono text-slate-500">hashed</span>
                  )}
                  <p className="mt-1 text-xs text-slate-500">{formatMaybe(ip.countryCode)} · {new Date(ip.lastSeenAt).toLocaleString("fr-FR")}</p>
                </div>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Servers">
            <div className="space-y-3">
              {profile.servers.map((server) => (
                <div key={server.serverId} className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
                  <Link href={`/services/minecraft/${server.serverId}`} className="text-slate-100 hover:text-accent">
                    {server.serverName}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">{server.joins} joins · {server.totalPlayMinutes} min</p>
                </div>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Notes">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add internal note"
              className="min-h-28 w-full rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm text-white outline-none placeholder:text-slate-600"
            />
            <button className={`${buttonClass} mt-3`} disabled={busy === "note" || note.trim().length === 0} onClick={() => void runAction("note")}>
              Add note
            </button>
            {profile.profile.notes ? <pre className="mt-4 whitespace-pre-wrap text-xs text-slate-400">{profile.profile.notes}</pre> : null}
          </DetailCard>
        </section>

        <div className="overflow-hidden rounded-2xl border border-line bg-panel/78 shadow-soft">
          <DataTable
            rows={profile.timeline}
            getRowKey={(row) => row.id}
            emptyTitle="No timeline events"
            columns={[
              { key: "time", header: "Time", cell: (row) => <span className="text-slate-400">{new Date(row.createdAt).toLocaleString("fr-FR")}</span> },
              { key: "action", header: "Action", cell: (row) => <ActionBadge action={row.action} /> },
              { key: "server", header: "Server", cell: (row) => <span className="text-slate-200">{row.server?.name ?? row.hostname ?? "-"}</span> },
              { key: "country", header: "Country", cell: (row) => <span className="font-mono text-xs text-slate-300">{formatMaybe(row.countryCode)}</span> },
              { key: "result", header: "Result", cell: (row) => <span className="text-slate-400">{row.disconnectReason ?? "-"}</span> },
              { key: "risk", header: "Risk", cell: (row) => <RiskBadge score={row.riskScore} /> }
            ]}
          />
        </div>
      </div>
    </AdminShell>
  );
}

const buttonClass =
  "rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50";
