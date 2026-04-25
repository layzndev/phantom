export interface MinecraftHandshake {
  protocolVersion: number;
  hostname: string;
  port: number;
  nextState: 1 | 2;
}

export function tryParseHandshake(buffer: Buffer): MinecraftHandshake | null {
  try {
    let offset = 0;
    const packetLength = readVarInt(buffer, offset);
    offset += packetLength.size;
    if (buffer.length < offset + packetLength.value) {
      return null;
    }

    const packetId = readVarInt(buffer, offset);
    offset += packetId.size;
    if (packetId.value !== 0) {
      return null;
    }

    const protocolVersion = readVarInt(buffer, offset);
    offset += protocolVersion.size;

    const hostname = readString(buffer, offset);
    offset += hostname.size;

    if (buffer.length < offset + 2) {
      return null;
    }
    const port = buffer.readUInt16BE(offset);
    offset += 2;

    const nextState = readVarInt(buffer, offset);
    if (nextState.value !== 1 && nextState.value !== 2) {
      return null;
    }

    return {
      protocolVersion: protocolVersion.value,
      hostname: hostname.value.toLowerCase(),
      port,
      nextState: nextState.value
    };
  } catch {
    return null;
  }
}

export function encodeLoginDisconnect(message: string) {
  const json = JSON.stringify({ text: message });
  const payload = Buffer.concat([encodeVarInt(0), encodeString(json)]);
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

export function encodeStatusResponse(message: string, version = "Phantom Proxy") {
  const json = JSON.stringify({
    version: { name: version, protocol: 767 },
    players: { max: 0, online: 0, sample: [] },
    description: { text: message }
  });
  const payload = Buffer.concat([encodeVarInt(0), encodeString(json)]);
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

export function encodeStatusPong(payload: Buffer) {
  const packet = Buffer.concat([encodeVarInt(1), payload]);
  return Buffer.concat([encodeVarInt(packet.length), packet]);
}

export function readNextPacket(buffer: Buffer) {
  let offset = 0;
  const length = readVarInt(buffer, offset);
  offset += length.size;
  if (buffer.length < offset + length.value) {
    return null;
  }
  return {
    packet: buffer.subarray(offset, offset + length.value),
    bytes: offset + length.value
  };
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

function readString(buffer: Buffer, offset: number) {
  const length = readVarInt(buffer, offset);
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
