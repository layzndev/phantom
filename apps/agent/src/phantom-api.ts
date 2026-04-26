import type {
  AgentConfig,
  AssignedWorkloadsResponse,
  MinecraftOperationCompletePayload,
  MinecraftRuntimeOperationsResponse,
  NodeHeartbeatPayload,
  RuntimeMinecraftConsoleStreamsResponse,
  WorkloadAckActionPayload,
  WorkloadAckDeletePayload,
  WorkloadEventPayload,
  WorkloadHeartbeatPayload
} from "./types.js";

export class PhantomApiClient {
  constructor(private readonly config: AgentConfig) {}

  async getAssignedWorkloads() {
    return this.request<AssignedWorkloadsResponse>("/runtime/workloads/assigned");
  }

  async sendNodeHeartbeat(payload: NodeHeartbeatPayload) {
    return this.request(`/runtime/nodes/${encodeURIComponent(this.config.nodeId)}/heartbeat`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async sendHeartbeat(workloadId: string, payload: WorkloadHeartbeatPayload) {
    return this.request(`/runtime/workloads/${encodeURIComponent(workloadId)}/heartbeat`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async sendEvent(workloadId: string, payload: WorkloadEventPayload) {
    return this.request(`/runtime/workloads/${encodeURIComponent(workloadId)}/events`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async ackAction(workloadId: string, payload: WorkloadAckActionPayload) {
    return this.request(`/runtime/workloads/${encodeURIComponent(workloadId)}/ack-action`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async ackDelete(workloadId: string, payload: WorkloadAckDeletePayload) {
    return this.request(`/runtime/workloads/${encodeURIComponent(workloadId)}/ack-delete`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listMinecraftOperations() {
    return this.request<MinecraftRuntimeOperationsResponse>(
      "/runtime/minecraft/operations/pending"
    );
  }

  async listMinecraftConsoleStreams() {
    return this.request<RuntimeMinecraftConsoleStreamsResponse>(
      "/runtime/minecraft/consoles/active"
    );
  }

  async waitMinecraftConsoleStreams(cursor: number, timeoutMs: number) {
    const params = new URLSearchParams({
      cursor: String(cursor),
      timeoutMs: String(timeoutMs)
    });
    return this.request<RuntimeMinecraftConsoleStreamsResponse>(
      `/runtime/minecraft/consoles/watch?${params.toString()}`
    );
  }

  async publishMinecraftConsoleLogs(serverId: string, payload: { lines: string[] }) {
    return this.request<{ ok: true }>(
      `/runtime/minecraft/servers/${encodeURIComponent(serverId)}/console/logs`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  async claimMinecraftOperation(opId: string) {
    return this.request<{ ok: true }>(
      `/runtime/minecraft/operations/${encodeURIComponent(opId)}/claim`,
      { method: "POST" }
    );
  }

  async completeMinecraftOperation(opId: string, payload: MinecraftOperationCompletePayload) {
    return this.request<{ ok: true }>(
      `/runtime/minecraft/operations/${encodeURIComponent(opId)}/complete`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.nodeToken}`,
        ...init?.headers
      }
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Request failed." }));
      throw new Error(
        `Phantom API request failed (${response.status}): ${payload.error ?? "Unknown error"}`
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
