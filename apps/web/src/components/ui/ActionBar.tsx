import type { ReactNode } from "react";

type ActionBarProps = {
  children: ReactNode;
  className?: string;
};

export function ActionBar({ children, className }: ActionBarProps) {
  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/[0.035] p-2"
      }
    >
      {children}
    </div>
  );
}