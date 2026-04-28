import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { env } from "../../config/env.js";

export interface GuardGeoResult {
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: string | null;
  isp: string | null;
}

interface ReaderLike {
  get(ip: string): unknown;
}

interface MaxmindLike {
  open(path: string): Promise<ReaderLike>;
  default?: { open(path: string): Promise<ReaderLike> };
}

interface JsonGeoRecord {
  countryCode?: string;
  region?: string;
  city?: string;
  asn?: string | number;
  isp?: string;
}

interface GuardGeoLookup {
  cityReader: ReaderLike | null;
  asnReader: ReaderLike | null;
  jsonRecords: Map<string, JsonGeoRecord>;
}

let lookupPromise: Promise<GuardGeoLookup> | null = null;

export async function lookupGuardGeo(ip: string | null | undefined): Promise<GuardGeoResult> {
  const normalized = normalizeIp(ip);
  if (!normalized) {
    return emptyGeo();
  }

  if (isPrivateOrLocalIp(normalized)) {
    return {
      countryCode: "ZZ",
      region: "Private Network",
      city: null,
      asn: null,
      isp: null
    };
  }

  const lookup = await getLookup();
  const fromJson = lookup.jsonRecords.get(normalized);
  const cityRecord = lookup.cityReader?.get(normalized);
  const asnRecord = lookup.asnReader?.get(normalized);

  return {
    countryCode:
      stringFromPath(cityRecord, ["country", "iso_code"]) ??
      sanitizeCountry(fromJson?.countryCode),
    region:
      stringFromPath(cityRecord, ["subdivisions", 0, "iso_code"]) ??
      stringFromPath(cityRecord, ["subdivisions", 0, "names", "en"]) ??
      fromJson?.region ??
      null,
    city: stringFromPath(cityRecord, ["city", "names", "en"]) ?? fromJson?.city ?? null,
    asn:
      numberOrStringFromPath(asnRecord, ["autonomous_system_number"]) ??
      stringifyOptional(fromJson?.asn),
    isp:
      stringFromPath(asnRecord, ["autonomous_system_organization"]) ??
      fromJson?.isp ??
      null
  };
}

function getLookup() {
  lookupPromise ??= loadLookup();
  return lookupPromise;
}

async function loadLookup(): Promise<GuardGeoLookup> {
  const [cityReader, asnReader] = await Promise.all([
    openReader(env.guardGeoLiteCityPath),
    openReader(env.guardGeoLiteAsnPath)
  ]);

  return {
    cityReader,
    asnReader,
    jsonRecords: loadJsonRecords(env.guardGeoJsonPath)
  };
}

async function openReader(path: string) {
  if (!path || !existsSync(path)) {
    return null;
  }

  try {
    const imported = (await import("maxmind")) as unknown as MaxmindLike;
    const maxmind = imported.default ?? imported;
    return await maxmind.open(path);
  } catch (error) {
    console.warn("[guard] failed to open GeoIP database", {
      path,
      error: error instanceof Error ? error.message : "unknown"
    });
    return null;
  }
}

function loadJsonRecords(path: string) {
  const records = new Map<string, JsonGeoRecord>();
  if (!path || !existsSync(path)) {
    return records;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, JsonGeoRecord>;
    for (const [ip, record] of Object.entries(parsed)) {
      const normalized = normalizeIp(ip);
      if (normalized) records.set(normalized, record);
    }
  } catch (error) {
    console.warn("[guard] failed to load GeoIP JSON fallback", {
      path,
      error: error instanceof Error ? error.message : "unknown"
    });
  }
  return records;
}

function normalizeIp(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withoutMappedPrefix = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  return isIP(withoutMappedPrefix) ? withoutMappedPrefix : null;
}

function isPrivateOrLocalIp(ip: string) {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) return true;
  return ip.toLowerCase().startsWith("fe80:");
}

function emptyGeo(): GuardGeoResult {
  return {
    countryCode: null,
    region: null,
    city: null,
    asn: null,
    isp: null
  };
}

function stringFromPath(value: unknown, path: Array<string | number>) {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown> | unknown[])[part as never];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function numberOrStringFromPath(value: unknown, path: Array<string | number>) {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown> | unknown[])[part as never];
  }
  return stringifyOptional(current);
}

function stringifyOptional(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function sanitizeCountry(value: string | undefined) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}
