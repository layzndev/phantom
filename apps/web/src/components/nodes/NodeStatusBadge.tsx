import type { NodeStatus } from "@/types/admin";
import { StatusBadge } from "@/components/ui/StatusBadge";

export function NodeStatusBadge({ status }: { status: NodeStatus }) {
  return <StatusBadge value={status} />;
}
