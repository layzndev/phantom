"use client";

import { useState } from "react";
import { percent } from "@/lib/utils/format";
import { adminApi } from "@/lib/api/admin-api";
import type { AdminRole, CompanyNode, SuggestedPortRange } from "@/types/admin";
import { DetailCard } from "@/components/ui/DetailCard";
import { ActionButton } from "@/components/ui/ActionButton";

const APPLY_ROLES: ReadonlyArray<AdminRole> = ["superadmin", "ops"];

const rangeSize = (range: SuggestedPortRange) => range.end - range.start + 1;
const SYSTEM_PORT_LABELS: Record<number, string> = {
  22: "SSH",
  80: "HTTP",
  443: "HTTPS"
};

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
  const serverByWorkloadId = new Map(
    (node.hostedServersList ?? [])
      .filter((server) => server.workloadId)
      .map((server) => [server.workloadId as string, server])
  );
  const reservedPorts = Array.from(
    new Set(
      (node.hostedServersList ?? [])
        .map((server) => server.port)
        .filter((port): port is number => typeof port === "number")
    )
  ).sort((a, b) => a - b);
  const listeningDetails =
    node.openPortDetails.length > 0
      ? [...node.openPortDetails]
      : node.openPorts.map((port) => ({
          port,
          protocol: "tcp" as const,
          address: "unknown",
          category: "phantom-range" as const
        }));
  const phantomListeningPorts = Array.from(
    new Set(
      listeningDetails
        .filter((entry) => entry.category === "phantom-range")
        .map((entry) => entry.port)
    )
  ).sort((a, b) => a - b);
  const reservedButNotListening = reservedPorts.filter(
    (port) => !phantomListeningPorts.includes(port)
  );
  const listeningButNotReserved = phantomListeningPorts.filter(
    (port) => !reservedPorts.includes(port)
  );
  const systemListening = listeningDetails.filter((entry) => entry.category === "system");
  const activeListening = listeningDetails.filter(
    (entry, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.port === entry.port && candidate.protocol === entry.protocol
      ) === index
  );
  const dockerPublished = [...node.dockerPublishedPorts].sort(
    (left, right) => left.publishedPort - right.publishedPort
  );

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
    <DetailCard title="Ports">
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
          <p className="text-slate-400">Port diagnostics</p>
          <p className="mt-1 font-semibold text-white">
            {activeListening.length > 0
              ? `${activeListening.length} active listeners`
              : "No active listeners reported"}
          </p>
          <div className="mt-3 space-y-3 text-xs">
            <PortSection
              label="Active Listening Ports"
              items={activeListening.map((entry) => {
                const owner = dockerPublished.find(
                  (binding) =>
                    binding.publishedPort === entry.port && binding.protocol === entry.protocol
                );
                const server = owner?.workloadId ? serverByWorkloadId.get(owner.workloadId) : null;
                const ownerLabel = server?.name
                  ? server.name
                  : SYSTEM_PORT_LABELS[entry.port] ?? owner?.containerName ?? null;
                return `${entry.port}/${entry.protocol}${ownerLabel ? ` ${ownerLabel}` : ""}`;
              })}
              empty="None reported"
            />

            <PortSection
              label="Docker Published Ports"
              items={dockerPublished.map((binding) => {
                const server = binding.workloadId
                  ? serverByWorkloadId.get(binding.workloadId)
                  : null;
                const ownerLabel = server?.name ?? binding.containerName;
                return `${binding.publishedPort}/${binding.protocol} -> ${binding.targetPort} ${ownerLabel}`;
              })}
              empty="No Phantom container port published"
            />

            <PortSection
              label="Phantom Reserved Ports"
              items={reservedPorts.map((port) => String(port))}
              empty="No reserved ports"
            />

            {reservedButNotListening.length > 0 ? (
              <p className="text-slate-400">
                Reserved but not listening:{" "}
                <span className="font-mono text-slate-300">
                  {reservedButNotListening.join(", ")}
                </span>
              </p>
            ) : null}

            {listeningButNotReserved.length > 0 ? (
              <p className="text-slate-400">
                Listening but not reserved:{" "}
                <span className="font-mono text-slate-300">
                  {listeningButNotReserved.join(", ")}
                </span>
              </p>
            ) : null}

            {systemListening.length > 0 ? (
              <p className="text-slate-400">
                System listeners:{" "}
                <span className="font-mono text-slate-300">
                  {systemListening
                    .map((entry) => `${entry.port}/${entry.protocol}`)
                    .join(", ")}
                </span>
              </p>
            ) : null}
          </div>
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

function PortSection({
  label,
  items,
  empty
}: {
  label: string;
  items: string[];
  empty: string;
}) {
  return (
    <div>
      <p className="text-slate-400">{label}</p>
      <p className="mt-1 break-all font-mono text-xs text-slate-300">
        {items.length > 0 ? items.join(", ") : empty}
      </p>
    </div>
  );
}
