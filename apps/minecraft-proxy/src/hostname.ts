export interface NormalizeOptions {
  maxLength: number;
}

export interface NormalizedHostname {
  raw: string;
  hostname: string;
  truncated: boolean;
}

const NULL_OR_AFTER = /\u0000.*$/s;
const NON_PRINTABLE = /[^\x20-\x7e]/g;
const TRAILING_DOTS = /\.+$/;
const PORT_SUFFIX = /:\d+$/;
const KNOWN_MOD_SUFFIX = /\\?fml\d?\\?$|\\?forge\\?$/i;

export function normalizeHostname(input: string, options: NormalizeOptions): NormalizedHostname {
  const raw = input ?? "";

  let value = raw;
  if (value.length > options.maxLength) {
    value = value.slice(0, options.maxLength);
  }

  value = value.replace(NULL_OR_AFTER, "");
  value = value.trim().toLowerCase();
  value = value.replace(NON_PRINTABLE, "");
  value = value.replace(TRAILING_DOTS, "");
  value = value.replace(PORT_SUFFIX, "");
  value = value.replace(KNOWN_MOD_SUFFIX, "");
  value = value.trim();

  return {
    raw,
    hostname: value,
    truncated: raw.length > options.maxLength
  };
}

export function isValidHostnameShape(hostname: string) {
  if (!hostname) return false;
  if (hostname.length > 255) return false;
  return /^[a-z0-9](?:[a-z0-9.\-]*[a-z0-9])?$/.test(hostname);
}
