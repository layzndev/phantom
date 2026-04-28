"use client";

import clsx from "clsx";
import Link from "next/link";
import type { GuardAction } from "@/types/admin";

export function GuardNav() {
  return (
    <div className="flex flex-wrap gap-2">
      <GuardNavLink href="/guard/overview" label="Overview" />
      <GuardNavLink href="/guard/connections" label="Connections" />
    </div>
  );
}

export function GuardNavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200 transition hover:border-accent/30 hover:bg-accent/[0.08]"
    >
      {label}
    </Link>
  );
}

export function RiskBadge({ score }: { score: number }) {
  const tone = score >= 70 ? "bad" : score >= 35 ? "warn" : "good";
  return (
    <span
      className={clsx(
        "inline-flex min-w-14 justify-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        tone === "bad" && "border-red-300/25 bg-red-400/[0.09] text-red-100",
        tone === "warn" && "border-amber/25 bg-amber/[0.09] text-amber",
        tone === "good" && "border-accent/25 bg-accent/[0.09] text-accent"
      )}
    >
      {score}
    </span>
  );
}

export function ActionBadge({ action }: { action: GuardAction | string }) {
  const dangerous = action === "blocked" || action === "invalid_session" || action === "rate_limited";
  const good = action === "login_success";
  return (
    <span
      className={clsx(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        dangerous && "border-red-300/25 bg-red-400/[0.08] text-red-100",
        good && "border-accent/25 bg-accent/[0.08] text-accent",
        !dangerous && !good && "border-white/10 bg-white/[0.04] text-slate-300"
      )}
    >
      {action.replace("_", " ")}
    </span>
  );
}

export function MiniBarChart({
  data,
  labelKey = "hour"
}: {
  data: Array<{ count: number; hour?: string; countryCode?: string; serverName?: string }>;
  labelKey?: "hour" | "countryCode" | "serverName";
}) {
  const max = Math.max(1, ...data.map((item) => item.count));
  return (
    <div className="space-y-3">
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">No data in this window.</p>
      ) : (
        data.map((item) => {
          const label =
            labelKey === "hour"
              ? item.hour
                ? new Date(item.hour).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                : "-"
              : labelKey === "countryCode"
                ? item.countryCode ?? "ZZ"
                : item.serverName ?? "Unknown";
          return (
            <div key={`${label}-${item.count}`} className="grid grid-cols-[96px_1fr_42px] items-center gap-3 text-sm">
              <span className="truncate text-slate-400">{label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(5, (item.count / max) * 100)}%` }}
                />
              </span>
              <span className="text-right font-mono text-xs text-slate-300">{item.count}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

export function formatMaybe(value: string | null | undefined) {
  return value && value.length > 0 ? value : "-";
}
