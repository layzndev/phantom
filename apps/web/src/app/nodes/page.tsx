import { AdminShell } from "@/components/layout/AdminShell";
import { NodesTableClient } from "@/components/nodes/NodesTableClient";

export default function NodesPage() {
  return (
    <AdminShell>
      <NodesTableClient />
    </AdminShell>
  );
}
