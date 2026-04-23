import type { ReactNode } from "react";

export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/[0.035] p-2">
      {children}
    </div>
  );
}
