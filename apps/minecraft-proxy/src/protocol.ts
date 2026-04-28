export interface MinecraftHandshake {
  protocolVersion: number;
  rawHostname: string;
  hostname: string;
  port: number;
  nextState: 1 | 2;
  bytesConsumed: number;
}

export interface ParsedPacket {
  packet: Buffer;
  bytes: number;
}

export interface StatusResponseInput {
  description: string;
  protocol: number;
  versionLabel: string;
  online?: number;
  max?: number;
  favicon?: string;
}

export function tryParseHandshake(buffer: Buffer): MinecraftHandshake | null {
  try {
    let offset = 0;
    const length = readVarInt(buffer, offset);
    offset += length.size;
    if (length.value <= 0 || length.value > 4_096) {
      return null;
    }
    if (buffer.length < offset + length.value) {
      return null;
    }
    const packetEnd = offset + length.value;

    const packetId = readVarInt(buffer, offset);
    offset += packetId.size;
    if (packetId.value !== 0) {
      return null;
    }

    const protocolVersion = readVarInt(buffer, offset);
    offset += protocolVersion.size;

    const hostname = readString(buffer, offset, 255);
    offset += hostname.size;

    if (buffer.length < offset + 2) {
      return null;
    }
    const port = buffer.readUInt16BE(offset);
    offset += 2;

    const nextState = readVarInt(buffer, offset);
    offset += nextState.size;
    if (nextState.value !== 1 && nextState.value !== 2) {
      return null;
    }
    if (offset > packetEnd) {
      return null;
    }

    return {
      protocolVersion: protocolVersion.value,
      rawHostname: hostname.value,
      hostname: hostname.value.toLowerCase(),
      port,
      nextState: nextState.value,
      bytesConsumed: packetEnd
    };
  } catch {
    return null;
  }
}

export function readNextPacket(buffer: Buffer): ParsedPacket | null {
  try {
    let offset = 0;
    const length = readVarInt(buffer, offset);
    offset += length.size;
    if (length.value < 0 || length.value > 32_768) {
      return null;
    }
    if (buffer.length < offset + length.value) {
      return null;
    }
    return {
      packet: buffer.subarray(offset, offset + length.value),
      bytes: offset + length.value
    };
  } catch {
    return null;
  }
}

export function tryParseLoginStart(buffer: Buffer): string | null {
  try {
    const packet = readNextPacket(buffer);
    if (!packet) return null;

    let offset = 0;
    const packetId = readVarInt(packet.packet, offset);
    offset += packetId.size;
    if (packetId.value !== 0) return null;

    const username = readString(packet.packet, offset, 64);
    return username.value || null;
  } catch {
    return null;
  }
}

export function encodeLoginDisconnect(message: string) {
  const json = JSON.stringify({ text: message });
  const payload = Buffer.concat([encodeVarInt(0), encodeString(json)]);
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

export function encodeStatusResponse(input: StatusResponseInput) {
  const json = JSON.stringify({
    version: { name: input.versionLabel, protocol: input.protocol },
    players: {
      max: input.max ?? 20,
      online: input.online ?? 0,
      sample: []
    },
    description: { text: input.description },
    ...(input.favicon ? { favicon: input.favicon } : {})
  });
  const payload = Buffer.concat([encodeVarInt(0), encodeString(json)]);
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

export function encodeStatusPong(payload: Buffer) {
  const packet = Buffer.concat([encodeVarInt(1), payload]);
  return Buffer.concat([encodeVarInt(packet.length), packet]);
}

export function readVarInt(buffer: Buffer, offset: number) {
  let num = 0;
  let shift = 0;
  let size = 0;

  while (true) {
    if (offset + size >= buffer.length) {
      throw new Error("incomplete varint");
    }
    const byte = buffer[offset + size];
    num |= (byte & 0x7f) << shift;
    size += 1;
    if ((byte & 0x80) !== 0x80) {
      break;
    }
    shift += 7;
    if (size > 5) {
      throw new Error("varint too big");
    }
  }

  return { value: num, size };
}

function readString(buffer: Buffer, offset: number, maxLength: number) {
  const length = readVarInt(buffer, offset);
  if (length.value < 0 || length.value > maxLength * 4) {
    throw new Error("string too long");
  }
  const start = offset + length.size;
  const end = start + length.value;
  if (buffer.length < end) {
    throw new Error("incomplete string");
  }
  return {
    value: buffer.toString("utf8", start, end),
    size: length.size + length.value
  };
}

function encodeVarInt(value: number) {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    let temp = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function encodeString(value: string) {
  const payload = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}
