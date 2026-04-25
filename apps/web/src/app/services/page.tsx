import { AdminShell } from "@/components/layout/AdminShell";
import { ServicesIndexClient } from "@/components/services/ServicesIndexClient";

export default function ServicesPage() {
  return (
    <AdminShell>
      <ServicesIndexClient />
    </AdminShell>
  );
}
