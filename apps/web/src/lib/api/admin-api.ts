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
  GuardAction,
  GuardConnectionEvent,
  GuardIpProfile,
  GuardOverview,
  GuardPlayerProfile,
  GuardRule,
  GuardServerSummary,
  GuardSettings,
  Incident,
  IncidentSummary,
  MinecraftServerWithWorkload,
  MinecraftUptimeHistory,
  PlatformTokenIssued,
  PlatformTokenSummary,
  MinecraftFilesListResult,
  MinecraftFileReadResult,
  MinecraftGlobalSettings,
  SystemNotification,
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
    const message = payload.error ?? "Request failed.";
    const details = payload.details?.fieldErrors as Record<string, string[]> | undefined;
    if (details) {
      const fields = Object.entries(details)
        .filter(([, errors]) => Array.isArray(errors) && errors.length > 0)
        .map(([field, errors]) => `${field}: ${errors.join(", ")}`)
        .join("; ");
      if (fields) {
        throw new Error(`${message} (${fields})`);
      }
    }
    throw new Error(message);
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
  updateAdminIpAllowlist: (entries: string[]) =>
    apiRequest<{ admin: { id: string; ipAllowlist: string[] } }>("/auth/me/ip-allowlist", {
      method: "PUT",
      body: JSON.stringify({ entries })
    }),
  listPlatformTokens: () =>
    apiRequest<{ tokens: PlatformTokenSummary[] }>("/platform-admin/tokens"),
  issuePlatformToken: (input: { name: string; expiresAt?: string | null }) =>
    apiRequest<{ token: PlatformTokenIssued }>("/platform-admin/tokens", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  revokePlatformToken: (id: string) =>
    apiRequest<{ token: PlatformTokenSummary }>(
      `/platform-admin/tokens/${encodeURIComponent(id)}/revoke`,
      { method: "POST" }
    ),
  incidents: (options?: {
    status?: string;
    severity?: string;
    scope?: string;
    sourceId?: string;
    sourceType?: string;
    window?: "24h" | "7d" | "all";
    limit?: number;
  }) =>
    apiRequest<{ incidents: Incident[] }>(
      `/incidents?${new URLSearchParams(
        Object.entries({
          status: options?.status,
          severity: options?.severity,
          scope: options?.scope,
          sourceId: options?.sourceId,
          sourceType: options?.sourceType,
          window: options?.window,
          limit: options?.limit !== undefined ? String(options.limit) : undefined
        }).filter(([, value]) => typeof value === "string" && value.length > 0) as Array<
          [string, string]
        >
      ).toString()}`
    ),
  incidentSummary: () => apiRequest<{ summary: IncidentSummary }>("/incidents/summary"),
  incident: (id: string) =>
    apiRequest<{ incident: Incident }>(`/incidents/${encodeURIComponent(id)}`),
  acknowledgeIncident: (id: string) =>
    apiRequest<{ incident: Incident }>(`/incidents/${encodeURIComponent(id)}/acknowledge`, {
      method: "POST"
    }),
  assignIncidentToMe: (id: string) =>
    apiRequest<{ incident: Incident }>(`/incidents/${encodeURIComponent(id)}/assign-to-me`, {
      method: "POST"
    }),
  resolveIncident: (id: string, payload: { rootCause?: string; internalNotes?: string } = {}) =>
    apiRequest<{ incident: Incident }>(`/incidents/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  reopenIncident: (id: string, payload: { note?: string } = {}) =>
    apiRequest<{ incident: Incident }>(`/incidents/${encodeURIComponent(id)}/reopen`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  addIncidentNote: (id: string, note: string) =>
    apiRequest<{ incident: Incident }>(`/incidents/${encodeURIComponent(id)}/note`, {
      method: "POST",
      body: JSON.stringify({ note })
    }),
  nodeSummary: () => apiRequest<{ summary: NodeSummary }>("/nodes/summary"),
  clearNodeIncidents: () => apiRequest<{ clearedCount: number; clearedAt: string }>("/nodes/incidents/clear", { method: "POST" }),
  notifications: (options?: { includeDismissed?: boolean; limit?: number }) =>
    apiRequest<{ notifications: SystemNotification[] }>(
      `/notifications?includeDismissed=${options?.includeDismissed === true}&limit=${options?.limit ?? 100}`
    ),
  readNotification: (id: string) =>
    apiRequest<{ notification: SystemNotification }>(
      `/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST" }
    ),
  readAllNotifications: () =>
    apiRequest<{ updatedCount: number; updatedAt: string }>("/notifications/read-all", {
      method: "POST"
    }),
  dismissNotification: (id: string) =>
    apiRequest<{ notification: SystemNotification }>(
      `/notifications/${encodeURIComponent(id)}/dismiss`,
      { method: "POST" }
    ),
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
  minecraftServerUptime: (id: string, limit = 50) =>
    apiRequest<MinecraftUptimeHistory>(
      `/minecraft/servers/${encodeURIComponent(id)}/uptime?limit=${limit}`
    ),
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
  guardOverview: (timeframe: "1h" | "24h" | "7d" | "30d" = "24h") =>
    apiRequest<GuardOverview>(`/guard/overview?timeframe=${timeframe}`),
  guardConnections: (options: {
    username?: string;
    ip?: string;
    country?: string;
    server?: string;
    action?: GuardAction | "all";
    timeframe?: "1h" | "24h" | "7d" | "30d" | "all";
    limit?: number;
  } = {}) =>
    apiRequest<{ connections: GuardConnectionEvent[] }>(
      `/guard/connections?${new URLSearchParams(
        Object.entries({
          username: options.username,
          ip: options.ip,
          country: options.country,
          server: options.server,
          action: options.action === "all" ? undefined : options.action,
          timeframe: options.timeframe,
          limit: options.limit !== undefined ? String(options.limit) : undefined
        }).filter(([, value]) => typeof value === "string" && value.length > 0) as Array<
          [string, string]
        >
      ).toString()}`
    ),
  guardPlayer: (username: string) =>
    apiRequest<GuardPlayerProfile>(`/guard/players/${encodeURIComponent(username)}`),
  guardIp: (ip: string) => apiRequest<GuardIpProfile>(`/guard/ip/${encodeURIComponent(ip)}`),
  guardServerSummary: (serverId: string) =>
    apiRequest<{ summary: GuardServerSummary }>(
      `/guard/servers/${encodeURIComponent(serverId)}/summary`
    ),
  guardSettings: () => apiRequest<{ settings: GuardSettings }>("/guard/settings"),
  updateGuardSettings: (payload: GuardSettings) =>
    apiRequest<{ settings: GuardSettings }>("/guard/settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  blockGuardIp: (ip: string, payload: { expiresMinutes?: number; note?: string; reason?: string } = {}) =>
    apiRequest<{ rule: GuardRule }>(`/guard/ip/${encodeURIComponent(ip)}/block`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  rateLimitGuardIp: (
    ip: string,
    payload: { expiresMinutes?: number; note?: string; reason?: string; rateLimitPerMinute?: number } = {}
  ) =>
    apiRequest<{ rule: GuardRule }>(`/guard/ip/${encodeURIComponent(ip)}/rate-limit`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  trustGuardIp: (ip: string, payload: { expiresMinutes?: number; note?: string } = {}) =>
    apiRequest<{ rule: GuardRule }>(`/guard/ip/${encodeURIComponent(ip)}/trust`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  clearGuardIpScore: (ip: string) =>
    apiRequest<{ ok: true }>(`/guard/ip/${encodeURIComponent(ip)}/clear-score`, {
      method: "POST"
    }),
  addGuardIpNote: (ip: string, note: string) =>
    apiRequest(`/guard/ip/${encodeURIComponent(ip)}/note`, {
      method: "POST",
      body: JSON.stringify({ note })
    }),
  trustGuardPlayer: (username: string, payload: { expiresMinutes?: number; note?: string } = {}) =>
    apiRequest<{ rule: GuardRule }>(`/guard/players/${encodeURIComponent(username)}/trust`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  clearGuardPlayerScore: (username: string) =>
    apiRequest<{ ok: true }>(`/guard/players/${encodeURIComponent(username)}/clear-score`, {
      method: "POST"
    }),
  addGuardPlayerNote: (username: string, note: string) =>
    apiRequest(`/guard/players/${encodeURIComponent(username)}/note`, {
      method: "POST",
      body: JSON.stringify({ note })
    }),
  shadowThrottleHostname: (
    hostname: string,
    payload: { expiresMinutes?: number; note?: string; reason?: string; delayMs?: number } = {}
  ) =>
    apiRequest<{ rule: GuardRule }>(
      `/guard/hostnames/${encodeURIComponent(hostname)}/shadow-throttle`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    ),
  auditLogs: () => apiRequest<{ auditLogs: AuditLogEntry[] }>("/audit-logs")
};
