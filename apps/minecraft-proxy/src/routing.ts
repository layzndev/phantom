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

export interface ResolveOptions {
  forceRefreshIfSleeping?: boolean;
  forceRefresh?: boolean;
}

interface CacheEntry {
  cachedAt: number;
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
    if (this.cache.delete(hostname)) {
      log.info("cache.invalidated", { hostname });
    }
  }

  async resolve(
    hostname: string,
    options?: ResolveOptions
  ): Promise<RoutingRecord | null> {
    const now = Date.now();
    const cached = this.cache.get(hostname);

    const bypassForSleeping =
      options?.forceRefreshIfSleeping &&
      cached?.value?.status === "sleeping";
    const bypass = options?.forceRefresh || bypassForSleeping;

    if (!bypass && cached && cached.expiresAt > now) {
      metrics.cacheHits += 1;
      log.info("cache.hit", {
        hostname,
        status: cached.value?.status ?? "miss",
        ageMs: now - cached.cachedAt
      });
      return cached.value;
    }

    if (bypassForSleeping) {
      log.info("cache.bypass", {
        hostname,
        reason: "sleeping-on-login",
        ageMs: cached ? now - cached.cachedAt : 0
      });
    }

    metrics.cacheMisses += 1;

    const existing = this.inflight.get(hostname);
    if (existing && !bypass) return existing.promise;

    const promise = this.fetchRoute(hostname).finally(() => {
      this.inflight.delete(hostname);
    });
    this.inflight.set(hostname, { promise });
    return promise;
  }

  async wake(serverId: string, hostname?: string): Promise<boolean> {
    const url = `${this.config.apiUrl}/runtime/minecraft/wake/${encodeURIComponent(serverId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.routingTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.nodeToken}` },
        signal: controller.signal
      });
      const ok = response.ok;
      if (!ok) {
        log.warn("wake.failed", { serverId, status: response.status });
      } else {
        metrics.wakesTriggered += 1;
        log.info("wake.triggered", { serverId, hostname: hostname ?? null });
      }
      if (hostname) {
        this.cache.delete(hostname);
      }
      return ok;
    } catch (error) {
      if (hostname) {
        this.cache.delete(hostname);
      }
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
        const now = Date.now();
        this.cache.set(hostname, {
          cachedAt: now,
          expiresAt: now + this.config.cacheMissTtlMs,
          value: null
        });
        return null;
      }

      if (!response.ok) {
        log.warn("routing.unhealthy", { hostname, status: response.status });
        return null;
      }

      const value = (await response.json()) as RoutingRecord;
      const now = Date.now();
      const ttl = this.ttlForStatus(value.status);
      this.cache.set(hostname, {
        cachedAt: now,
        expiresAt: now + ttl,
        value
      });
      log.info("routing.fetched", {
        hostname,
        status: value.status,
        ttlMs: ttl,
        latencyMs: latency
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
      case "sleeping":
        return this.config.cacheSleepingTtlMs;
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
