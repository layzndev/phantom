import { formatRam, percent } from "@/lib/utils/format";
import type { CompanyNode } from "@/types/admin";
import { DetailCard } from "@/components/ui/DetailCard";

function Bar({ value }: { value: number }) {
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

export function NodeCapacityCard({ node }: { node: CompanyNode }) {
  const ramPercent = percent(node.usedRamMb, node.totalRamMb);
  const cpuPercent = percent(node.usedCpu, node.totalCpu);

  return (
    <DetailCard title="Capacity">
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">RAM</span>
            <span className="text-white">{formatRam(node.usedRamMb)} / {formatRam(node.totalRamMb)}</span>
          </div>
          <Bar value={ramPercent} />
        </div>
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">CPU</span>
            <span className="text-white">{node.usedCpu.toFixed(1)} / {node.totalCpu} cores</span>
          </div>
          <Bar value={cpuPercent} />
        </div>
      </div>
    </DetailCard>
  );
}
