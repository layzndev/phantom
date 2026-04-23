import type { AdminUser, AuditLogEntry, CompanyNode, NodeSummary } from "@/types/admin";

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
  syncNode: (id: string) => apiRequest<{ node: CompanyNode }>(`/nodes/${encodeURIComponent(id)}/sync`, { method: "POST" }),
  refreshNode: (id: string) => apiRequest<{ node: CompanyNode }>(`/nodes/${encodeURIComponent(id)}/refresh`, { method: "POST" }),
  reconcileNode: (id: string) => apiRequest<{ node: CompanyNode }>(`/nodes/${encodeURIComponent(id)}/reconcile`, { method: "POST" }),
  maintenanceNode: (id: string, maintenanceMode: boolean) =>
    apiRequest<{ node: CompanyNode }>(`/nodes/${encodeURIComponent(id)}/maintenance`, {
      method: "POST",
      body: JSON.stringify({ maintenanceMode })
    }),
  rotateNodeToken: (id: string) =>
    apiRequest<{ rotation: { accepted: boolean; nodeId: string; rotatedAt: string } }>(`/nodes/${encodeURIComponent(id)}/rotate-token`, { method: "POST" }),
  auditLogs: () => apiRequest<{ auditLogs: AuditLogEntry[] }>("/audit-logs")
};
