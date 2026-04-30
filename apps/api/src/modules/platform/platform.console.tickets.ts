import { randomBytes } from "node:crypto";

const TICKET_BYTES = 24;
const DEFAULT_TTL_MS = 60_000;

interface TicketRecord {
  ticket: string;
  serverId: string;
  tenantId: string;
  expiresAt: number;
  // Tracks the platform token name that minted the ticket — useful for
  // audit. The bearer never reaches the WebSocket client.
  mintedBy: string;
}

const tickets = new Map<string, TicketRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of tickets.entries()) {
    if (record.expiresAt <= now) tickets.delete(key);
  }
}, 30_000).unref();

export interface IssueConsoleTicketResult {
  ticket: string;
  expiresAt: string;
  ttlSeconds: number;
}

export function issueConsoleTicket(input: {
  serverId: string;
  tenantId: string;
  mintedBy: string;
  ttlMs?: number;
}): IssueConsoleTicketResult {
  const ttl = Math.min(input.ttlMs ?? DEFAULT_TTL_MS, 5 * 60_000);
  const ticket = `phct_${randomBytes(TICKET_BYTES).toString("base64url")}`;
  const expiresAt = Date.now() + ttl;
  tickets.set(ticket, {
    ticket,
    serverId: input.serverId,
    tenantId: input.tenantId,
    mintedBy: input.mintedBy,
    expiresAt
  });
  return {
    ticket,
    expiresAt: new Date(expiresAt).toISOString(),
    ttlSeconds: Math.floor(ttl / 1000)
  };
}

export interface ConsumedTicket {
  serverId: string;
  tenantId: string;
  mintedBy: string;
}

/**
 * Single-use redemption: returns the ticket payload and deletes it
 * immediately. A second WS attempt with the same ticket fails.
 */
export function redeemConsoleTicket(rawTicket: string): ConsumedTicket | null {
  if (!rawTicket || !rawTicket.startsWith("phct_")) return null;
  const record = tickets.get(rawTicket);
  if (!record) return null;
  tickets.delete(rawTicket);
  if (record.expiresAt <= Date.now()) return null;
  return {
    serverId: record.serverId,
    tenantId: record.tenantId,
    mintedBy: record.mintedBy
  };
}
