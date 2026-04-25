import { AdminShell } from "@/components/layout/AdminShell";
import { MinecraftServicesClient } from "@/components/services/MinecraftServicesClient";

export default function MinecraftServicesPage() {
  return (
    <AdminShell>
      <MinecraftServicesClient />
    </AdminShell>
  );
}
