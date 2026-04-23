import { AdminShell } from "@/components/layout/AdminShell";
import { SectionHeader } from "@/components/ui/SectionHeader";

export default function SettingsPage() {
  return (
    <AdminShell>
      <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
        <SectionHeader eyebrow="Prepared foundations" title="Settings" description="Socle de securite prevu pour faire evoluer ce panel en control plane entreprise." />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {["IP allowlist", "2FA enforcement", "Fine-grained permissions", "External audit sink"].map((item) => (
            <div key={item} className="rounded-2xl border border-line bg-white/[0.04] p-5">
              <p className="font-semibold text-white">{item}</p>
              <p className="mt-2 text-sm text-slate-400">Structure backend prete pour activer ce controle sans couplage au panel client.</p>
            </div>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
