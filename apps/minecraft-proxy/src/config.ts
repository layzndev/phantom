import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ProxyConfig {
  apiUrl: string;
  nodeToken: string;
  listenHost: string;
  listenPort: number;
  routingCacheTtlMs: number;
  connectTimeoutMs: number;
}

export function loadConfig(): ProxyConfig {
  loadEnvFile();
  return {
    apiUrl: required("PHANTOM_API_URL").replace(/\/+$/, ""),
    nodeToken: required("PHANTOM_NODE_TOKEN"),
    listenHost: process.env.PROXY_LISTEN_HOST?.trim() || "0.0.0.0",
    listenPort: positiveInt(process.env.PROXY_LISTEN_PORT, 25565),
    routingCacheTtlMs: positiveInt(process.env.PROXY_ROUTING_CACHE_TTL_MS, 5_000),
    connectTimeoutMs: positiveInt(process.env.PROXY_CONNECT_TIMEOUT_MS, 5_000)
  };
}

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function positiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, received ${value}`);
  }
  return parsed;
}
