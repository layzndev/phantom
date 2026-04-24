import { AdminShell } from "@/components/layout/AdminShell";
import { WorkloadDetailClient } from "@/components/workloads/WorkloadDetailClient";

export default async function WorkloadDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AdminShell>
      <WorkloadDetailClient id={id} />
    </AdminShell>
  );
}
