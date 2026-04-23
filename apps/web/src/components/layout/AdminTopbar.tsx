"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/admin-api";

export function AdminTopbar() {
  const router = useRouter();

  async function logout() {
    await adminApi.logout().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-obsidian/72 px-5 py-3.5 backdrop-blur-xl lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Internal only</p>
          <h1 className="font-display text-lg font-semibold text-slate-100">Infrastructure Operations</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3.5 py-2 text-xs text-slate-400 md:flex">
            <ShieldCheck size={16} className="text-accent" />
            Session admin separee
          </div>
          <button onClick={logout} className="rounded-full border border-white/10 p-2.5 text-slate-400 transition hover:border-red-400/30 hover:text-red-200" aria-label="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
