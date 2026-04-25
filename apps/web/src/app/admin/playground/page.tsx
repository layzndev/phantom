import { AdminShell } from "@/components/layout/AdminShell";
import { PlaygroundClient } from "@/components/playground/PlaygroundClient";

export default function PlaygroundPage() {
  return (
    <AdminShell>
      <PlaygroundClient />
    </AdminShell>
  );
}
