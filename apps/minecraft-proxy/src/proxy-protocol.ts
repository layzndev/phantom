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

function buildHeader(protoByte: number, addresses: Buffer) {
  const header = Buffer.alloc(16 + addresses.length);
  SIG.copy(header, 0);
  header.writeUInt8(VERSION_PROXY, 12);
  header.writeUInt8(protoByte, 13);
  header.writeUInt16BE(addresses.length, 14);
  addresses.copy(header, 16);
  return header;
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
