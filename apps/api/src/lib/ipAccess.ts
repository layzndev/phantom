import net, { BlockList } from "node:net";

export interface ParsedAllowlist {
  /** Returns true when the list is empty (= allow-all). */
  isEmpty: boolean;
  /** Returns true when the IP matches one of the entries. */
  matches: (ip: string) => boolean;
  /** Original entries, used for audit/debug. */
  entries: string[];
}

const EMPTY: ParsedAllowlist = {
  isEmpty: true,
  matches: () => true,
  entries: []
};

/**
 * Parse a comma/space separated list of IPs and CIDRs into a BlockList-backed
 * matcher. Supports IPv4, IPv6 and CIDR notation (eg. "10.0.0.0/8",
 * "2001:db8::/32"). Empty lists allow everything (the call site is responsible
 * for treating them as opt-in).
 */
export function parseIpAllowlist(raw: string | undefined): ParsedAllowlist {
  if (!raw) return EMPTY;
  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return EMPTY;

  const block = new BlockList();
  const accepted: string[] = [];
  for (const token of tokens) {
    if (!addEntryToBlocklist(block, token)) {
      // Skip silently in production but warn in logs so misconfig is visible.
      console.warn("[ipAccess] ignored invalid allowlist entry", { token });
      continue;
    }
    accepted.push(token);
  }

  if (accepted.length === 0) return EMPTY;

  return {
    isEmpty: false,
    entries: accepted,
    matches: (ip) => {
      const normalized = normalizeIp(ip);
      if (!normalized) return false;
      const family = net.isIP(normalized);
      if (family === 0) return false;
      return block.check(normalized, family === 6 ? "ipv6" : "ipv4");
    }
  };
}

/**
 * Match a per-account allowlist (stored in DB as a string[]). Same semantics
 * as parseIpAllowlist but takes a parsed array.
 */
export function buildAccountAllowlist(entries: string[]): ParsedAllowlist {
  return parseIpAllowlist(entries.join(","));
}

function addEntryToBlocklist(block: BlockList, token: string) {
  try {
    if (token.includes("/")) {
      const [address, prefixRaw] = token.split("/");
      const prefix = Number.parseInt(prefixRaw ?? "", 10);
      const family = net.isIP(address ?? "");
      if (!Number.isFinite(prefix) || prefix < 0 || family === 0) return false;
      block.addSubnet(address as string, prefix, family === 6 ? "ipv6" : "ipv4");
      return true;
    }
    const family = net.isIP(token);
    if (family === 0) return false;
    block.addAddress(token, family === 6 ? "ipv6" : "ipv4");
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip IPv6-mapped IPv4 prefix and brackets. Express's `req.ip` can give
 * "::ffff:203.0.113.5" behind a proxy.
 */
export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\[|\]$/g, "");
  if (trimmed.startsWith("::ffff:")) {
    const rest = trimmed.slice(7);
    if (net.isIPv4(rest)) return rest;
  }
  return trimmed;
}
