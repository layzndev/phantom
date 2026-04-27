"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import { formatDateTime } from "@/lib/utils/format";
import type { MinecraftServerWithWorkload, MinecraftUptimeSession } from "@/types/admin";

const REFRESH_MS = 15_000;

export function MinecraftUptimeHistory({
  entry
}: {
  entry: MinecraftServerWithWorkload;
}) {
  const [sessions, setSessions] = useState<MinecraftUptimeSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await adminApi.minecraftServerUptime(entry.server.id);
        if (!cancelled) {
          setSessions(result.sessions);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load uptime history.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [entry.server.id]);

  if (loading && !sessions) {
    return (
      <div className="rounded-2xl border border-line bg-panel/78 p-5 text-sm text-slate-400">
        Loading uptime history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-400/30 bg-red-400/[0.08] p-5 text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-panel/78 p-5 text-sm text-slate-500">
        No start/stop history yet for this server.
      </div>
    );
  }

  const totalSeconds = sessions.reduce((acc, session) => acc + session.durationSeconds, 0);

  return (
    <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Uptime history</h3>
          <p className="mt-1 text-xs text-slate-500">
            {sessions.length} session{sessions.length > 1 ? "s" : ""} · cumulative {formatDuration(totalSeconds)}
          </p>
        </div>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Stopped</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={`${session.startedAt}-${session.stoppedAt ?? "ongoing"}`} className="border-t border-white/[0.06]">
                <td className="px-4 py-3 font-mono text-xs text-slate-200">
                  {formatDateTime(session.startedAt)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-200">
                  {session.ongoing ? (
                    <span className="inline-flex items-center gap-2 text-emerald-300">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      Ongoing
                    </span>
                  ) : (
                    formatDateTime(session.stoppedAt)
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">
                  {formatDuration(session.durationSeconds)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {session.reason ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "0s";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 || (days === 0 && hours === 0)) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}
