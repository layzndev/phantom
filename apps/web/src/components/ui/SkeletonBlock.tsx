export function SkeletonBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-panel/70 p-8 shadow-premium">
      <div className="h-4 w-40 animate-pulse rounded-full bg-white/10" />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-2xl bg-white/[0.05]" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/[0.05]" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/[0.05]" />
      </div>
      <p className="mt-5 text-sm text-slate-500">{label}</p>
    </div>
  );
}
