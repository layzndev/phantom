import net from "node:net";
import { loadConfig } from "./config.js";
import { PhantomRoutingClient } from "./api.js";
import {
  encodeLoginDisconnect,
  encodeStatusPong,
  encodeStatusResponse,
  readNextPacket,
  tryParseHandshake
} from "./minecraft-protocol.js";

const config = loadConfig();
const routing = new PhantomRoutingClient(config);

const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let handled = false;

  socket.on("data", async (chunk) => {
    if (handled) {
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    const handshake = tryParseHandshake(buffer);
    if (!handshake) {
      if (buffer.length > 2048) {
        socket.destroy();
      }
      return;
    }
    handled = true;

    try {
      console.info("[minecraft-proxy] handshake", {
        rawHostname: handshake.rawHostname,
        hostname: handshake.hostname,
        port: handshake.port,
        nextState: handshake.nextState
      });
      const route = await routing.resolve(handshake.hostname);
      if (!route) {
        return replyUnavailable(socket, handshake.nextState, "Unknown Phantom server.", buffer);
      }

      console.info("[minecraft-proxy] route accepted", {
        hostname: handshake.hostname,
        backendHost: route.host,
        backendPort: route.port,
        status: route.status
      });

      if (route.status === "sleeping") {
        return replyUnavailable(socket, handshake.nextState, "Server is sleeping. Start it from your panel.", buffer);
      }

      if (["pending", "queued_start", "creating"].includes(route.status)) {
        return replyUnavailable(socket, handshake.nextState, "Server is starting, try again soon.", buffer);
      }

      if (route.status !== "running" || !route.host || !route.port) {
        return replyUnavailable(socket, handshake.nextState, "Server temporarily unavailable.", buffer);
      }

      proxyToBackend(socket, route.host, route.port, handshake.nextState, buffer);
    } catch (error) {
      console.warn("[minecraft-proxy] routing failed", {
        error: error instanceof Error ? error.message : "unknown"
      });
      replyUnavailable(socket, handshake.nextState, "Server temporarily unavailable.", buffer);
    }
  });

  socket.on("error", () => undefined);
});

server.listen(config.listenPort, config.listenHost, () => {
  console.log(
    `[minecraft-proxy] listening on ${config.listenHost}:${config.listenPort}`
  );
});

function proxyToBackend(
  client: net.Socket,
  host: string,
  port: number,
  nextState: 1 | 2,
  initialData: Buffer
) {
  const backend = net.createConnection({ host, port });
  backend.setTimeout(config.connectTimeoutMs, () => {
    backend.destroy(new Error("backend connect timeout"));
  });

  backend.once("connect", () => {
    console.info("[minecraft-proxy] proxy connected", { host, port });
    backend.write(initialData);
    client.pipe(backend);
    backend.pipe(client);
  });

  backend.once("error", (error) => {
    console.warn("[minecraft-proxy] backend connect failed", {
      host,
      port,
      error: error instanceof Error ? error.message : "unknown"
    });
    if (!client.destroyed) {
      replyUnavailable(client, nextState, "Server temporarily unavailable.", initialData);
    }
  });

  client.once("close", () => backend.destroy());
  client.once("error", () => backend.destroy());
}

function replyUnavailable(
  socket: net.Socket,
  nextState: 1 | 2,
  message: string,
  buffered: Buffer
) {
  if (nextState === 2) {
    socket.write(encodeLoginDisconnect(message));
    socket.end();
    return;
  }

  let remaining = buffered;
  const handshakePacket = readNextPacket(remaining);
  if (!handshakePacket) {
    socket.end();
    return;
  }
  remaining = remaining.subarray(handshakePacket.bytes);

  const requestPacket = readNextPacket(remaining);
  if (!requestPacket) {
    socket.write(encodeStatusResponse(message));
    socket.end();
    return;
  }

  socket.write(encodeStatusResponse(message));
  remaining = remaining.subarray(requestPacket.bytes);

  const maybePing = readNextPacket(remaining);
  if (maybePing && maybePing.packet[0] === 0x01 && maybePing.packet.length >= 9) {
    socket.write(encodeStatusPong(maybePing.packet.subarray(1, 9)));
  }
  socket.end();
}
