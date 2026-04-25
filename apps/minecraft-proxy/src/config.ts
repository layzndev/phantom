import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ProxyConfig {
  apiUrl: string;
  nodeToken: string;
  listenHost: string;
  listenPort: number;

  routingTimeoutMs: number;
  backendConnectTimeoutMs: number;
  handshakeTimeoutMs: number;

  cacheRunningTtlMs: number;
  cacheMissTtlMs: number;
  cacheTransientTtlMs: number;

  maxConnections: number;
  maxBufferBytes: number;
  maxHostnameLength: number;

  rateLimitPerMinute: number;
  rateLimitBurst: number;

  enableProxyProtocol: boolean;
  metricsLogIntervalMs: number;

  rootDomain: string;
  protocolVersion: number;
  versionLabel: string;
}

export function loadConfig(): ProxyConfig {
  loadEnvFile();
  return {
    apiUrl: required("PHANTOM_API_URL").replace(/\/+$/, ""),
    nodeToken: required("PHANTOM_NODE_TOKEN"),
    listenHost: process.env.PROXY_LISTEN_HOST?.trim() || "0.0.0.0",
    listenPort: positiveInt(process.env.PROXY_LISTEN_PORT, 25565),

    routingTimeoutMs: positiveInt(process.env.PROXY_ROUTE_TIMEOUT_MS, 2_000),
    backendConnectTimeoutMs: positiveInt(process.env.PROXY_BACKEND_TIMEOUT_MS, 5_000),
    handshakeTimeoutMs: positiveInt(process.env.PROXY_HANDSHAKE_TIMEOUT_MS, 5_000),

    cacheRunningTtlMs: positiveInt(process.env.PROXY_CACHE_RUNNING_TTL_MS, 10_000),
    cacheMissTtlMs: positiveInt(process.env.PROXY_CACHE_MISS_TTL_MS, 2_000),
    cacheTransientTtlMs: positiveInt(process.env.PROXY_CACHE_TRANSIENT_TTL_MS, 1_000),

    maxConnections: positiveInt(process.env.PROXY_MAX_CONNECTIONS, 5_000),
    maxBufferBytes: positiveInt(process.env.PROXY_MAX_BUFFER_BYTES, 4_096),
    maxHostnameLength: positiveInt(process.env.PROXY_MAX_HOSTNAME_LEN, 255),

    rateLimitPerMinute: positiveInt(process.env.PROXY_RATE_LIMIT_PER_MIN, 120),
    rateLimitBurst: positiveInt(process.env.PROXY_RATE_LIMIT_BURST, 20),

    enableProxyProtocol: boolFlag(process.env.PROXY_ENABLE_PROXY_PROTOCOL, false),
    metricsLogIntervalMs: positiveInt(process.env.PROXY_METRICS_LOG_INTERVAL_MS, 60_000),

    rootDomain: (process.env.PROXY_ROOT_DOMAIN ?? "nptnz.co.uk").toLowerCase(),
    protocolVersion: positiveInt(process.env.PROXY_PROTOCOL_VERSION, 767),
    versionLabel: process.env.PROXY_VERSION_LABEL?.trim() || "Phantom"
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
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, received ${value}`);
  }
  return parsed;
}

function boolFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}
