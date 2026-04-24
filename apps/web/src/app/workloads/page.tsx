import { AdminShell } from "@/components/layout/AdminShell";
import { WorkloadsTableClient } from "@/components/workloads/WorkloadsTableClient";

export default function WorkloadsPage() {
  return (
    <AdminShell>
      <WorkloadsTableClient />
    </AdminShell>
  );
}
