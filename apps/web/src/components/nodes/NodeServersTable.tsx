import Link from "next/link";
import { formatRam } from "@/lib/utils/format";
import type { HostedServer } from "@/types/admin";
import { DetailCard } from "@/components/ui/DetailCard";
import { EmptyState } from "@/components/ui/EmptyState";

export function NodeServersTable({ servers = [] }: { servers?: HostedServer[] }) {
  return (
    <DetailCard title={`Hosted Servers (${servers.length})`}>
      {servers.length === 0 ? (
        <EmptyState
          title="No hosted servers"
          description="No Minecraft server is currently scheduled on this node."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.22em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Server</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Resources</th>
                <th className="px-4 py-3">Port</th>
                <th className="px-4 py-3 text-right">Console</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {servers.map((server) => (
                <tr key={server.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-4">
                    <p className="font-medium text-white">{server.name}</p>
                    {server.version ? (
                      <p className="font-mono text-[11px] text-slate-500">
                        {server.templateId ?? ""} v{server.version}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-slate-300">
                    <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                      {server.kind ?? "server"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <HostedStatusPill status={server.status} desired={server.desiredStatus} />
                  </td>
                  <td className="px-4 py-4 text-slate-300">
                    <p>{formatRam(server.ramMb)}</p>
                    <p className="text-xs text-slate-500">
                      {server.cpu} CPU
                      {server.diskGb !== undefined ? ` · ${server.diskGb} GB disk` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-300">
                    {server.port ? `${server.port} → 25565` : "—"}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {server.kind === "minecraft" ? (
                      <Link
                        href={`/services/playground?server=${encodeURIComponent(server.id)}`}
                        className="inline-flex h-8 items-center rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.07]"
                      >
                        Open
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DetailCard>
  );
}

function HostedStatusPill({ status, desired }: { status: string; desired?: string }) {
  const tone =
    status === "running"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : status === "crashed"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : status === "creating" || status === "pending"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
          : "border-white/15 bg-white/[0.035] text-slate-300";
  const drift = desired && desired !== status && status !== "running";
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
      >
        {status}
      </span>
      {drift ? (
        <span className="font-mono text-[10px] text-slate-500">desired: {desired}</span>
      ) : null}
    </div>
  );
}
