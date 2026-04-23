import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

export function ActionButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-accent/30 hover:bg-accent/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45",
        className
      )}
      {...props}
    />
  );
}
