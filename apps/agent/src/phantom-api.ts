import type {
  AgentConfig,
  AssignedWorkloadsResponse,
  MinecraftOperationCompletePayload,
  MinecraftRuntimeOperationsResponse,
  WorkloadAckActionPayload,
  WorkloadEventPayload,
  WorkloadHeartbeatPayload
} from "./types.js";

export class PhantomApiClient {
  constructor(private readonly config: AgentConfig) {}

  async getAssignedWorkloads() {
    return this.request<AssignedWorkloadsResponse>("/runtime/workloads/assigned");
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

  async listMinecraftOperations() {
    return this.request<MinecraftRuntimeOperationsResponse>(
      "/runtime/minecraft/operations/pending"
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
