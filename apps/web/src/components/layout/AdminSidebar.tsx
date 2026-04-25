"use client";

import clsx from "clsx";
import { Activity, Boxes, FileClock, LayoutDashboard, Layers3, ServerCog, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/nodes", label: "Nodes", icon: ServerCog },
  { href: "/workloads", label: "Workloads", icon: Boxes },
  { href: "/services", label: "Services", icon: Layers3 },
  { href: "/audit-logs", label: "Audit Logs", icon: FileClock },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-64 border-r border-line bg-obsidian/75 p-4 backdrop-blur-xl lg:block">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <Activity size={19} />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-white">Phantom</p>
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Control Plane</p>
          </div>
        </div>
      </div>

      <nav className="mt-7 space-y-1.5">
        {links.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition",
                active ? "bg-white/[0.09] text-white ring-1 ring-white/10" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-200"
              )}
            >
              <Icon size={18} />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
