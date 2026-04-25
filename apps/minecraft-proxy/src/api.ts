import type { ProxyConfig } from "./config.js";

export interface RoutingRecord {
  serverId: string;
  status: string;
  nodeId: string | null;
  host: string | null;
  port: number | null;
  motd: string | null;
  version: string;
  planTier: string;
}

type CacheEntry = {
  expiresAt: number;
  value: RoutingRecord | null;
};

export class PhantomRoutingClient {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: ProxyConfig) {}

  async resolve(hostname: string): Promise<RoutingRecord | null> {
    const key = hostname.trim().toLowerCase();
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const response = await fetch(
      `${this.config.apiUrl}/runtime/minecraft/routing?hostname=${encodeURIComponent(key)}`,
      {
        headers: {
          authorization: `Bearer ${this.config.nodeToken}`
        }
      }
    );

    if (response.status === 404) {
      this.cache.set(key, {
        expiresAt: now + this.config.routingCacheTtlMs,
        value: null
      });
      return null;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "request failed" }));
      throw new Error(
        `routing lookup failed (${response.status}): ${payload.error ?? "unknown error"}`
      );
    }

    const value = (await response.json()) as RoutingRecord;
    this.cache.set(key, {
      expiresAt: now + this.config.routingCacheTtlMs,
      value
    });
    return value;
  }
}
