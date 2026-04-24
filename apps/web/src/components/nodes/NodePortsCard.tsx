"use client";

import { useState } from "react";
import { percent } from "@/lib/utils/format";
import { adminApi } from "@/lib/api/admin-api";
import type { AdminRole, CompanyNode, SuggestedPortRange } from "@/types/admin";
import { DetailCard } from "@/components/ui/DetailCard";
import { ActionButton } from "@/components/ui/ActionButton";

const APPLY_ROLES: ReadonlyArray<AdminRole> = ["superadmin", "ops"];

const rangeSize = (range: SuggestedPortRange) => range.end - range.start + 1;

export function NodePortsCard({
  node,
  adminRole = null,
  onUpdated
}: {
  node: CompanyNode;
  adminRole?: AdminRole | null;
  onUpdated?: (node: CompanyNode) => void;
}) {
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalPorts = node.availablePorts + node.reservedPorts;
  const reservedPercent = percent(node.reservedPorts, totalPorts);
  const rangeDefined = node.portRange !== null;
  const canApply = adminRole !== null && APPLY_ROLES.includes(adminRole);

  const suggestions = [...(node.suggestedPortRanges ?? [])]
    .filter((range) => range.end >= range.start)
    .sort((a, b) => rangeSize(b) - rangeSize(a))
    .slice(0, 3);

  async function apply(range: SuggestedPortRange) {
    const key = `${range.start}-${range.end}`;
    setApplyingKey(key);
    setError(null);
    try {
      const { node: updated } = await adminApi.updateNode(node.id, {
        portRangeStart: range.start,
        portRangeEnd: range.end
      });
      onUpdated?.(updated);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Unable to apply port range.");
    } finally {
      setApplyingKey(null);
    }
  }

  return (
    <DetailCard title="Ports" description="Range, ports reserves et capacite disponible.">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Range</p>
          <p className="mt-1 font-semibold text-white">
            {rangeDefined ? node.portRange : <span className="text-slate-500">Awaiting heartbeat...</span>}
          </p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Reserved</p>
          <p className="mt-1 font-semibold text-white">{node.reservedPorts}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Available</p>
          <p className="mt-1 font-semibold text-white">{rangeDefined ? node.availablePorts : "-"}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Usage</p>
          <p className="mt-1 font-semibold text-white">{rangeDefined ? `${reservedPercent}%` : "-"}</p>
        </div>
        <div className="col-span-2 rounded-2xl bg-white/[0.04] p-4">
          <p className="text-slate-400">Open ports detected</p>
          <p className="mt-1 font-semibold text-white">
            {node.openPorts.length > 0 ? `${node.openPorts.length} listening` : "None reported"}
          </p>
          {node.openPorts.length > 0 ? (
            <p className="mt-1 break-all font-mono text-xs text-slate-500">
              {node.openPorts.slice(0, 24).join(", ")}
              {node.openPorts.length > 24 ? ` +${node.openPorts.length - 24} more` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {suggestions.length > 0 && !rangeDefined ? (
        <div className="mt-5 space-y-3 rounded-2xl border border-accent/30 bg-accent/[0.06] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Suggested port pool detected</p>
            <p className="mt-1 text-xs text-slate-400">Pick a range to attach it to this node. Saved via audit log.</p>
          </div>
          <ul className="space-y-2">
            {suggestions.map((range) => {
              const key = `${range.start}-${range.end}`;
              return (
                <li key={key} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3 py-2">
                  <span className="font-mono text-sm text-white">
                    {range.start}-{range.end}{" "}
                    <span className="ml-2 text-xs text-slate-400">({rangeSize(range)} ports free)</span>
                  </span>
                  {canApply ? (
                    <ActionButton
                      disabled={applyingKey !== null}
                      onClick={() => apply(range)}
                    >
                      {applyingKey === key ? "Applying..." : "Apply"}
                    </ActionButton>
                  ) : (
                    <span className="text-xs text-slate-500">Read-only</span>
                  )}
                </li>
              );
            })}
          </ul>
          {error ? <p className="text-xs text-red-200">{error}</p> : null}
        </div>
      ) : null}
    </DetailCard>
  );
}
