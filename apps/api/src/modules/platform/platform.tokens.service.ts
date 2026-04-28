import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../lib/appError.js";
import {
  createPlatformTokenRecord,
  findPlatformTokenByHash,
  listPlatformTokenRecords,
  markPlatformTokenUsed,
  revokePlatformTokenRecord
} from "../../db/platformRepository.js";
import type { PlatformTokenIssued, PlatformTokenSummary } from "./platform.types.js";

// Stripe-style prefix: phs_live_<32 random url-safe base64 chars>
const TOKEN_PREFIX = "phs_live_";
const TOKEN_BYTES = 32;

export interface IssuePlatformTokenInput {
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
  createdById?: string | null;
}

export async function issuePlatformToken(input: IssuePlatformTokenInput): Promise<PlatformTokenIssued> {
  if (!input.name || input.name.trim().length === 0) {
    throw new AppError(400, "Token name is required.", "VALIDATION_ERROR");
  }
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}${secret}`;
  const tokenHash = sha256(token);
  const prefix = token.slice(0, 12);
  const last4 = token.slice(-4);

  const record = await createPlatformTokenRecord({
    name: input.name.trim(),
    prefix,
    last4,
    tokenHash,
    scopes: input.scopes ?? ["*"],
    createdById: input.createdById ?? null,
    expiresAt: input.expiresAt ?? null
  });

  return {
    ...toSummary(record),
    token
  };
}

export async function listPlatformTokens(): Promise<PlatformTokenSummary[]> {
  const records = await listPlatformTokenRecords();
  return records.map(toSummary);
}

export async function revokePlatformToken(id: string): Promise<PlatformTokenSummary> {
  const updated = await revokePlatformTokenRecord(id);
  return toSummary(updated);
}

export interface AuthenticatedPlatformToken {
  id: string;
  name: string;
  scopes: string[];
}

export async function authenticatePlatformToken(
  rawHeader: string | undefined
): Promise<AuthenticatedPlatformToken | null> {
  const presented = extractBearer(rawHeader);
  if (!presented) return null;
  if (!presented.startsWith(TOKEN_PREFIX)) return null;

  const tokenHash = sha256(presented);
  const record = await findPlatformTokenByHash(tokenHash);
  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // tokenHash is keyed unique so the lookup is exact, but use timingSafeEqual
  // for defense-in-depth in case a future store does prefix matching.
  if (!safeEqualHex(record.tokenHash, tokenHash)) return null;

  // Fire-and-forget — we don't want lastUsedAt failures to break a request.
  void markPlatformTokenUsed(record.id).catch(() => undefined);

  return {
    id: record.id,
    name: record.name,
    scopes: Array.isArray(record.scopes) ? (record.scopes as string[]) : ["*"]
  };
}

function extractBearer(header: string | undefined) {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._\-+/=]+)\s*$/.exec(header);
  return match?.[1] ?? null;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function toSummary(record: {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: unknown;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): PlatformTokenSummary {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    last4: record.last4,
    scopes: Array.isArray(record.scopes) ? (record.scopes as string[]) : ["*"],
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null
  };
}
