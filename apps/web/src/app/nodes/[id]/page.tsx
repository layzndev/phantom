import { AdminShell } from "@/components/layout/AdminShell";
import { NodeDetailClient } from "@/components/nodes/NodeDetailClient";

export default async function NodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AdminShell>
      <NodeDetailClient id={id} />
    </AdminShell>
  );
}
