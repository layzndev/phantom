import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentConfig, LogLevel } from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_DATA_DIR = "/srv/phantom";

export function loadConfig(): AgentConfig {
  loadEnvFile();

  const apiUrl = required("PHANTOM_API_URL");
  const nodeToken = required("PHANTOM_NODE_TOKEN");
  const nodeId = required("PHANTOM_NODE_ID");
  const pollIntervalMs = positiveInt(
    process.env.PHANTOM_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS
  );
  const heartbeatIntervalMs = positiveInt(
    process.env.PHANTOM_HEARTBEAT_INTERVAL_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS
  );
  const agentId = process.env.PHANTOM_AGENT_ID?.trim() || `${nodeId}-agent`;
  const logLevel = normalizeLogLevel(process.env.PHANTOM_AGENT_LOG_LEVEL);
  const dataDir = normalizeDataDir(process.env.PHANTOM_DATA_DIR) ?? DEFAULT_DATA_DIR;

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    nodeToken,
    nodeId,
    pollIntervalMs,
    heartbeatIntervalMs,
    agentId,
    logLevel,
    dataDir
  };
}

function normalizeDataDir(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
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
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer value, received: ${value}`);
  }

  return parsed;
}

function normalizeLogLevel(value: string | undefined): LogLevel {
  switch (value?.toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value.toLowerCase() as LogLevel;
    default:
      return "info";
  }
}
