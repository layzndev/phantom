import type {
  AdminUser,
  AuditLogEntry,
  CompanyNode,
  CompanyWorkload,
  CreateWorkloadPayload,
  CreateWorkloadResult,
  CreateNodePayload,
  DeleteMinecraftServerOptions,
  DeleteMinecraftServerResult,
  DeleteWorkloadOptions,
  DeleteWorkloadResult,
  MinecraftServerWithWorkload,
  NodeSummary,
  UpdateNodePayload,
  UpdateWorkloadPayload
} from "@/types/admin";

export const ADMIN_API_BASE_URL =
  process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "http://localhost:4200";

const API_BASE_URL = ADMIN_API_BASE_URL;

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
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
  workloads: () => apiRequest<{ workloads: CompanyWorkload[] }>("/workloads"),
  workload: (id: string) =>
    apiRequest<{ workload: CompanyWorkload }>(`/workloads/${encodeURIComponent(id)}`),
  createWorkload: (payload: CreateWorkloadPayload) =>
    apiRequest<CreateWorkloadResult>("/workloads", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateWorkload: (id: string, payload: UpdateWorkloadPayload) =>
    apiRequest<{ workload: CompanyWorkload }>(`/workloads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  startWorkload: (id: string) =>
    apiRequest<{ workload: CompanyWorkload }>(`/workloads/${encodeURIComponent(id)}/start`, {
      method: "POST"
    }),
  stopWorkload: (id: string) =>
    apiRequest<{ workload: CompanyWorkload }>(`/workloads/${encodeURIComponent(id)}/stop`, {
      method: "POST"
    }),
  restartWorkload: (id: string) =>
    apiRequest<{ workload: CompanyWorkload }>(`/workloads/${encodeURIComponent(id)}/restart`, {
      method: "POST"
    }),
  killWorkload: (id: string) =>
    apiRequest<{ workload: CompanyWorkload }>(`/workloads/${encodeURIComponent(id)}/kill`, {
      method: "POST"
    }),
  deleteWorkload: (id: string, options: DeleteWorkloadOptions = {}) =>
    apiRequest<DeleteWorkloadResult>(
      `/workloads/${encodeURIComponent(id)}?hardDeleteData=${options.hardDeleteData === true}`,
      { method: "DELETE" }
    ),
  minecraftServers: () =>
    apiRequest<{ servers: MinecraftServerWithWorkload[] }>("/minecraft/servers"),
  deleteMinecraftServer: (id: string, options: DeleteMinecraftServerOptions = {}) =>
    apiRequest<DeleteMinecraftServerResult>(
      `/minecraft/servers/${encodeURIComponent(id)}?hardDeleteData=${options.hardDeleteData === true}`,
      { method: "DELETE" }
    ),
  auditLogs: () => apiRequest<{ auditLogs: AuditLogEntry[] }>("/audit-logs")
};
