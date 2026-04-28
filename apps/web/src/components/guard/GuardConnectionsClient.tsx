"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { adminApi } from "@/lib/api/admin-api";
import type { GuardAction, GuardConnectionEvent } from "@/types/admin";
import { ActionBadge, GuardNav, RiskBadge, formatMaybe } from "./GuardCommon";

const REFRESH_MS = 3_000;
const actions: Array<GuardAction | "all"> = [
  "all",
  "ping",
  "login_attempt",
  "login_success",
  "disconnect",
  "invalid_session",
  "rate_limited",
  "blocked"
];

export function GuardConnectionsClient() {
  const [connections, setConnections] = useState<GuardConnectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [ip, setIp] = useState("");
  const [country, setCountry] = useState("");
  const [server, setServer] = useState("");
  const [action, setAction] = useState<GuardAction | "all">("all");
  const [timeframe, setTimeframe] = useState<"1h" | "24h" | "7d" | "30d" | "all">("24h");

  const filters = useMemo(
    () => ({ username, ip, country, server, action, timeframe, limit: 200 }),
    [action, country, ip, server, timeframe, username]
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const { connections: next } = await adminApi.guardConnections(filters);
        if (active) setConnections(next);
      } finally {
        if (active) setLoading(false);
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [filters]);

  if (loading) {
    return (
      <AdminShell>
        <SkeletonBlock label="Loading Guard connections..." />
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
              title="Live connections"
              description="Near real-time proxy events with usernames, IPs, target servers and risk."
            />
            <GuardNav />
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_1fr_120px_1fr_170px_150px]">
            <FilterInput value={username} onChange={setUsername} placeholder="Username" />
            <FilterInput value={ip} onChange={setIp} placeholder="IP address" />
            <FilterInput value={country} onChange={setCountry} placeholder="CC" />
            <FilterInput value={server} onChange={setServer} placeholder="Server UUID" />
            <select value={action} onChange={(event) => setAction(event.target.value as GuardAction | "all")} className={selectClass}>
              {actions.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All actions" : value.replace("_", " ")}
                </option>
              ))}
            </select>
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as typeof timeframe)} className={selectClass}>
              <option value="1h">Last hour</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="30d">Last 30d</option>
              <option value="all">All time</option>
            </select>
          </div>
        </section>

        <div className="overflow-hidden rounded-2xl border border-line bg-panel/78 shadow-soft">
          <DataTable
            rows={connections}
            getRowKey={(row) => row.id}
            emptyTitle="No Guard events match these filters"
            emptyDescription="New proxy telemetry will appear here automatically."
            columns={[
              {
                key: "time",
                header: "Time",
                cell: (row) => <span className="text-slate-400">{new Date(row.createdAt).toLocaleString("fr-FR")}</span>
              },
              {
                key: "username",
                header: "Username",
                cell: (row) =>
                  row.normalizedUsername ? (
                    <Link href={`/guard/players/${encodeURIComponent(row.normalizedUsername)}`} className="font-medium text-white hover:text-accent">
                      {row.usernameAttempted ?? row.normalizedUsername}
                    </Link>
                  ) : (
                    <span className="text-slate-500">-</span>
                  )
              },
              {
                key: "ip",
                header: "IP",
                cell: (row) =>
                  row.sourceIp ? (
                    <Link href={`/guard/ip/${encodeURIComponent(row.sourceIp)}`} className="font-mono text-xs text-slate-200 hover:text-accent">
                      {row.sourceIp}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-slate-500" title={row.sourceIpHash}>
                      hashed
                    </span>
                  )
              },
              {
                key: "country",
                header: "Country",
                cell: (row) => <span className="font-mono text-xs text-slate-300">{formatMaybe(row.countryCode)}</span>
              },
              {
                key: "server",
                header: "Target",
                cell: (row) => (
                  <div>
                    <p className="text-slate-200">{row.server?.name ?? row.hostname ?? "-"}</p>
                    <p className="mt-1 font-mono text-xs text-slate-500">{row.server?.hostname ?? row.hostname ?? ""}</p>
                  </div>
                )
              },
              {
                key: "action",
                header: "Action",
                cell: (row) => <ActionBadge action={row.action} />
              },
              {
                key: "result",
                header: "Result",
                cell: (row) => <span className="text-slate-400">{row.disconnectReason ?? (row.latencyMs ? `${row.latencyMs} ms` : "-")}</span>
              },
              {
                key: "risk",
                header: "Risk",
                cell: (row) => <RiskBadge score={row.riskScore} />
              }
            ]}
          />
        </div>
      </div>
    </AdminShell>
  );
}

function FilterInput({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40"
    />
  );
}

const selectClass =
  "rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition focus:border-accent/40";
