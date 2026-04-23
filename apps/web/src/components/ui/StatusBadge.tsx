import clsx from "clsx";

const statusStyles: Record<string, string> = {
  online: "border-accent/25 bg-accent/[0.08] text-accent",
  degraded: "border-amber/25 bg-amber/[0.08] text-amber",
  maintenance: "border-sky-300/20 bg-sky-300/[0.07] text-sky-200",
  offline: "border-red-300/25 bg-red-400/[0.075] text-red-200",
  healthy: "border-accent/25 bg-accent/[0.08] text-accent",
  warning: "border-amber/25 bg-amber/[0.08] text-amber",
  critical: "border-red-300/25 bg-red-400/[0.075] text-red-200",
  unknown: "border-slate-500/30 bg-slate-500/10 text-slate-300"
};

export function StatusBadge({ value }: { value: string }) {
  return <span className={clsx("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize leading-none", statusStyles[value] ?? statusStyles.unknown)}>{value}</span>;
}
