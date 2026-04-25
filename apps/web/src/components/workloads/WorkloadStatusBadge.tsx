import clsx from "clsx";
import type { WorkloadDesiredStatus, WorkloadStatus } from "@/types/admin";

const statusTone: Record<WorkloadStatus, string> = {
  pending: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  queued_start: "border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-200",
  creating: "border-amber/25 bg-amber/[0.08] text-amber",
  running: "border-accent/25 bg-accent/[0.08] text-accent",
  stopped: "border-red-300/25 bg-red-400/[0.075] text-red-200",
  crashed: "border-red-400/35 bg-red-500/[0.11] text-red-100",
  deleting: "border-amber/25 bg-amber/[0.08] text-amber",
  deleted: "border-slate-500/30 bg-slate-500/10 text-slate-300"
};

const desiredTone: Record<WorkloadDesiredStatus, string> = {
  running: "border-accent/25 bg-accent/[0.08] text-accent",
  stopped: "border-red-300/25 bg-red-400/[0.075] text-red-200"
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize leading-none",
        className
      )}
    >
      {label}
    </span>
  );
}

export function WorkloadStatusBadge({ status }: { status: WorkloadStatus }) {
  return <Badge label={status} className={statusTone[status]} />;
}

export function WorkloadDesiredStatusBadge({
  desiredStatus
}: {
  desiredStatus: WorkloadDesiredStatus;
}) {
  return <Badge label={desiredStatus} className={desiredTone[desiredStatus]} />;
}
