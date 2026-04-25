import { AdminShell } from "@/components/layout/AdminShell";
import { MinecraftServerDetailClient } from "@/components/services/MinecraftServerDetailClient";

export default async function MinecraftServiceDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AdminShell>
      <MinecraftServerDetailClient id={id} />
    </AdminShell>
  );
}
