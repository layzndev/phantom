import { percent } from "@/lib/utils/format";
import type { CompanyNode } from "@/types/admin";
import { DetailCard } from "@/components/ui/DetailCard";

export function NodePortsCard({ node }: { node: CompanyNode }) {
  const totalPorts = node.availablePorts + node.reservedPorts;
  const reservedPercent = percent(node.reservedPorts, totalPorts);

  return (
    <DetailCard title="Ports" description="Range, ports reserves et capacite disponible.">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Range</p>
          <p className="mt-1 font-semibold text-white">{node.portRange}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Reserved</p>
          <p className="mt-1 font-semibold text-white">{node.reservedPorts}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Available</p>
          <p className="mt-1 font-semibold text-white">{node.availablePorts}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Usage</p>
          <p className="mt-1 font-semibold text-white">{reservedPercent}%</p>
        </div>
      </div>
    </DetailCard>
  );
}
