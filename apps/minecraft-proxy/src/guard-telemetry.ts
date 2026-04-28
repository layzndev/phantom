import type { ProxyConfig } from "./config.js";
import { log } from "./logger.js";

export type GuardAction =
  | "ping"
  | "login_attempt"
  | "login_success"
  | "disconnect"
  | "invalid_session"
  | "rate_limited"
  | "blocked";

export interface GuardConnectionEvent {
  createdAt?: string;
  serverId?: string | null;
  nodeId?: string | null;
  hostname?: string | null;
  sourceIp: string;
  usernameAttempted?: string | null;
  onlineMode?: boolean | null;
  protocolVersion?: number | null;
  clientBrand?: string | null;
  action: GuardAction;
  disconnectReason?: string | null;
  latencyMs?: number | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GuardDecision {
  action: "allow" | "blocked" | "rate_limited" | "shadow_throttle";
  trusted?: boolean;
  reason?: string;
  rateLimitPerMinute?: number;
  delayMs?: number;
  expiresAt?: string | null;
  riskScore?: number;
}

interface DecisionCacheEntry {
  expiresAt: number;
  decision: GuardDecision;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  capacity: number;
  refillPerMs: number;
}

export class GuardTelemetryClient {
  private readonly queue: GuardConnectionEvent[] = [];
  private readonly decisions = new Map<string, DecisionCacheEntry>();
  private readonly rateBuckets = new Map<string, Bucket>();
  private readonly timer: NodeJS.Timeout | null;
  private flushing = false;

  constructor(private readonly config: ProxyConfig) {
    this.timer = this.config.guardEnabled
      ? setInterval(() => void this.flush(), this.config.guardFlushIntervalMs)
      : null;
    this.timer?.unref();
  }

  record(event: GuardConnectionEvent) {
    if (!this.config.guardEnabled) {
      return;
    }
    this.queue.push({
      createdAt: new Date().toISOString(),
      ...event
    });
    if (this.queue.length >= this.config.guardBatchSize) {
      void this.flush();
    }
  }

  async checkDecision(sourceIp: string, hostname: string | null): Promise<GuardDecision> {
    if (!this.config.guardEnabled || !this.config.guardDecisionEnabled) {
      return { action: "allow" };
    }

    const key = `${sourceIp}|${hostname ?? ""}`;
    const now = Date.now();
    const cached = this.decisions.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.decision;
    }

    const params = new URLSearchParams({ sourceIp });
    if (hostname) params.set("hostname", hostname);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.guardDecisionTimeoutMs);

    try {
      const response = await fetch(`${this.config.apiUrl}/runtime/guard/decision?${params}`, {
        headers: { authorization: `Bearer ${this.config.nodeToken}` },
        signal: controller.signal
      });
      if (!response.ok) {
        return { action: "allow" };
      }
      const payload = (await response.json()) as { decision?: GuardDecision };
      const decision = payload.decision ?? { action: "allow" as const };
      this.decisions.set(key, {
        decision,
        expiresAt: now + this.config.guardDecisionCacheTtlMs
      });
      return decision;
    } catch {
      return { action: "allow" };
    } finally {
      clearTimeout(timeout);
    }
  }

  allowRateLimitedDecision(sourceIp: string, hostname: string | null, perMinute: number) {
    const key = `${sourceIp}|${hostname ?? ""}`;
    const now = Date.now();
    const capacity = Math.max(1, perMinute);
    const refillPerMs = capacity / 60_000;
    let bucket = this.rateBuckets.get(key);
    if (!bucket || bucket.capacity !== capacity) {
      bucket = { tokens: capacity, updatedAt: now, capacity, refillPerMs };
      this.rateBuckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.updatedAt;
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
      bucket.updatedAt = now;
    }

    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  async flush() {
    if (this.flushing || this.queue.length === 0) {
      return;
    }
    this.flushing = true;
    const batch = this.queue.splice(0, this.config.guardBatchSize);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.guardTelemetryTimeoutMs);

    try {
      const response = await fetch(`${this.config.apiUrl}/runtime/guard/events`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.nodeToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal
      });
      if (!response.ok) {
        log.warn("guard.telemetry.failed", { status: response.status, events: batch.length });
      }
    } catch (error) {
      log.warn("guard.telemetry.error", {
        error: error instanceof Error ? error.message : "unknown",
        events: batch.length
      });
    } finally {
      clearTimeout(timeout);
      this.flushing = false;
    }
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
