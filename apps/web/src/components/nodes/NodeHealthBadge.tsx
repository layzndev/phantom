import type { NodeHealth } from "@/types/admin";
import { StatusBadge } from "@/components/ui/StatusBadge";

export function NodeHealthBadge({ health }: { health: NodeHealth }) {
  return <StatusBadge value={health} />;
}
