import { AdminShell } from "@/components/layout/AdminShell";
import { IpAllowlistCard } from "@/components/settings/IpAllowlistCard";
import { SectionHeader } from "@/components/ui/SectionHeader";

export default function SettingsPage() {
  return (
    <AdminShell>
      <section className="space-y-6">
        <div className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
          <SectionHeader
            eyebrow="Account security"
            title="Settings"
            description="Manage how your admin account authenticates against the Phantom control plane."
          />
        </div>

        <IpAllowlistCard />

        <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-white">Roadmap</h3>
          <p className="mt-1 text-xs text-slate-400">
            These controls are wired in the backend and will land in this panel next.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {["2FA enforcement", "Fine-grained permissions", "External audit sink"].map((item) => (
              <div key={item} className="rounded-2xl border border-line bg-white/[0.04] p-4">
                <p className="text-sm font-semibold text-white">{item}</p>
                <p className="mt-2 text-xs text-slate-500">Available in the API, surfaced soon.</p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </AdminShell>
  );
}
