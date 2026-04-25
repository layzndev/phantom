"use client";

import Link from "next/link";
import { Blocks, HardDrive, ShieldCheck, Swords } from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";

const services = [
  {
    title: "Minecraft",
    href: "/services/minecraft",
    description: "Operate Minecraft servers, console access, lifecycle actions and runtime diagnostics.",
    status: "Available",
    icon: Swords
  },
  {
    title: "Proxies",
    href: "/services",
    description: "Velocity, Waterfall and future edge routing services will land here next.",
    status: "Placeholder",
    icon: ShieldCheck
  },
  {
    title: "Storage",
    href: "/services",
    description: "Backups, snapshots and persistent data orchestration will be exposed here later.",
    status: "Placeholder",
    icon: HardDrive
  },
  {
    title: "Automation",
    href: "/services",
    description: "Reusable service operators and scheduled actions will plug into this section later.",
    status: "Placeholder",
    icon: Blocks
  }
];

export function ServicesIndexClient() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-panel/70 p-6 shadow-soft">
        <SectionHeader
          eyebrow="Services"
          title="Admin Service Catalog"
          description="Service-oriented admin surfaces layered on top of Phantom nodes, workloads and agents."
        />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        {services.map((service) => {
          const Icon = service.icon;
          const available = service.status === "Available";
          return (
            <Link
              key={service.title}
              href={service.href}
              className={`rounded-3xl border p-6 shadow-soft transition ${
                available
                  ? "border-line bg-panel/78 hover:border-accent/35 hover:bg-panel"
                  : "pointer-events-none border-white/10 bg-white/[0.03] opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-white">
                  <Icon size={22} />
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                    available
                      ? "border border-accent/25 bg-accent/[0.08] text-accent"
                      : "border border-white/10 bg-white/[0.04] text-slate-400"
                  }`}
                >
                  {service.status}
                </span>
              </div>

              <h2 className="mt-5 font-display text-xl font-semibold text-white">{service.title}</h2>
              <p className="mt-2 text-sm text-slate-400">{service.description}</p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
