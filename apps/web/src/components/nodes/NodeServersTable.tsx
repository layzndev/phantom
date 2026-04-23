import { formatRam } from "@/lib/utils/format";
import type { HostedServer } from "@/types/admin";
import { DetailCard } from "@/components/ui/DetailCard";
import { EmptyState } from "@/components/ui/EmptyState";

export function NodeServersTable({ servers = [] }: { servers?: HostedServer[] }) {
  return (
    <DetailCard title="Hosted Servers" description="Disponible plus tard avec la synchronisation runtime.">
      {servers.length === 0 ? (
        <EmptyState title="No hosted servers" description="This node does not currently report hosted servers." />
      ) : (
      <div className="overflow-hidden rounded-2xl border border-line">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.22em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Server</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">RAM</th>
              <th className="px-4 py-3">CPU</th>
              <th className="px-4 py-3">Port</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {servers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No hosted servers reported.</td>
              </tr>
            ) : (
              servers.map((server) => (
                <tr key={server.id}>
                  <td className="px-4 py-4 font-medium text-white">{server.name}</td>
                  <td className="px-4 py-4 text-slate-300">{server.status}</td>
                  <td className="px-4 py-4 text-slate-300">{formatRam(server.ramMb)}</td>
                  <td className="px-4 py-4 text-slate-300">{server.cpu}</td>
                  <td className="px-4 py-4 text-slate-300">{server.port ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}
    </DetailCard>
  );
}
