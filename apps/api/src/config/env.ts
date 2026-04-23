import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  port: Number(process.env.PORT ?? 4200),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? (isProduction ? "" : "dev-phantom-session-secret-change-me"),
  adminBootstrapEmail: process.env.ADMIN_BOOTSTRAP_EMAIL ?? (isProduction ? "" : "admin@company.local"),
  adminBootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD ?? (isProduction ? "" : "ChangeMe-Admin-2026!"),
  hostingApiBaseUrl: process.env.HOSTING_API_BASE_URL ?? "",
  hostingApiToken: process.env.HOSTING_API_TOKEN ?? "",
  hostingApiNodesPath: process.env.HOSTING_API_NODES_PATH ?? "/admin/nodes",
  hostingApiTimeoutMs: Number(process.env.HOSTING_API_TIMEOUT_MS ?? 7000),
  hostingApiRetryAttempts: Number(process.env.HOSTING_API_RETRY_ATTEMPTS ?? 1)
};

export function assertRuntimeConfig() {
  if (env.isProduction && (!env.sessionSecret || !env.adminBootstrapEmail || !env.adminBootstrapPassword || !env.databaseUrl)) {
    throw new Error("Missing production admin security configuration.");
  }

  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required for the dedicated Phantom Aurora PostgreSQL database.");
  }
}
