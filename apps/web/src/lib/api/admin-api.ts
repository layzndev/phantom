import type {
  AdminUser,
  AuditLogEntry,
  CompanyNode,
  CreateNodePayload,
  NodeSummary,
  UpdateNodePayload
} from "@/types/admin";

const API_BASE_URL = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "http://localhost:4200";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error ?? "Request failed.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const adminApi = {
  login: (email: string, password: string) =>
    apiRequest<{ admin: AdminUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),
  me: () => apiRequest<{ admin: AdminUser }>("/auth/me"),
  nodeSummary: () => apiRequest<{ summary: NodeSummary }>("/nodes/summary"),
  nodes: () => apiRequest<{ nodes: CompanyNode[] }>("/nodes"),
  node: (id: string) => apiRequest<{ node: CompanyNode }>(`/nodes/${encodeURIComponent(id)}`),
  createNode: (payload: CreateNodePayload) =>
    apiRequest<{ node: CompanyNode; token: string }>("/nodes", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateNode: (id: string, payload: UpdateNodePayload) =>
    apiRequest<{ node: CompanyNode }>(`/nodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteNode: (id: string) =>
    apiRequest<void>(`/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  maintenanceNode: (id: string, maintenanceMode: boolean) =>
    apiRequest<{ node: CompanyNode }>(`/nodes/${encodeURIComponent(id)}/maintenance`, {
      method: "POST",
      body: JSON.stringify({ maintenanceMode })
    }),
  rotateNodeToken: (id: string) =>
    apiRequest<{ rotation: { nodeId: string; token: string; rotatedAt: string } }>(`/nodes/${encodeURIComponent(id)}/rotate-token`, { method: "POST" }),
  auditLogs: () => apiRequest<{ auditLogs: AuditLogEntry[] }>("/audit-logs")
};
