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
import type { GuardIpProfile } from "@/types/admin";
import { ActionBadge, GuardNav, RiskBadge, formatMaybe } from "./GuardCommon";

export function GuardIpClient({ ip }: { ip: string }) {
  const [profile, setProfile] = useState<GuardIpProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProfile(await adminApi.guardIp(ip));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load IP profile.");
    }
  }, [ip]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = async (action: "block" | "rate" | "trust" | "clear" | "note") => {
    setBusy(action);
    try {
      if (action === "block") await adminApi.blockGuardIp(ip, { expiresMinutes: 60, reason: "Admin temporary block" });
      if (action === "rate") await adminApi.rateLimitGuardIp(ip, { expiresMinutes: 60, rateLimitPerMinute: 10, reason: "Admin rate limit" });
      if (action === "trust") await adminApi.trustGuardIp(ip, { note: "Trusted by admin" });
      if (action === "clear") await adminApi.clearGuardIpScore(ip);
      if (action === "note" && note.trim()) {
        await adminApi.addGuardIpNote(ip, note.trim());
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
        <SkeletonBlock label="Loading IP analytics..." />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
            <SectionHeader
              eyebrow="IP profile"
              title={profile.profile.sourceIp ?? ip}
              description="Usernames, target servers, ASN context, rules and recent activity."
            />
            <GuardNav />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Risk score" value={profile.profile.riskScore} tone={profile.profile.riskScore >= 70 ? "bad" : profile.profile.riskScore >= 35 ? "warn" : "good"} />
            <StatCard label="Requests hour" value={profile.requestsLastHour} />
            <StatCard label="Requests day" value={profile.requestsLastDay} />
            <StatCard label="Usernames" value={profile.profile.totalUsernames} />
            <StatCard label="Servers targeted" value={profile.profile.totalServersTargeted} />
            <StatCard label="Blocked" value={profile.profile.blocked ? "Yes" : "No"} tone={profile.profile.blocked ? "bad" : "good"} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button className={buttonClass} disabled={busy === "block"} onClick={() => void runAction("block")}>Temp block</button>
            <button className={buttonClass} disabled={busy === "rate"} onClick={() => void runAction("rate")}>Rate limit</button>
            <button className={buttonClass} disabled={busy === "trust"} onClick={() => void runAction("trust")}>Mark trusted</button>
            <button className={buttonClass} disabled={busy === "clear"} onClick={() => void runAction("clear")}>Clear score</button>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <DetailCard title="Usernames">
            <ListBlock
              rows={profile.usernames.map((entry) => ({
                key: entry.username,
                label: entry.username,
                href: `/guard/players/${encodeURIComponent(entry.username)}`,
                meta: `${entry.count} events`
              }))}
            />
          </DetailCard>
          <DetailCard title="Servers targeted">
            <ListBlock
              rows={profile.servers.map((entry) => ({
                key: entry.serverId,
                label: entry.serverName,
                href: `/services/minecraft/${entry.serverId}`,
                meta: `${entry.count} events`
              }))}
            />
          </DetailCard>
          <DetailCard title="Rules and notes">
            <div className="space-y-3">
              {profile.activeRules.map((rule) => (
                <div key={rule.id} className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
                  <p className="text-slate-100">{rule.action.replace("_", " ")}</p>
                  <p className="mt-1 text-xs text-slate-500">{rule.expiresAt ? `expires ${new Date(rule.expiresAt).toLocaleString("fr-FR")}` : "no expiry"}</p>
                </div>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add internal note"
              className="mt-4 min-h-24 w-full rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm text-white outline-none placeholder:text-slate-600"
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
              { key: "username", header: "Username", cell: (row) => row.normalizedUsername ? <Link className="text-white hover:text-accent" href={`/guard/players/${encodeURIComponent(row.normalizedUsername)}`}>{row.usernameAttempted ?? row.normalizedUsername}</Link> : <span className="text-slate-500">-</span> },
              { key: "action", header: "Action", cell: (row) => <ActionBadge action={row.action} /> },
              { key: "country", header: "Country", cell: (row) => <span className="font-mono text-xs text-slate-300">{formatMaybe(row.countryCode)}</span> },
              { key: "server", header: "Server", cell: (row) => <span className="text-slate-200">{row.server?.name ?? row.hostname ?? "-"}</span> },
              { key: "risk", header: "Risk", cell: (row) => <RiskBadge score={row.riskScore} /> }
            ]}
          />
        </div>
      </div>
    </AdminShell>
  );
}

function ListBlock({
  rows
}: {
  rows: Array<{ key: string; label: string; href: string; meta: string }>;
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-sm text-slate-500">No data yet.</p> : null}
      {rows.map((row) => (
        <div key={row.key} className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
          <Link href={row.href} className="text-slate-100 hover:text-accent">
            {row.label}
          </Link>
          <p className="mt-1 text-xs text-slate-500">{row.meta}</p>
        </div>
      ))}
    </div>
  );
}

const buttonClass =
  "rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50";
