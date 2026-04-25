import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type WebSocketHandler = {
  onText?: (message: string) => void;
  onClose?: () => void;
};

export class WebSocketConnection {
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly socket: Duplex,
    private readonly handlers: WebSocketHandler = {}
  ) {
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("close", () => {
      this.closed = true;
      this.handlers.onClose?.();
    });
    this.socket.on("end", () => {
      this.closed = true;
      this.handlers.onClose?.();
    });
    this.socket.on("error", () => {
      this.closed = true;
      this.handlers.onClose?.();
    });
  }

  sendJson(payload: unknown) {
    this.sendText(JSON.stringify(payload));
  }

  sendText(message: string) {
    if (this.closed) {
      return;
    }
    const payload = Buffer.from(message, "utf8");
    this.socket.write(encodeFrame(0x1, payload));
  }

  close(code = 1000) {
    if (this.closed) {
      return;
    }
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.socket.write(encodeFrame(0x8, payload));
    this.socket.end();
    this.closed = true;
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) === 0x80;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) {
          return;
        }
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) {
          return;
        }
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        if (high !== 0) {
          this.close(1009);
          return;
        }
        length = low;
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) {
        return;
      }

      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskLength;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);

      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      if (opcode === 0x8) {
        this.close();
        return;
      }

      if (opcode === 0x9) {
        this.socket.write(encodeFrame(0xA, payload));
        continue;
      }

      if (opcode === 0x1) {
        this.handlers.onText?.(payload.toString("utf8"));
      }
    }
  }
}

export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  handlers: WebSocketHandler = {}
) {
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  if (!key || version !== "13") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return null;
  }

  const accept = createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );

  const connection = new WebSocketConnection(socket, handlers);
  if (head.length > 0) {
    socket.emit("data", head);
  }
  return connection;
}

function encodeFrame(opcode: number, payload: Buffer) {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }
  if (length < 65_536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(length, 6);
  return Buffer.concat([header, payload]);
}
