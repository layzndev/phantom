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
  nodeHeartbeatTimeoutMs: Number(process.env.NODE_HEARTBEAT_TIMEOUT_MS ?? 45_000),
  nodeMonitorTickMs: Number(process.env.NODE_MONITOR_TICK_MS ?? 10_000),
  nodeMonitorEnabled: (process.env.NODE_MONITOR_ENABLED ?? "true").toLowerCase() !== "false",
  workloadDeleteTimeoutMs: Number(process.env.WORKLOAD_DELETE_TIMEOUT_MS ?? 120_000),
  workloadDeleteMonitorTickMs: Number(process.env.WORKLOAD_DELETE_MONITOR_TICK_MS ?? 10_000),
  workloadDeleteMonitorEnabled:
    (process.env.WORKLOAD_DELETE_MONITOR_ENABLED ?? "true").toLowerCase() !== "false"
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
    !Number.isFinite(env.workloadDeleteTimeoutMs) ||
    !Number.isFinite(env.workloadDeleteMonitorTickMs) ||
    env.nodeHeartbeatTimeoutMs <= 0 ||
    env.nodeMonitorTickMs <= 0 ||
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
