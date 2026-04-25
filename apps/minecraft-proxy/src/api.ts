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

const NEGATIVE_CACHE_TTL_MS = 1_000;

export class PhantomRoutingClient {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: ProxyConfig) {}

  async resolve(hostname: string): Promise<RoutingRecord | null> {
    const key = normalizeRoutingHostname(hostname);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      console.info("[minecraft-proxy] routing cache hit", {
        hostname,
        normalizedHostname: key,
        cachedStatus: cached.value?.status ?? "miss"
      });
      return cached.value;
    }

    const url = `${this.config.apiUrl}/runtime/minecraft/routing?hostname=${encodeURIComponent(key)}`;
    console.info("[minecraft-proxy] routing lookup", {
      hostname,
      normalizedHostname: key,
      url
    });

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${this.config.nodeToken}`
      }
    });

    console.info("[minecraft-proxy] routing response", {
      hostname,
      normalizedHostname: key,
      status: response.status
    });

    if (response.status === 404) {
      this.cache.set(key, {
        expiresAt: now + NEGATIVE_CACHE_TTL_MS,
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

function normalizeRoutingHostname(value: string) {
  const withoutNullBytes = value.replace(/\0.*$/s, "");
  const withoutWeirdWhitespace = withoutNullBytes.trim().toLowerCase();
  const withoutTrailingDot = withoutWeirdWhitespace.replace(/\.+$/, "");
  const withoutPort = withoutTrailingDot.replace(/:\d+$/, "");
  const sanitized = withoutPort.replace(/[^\x20-\x7e]/g, "");
  return sanitized;
}
