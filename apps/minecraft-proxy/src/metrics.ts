import { log } from "./logger.js";

export interface MetricsSnapshot {
  activeConnections: number;
  totalConnections: number;
  totalHandshakes: number;
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
  wakesTriggered: number;
  pingResponses: number;
  loginDisconnects: number;
  proxiedSessions: number;
  backendConnectFailures: number;
  rateLimited: number;
  routeLatencyAvgMs: number;
}

class Metrics {
  activeConnections = 0;
  totalConnections = 0;
  totalHandshakes = 0;
  cacheHits = 0;
  cacheMisses = 0;
  wakesTriggered = 0;
  pingResponses = 0;
  loginDisconnects = 0;
  proxiedSessions = 0;
  backendConnectFailures = 0;
  rateLimited = 0;

  private routeLatencySum = 0;
  private routeLatencyCount = 0;
  private cacheSizeSampler: () => number = () => 0;

  setCacheSizeSampler(sampler: () => number) {
    this.cacheSizeSampler = sampler;
  }

  recordRouteLatency(ms: number) {
    this.routeLatencySum += ms;
    this.routeLatencyCount += 1;
  }

  snapshot(): MetricsSnapshot {
    return {
      activeConnections: this.activeConnections,
      totalConnections: this.totalConnections,
      totalHandshakes: this.totalHandshakes,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheSize: this.cacheSizeSampler(),
      wakesTriggered: this.wakesTriggered,
      pingResponses: this.pingResponses,
      loginDisconnects: this.loginDisconnects,
      proxiedSessions: this.proxiedSessions,
      backendConnectFailures: this.backendConnectFailures,
      rateLimited: this.rateLimited,
      routeLatencyAvgMs:
        this.routeLatencyCount === 0
          ? 0
          : Math.round(this.routeLatencySum / this.routeLatencyCount)
    };
  }
}

export const metrics = new Metrics();

export function startMetricsLogger(intervalMs: number) {
  const timer = setInterval(() => {
    log.info("metrics", { ...metrics.snapshot() });
  }, intervalMs);
  timer.unref();
  return timer;
}
