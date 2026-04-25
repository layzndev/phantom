import { AppError } from "../../lib/appError.js";
import { env } from "../../config/env.js";
import { findMinecraftServerRecordByHostnameSlug } from "../../db/minecraftRepository.js";

const RESERVED = new Set([
  "admin",
  "api",
  "www",
  "mail",
  "ftp",
  "support",
  "root",
  "status",
  "ns1",
  "ns2"
]);

export function normalizeHostnameSlug(input: string) {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 32)
    .replace(/-+$/g, "");

  if (!value) {
    throw new AppError(400, "Hostname slug is required.", "HOSTNAME_SLUG_REQUIRED");
  }

  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(value)) {
    throw new AppError(400, "Invalid hostname slug.", "HOSTNAME_SLUG_INVALID");
  }

  if (RESERVED.has(value)) {
    throw new AppError(400, "Hostname slug is reserved.", "HOSTNAME_SLUG_RESERVED");
  }

  return value;
}

export function buildHostname(hostnameSlug: string) {
  return `${hostnameSlug}.${env.hostingRootDomain}`;
}

export function deriveHostnameBase(input: {
  requestedSlug?: string;
  username?: string | null;
  serverSlug: string;
  serverName: string;
}) {
  if (input.requestedSlug) {
    return normalizeHostnameSlug(input.requestedSlug);
  }

  const fallbacks = [input.username, input.serverSlug, input.serverName];
  for (const candidate of fallbacks) {
    if (!candidate) continue;
    try {
      return normalizeHostnameSlug(candidate);
    } catch {
      continue;
    }
  }

  throw new AppError(400, "Unable to derive hostname slug.", "HOSTNAME_SLUG_DERIVE_FAILED");
}

export async function allocateHostname(input: {
  requestedSlug?: string;
  username?: string | null;
  serverSlug: string;
  serverName: string;
  excludeServerId?: string;
}) {
  const base = deriveHostnameBase(input);

  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : String(index + 1);
    const candidateBase = `${base}${suffix}`.slice(0, 32);
    const candidate = normalizeHostnameSlug(candidateBase);
    const existing = await findMinecraftServerRecordByHostnameSlug(candidate);
    if (!existing || existing.id === input.excludeServerId) {
      return {
        hostnameSlug: candidate,
        hostname: buildHostname(candidate)
      };
    }
  }

  throw new AppError(409, "Unable to allocate a unique hostname.", "HOSTNAME_CONFLICT");
}

export function extractHostnameSlug(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) {
    throw new AppError(400, "Hostname is required.", "HOSTNAME_REQUIRED");
  }

  if (normalized === env.hostingRootDomain) {
    throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
  }

  const suffix = `.${env.hostingRootDomain}`;
  if (normalized.endsWith(suffix)) {
    return normalizeHostnameSlug(normalized.slice(0, -suffix.length));
  }

  if (!normalized.includes(".")) {
    return normalizeHostnameSlug(normalized);
  }

  throw new AppError(404, "Minecraft server not found.", "MINECRAFT_SERVER_NOT_FOUND");
}
