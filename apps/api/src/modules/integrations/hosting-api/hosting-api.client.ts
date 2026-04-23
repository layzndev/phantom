import { randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { AppError } from "../../../lib/appError.js";

type HostingApiNode = Record<string, unknown> & { id: string; maintenanceMode?: boolean; status?: string; history?: Array<Record<string, unknown>> };

const mockNodes: HostingApiNode[] = [
  {
    id: "node-par-01",
    name: "Paris Edge 01",
    provider: "OVHcloud",
    region: "eu-west-par",
    internalHost: "10.40.0.11",
    publicHost: "par-01.nodes.company.internal",
    status: "online",
    health: "healthy",
    runtimeMode: "docker",
    heartbeat: new Date(Date.now() - 23_000).toISOString(),
    totalRamMb: 65536,
    usedRamMb: 38400,
    totalCpu: 32,
    usedCpu: 17.4,
    hostedServers: 42,
    availablePorts: 740,
    reservedPorts: 260,
    portRange: "25000-26000",
    maintenanceMode: false,
    hostedServersList: [
      { id: "srv_2042", name: "survival-prod-a", status: "running", ramMb: 4096, cpu: 2, port: 25565 },
      { id: "srv_2043", name: "creative-team-b", status: "running", ramMb: 6144, cpu: 3, port: 25566 }
    ],
    history: [
      { id: "evt_1", type: "heartbeat", message: "Heartbeat received", createdAt: new Date(Date.now() - 23_000).toISOString() },
      { id: "evt_2", type: "sync", message: "Node inventory synced", createdAt: new Date(Date.now() - 18 * 60_000).toISOString() }
    ],
    logs: ["runtime: heartbeat accepted", "capacity: ports reconciled", "scheduler: 42 hosted servers tracked"]
  },
  {
    id: "node-fra-02",
    name: "Frankfurt Compute 02",
    provider: "Hetzner",
    region: "eu-central-fra",
    internalHost: "10.50.0.21",
    publicHost: "fra-02.nodes.company.internal",
    status: "degraded",
    health: "warning",
    runtimeMode: "docker",
    heartbeat: new Date(Date.now() - 6 * 60_000).toISOString(),
    totalRamMb: 131072,
    usedRamMb: 106496,
    totalCpu: 64,
    usedCpu: 51.2,
    hostedServers: 89,
    availablePorts: 210,
    reservedPorts: 790,
    portRange: "26001-27000",
    maintenanceMode: false,
    hostedServersList: [{ id: "srv_3011", name: "modded-pack-x", status: "running", ramMb: 8192, cpu: 4, port: 26008 }],
    history: [{ id: "evt_3", type: "incident", message: "High memory pressure detected", createdAt: new Date(Date.now() - 9 * 60_000).toISOString() }],
    logs: ["capacity: ram pressure above policy threshold", "scheduler: placement throttled"]
  },
  {
    id: "node-nyc-01",
    name: "New York Reserve 01",
    provider: "DigitalOcean",
    region: "us-east-nyc",
    internalHost: "10.70.0.12",
    publicHost: "nyc-01.nodes.company.internal",
    status: "maintenance",
    health: "unknown",
    runtimeMode: "docker",
    heartbeat: null,
    totalRamMb: 32768,
    usedRamMb: 2048,
    totalCpu: 16,
    usedCpu: 0.8,
    hostedServers: 0,
    availablePorts: 1000,
    reservedPorts: 0,
    portRange: "27001-28000",
    maintenanceMode: true,
    hostedServersList: [],
    history: [{ id: "evt_4", type: "maintenance", message: "Maintenance mode enabled", createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }],
    logs: ["maintenance: node isolated from scheduler"]
  }
];

function endpoint(path: string) {
  return `${env.hostingApiBaseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

async function hostingFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.hostingApiBaseUrl) {
    throw new AppError(503, "HOSTING_API_BASE_URL is not configured.", "HOSTING_API_NOT_CONFIGURED");
  }

  const method = init?.method ?? "GET";
  const maxAttempts = method === "GET" ? env.hostingApiRetryAttempts + 1 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.hostingApiTimeoutMs);

    try {
      const response = await fetch(endpoint(path), {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(env.hostingApiToken ? { authorization: `Bearer ${env.hostingApiToken}` } : {}),
          ...init?.headers
        }
      });

      if (!response.ok) {
        throw new AppError(response.status, `Hosting API request failed with status ${response.status}.`, "HOSTING_API_ERROR");
      }

      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      if (error instanceof AppError && error.statusCode < 500) throw error;
      if (attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw new AppError(504, "Hosting API request timed out or failed.", "HOSTING_API_UNAVAILABLE");
}

export const hostingApiClient = {
  async listNodes<T = HostingApiNode[]>() {
    if (!env.hostingApiBaseUrl) return mockNodes;
    return hostingFetch<T>(env.hostingApiNodesPath);
  },

  async getNode<T = HostingApiNode>(id: string) {
    if (!env.hostingApiBaseUrl) return mockNodes.find((node) => node.id === id) ?? null;
    return hostingFetch<T>(`${env.hostingApiNodesPath}/${encodeURIComponent(id)}`);
  },

  async postNodeAction<T = HostingApiNode>(id: string, action: string, body?: Record<string, unknown>) {
    if (!env.hostingApiBaseUrl) {
      const node = mockNodes.find((item) => item.id === id);
      if (!node) return null as T;
      if (action === "maintenance") {
        node.maintenanceMode = Boolean(body?.maintenanceMode);
        node.status = node.maintenanceMode ? "maintenance" : "online";
      }
      node.history = [
        { id: randomUUID(), type: action === "maintenance" ? "maintenance" : "sync", message: `Mock ${action} action accepted`, createdAt: new Date().toISOString() },
        ...(node.history ?? [])
      ];
      return node as T;
    }

    return hostingFetch<T>(`${env.hostingApiNodesPath}/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined
    });
  }
};
