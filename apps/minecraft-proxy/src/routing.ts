import type { ProxyConfig } from "./config.js";
import { metrics } from "./metrics.js";
import { log } from "./logger.js";

export type RoutingStatus =
  | "running"
  | "starting"
  | "waking"
  | "sleeping"
  | "stopping"
  | "stopped"
  | "crashed"
  | "unknown";

export interface RoutingRecord {
  serverId: string;
  status: RoutingStatus;
  nodeId: string | null;
  host: string | null;
  port: number | null;
  motd: string | null;
  version: string;
  planTier: string;
}

interface CacheEntry {
  expiresAt: number;
  value: RoutingRecord | null;
}

interface InflightEntry {
  promise: Promise<RoutingRecord | null>;
}

export class PhantomRoutingClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, InflightEntry>();

  constructor(private readonly config: ProxyConfig) {
    metrics.setCacheSizeSampler(() => this.cache.size);
  }

  cacheSize() {
    return this.cache.size;
  }

  invalidate(hostname: string) {
    this.cache.delete(hostname);
  }

  markWaking(hostname: string, record: RoutingRecord) {
    const updated: RoutingRecord = { ...record, status: "waking" };
    this.cache.set(hostname, {
      expiresAt: Date.now() + this.config.cacheTransientTtlMs,
      value: updated
    });
  }

  async resolve(hostname: string): Promise<RoutingRecord | null> {
    const now = Date.now();
    const cached = this.cache.get(hostname);
    if (cached && cached.expiresAt > now) {
      metrics.cacheHits += 1;
      return cached.value;
    }
    metrics.cacheMisses += 1;

    const existing = this.inflight.get(hostname);
    if (existing) return existing.promise;

    const promise = this.fetchRoute(hostname).finally(() => {
      this.inflight.delete(hostname);
    });
    this.inflight.set(hostname, { promise });
    return promise;
  }

  async wake(serverId: string): Promise<boolean> {
    const url = `${this.config.apiUrl}/runtime/minecraft/wake/${encodeURIComponent(serverId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.routingTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.nodeToken}` },
        signal: controller.signal
      });
      if (!response.ok) {
        log.warn("wake.failed", { serverId, status: response.status });
        return false;
      }
      metrics.wakesTriggered += 1;
      log.info("wake.triggered", { serverId });
      return true;
    } catch (error) {
      log.warn("wake.error", {
        serverId,
        error: error instanceof Error ? error.message : "unknown"
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchRoute(hostname: string): Promise<RoutingRecord | null> {
    const start = Date.now();
    const url = `${this.config.apiUrl}/runtime/minecraft/routing?hostname=${encodeURIComponent(hostname)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.routingTimeoutMs);

    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${this.config.nodeToken}` },
        signal: controller.signal
      });
      const latency = Date.now() - start;
      metrics.recordRouteLatency(latency);

      if (response.status === 404) {
        this.cache.set(hostname, {
          expiresAt: Date.now() + this.config.cacheMissTtlMs,
          value: null
        });
        return null;
      }

      if (!response.ok) {
        log.warn("routing.unhealthy", {
          hostname,
          status: response.status
        });
        return null;
      }

      const value = (await response.json()) as RoutingRecord;
      const ttl = this.ttlForStatus(value.status);
      this.cache.set(hostname, {
        expiresAt: Date.now() + ttl,
        value
      });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      log.warn("routing.error", { hostname, error: message });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private ttlForStatus(status: RoutingStatus) {
    switch (status) {
      case "running":
        return this.config.cacheRunningTtlMs;
      case "waking":
      case "starting":
      case "stopping":
      case "crashed":
        return this.config.cacheTransientTtlMs;
      default:
        return this.config.cacheTransientTtlMs;
    }
  }
}
