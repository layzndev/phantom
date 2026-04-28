import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";
const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const cookieSameSite = process.env.COOKIE_SAMESITE ?? (isProduction ? "none" : "lax");

if (!["lax", "strict", "none"].includes(cookieSameSite)) {
  throw new Error("COOKIE_SAMESITE must be one of: lax, strict, none.");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4200),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  corsOrigins,
  trustProxy: process.env.TRUST_PROXY ?? (isProduction ? "loopback" : "1"),
  cookieSameSite: cookieSameSite as "lax" | "strict" | "none",
  databaseUrl: process.env.DATABASE_URL ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? (isProduction ? "" : "dev-phantom-session-secret-change-me"),
  adminBootstrapEmail: process.env.ADMIN_BOOTSTRAP_EMAIL ?? (isProduction ? "" : "admin@company.local"),
  adminBootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD ?? (isProduction ? "" : "ChangeMe-Admin-2026!"),
  hostingApiBaseUrl: process.env.HOSTING_API_BASE_URL ?? "",
  hostingApiToken: process.env.HOSTING_API_TOKEN ?? "",
  hostingApiNodesPath: process.env.HOSTING_API_NODES_PATH ?? "/admin/nodes",
  hostingApiTimeoutMs: Number(process.env.HOSTING_API_TIMEOUT_MS ?? 7000),
  hostingApiRetryAttempts: Number(process.env.HOSTING_API_RETRY_ATTEMPTS ?? 1),
  nodeHeartbeatTimeoutMs: Number(process.env.NODE_HEARTBEAT_TIMEOUT_MS ?? 15_000),
  nodeMonitorTickMs: Number(process.env.NODE_MONITOR_TICK_MS ?? 1_000),
  nodeMonitorEnabled: (process.env.NODE_MONITOR_ENABLED ?? "true").toLowerCase() !== "false",
  freeTierMaxRamPercent: Number(process.env.FREE_TIER_MAX_RAM_PERCENT ?? 85),
  freeTierMaxCpuPercent: Number(process.env.FREE_TIER_MAX_CPU_PERCENT ?? 85),
  queuedStartMonitorTickMs: Number(process.env.QUEUED_START_MONITOR_TICK_MS ?? 10_000),
  queuedStartMonitorEnabled:
    (process.env.QUEUED_START_MONITOR_ENABLED ?? "true").toLowerCase() !== "false",
  autoSleepEnabled: (process.env.AUTO_SLEEP_ENABLED ?? "true").toLowerCase() !== "false",
  autoSleepIdleMinutes: Number(process.env.AUTO_SLEEP_IDLE_MINUTES ?? 10),
  autoSleepMonitorTickMs: Number(process.env.AUTO_SLEEP_MONITOR_TICK_MS ?? 2_000),
  autoSleepProbeIntervalMs: Number(process.env.AUTO_SLEEP_PROBE_INTERVAL_MS ?? 20_000),
  autoSleepSampleFreshnessMs: Number(process.env.AUTO_SLEEP_SAMPLE_FRESHNESS_MS ?? 60_000),
  incidentMonitorTickMs: Number(process.env.INCIDENT_MONITOR_TICK_MS ?? 5_000),
  hostingRootDomain: process.env.HOSTING_ROOT_DOMAIN ?? "nptnz.co.uk",
  dnsProvider: (process.env.DNS_PROVIDER ?? "noop").toLowerCase(),
  dnsRecordType: (process.env.DNS_RECORD_TYPE ?? "CNAME").toUpperCase(),
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
  cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID ?? "",
  workloadDeleteTimeoutMs: Number(process.env.WORKLOAD_DELETE_TIMEOUT_MS ?? 120_000),
  workloadDeleteMonitorTickMs: Number(process.env.WORKLOAD_DELETE_MONITOR_TICK_MS ?? 10_000),
  workloadDeleteMonitorEnabled:
    (process.env.WORKLOAD_DELETE_MONITOR_ENABLED ?? "true").toLowerCase() !== "false",
  // Comma/space separated CIDR or single-IP list. Empty = allow all.
  adminIpAllowlist: process.env.ADMIN_IP_ALLOWLIST ?? "",
  runtimeIpAllowlist: process.env.RUNTIME_IP_ALLOWLIST ?? "",
  // Per-admin session pinning: bind the cookie to the IP/UA captured at login.
  sessionPinIp: (process.env.SESSION_PIN_IP ?? "true").toLowerCase() !== "false",
  sessionPinUserAgent: (process.env.SESSION_PIN_USER_AGENT ?? "true").toLowerCase() !== "false",
  // Per-IP login brute-force lockout.
  loginIpLockoutThreshold: Number(process.env.LOGIN_IP_LOCKOUT_THRESHOLD ?? 10),
  loginIpLockoutMs: Number(process.env.LOGIN_IP_LOCKOUT_MS ?? 15 * 60_000),
  loginIpFailureWindowMs: Number(process.env.LOGIN_IP_FAILURE_WINDOW_MS ?? 15 * 60_000),
  // Strict transport security in production.
  hstsMaxAgeSeconds: Number(process.env.HSTS_MAX_AGE_SECONDS ?? 60 * 60 * 24 * 365)
};

export function assertRuntimeConfig() {
  if (env.isProduction && (!env.sessionSecret || !env.adminBootstrapEmail || !env.adminBootstrapPassword || !env.databaseUrl)) {
    throw new Error("Missing production admin security configuration.");
  }

  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required for the dedicated Phantom Aurora PostgreSQL database.");
  }

  if (
    !Number.isFinite(env.nodeHeartbeatTimeoutMs) ||
    !Number.isFinite(env.nodeMonitorTickMs) ||
    !Number.isFinite(env.freeTierMaxRamPercent) ||
    !Number.isFinite(env.freeTierMaxCpuPercent) ||
    !Number.isFinite(env.queuedStartMonitorTickMs) ||
    !Number.isFinite(env.autoSleepIdleMinutes) ||
    !Number.isFinite(env.autoSleepMonitorTickMs) ||
    !Number.isFinite(env.autoSleepProbeIntervalMs) ||
    !Number.isFinite(env.autoSleepSampleFreshnessMs) ||
    !Number.isFinite(env.incidentMonitorTickMs) ||
    !Number.isFinite(env.workloadDeleteTimeoutMs) ||
    !Number.isFinite(env.workloadDeleteMonitorTickMs) ||
    env.nodeHeartbeatTimeoutMs <= 0 ||
    env.nodeMonitorTickMs <= 0 ||
    env.freeTierMaxRamPercent <= 0 ||
    env.freeTierMaxRamPercent > 100 ||
    env.freeTierMaxCpuPercent <= 0 ||
    env.freeTierMaxCpuPercent > 100 ||
    env.queuedStartMonitorTickMs <= 0 ||
    env.autoSleepIdleMinutes <= 0 ||
    env.autoSleepMonitorTickMs <= 0 ||
    env.autoSleepProbeIntervalMs <= 0 ||
    env.autoSleepSampleFreshnessMs <= 0 ||
    env.incidentMonitorTickMs <= 0 ||
    env.workloadDeleteTimeoutMs <= 0 ||
    env.workloadDeleteMonitorTickMs <= 0
  ) {
    throw new Error(
      "NODE_HEARTBEAT_TIMEOUT_MS, NODE_MONITOR_TICK_MS, WORKLOAD_DELETE_TIMEOUT_MS and WORKLOAD_DELETE_MONITOR_TICK_MS must be positive integers."
    );
  }

  if (env.nodeMonitorTickMs >= env.nodeHeartbeatTimeoutMs) {
    throw new Error("NODE_MONITOR_TICK_MS must be smaller than NODE_HEARTBEAT_TIMEOUT_MS.");
  }

  if (env.workloadDeleteMonitorTickMs >= env.workloadDeleteTimeoutMs) {
    throw new Error(
      "WORKLOAD_DELETE_MONITOR_TICK_MS must be smaller than WORKLOAD_DELETE_TIMEOUT_MS."
    );
  }

}
