import type {
  AdminUser,
  AuditLogEntry,
  CompanyNode,
  CompanyWorkload,
  CreateMinecraftServerPayload,
  CreateWorkloadPayload,
  CreateWorkloadResult,
  CreateNodePayload,
  DeleteMinecraftServerOptions,
  DeleteMinecraftServerResult,
  DeleteWorkloadOptions,
  DeleteWorkloadResult,
  MinecraftServerWithWorkload,
  MinecraftFilesListResult,
  MinecraftFileReadResult,
  MinecraftGlobalSettings,
  UpdateMinecraftServerSettingsPayload,
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
  minecraftFreeTierSettings: () =>
    apiRequest<{ settings: MinecraftGlobalSettings }>("/minecraft/settings/free-tier"),
  updateMinecraftFreeTierSettings: (payload: MinecraftGlobalSettings) =>
    apiRequest<{ settings: MinecraftGlobalSettings }>("/minecraft/settings/free-tier", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  createMinecraftServer: (payload: CreateMinecraftServerPayload) =>
    apiRequest<{
      server: MinecraftServerWithWorkload["server"];
      workload: CompanyWorkload;
      placed: boolean;
      reason?: string;
    }>("/minecraft/servers", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  minecraftServer: (id: string) =>
    apiRequest<MinecraftServerWithWorkload>(`/minecraft/servers/${encodeURIComponent(id)}`),
  minecraftFiles: (id: string, path = "/") =>
    apiRequest<MinecraftFilesListResult>(
      `/minecraft/servers/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`
    ),
  readMinecraftFile: (id: string, path: string) =>
    apiRequest<MinecraftFileReadResult>(
      `/minecraft/servers/${encodeURIComponent(id)}/files/read?path=${encodeURIComponent(path)}`
    ),
  writeMinecraftFile: (id: string, path: string, content: string) =>
    apiRequest(`/minecraft/servers/${encodeURIComponent(id)}/files/write`, {
      method: "PUT",
      body: JSON.stringify({ path, content })
    }),
  uploadMinecraftFile: async (id: string, path: string, file: File) => {
    const formData = new FormData();
    formData.append("path", path);
    formData.append("file", file);
    const response = await fetch(
      `${API_BASE_URL}/minecraft/servers/${encodeURIComponent(id)}/files/upload`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        body: formData
      }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Request failed." }));
      throw new Error(payload.error ?? "Request failed.");
    }
    return response.json();
  },
  mkdirMinecraftFile: (id: string, path: string) =>
    apiRequest(`/minecraft/servers/${encodeURIComponent(id)}/files/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path })
    }),
  renameMinecraftFile: (id: string, from: string, to: string) =>
    apiRequest(`/minecraft/servers/${encodeURIComponent(id)}/files/rename`, {
      method: "POST",
      body: JSON.stringify({ from, to })
    }),
  deleteMinecraftFile: (id: string, path: string) =>
    apiRequest(`/minecraft/servers/${encodeURIComponent(id)}/files`, {
      method: "DELETE",
      body: JSON.stringify({ path })
    }),
  archiveMinecraftFile: (id: string, path: string) =>
    apiRequest(`/minecraft/servers/${encodeURIComponent(id)}/files/archive`, {
      method: "POST",
      body: JSON.stringify({ path })
    }),
  extractMinecraftFile: (id: string, path: string) =>
    apiRequest(`/minecraft/servers/${encodeURIComponent(id)}/files/extract`, {
      method: "POST",
      body: JSON.stringify({ path })
    }),
  startMinecraftServer: (id: string) =>
    apiRequest<{ server: MinecraftServerWithWorkload["server"]; workload: CompanyWorkload }>(
      `/minecraft/servers/${encodeURIComponent(id)}/start`,
      { method: "POST" }
    ),
  stopMinecraftServer: (id: string) =>
    apiRequest<{ server: MinecraftServerWithWorkload["server"]; workload: CompanyWorkload }>(
      `/minecraft/servers/${encodeURIComponent(id)}/stop`,
      { method: "POST" }
    ),
  restartMinecraftServer: (id: string) =>
    apiRequest<{ server: MinecraftServerWithWorkload["server"]; workload: CompanyWorkload }>(
      `/minecraft/servers/${encodeURIComponent(id)}/restart`,
      { method: "POST" }
    ),
  updateMinecraftServerHostname: (id: string, hostnameSlug: string) =>
    apiRequest<MinecraftServerWithWorkload>(
      `/minecraft/servers/${encodeURIComponent(id)}/hostname`,
      {
        method: "PATCH",
        body: JSON.stringify({ hostnameSlug })
      }
    ),
  updateMinecraftServerSettings: (id: string, payload: UpdateMinecraftServerSettingsPayload) =>
    apiRequest<MinecraftServerWithWorkload>(
      `/minecraft/servers/${encodeURIComponent(id)}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    ),
  commandMinecraftServer: (id: string, command: string) =>
    apiRequest<{ operation: unknown; pending: boolean }>(
      `/minecraft/servers/${encodeURIComponent(id)}/command`,
      { method: "POST", body: JSON.stringify({ command }) }
    ),
  saveMinecraftServer: (id: string) =>
    apiRequest<{ operation: unknown; pending: boolean }>(
      `/minecraft/servers/${encodeURIComponent(id)}/save`,
      { method: "POST" }
    ),
  deleteMinecraftServer: (id: string, options: DeleteMinecraftServerOptions = {}) =>
    apiRequest<DeleteMinecraftServerResult>(
      `/minecraft/servers/${encodeURIComponent(id)}?hardDeleteData=${options.hardDeleteData === true}`,
      { method: "DELETE" }
    ),
  auditLogs: () => apiRequest<{ auditLogs: AuditLogEntry[] }>("/audit-logs")
};
