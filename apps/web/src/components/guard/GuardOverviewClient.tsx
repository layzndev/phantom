"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { StatCard } from "@/components/ui/StatCard";
import { adminApi } from "@/lib/api/admin-api";
import type { GuardOverview } from "@/types/admin";
import { GuardNav, MiniBarChart } from "./GuardCommon";

const REFRESH_MS = 5_000;

export function GuardOverviewClient() {
  const [overview, setOverview] = useState<GuardOverview | null>(null);
  const [timeframe, setTimeframe] = useState<"1h" | "24h" | "7d" | "30d">("24h");

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const next = await adminApi.guardOverview(timeframe);
      if (active) setOverview(next);
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [timeframe]);

  if (!overview) {
    return (
      <AdminShell>
        <SkeletonBlock label="Loading Phantom Guard..." />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
            <SectionHeader
              eyebrow="Phantom Guard"
              title="Connection Intelligence"
              description="Network-wide connection analytics, player movement and abuse signals."
            />
            <div className="flex flex-wrap items-center gap-3">
              <GuardNav />
              <select
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value as typeof timeframe)}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200 outline-none"
              >
                <option value="1h">Last hour</option>
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7d</option>
                <option value="30d">Last 30d</option>
              </select>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Active connections" value={overview.cards.activeConnections} tone="good" />
            <StatCard label="Unique IPs today" value={overview.cards.uniqueIpsToday} />
            <StatCard label="Usernames today" value={overview.cards.uniqueUsernamesToday} />
            <StatCard label="Invalid sessions" value={`${overview.cards.invalidSessionRate}%`} tone={overview.cards.invalidSessionRate > 20 ? "bad" : "neutral"} />
            <StatCard label="Suspected bots" value={overview.cards.suspectedBots} tone={overview.cards.suspectedBots > 0 ? "warn" : "good"} />
            <StatCard
              label="Top attacked"
              value={overview.cards.topAttackedServer?.name ?? "-"}
              caption={overview.cards.topAttackedServer ? `${overview.cards.topAttackedServer.suspiciousEvents} events` : undefined}
              tone={overview.cards.topAttackedServer ? "warn" : "neutral"}
            />
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <Panel title="Joins per hour">
            <MiniBarChart data={overview.charts.joinsPerHour.slice(-12)} />
          </Panel>
          <Panel title="Failed logins per hour">
            <MiniBarChart data={overview.charts.failedLoginsPerHour.slice(-12)} />
          </Panel>
          <Panel title="Top servers">
            <MiniBarChart data={overview.charts.topServers} labelKey="serverName" />
          </Panel>
          <Panel title="Geo overview">
            <MiniBarChart data={overview.charts.topCountries} labelKey="countryCode" />
          </Panel>
        </section>

        <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-display text-lg font-semibold text-white">Investigation shortcuts</p>
              <p className="mt-1 text-sm text-slate-500">Jump into live events when the overview starts to move.</p>
            </div>
            <Link
              href="/guard/connections"
              className="rounded-xl border border-accent/25 bg-accent/[0.08] px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/[0.13]"
            >
              Open live table
            </Link>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
      <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
      <div className="mt-5">{children}</div>
    </div>
  );
}
