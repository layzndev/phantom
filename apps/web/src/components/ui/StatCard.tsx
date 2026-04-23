import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}

const tones = {
  neutral: "border-white/10 bg-white/[0.035]",
  good: "border-accent/20 bg-accent/[0.075]",
  warn: "border-amber/20 bg-amber/[0.075]",
  bad: "border-red-300/20 bg-red-400/[0.07]"
};

export function StatCard({ label, value, caption, tone = "neutral" }: StatCardProps) {
  return (
    <div className={clsx("rounded-2xl border p-5 shadow-soft", tones[tone])}>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-50">{value}</p>
      {caption ? <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">{caption}</p> : null}
    </div>
  );
}
