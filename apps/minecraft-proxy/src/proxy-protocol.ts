import { isIPv4, isIPv6 } from "node:net";

const SIG = Buffer.from([
  0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a
]);

const VERSION_PROXY = 0x21;
const TCP4 = 0x11;
const TCP6 = 0x21;
const LOCAL = 0x20;

export function buildProxyV2Header(
  clientHost: string,
  clientPort: number,
  proxyHost: string,
  proxyPort: number
): Buffer {
  const isV4 = isIPv4(clientHost) && isIPv4(proxyHost);
  const isV6 = isIPv6(clientHost) || isIPv6(proxyHost);

  if (!isV4 && !isV6) {
    return buildLocalHeader();
  }

  if (isV4) {
    const addresses = Buffer.alloc(12);
    writeIPv4(clientHost, addresses, 0);
    writeIPv4(proxyHost, addresses, 4);
    addresses.writeUInt16BE(clientPort & 0xffff, 8);
    addresses.writeUInt16BE(proxyPort & 0xffff, 10);
    return buildHeader(TCP4, addresses);
  }

  const addresses = Buffer.alloc(36);
  writeIPv6(clientHost, addresses, 0);
  writeIPv6(proxyHost, addresses, 16);
  addresses.writeUInt16BE(clientPort & 0xffff, 32);
  addresses.writeUInt16BE(proxyPort & 0xffff, 34);
  return buildHeader(TCP6, addresses);
}

export type ProxyProtocolParseResult =
  | { status: "pending" }
  | { status: "none" }
  | { status: "invalid"; reason: string }
  | {
      status: "valid";
      bytesConsumed: number;
      sourceAddress: string | null;
      sourcePort: number | null;
    };

export function tryParseProxyProtocolHeader(buffer: Buffer): ProxyProtocolParseResult {
  if (buffer.length === 0) return { status: "pending" };

  const asciiPrefix = buffer.subarray(0, Math.min(buffer.length, 6)).toString("ascii");
  if ("PROXY ".startsWith(asciiPrefix) && buffer.length < 6) {
    return { status: "pending" };
  }

  if (buffer.subarray(0, Math.min(buffer.length, SIG.length)).equals(SIG.subarray(0, Math.min(buffer.length, SIG.length)))) {
    return parseProxyV2Header(buffer);
  }

  if (buffer.length >= 6 && buffer.subarray(0, 6).toString("ascii") === "PROXY ") {
    return parseProxyV1Header(buffer);
  }

  return { status: "none" };
}

function buildHeader(protoByte: number, addresses: Buffer) {
  const header = Buffer.alloc(16 + addresses.length);
  SIG.copy(header, 0);
  header.writeUInt8(VERSION_PROXY, 12);
  header.writeUInt8(protoByte, 13);
  header.writeUInt16BE(addresses.length, 14);
  addresses.copy(header, 16);
  return header;
}

function parseProxyV1Header(buffer: Buffer): ProxyProtocolParseResult {
  const end = buffer.indexOf("\r\n");
  if (end === -1) {
    return buffer.length > 108 ? { status: "invalid", reason: "proxy-v1-too-long" } : { status: "pending" };
  }

  const line = buffer.subarray(0, end).toString("ascii");
  const parts = line.split(" ");
  if (parts.length < 2 || parts[0] !== "PROXY") {
    return { status: "invalid", reason: "proxy-v1-malformed" };
  }
  if (parts[1] === "UNKNOWN") {
    return { status: "valid", bytesConsumed: end + 2, sourceAddress: null, sourcePort: null };
  }
  if ((parts[1] !== "TCP4" && parts[1] !== "TCP6") || parts.length < 6) {
    return { status: "invalid", reason: "proxy-v1-unsupported" };
  }

  const sourceAddress = parts[2];
  const sourcePort = Number.parseInt(parts[4], 10);
  if ((!isIPv4(sourceAddress) && !isIPv6(sourceAddress)) || !Number.isInteger(sourcePort)) {
    return { status: "invalid", reason: "proxy-v1-invalid-source" };
  }

  return { status: "valid", bytesConsumed: end + 2, sourceAddress, sourcePort };
}

function parseProxyV2Header(buffer: Buffer): ProxyProtocolParseResult {
  if (buffer.length < 16) return { status: "pending" };
  if (!buffer.subarray(0, SIG.length).equals(SIG)) {
    return { status: "none" };
  }

  const command = buffer.readUInt8(12);
  const family = buffer.readUInt8(13);
  const length = buffer.readUInt16BE(14);
  if (buffer.length < 16 + length) return { status: "pending" };

  if ((command & 0xf0) !== 0x20) {
    return { status: "invalid", reason: "proxy-v2-version" };
  }
  if ((command & 0x0f) === 0x00) {
    return { status: "valid", bytesConsumed: 16 + length, sourceAddress: null, sourcePort: null };
  }

  const payload = buffer.subarray(16, 16 + length);
  if (family === TCP4 && payload.length >= 12) {
    return {
      status: "valid",
      bytesConsumed: 16 + length,
      sourceAddress: [...payload.subarray(0, 4)].join("."),
      sourcePort: payload.readUInt16BE(8)
    };
  }
  if (family === TCP6 && payload.length >= 36) {
    const words: string[] = [];
    for (let offset = 0; offset < 16; offset += 2) {
      words.push(payload.readUInt16BE(offset).toString(16));
    }
    return {
      status: "valid",
      bytesConsumed: 16 + length,
      sourceAddress: words.join(":"),
      sourcePort: payload.readUInt16BE(32)
    };
  }

  return { status: "valid", bytesConsumed: 16 + length, sourceAddress: null, sourcePort: null };
}

function buildLocalHeader() {
  const header = Buffer.alloc(16);
  SIG.copy(header, 0);
  header.writeUInt8(LOCAL, 12);
  header.writeUInt8(0x00, 13);
  header.writeUInt16BE(0, 14);
  return header;
}

function writeIPv4(ip: string, target: Buffer, offset: number) {
  const parts = ip.split(".");
  for (let i = 0; i < 4; i += 1) {
    target.writeUInt8(Number.parseInt(parts[i] ?? "0", 10) & 0xff, offset + i);
  }
}

function writeIPv6(ip: string, target: Buffer, offset: number) {
  const expanded = expandIPv6(ip);
  for (let i = 0; i < 8; i += 1) {
    const word = Number.parseInt(expanded[i] ?? "0", 16) & 0xffff;
    target.writeUInt16BE(word, offset + i * 2);
  }
}

function expandIPv6(ip: string) {
  if (ip.startsWith("::ffff:") && isIPv4(ip.slice(7))) {
    const parts = ip.slice(7).split(".").map((part) => Number.parseInt(part, 10) & 0xff);
    return [
      "0", "0", "0", "0", "0", "ffff",
      ((parts[0] << 8) | parts[1]).toString(16),
      ((parts[2] << 8) | parts[3]).toString(16)
    ];
  }
  const halves = ip.split("::");
  if (halves.length === 1) {
    return halves[0].split(":");
  }
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves[1] === "" ? [] : halves[1].split(":");
  const fill = new Array(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right];
}
